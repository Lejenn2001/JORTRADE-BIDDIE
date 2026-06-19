import WebSocket from "ws";
import { getPolygonKey } from "./polygonKey";

// Polygon Options WebSocket — Phase 1 (May 2026).
//
// Real-time option quote/trade stream over wss://socket.polygon.io/options.
// Channels per OCC contract symbol:
//   Q.O:<symbol>  — NBBO quote (bid/ask)
//   T.O:<symbol>  — trade prints (last)
//
// Mirrors the lifecycle pattern of priceMonitor.ts (stocks WS):
//   • exponential reconnect 1s → 30s
//   • heartbeat ping every 30s
//   • dormant when POLYGON_API_KEY missing
//   • subscriptions are managed by the caller via updateSubscriptions(symbols)
//
// This module knows NOTHING about trade rows / DB / exit rules — it just
// tracks a per-symbol quote cache and fires callbacks on every update.
// The caller (paperTradeMonitor) maps contract → tradeIds and dispatches
// to the existing evaluateAndMaybeClose() exit pipeline.

const POLYGON_KEY = () => getPolygonKey();
const POLYGON_OPTIONS_WS_URL = "wss://socket.polygon.io/options";

// Polygon allows only ONE live WebSocket connection per account on the options
// cluster too. The deployed (production) app must own it; the dev workspace must
// NOT open this WS or it would fight the live app (endless code-1008 drops on
// both). In dev, option-quote callers fall back to REST snapshots instead.
//
// Positive dev signal so the SAFE default (incl. unset NODE_ENV) is to open the
// WS like production. See priceMonitor.ts for the full rationale.
//   • POLYGON_WS_FORCE=1   → always use WS (overrides everything)
//   • POLYGON_REST_ONLY=1  → force REST-only regardless of NODE_ENV
//   • NODE_ENV=development → REST-only (normal dev case)
const REST_ONLY =
  process.env["POLYGON_WS_FORCE"] !== "1" &&
  (process.env["NODE_ENV"] === "development" || process.env["POLYGON_REST_ONLY"] === "1");
console.log(
  `[option-price-monitor] mode: ${REST_ONLY ? "REST-only (WS disabled)" : "WebSocket (real-time)"} (NODE_ENV=${process.env["NODE_ENV"] ?? "unset"})`,
);

export interface OptionWsQuote {
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  lastUpdate: number;
}

type QuoteCallback = (contractSymbol: string, quote: OptionWsQuote) => void;

