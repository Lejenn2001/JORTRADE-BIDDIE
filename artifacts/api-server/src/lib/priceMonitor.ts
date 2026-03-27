import WebSocket from "ws";

const FINNHUB_KEY = () => process.env["FINNHUB_API_KEY"] ?? "";
const WS_URL = () => `wss://ws.finnhub.io?token=${FINNHUB_KEY()}`;
const QUOTE_URL = (symbol: string) =>
  `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY()}`;

interface PriceData {
  price: number;
  high: number;
  low: number;
  volume: number;
  lastUpdate: number;
  trades: number;
  source?: "ws" | "rest";
}

type PriceCallback = (ticker: string, data: PriceData, tradeVolume?: number) => void;

class PriceMonitor {
  private ws: WebSocket | null = null;
  private subscribedTickers = new Set<string>();
  private priceData = new Map<string, PriceData>();
  private callbacks: PriceCallback[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private restPollTimer: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private isShuttingDown = false;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  connect() {
    if (this.isShuttingDown) return;
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    if (!FINNHUB_KEY()) {
      console.log("[price-monitor] No FINNHUB_API_KEY, skipping WebSocket connection");
      return;
    }

    this.isConnecting = true;
    console.log("[price-monitor] Connecting to Finnhub WebSocket...");

    try {
      this.ws = new WebSocket(WS_URL());

      this.ws.on("open", () => {
        this.isConnecting = false;
        this.reconnectDelay = 1000;
        console.log(`[price-monitor] Connected. Resubscribing ${this.subscribedTickers.size} tickers`);

        for (const ticker of this.subscribedTickers) {
          this.sendSubscribe(ticker);
        }

        this.startHeartbeat();
      });

      this.ws.on("message", (raw: WebSocket.Data) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "trade" && Array.isArray(msg.data)) {
            for (const trade of msg.data) {
              const ticker = trade.s;
              const price = trade.p;
              const volume = trade.v || 0;

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
            }
          } else if (msg.type === "ping") {
            // heartbeat
          }
        } catch {}
      });

      this.ws.on("close", (code: number) => {
        this.isConnecting = false;
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

  private sendSubscribe(ticker: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", symbol: ticker }));
    }
  }

  private sendUnsubscribe(ticker: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", symbol: ticker }));
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
    if (added && !this.restPollTimer) {
      this.startRestPoll();
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

  private async fetchRestQuote(ticker: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(QUOTE_URL(ticker), { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return;
      const q = await resp.json() as { c?: number; h?: number; l?: number; t?: number };
      const price = q.c;
      if (!price || price <= 0) return;

      const existing = this.priceData.get(ticker);
      if (existing && existing.source === "ws" && Date.now() - existing.lastUpdate < 120000) return;

      const data: PriceData = {
        price,
        high: q.h ?? price,
        low: q.l ?? price,
        volume: existing?.volume ?? 0,
        lastUpdate: Date.now(),
        trades: existing?.trades ?? 0,
        source: "rest",
      };
      this.priceData.set(ticker, data);
    } catch {}
  }

  private startRestPoll() {
    this.stopRestPoll();
    this.pollRestQuotes();
    this.restPollTimer = setInterval(() => this.pollRestQuotes(), 60000);
  }

  private stopRestPoll() {
    if (this.restPollTimer) {
      clearInterval(this.restPollTimer);
      this.restPollTimer = null;
    }
  }

  private async pollRestQuotes() {
    if (this.subscribedTickers.size === 0 || !FINNHUB_KEY()) return;
    const tickers = [...this.subscribedTickers];
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const existing = this.priceData.get(t);
      if (existing && existing.source === "ws" && Date.now() - existing.lastUpdate < 120000) continue;
      await this.fetchRestQuote(t);
      if (i < tickers.length - 1) await new Promise(r => setTimeout(r, 250));
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
    return this.ws?.readyState === WebSocket.OPEN;
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
    this.stopRestPoll();
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
