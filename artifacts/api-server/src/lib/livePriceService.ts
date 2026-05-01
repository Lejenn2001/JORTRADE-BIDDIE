// LivePriceService — JORTRADE unified live-price facade (P1 single-file).
//
// One public API for "what is the current price of X?" across the codebase.
// Internally delegates to the existing priceMonitor (stocks WS + REST snapshot)
// and optionPriceMonitor (options WS) singletons. Zero behavior change in P1 —
// no caller imports this yet. Subsequent phases (P2–P5) migrate call sites
// and eventually rename the underlying singletons to `_internal*`.
//
// Design notes (locked by user):
//   • ONE service. No parallel price systems.
//   • WS first, REST fallback. Three source labels surfaced upward:
//       live = WS update within 60s
//       rest = REST snapshot within 30s, OR WS update 60–120s old
//       stale = >120s old (or never received)
//   • Subscriptions are ref-counted by ownerId. The union of every owner's
//     ticker/symbol set is the actual WS subscription set. unsubscribe(ownerId)
//     drops only that owner's contribution, then recomputes the union.
//   • Owners examples: "whale-feed", "breakout", "paper-trades", "biddie".
//     Each route/service uses a stable string. Two callers can share the same
//     ticker and the union keeps one WS sub.
//
// What is NOT in P1:
//   • No caller migration (P2 = realtime endpoint + frontend badge,
//     P3 = breakout, P4 = paper trades non-exit, P5 = decommission).
//   • Options REST fallback is wired via `options.setRestFetcher()` so P4 can
//     hand fetchOptionQuote in without circular imports. Until P4 wires it,
//     `options.fetchOrSubscribe()` is WS-cache-only.

import { priceMonitor, type PriceData } from "./priceMonitor";
import { optionPriceMonitor, type OptionWsQuote } from "./optionPriceMonitor";

// Public source labels surfaced by the facade.
export type PriceSourceLabel = "live" | "rest" | "stale";

// Public stock-price record returned to callers.
export interface LiveStockPrice {
  ticker: string;
  price: number;
  bid?: number;
  ask?: number;
  high?: number;
  low?: number;
  volume?: number;
  trades?: number;
  prevClose?: number;
  changePercent?: number;
  source: PriceSourceLabel;
  underlyingSource: "ws" | "snapshot" | "rest" | "none"; // raw debug
  lastUpdate: number;       // epoch ms
  ageMs: number;            // now - lastUpdate (or Number.POSITIVE_INFINITY if missing)
}

// Public option-quote record returned to callers.
export interface LiveOptionQuote {
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  source: PriceSourceLabel;
  underlyingSource: "ws" | "rest" | "none";
  lastUpdate: number;
  ageMs: number;
}

// Per-feed status for diagnostics.
export interface FeedStatus {
  connected: boolean;
  subscribedCount: number;     // current actual WS subscription set size
  cachedCount: number;         // entries in the in-memory cache
  ownerCount: number;          // number of distinct ownerIds with active subs
  ownerSubscriptionCount: number; // sum of all per-owner sets (>= subscribedCount)
}

// Source-label thresholds (locked).
const LIVE_WS_MAX_AGE_MS = 60_000;
const REST_FRESH_MAX_AGE_MS = 30_000;
const REST_OR_LAGGING_WS_MAX_AGE_MS = 120_000;

// Optional REST fetcher for options. Wired by P4 to avoid circular imports
// (fetchOptionQuote currently lives in routes/whale.ts). Signature mirrors
// fetchOptionQuote() so P4 can hand it in unchanged.
export type OptionRestFetcher = (
  ticker: string,
  expiry: string | Date,
  optionType: "call" | "put",
  strike: number
) => Promise<{
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  contractSymbol: string;
} | null>;

// ---------------------------------------------------------------------------
// Stocks namespace
// ---------------------------------------------------------------------------

class StocksFacade {
  // ownerId → set of tickers that owner wants subscribed
  private ownerSubs = new Map<string, Set<string>>();

