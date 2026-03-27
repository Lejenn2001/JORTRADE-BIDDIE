import WebSocket from "ws";

const POLYGON_KEY = () => process.env["POLYGON_API_KEY"] ?? "";
const POLYGON_WS_URL = "wss://socket.polygon.io/stocks";
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
        this.reconnectDelay = 1000;
        console.log("[price-monitor] Connected to Polygon.io, authenticating...");

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

          const lastTrade = t.lastTrade?.p ?? t.day?.c ?? 0;
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
              high: t.day?.h ?? lastTrade,
              low: t.day?.l ?? lastTrade,
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
    this.snapshotPollTimer = setInterval(() => this.pollSnapshots(), 30000);
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