class OptionPriceMonitor {
  private ws: WebSocket | null = null;
  private subscribedSymbols = new Set<string>();
  private quoteCache = new Map<string, OptionWsQuote>();
  private callbacks: QuoteCallback[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isConnecting = false;
  private isShuttingDown = false;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private authenticated = false;
  private quoteLogSampleCounter = 0;
  private readonly QUOTE_LOG_SAMPLE_RATE = 200; // log 1 in N quote events

  connect() {
    if (this.isShuttingDown) return;
    if (REST_ONLY) {
      // Dev: never open the options WS. Callers fall back to REST option quotes
      // so we don't take the live app's single Polygon options connection slot.
      return;
    }
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
    if (!POLYGON_KEY()) {
      console.log("[option-price-monitor] No POLYGON_API_KEY, skipping WebSocket connection");
      return;
    }

    this.isConnecting = true;
    this.authenticated = false;
    console.log("[option-price-monitor] Connecting to Polygon.io options WebSocket...");

    try {
      this.ws = new WebSocket(POLYGON_OPTIONS_WS_URL);

      this.ws.on("open", () => {
        this.isConnecting = false;
        console.log("[option-price-monitor] Connected to Polygon.io options, authenticating...");

        // Reset backoff after a stable 30s of being open.
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
                console.log(`[option-price-monitor] Authenticated. Resubscribing ${this.subscribedSymbols.size} contracts`);
                this.resubscribeAll();
                this.startHeartbeat();
              } else if (msg.status === "auth_failed") {
                console.error(`[option-price-monitor] Polygon auth failed: ${msg.message ?? "(no message)"}`);
              } else if (msg.status === "success" && typeof msg.message === "string" && /subscribed/i.test(msg.message)) {
                // Per-channel subscription confirmation — log at debug level only when
                // it's the first batch (resubscribeAll already logs the aggregate count).
              }
            } else if (msg.ev === "Q") {
              // Options quote: msg.sym is the OCC symbol (e.g. "O:AAPL241220C00200000")
              // Fields: bp = bid price, ap = ask price, bs = bid size, as = ask size
              const sym = msg.sym;
              if (!sym) continue;
              const bid = typeof msg.bp === "number" ? msg.bp : null;
              const ask = typeof msg.ap === "number" ? msg.ap : null;
              this.applyUpdate(sym, { bid, ask });
            } else if (msg.ev === "T") {
              // Options trade print: msg.sym OCC symbol, msg.p = trade price.
              const sym = msg.sym;
              if (!sym) continue;
              const last = typeof msg.p === "number" ? msg.p : null;
              this.applyUpdate(sym, { last });
            }
          }
        } catch {
          // Per-message swallow — never crash the socket on bad payloads.
        }
      });

      this.ws.on("close", (code: number) => {
        this.isConnecting = false;
        this.authenticated = false;
        this.stopHeartbeat();
        if (this.isShuttingDown) {
          console.log(`[option-price-monitor] Disconnected (code ${code}), shutdown requested`);
          return;
        }
        console.log(`[option-price-monitor] Disconnected (code ${code}), reconnecting in ${this.reconnectDelay}ms`);
        this.scheduleReconnect();
      });

      this.ws.on("error", (err: Error) => {
        this.isConnecting = false;
        console.error(`[option-price-monitor] WebSocket error: ${err.message}`);
      });
    } catch (err: any) {
      this.isConnecting = false;
      console.error(`[option-price-monitor] Connection failed: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  private applyUpdate(symbol: string, patch: { bid?: number | null; ask?: number | null; last?: number | null }) {
    let q = this.quoteCache.get(symbol);
    if (!q) {
      q = { contractSymbol: symbol, bid: null, ask: null, last: null, lastUpdate: Date.now() };
      this.quoteCache.set(symbol, q);
    }
    if (patch.bid !== undefined) q.bid = patch.bid;
    if (patch.ask !== undefined) q.ask = patch.ask;
    if (patch.last !== undefined) q.last = patch.last;
    q.lastUpdate = Date.now();

    // Sampled quote log so we can confirm flow without log-bombing.
    this.quoteLogSampleCounter++;
    if (this.quoteLogSampleCounter % this.QUOTE_LOG_SAMPLE_RATE === 0) {
      console.log(`[option-price-monitor] quote sample ${symbol} bid=${q.bid ?? "n/a"} ask=${q.ask ?? "n/a"} last=${q.last ?? "n/a"}`);
    }

    for (const cb of this.callbacks) {
      try { cb(symbol, q); } catch {}
    }
  }

  private resubscribeAll() {
    if (!this.authenticated || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.subscribedSymbols.size === 0) return;

    const params = [...this.subscribedSymbols].flatMap(s => [`Q.${s}`, `T.${s}`]).join(",");
    this.ws.send(JSON.stringify({ action: "subscribe", params }));
    console.log(`[option-price-monitor] Subscribed to ${this.subscribedSymbols.size} contracts (Q+T)`);
  }

  private sendSubscribe(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated || symbols.length === 0) return;
    const params = symbols.flatMap(s => [`Q.${s}`, `T.${s}`]).join(",");
    this.ws.send(JSON.stringify({ action: "subscribe", params }));
  }

  private sendUnsubscribe(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated || symbols.length === 0) return;
    const params = symbols.flatMap(s => [`Q.${s}`, `T.${s}`]).join(",");
    this.ws.send(JSON.stringify({ action: "unsubscribe", params }));
  }

  /**
   * Reconcile the active subscription set against the desired set in one call.
   * Issues a single subscribe for additions and a single unsubscribe for removals.
   * Idempotent — safe to call every monitor cycle.
   */
  updateSubscriptions(desired: string[]): void {
    const desiredSet = new Set(desired);
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const sym of desired) {
      if (!this.subscribedSymbols.has(sym)) toAdd.push(sym);
    }
    for (const sym of this.subscribedSymbols) {
      if (!desiredSet.has(sym)) toRemove.push(sym);
    }

    if (toAdd.length === 0 && toRemove.length === 0) return;

    for (const s of toAdd) this.subscribedSymbols.add(s);
    for (const s of toRemove) {
      this.subscribedSymbols.delete(s);
      this.quoteCache.delete(s);
    }

    if (toAdd.length > 0) this.sendSubscribe(toAdd);
    if (toRemove.length > 0) this.sendUnsubscribe(toRemove);

    console.log(`[option-price-monitor] subscriptions reconciled: total=${this.subscribedSymbols.size} added=${toAdd.length} removed=${toRemove.length}`);

    // Lazily connect on first non-empty subscription.
    if (this.subscribedSymbols.size > 0 && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
      this.connect();
    }
  }

  onQuote(callback: QuoteCallback): void {
    this.callbacks.push(callback);
  }

  getQuote(contractSymbol: string): OptionWsQuote | null {
    return this.quoteCache.get(contractSymbol) ?? null;
  }

  getSubscribedSymbols(): string[] {
    return [...this.subscribedSymbols];
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedSymbols.clear();
    this.quoteCache.clear();
  }
}

export const optionPriceMonitor = new OptionPriceMonitor();
