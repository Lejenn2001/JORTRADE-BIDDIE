import WebSocket from "ws";
import { getPolygonKey, isUsingDevKey } from "./polygonKey";

const POLYGON_KEY = () => getPolygonKey();
const POLYGON_WS_URL = "wss://socket.polygon.io/stocks";

// Polygon allows only ONE live WebSocket connection per ACCOUNT (not per key).
// The deployed (production) app owns that single slot so paying members get live
// data. The dev workspace may open its OWN WS ONLY when it has a dedicated key
// that belongs to a SEPARATE Polygon account — otherwise dev and prod fight over
// the one slot and Polygon kicks both with code 1008 in a loop.
//
// A different key string on the SAME account is NOT enough (still 1008), so dev
// WS is gated behind an EXPLICIT opt-in (POLYGON_DEV_WS=1) that confirms the dev
// key is a separate account. Default for dev = REST snapshot polling, which can
// never steal prod's slot.
//   • POLYGON_WS_FORCE=1   → always use WS (overrides everything; use if prod is down)
//   • POLYGON_REST_ONLY=1  → force REST-only regardless of NODE_ENV
//   • NODE_ENV=development → REST-only UNLESS POLYGON_DEV_WS=1 AND a dedicated dev key
const DEV_WS_ENABLED =
  process.env["NODE_ENV"] === "development" &&
  isUsingDevKey() &&
  process.env["POLYGON_DEV_WS"] === "1";
const REST_ONLY =
  process.env["POLYGON_WS_FORCE"] !== "1" &&
  (process.env["POLYGON_REST_ONLY"] === "1" ||
    (process.env["NODE_ENV"] === "development" && !DEV_WS_ENABLED));
console.log(
  `[price-monitor] mode: ${REST_ONLY ? "REST-only (WS disabled)" : "WebSocket (real-time)"} (NODE_ENV=${process.env["NODE_ENV"] ?? "unset"}, devKey=${isUsingDevKey()}, devWs=${DEV_WS_ENABLED})`,
);
const POLYGON_SNAPSHOT_URL = (tickers: string) =>
  `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${POLYGON_KEY()}`;
const POLYGON_TICKER_SNAPSHOT_URL = (ticker: string) =>
  `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_KEY()}`;

interface PriceData {
  price: number;
  high: number;
  low: number;
  volume: number;
  lastUpdate: number;
  trades: number;
  source?: "ws" | "rest" | "snapshot";
  bid?: number;
  ask?: number;
  prevClose?: number;
  changePercent?: number;
}

type PriceCallback = (ticker: string, data: PriceData, tradeVolume?: number) => void;

class PriceMonitor {
  private ws: WebSocket | null = null;
  private subscribedTickers = new Set<string>();
  private priceData = new Map<string, PriceData>();
  private callbacks: PriceCallback[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotPollTimer: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private isShuttingDown = false;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private authenticated = false;

  connect() {
    if (this.isShuttingDown) return;
    if (REST_ONLY) {
      // Dev: do not open the real-time WS. Serve prices via REST polling instead
      // so we never take the live app's single Polygon connection slot.
      if (!this.snapshotPollTimer && this.subscribedTickers.size > 0) {
        this.fetchSnapshotForTickers([...this.subscribedTickers]);
        this.startSnapshotPoll();
      }
      return;
    }
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    if (!POLYGON_KEY()) {
      console.log("[price-monitor] No POLYGON_API_KEY, skipping WebSocket connection");
      return;
    }

    this.isConnecting = true;
    this.authenticated = false;
    console.log("[price-monitor] Connecting to Polygon.io WebSocket...");

    try {
      this.ws = new WebSocket(POLYGON_WS_URL);

      this.ws.on("open", () => {
        this.isConnecting = false;
        console.log("[price-monitor] Connected to Polygon.io, authenticating...");

        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.reconnectDelay = 1000;
          }
        }, 30000);

        this.ws!.send(JSON.stringify({ action: "auth", params: POLYGON_KEY() }));
      });