  /**
   * Add/replace this owner's interest in `tickers`. The actual WS subscription
   * set becomes the union across all owners. Idempotent: calling with the same
   * tickers twice is a no-op.
   */
  subscribe(ownerId: string, tickers: string[]): void {
    if (!ownerId) throw new Error("livePriceService.stocks.subscribe: ownerId required");
    const cleaned = tickers.map(t => String(t).toUpperCase()).filter(Boolean);
    this.ownerSubs.set(ownerId, new Set(cleaned));
    this.reconcile();
  }

  /**
   * Drop this owner's contribution. The WS subscription set shrinks to the
   * union of remaining owners. Tickers another owner still wants stay subscribed.
   */
  unsubscribe(ownerId: string): void {
    if (!this.ownerSubs.delete(ownerId)) return;
    this.reconcile();
  }

  /** Get current cached price for one ticker. Returns null if never seen. */
  get(ticker: string): LiveStockPrice | null {
    const t = String(ticker).toUpperCase();
    const raw = priceMonitor.getPrice(t);
    if (!raw) return null;
    return this.shape(t, raw);
  }

  /** Get every cached price. Includes tickers nobody owns currently — caller filters as needed. */
  getAll(): LiveStockPrice[] {
    const out: LiveStockPrice[] = [];
    for (const [ticker, raw] of priceMonitor.getAllPrices()) {
      out.push(this.shape(ticker, raw));
    }
    return out;
  }

  /**
   * Force a REST snapshot for one ticker (bypasses WS). Returns the freshly
   * cached value or null if Polygon errored / key missing.
   */
  async fetchNow(ticker: string): Promise<LiveStockPrice | null> {
    const t = String(ticker).toUpperCase();
    await priceMonitor.fetchSnapshotForTickers([t]);
    return this.get(t);
  }

  /** Current actual WS subscription set (union of all owners). Read-only. */
  getSubscribedTickers(): string[] {
    return priceMonitor.getSubscribedTickers();
  }

  status(): FeedStatus {
    const ownerSubsTotal = [...this.ownerSubs.values()].reduce((n, s) => n + s.size, 0);
    return {
      connected: priceMonitor.isConnected(),
      subscribedCount: priceMonitor.getSubscribedTickers().length,
      cachedCount: priceMonitor.getAllPrices().size,
      ownerCount: this.ownerSubs.size,
      ownerSubscriptionCount: ownerSubsTotal,
    };
  }

  // ---- internals ----------------------------------------------------------

  private reconcile(): void {
    const union = new Set<string>();
    for (const set of this.ownerSubs.values()) {
      for (const t of set) union.add(t);
    }
    priceMonitor.updateSubscriptions([...union]);
  }

  private shape(ticker: string, raw: PriceData): LiveStockPrice {
    const ageMs = Date.now() - raw.lastUpdate;
    return {
      ticker,
      price: raw.price,
      bid: raw.bid,
      ask: raw.ask,
      high: raw.high,
      low: raw.low,
      volume: raw.volume,
      trades: raw.trades,
      prevClose: raw.prevClose,
      changePercent: raw.changePercent,
      source: classifyStockSource(raw.source, ageMs),
      underlyingSource: raw.source ?? "none",
      lastUpdate: raw.lastUpdate,
      ageMs,
    };
  }
}

function classifyStockSource(
  underlying: PriceData["source"] | undefined,
  ageMs: number
): PriceSourceLabel {
  if (ageMs > REST_OR_LAGGING_WS_MAX_AGE_MS) return "stale";
  if (underlying === "ws") {
    if (ageMs <= LIVE_WS_MAX_AGE_MS) return "live";
    return "rest"; // 60–120s old WS data is degraded → tag as rest
  }
  // snapshot / rest underlying
  if (ageMs <= REST_FRESH_MAX_AGE_MS) return "rest";
  return "stale";
}

// ---------------------------------------------------------------------------
// Options namespace
// ---------------------------------------------------------------------------