      this.ws.on("message", (raw: WebSocket.Data) => {
        try {
          const messages = JSON.parse(raw.toString());
          if (!Array.isArray(messages)) return;

          for (const msg of messages) {
            if (msg.ev === "status") {
              if (msg.status === "auth_success") {
                this.authenticated = true;
                console.log(`[price-monitor] Authenticated. Subscribing ${this.subscribedTickers.size} tickers`);
                this.resubscribeAll();
                this.startHeartbeat();
                this.startSnapshotPoll();
              } else if (msg.status === "auth_failed") {
                console.error("[price-monitor] Polygon auth failed:", msg.message);
              }
            } else if (msg.ev === "T") {
              const ticker = msg.sym;
              const price = msg.p;
              const volume = msg.s || 0;

              if (!ticker || !price) continue;

              let data = this.priceData.get(ticker);
              if (!data) {
                data = { price, high: price, low: price, volume: 0, lastUpdate: Date.now(), trades: 0, source: "ws" };
                this.priceData.set(ticker, data);
              }

              data.price = price;
              data.volume += volume;
              data.trades++;
              data.lastUpdate = Date.now();
              data.source = "ws";

              if (price > data.high) data.high = price;
              if (price < data.low) data.low = price;

              for (const cb of this.callbacks) {
                try { cb(ticker, data, volume); } catch {}
              }
            } else if (msg.ev === "Q") {
              const ticker = msg.sym;
              if (!ticker) continue;
              const data = this.priceData.get(ticker);
              if (data) {
                data.bid = msg.bp;
                data.ask = msg.ap;
              }
            }
          }
        } catch {}
      });

      this.ws.on("close", (code: number) => {
        this.isConnecting = false;
        this.authenticated = false;
        this.stopHeartbeat();
        if (this.isShuttingDown) {
          console.log(`[price-monitor] Disconnected (code ${code}), shutdown requested`);
          return;
        }
        console.log(`[price-monitor] Disconnected (code ${code}), reconnecting in ${this.reconnectDelay}ms`);
        this.scheduleReconnect();
      });

      this.ws.on("error", (err: Error) => {
        this.isConnecting = false;
        console.error(`[price-monitor] WebSocket error: ${err.message}`);
      });
    } catch (err: any) {
      this.isConnecting = false;
      console.error(`[price-monitor] Connection failed: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  private resubscribeAll() {
    if (!this.authenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedTickers.size === 0) return;

    const tradeSubs = [...this.subscribedTickers].map(t => `T.${t}`).join(",");
    const quoteSubs = [...this.subscribedTickers].map(t => `Q.${t}`).join(",");
    this.ws.send(JSON.stringify({ action: "subscribe", params: `${tradeSubs},${quoteSubs}` }));
    console.log(`[price-monitor] Subscribed to ${this.subscribedTickers.size} tickers (trades + quotes)`);
  }

  private sendSubscribe(ticker: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify({ action: "subscribe", params: `T.${ticker},Q.${ticker}` }));
    }
  }

  private sendUnsubscribe(ticker: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify({ action: "unsubscribe", params: `T.${ticker},Q.${ticker}` }));
    }
  }

  subscribe(tickers: string[]) {
    let added = false;
    for (const ticker of tickers) {
      if (!this.subscribedTickers.has(ticker)) {
        this.subscribedTickers.add(ticker);
        this.sendSubscribe(ticker);
        added = true;
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    }
    if (added) {
      this.fetchSnapshotForTickers(tickers);
      if (!this.snapshotPollTimer) this.startSnapshotPoll();
    }
  }

  unsubscribe(tickers: string[]) {
    for (const ticker of tickers) {
      if (this.subscribedTickers.has(ticker)) {
        this.subscribedTickers.delete(ticker);
        this.sendUnsubscribe(ticker);
        this.priceData.delete(ticker);
      }
    }
  }

  updateSubscriptions(newTickers: string[]) {
    const newSet = new Set(newTickers);
    const toRemove = [...this.subscribedTickers].filter(t => !newSet.has(t));
    const toAdd = newTickers.filter(t => !this.subscribedTickers.has(t));

    if (toRemove.length > 0) this.unsubscribe(toRemove);
    if (toAdd.length > 0) this.subscribe(toAdd);
  }

  onPrice(callback: PriceCallback) {
    this.callbacks.push(callback);
  }

  getPrice(ticker: string): PriceData | null {
    return this.priceData.get(ticker) || null;
  }

  getAllPrices(): Map<string, PriceData> {
    return new Map(this.priceData);
  }

  getSubscribedTickers(): string[] {
    return [...this.subscribedTickers];
  }

  async fetchSnapshotForTickers(tickers: string[]): Promise<void> {
    if (!POLYGON_KEY() || tickers.length === 0) return;
    try {
      const batches: string[][] = [];
      for (let i = 0; i < tickers.length; i += 20) {
        batches.push(tickers.slice(i, i + 20));
      }

      for (const batch of batches) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const url = POLYGON_SNAPSHOT_URL(batch.join(","));
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) {
          console.log(`[price-monitor] Snapshot HTTP ${resp.status} for batch`);
          continue;
        }

        const json = await resp.json() as any;
        if (json.status !== "OK" || !Array.isArray(json.tickers)) continue;

        for (const t of json.tickers) {
          const ticker = t.ticker;
          if (!ticker) continue;

          // Use || (not ??) so zero-valued fields fall through. When the market
          // is closed (weekend/holiday/pre-market) lastTrade.p and day.c are 0,
          // so fall back to the previous session close — the ticker then shows
          // the last known price instead of going blank.
          const lastTrade = t.lastTrade?.p || t.day?.c || t.prevDay?.c || 0;
          if (lastTrade <= 0) continue;

          const existing = this.priceData.get(ticker);
          const wsIsFresh = existing && existing.source === "ws" && Date.now() - existing.lastUpdate < 120000;

          if (wsIsFresh) {
            existing.bid = t.lastQuote?.p ?? existing.bid;
            existing.ask = t.lastQuote?.P ?? existing.ask;
            existing.prevClose = t.prevDay?.c ?? existing.prevClose;
            existing.changePercent = t.todaysChangePerc ?? existing.changePercent;
            if (!existing.high || (t.day?.h ?? 0) > existing.high) existing.high = t.day?.h ?? existing.high;
            if (!existing.low || (t.day?.l ?? 0) < existing.low) existing.low = t.day?.l ?? existing.low;
          } else {
            const data: PriceData = {
              price: lastTrade,
              high: t.day?.h || lastTrade,
              low: t.day?.l || lastTrade,
              volume: t.day?.v ?? 0,
              lastUpdate: Date.now(),
              trades: existing?.trades ?? 0,
              source: "snapshot",
              bid: t.lastQuote?.p ?? undefined,
              ask: t.lastQuote?.P ?? undefined,
              prevClose: t.prevDay?.c ?? undefined,
              changePercent: t.todaysChangePerc ?? undefined,
            };
            this.priceData.set(ticker, data);
          }
        }
      }
    } catch (err: any) {
      console.log(`[price-monitor] Snapshot fetch error: ${err.message}`);
    }
  }

  private startSnapshotPoll() {
    this.stopSnapshotPoll();
    // In REST-only (dev) mode the snapshot poll IS the price feed, so poll
    // faster. With a live WS, it's only a fallback for stale tickers, so 30s.
    const interval = REST_ONLY ? 10000 : 30000;
    this.snapshotPollTimer = setInterval(() => this.pollSnapshots(), interval);
  }

  private stopSnapshotPoll() {
    if (this.snapshotPollTimer) {
      clearInterval(this.snapshotPollTimer);
      this.snapshotPollTimer = null;
    }
  }

  private async pollSnapshots() {
    if (this.subscribedTickers.size === 0 || !POLYGON_KEY()) return;
    const stale = [...this.subscribedTickers].filter(t => {
      const d = this.priceData.get(t);
      return !d || d.source !== "ws" || Date.now() - d.lastUpdate > 120000;
    });
    if (stale.length > 0) {
      await this.fetchSnapshotForTickers(stale);
    }
  }

  resetDailyHighLow(ticker: string) {
    const data = this.priceData.get(ticker);
    if (data) {
      data.high = data.price;
      data.low = data.price;
      data.volume = 0;
      data.trades = 0;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    this.isShuttingDown = true;
    this.stopHeartbeat();
    this.stopSnapshotPoll();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedTickers.clear();
    this.priceData.clear();
  }
}

export const priceMonitor = new PriceMonitor();
export type { PriceData };