class OptionsFacade {
  // ownerId → set of OCC contract symbols
  private ownerSubs = new Map<string, Set<string>>();
  private restFetcher: OptionRestFetcher | null = null;

  /**
   * Wire the REST fallback used by `fetchOrSubscribe()`. Called once at startup
   * (typically from routes/whale.ts after fetchOptionQuote is defined) to break
   * the circular-import that would otherwise occur. Until wired, fetchOrSubscribe
   * returns the WS cache only.
   */
  setRestFetcher(fn: OptionRestFetcher | null): void {
    this.restFetcher = fn;
  }

  subscribe(ownerId: string, occSymbols: string[]): void {
    if (!ownerId) throw new Error("livePriceService.options.subscribe: ownerId required");
    const cleaned = occSymbols.filter(Boolean);
    this.ownerSubs.set(ownerId, new Set(cleaned));
    this.reconcile();
  }

  unsubscribe(ownerId: string): void {
    if (!this.ownerSubs.delete(ownerId)) return;
    this.reconcile();
  }

  /** Get current cached quote for one OCC symbol. Returns null if never seen. */
  get(occSymbol: string): LiveOptionQuote | null {
    const raw = optionPriceMonitor.getQuote(occSymbol);
    if (!raw) return null;
    return shapeOptionQuote(raw, "ws");
  }

  /**
   * The "ergonomic" path used by paper-trade entry / refresh-all (P4).
   *   1. If WS cache is fresh (≤ LIVE_WS_MAX_AGE_MS), return it as `live`.
   *   2. Otherwise auto-subscribe so future reads are WS-fast.
   *   3. Then call the REST fallback (if wired) and tag as `rest`.
   *   4. If REST is unavailable or fails, re-read the WS cache (a quote may
   *      have arrived during the REST await) and return that. If still nothing,
   *      return null.
   *
   * `ownerId` is required so ref counting stays accurate — pass a stable string
   * tied to the caller (e.g. `"paper-trades"`, `"chat-modal"`). Callers MUST
   * later call `unsubscribe(ownerId)` when their interest ends.
   */
  async fetchOrSubscribe(
    ownerId: string,
    ticker: string,
    expiry: string | Date,
    optionType: "call" | "put",
    strike: number
  ): Promise<LiveOptionQuote | null> {
    if (!ownerId) throw new Error("livePriceService.options.fetchOrSubscribe: ownerId required");
    const occSymbol = buildOccSymbol(ticker, expiry, optionType, strike);

    // 1) Fast path: fresh WS cache.
    const cached = optionPriceMonitor.getQuote(occSymbol);
    if (cached && Date.now() - cached.lastUpdate <= LIVE_WS_MAX_AGE_MS) {
      return shapeOptionQuote(cached, "ws");
    }

    // 2) Auto-subscribe so the next call is WS-fast. Adds to ownerId's set
    //    without disturbing other owners' sets.
    this.addToOwner(ownerId, occSymbol);

    // 3) REST fallback (only if wired by P4).
    if (this.restFetcher) {
      try {
        const r = await this.restFetcher(ticker, expiry, optionType, strike);
        if (r) {
          const fakeWs: OptionWsQuote = {
            contractSymbol: r.contractSymbol,
            bid: r.bid,
            ask: r.ask,
            last: r.last,
            lastUpdate: Date.now(),
          };
          return shapeOptionQuote(fakeWs, "rest");
        }
      } catch {
        // fall through to re-read WS cache
      }
    }

    // 4) Re-read WS cache after the REST await — a quote may have arrived
    //    while we were waiting. Return null only if still nothing.
    const postAwait = optionPriceMonitor.getQuote(occSymbol);
    if (!postAwait) return null;
    return shapeOptionQuote(postAwait, "ws");
  }

  status(): FeedStatus {
    const ownerSubsTotal = [...this.ownerSubs.values()].reduce((n, s) => n + s.size, 0);
    return {
      connected: optionPriceMonitor.isConnected(),
      subscribedCount: optionPriceMonitor.getSubscribedSymbols().length,
      cachedCount: optionPriceMonitor.getSubscribedSymbols().length, // mirror — quoteCache isn't externally enumerable
      ownerCount: this.ownerSubs.size,
      ownerSubscriptionCount: ownerSubsTotal,
    };
  }

  // ---- internals ----------------------------------------------------------

  private addToOwner(ownerId: string, occSymbol: string): void {
    let set = this.ownerSubs.get(ownerId);
    if (!set) {
      set = new Set<string>();
      this.ownerSubs.set(ownerId, set);
    }
    if (!set.has(occSymbol)) {
      set.add(occSymbol);
      this.reconcile();
    }
  }

  private reconcile(): void {
    const union = new Set<string>();
    for (const set of this.ownerSubs.values()) {
      for (const s of set) union.add(s);
    }
    optionPriceMonitor.updateSubscriptions([...union]);
  }
}

function shapeOptionQuote(
  raw: OptionWsQuote,
  underlyingSource: "ws" | "rest"
): LiveOptionQuote {
  const ageMs = Date.now() - raw.lastUpdate;
  const mid = raw.bid != null && raw.ask != null ? (raw.bid + raw.ask) / 2 : null;
  return {
    contractSymbol: raw.contractSymbol,
    bid: raw.bid,
    ask: raw.ask,
    mid,
    last: raw.last,
    source: classifyOptionSource(underlyingSource, ageMs),
    underlyingSource,
    lastUpdate: raw.lastUpdate,
    ageMs,
  };
}

function classifyOptionSource(
  underlying: "ws" | "rest",
  ageMs: number
): PriceSourceLabel {
  if (ageMs > REST_OR_LAGGING_WS_MAX_AGE_MS) return "stale";
  if (underlying === "ws") {
    if (ageMs <= LIVE_WS_MAX_AGE_MS) return "live";
    return "rest";
  }
  // rest
  if (ageMs <= REST_FRESH_MAX_AGE_MS) return "rest";
  return "stale";
}

// OCC symbol builder — mirrors buildOptionContractSymbol() in routes/whale.ts.
// Kept inline here so the facade has zero dependency on whale.ts (avoids a
// route → lib → route circular import). When P4/P5 lift fetchOptionQuote into
// the lib, the duplicate version in whale.ts can be removed and both sites
// share this helper.
function buildOccSymbol(
  ticker: string,
  expiry: string | Date,
  optionType: "call" | "put",
  strike: number
): string {
  const isSpxWeekly = ticker === "SPXW";
  const contractTicker = isSpxWeekly ? "SPXW" : ticker;
  const strikeInt = Math.round(strike * 1000);
  const strikeStr = strikeInt.toString().padStart(8, "0");
  const isoDate = normalizeExpiryToIso(expiry);
  const expDigits = isoDate.replace(/-/g, "").slice(2); // YYMMDD
  const cp = optionType === "call" ? "C" : "P";
  return `O:${contractTicker}${expDigits}${cp}${strikeStr}`;
}

function normalizeExpiryToIso(expiry: unknown): string {
  if (expiry instanceof Date) {
    if (Number.isNaN(expiry.getTime())) {
      throw new Error("livePriceService: invalid Date expiry");
    }
    const y = expiry.getUTCFullYear();
    const m = String(expiry.getUTCMonth() + 1).padStart(2, "0");
    const d = String(expiry.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(expiry ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`livePriceService: cannot parse expiry "${s}"`);
  }
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const d = String(parsed.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Top-level singleton
// ---------------------------------------------------------------------------

class LivePriceService {
  readonly stocks = new StocksFacade();
  readonly options = new OptionsFacade();

  status(): { stocks: FeedStatus; options: FeedStatus } {
    return {
      stocks: this.stocks.status(),
      options: this.options.status(),
    };
  }
}

export const livePriceService = new LivePriceService();
