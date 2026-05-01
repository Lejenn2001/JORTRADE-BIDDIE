// ─── Shared EOD Auto-Close Engine ────────────────────────────────────────────
// One engine, multiple sources. Today only PaperTradeSource is registered;
// LiveTradeSource is sketched out for a future broker integration but is NOT
// invoked anywhere — gated by the LIVE_EOD_CLOSE_ENABLED env var which
// defaults to false. To enable live EOD later, a future commit must:
//   (1) Implement LiveTradeSource (broker-specific fetchOpenTrades + close)
//   (2) Register it alongside PaperTradeSource in the monitor's scheduler tick
//   (3) Set LIVE_EOD_CLOSE_ENABLED=true in the deployment env
// Both gates (registration AND env flag) are required, by design.
//
// Phase semantics (see marketHours.ts getEodPhaseET for the wall-clock map):
//   "before" / "after" → engine returns immediately
//   "soft"  → fresh quote only; no quote → leave open, retry next monitor tick
//   "force" → fresh quote first; if no quote, fall back to last stored quote
//             with exit_reason='eod_close_stale'
//
// Per-source, per-ET-day sentinel: marks "(source, ET-date) complete" only
// when the FORCE phase has successfully closed ≥1 trade. This is the user's
// explicit spec — a "trade-count-aware" sentinel that lets force retry within
// the (15:59, 16:00) window if the first attempt closed nothing (e.g.,
// transient quote/DB failures). Soft phase NEVER marks complete — it keeps
// catching trades opened mid-window. After 16:00 ET getEodPhaseET returns
// "after" and we early-exit regardless. SQL guard `WHERE id=$N AND
// status='open'` in closeForEod is the actual concurrency safety; this
// sentinel is the noise/cost cap.
//
// Late-open edge case (trade opened during the force window): handled by a
// separate gate in POST /whale/paper/trades that returns 409 code
// 'eod_force_window' for the entire force phase — so no new open can land
// while the engine is flattening, ensuring zero overnight risk.

import { fetchOptionQuote, closeForEod, dbQuery, normalizeExpiryToIso } from "./paperTradeService";
import { getEodPhaseET, currentEtDateString, type EodPhase } from "./marketHours";
import { getEodConfig } from "./eodCloseConfig";

export interface EodTradeRow {
  id: string;
  // All other fields opaque to the engine — adapters read what they need.
  [k: string]: any;
}

export interface EodCloseResult {
  closed: boolean;
  reason: "eod_close" | "eod_close_stale" | null;
  fill?: { price: number; source: string } | null;
}

export interface EodTradeSource {
  name: "paper" | "live";
  // Read each tick (so flipping the env flag at runtime is reflected without
  // re-registering — though changing env vars still requires a server restart
  // to take effect, since getEodConfig() caches at first read).
  readonly enabled: boolean;
  fetchOpenTrades(): Promise<EodTradeRow[]>;
  attemptClose(t: EodTradeRow, phase: "soft" | "force"): Promise<EodCloseResult>;
}

// ─── Paper Source (active) ───────────────────────────────────────────────────
export const PaperTradeSource: EodTradeSource = {
  name: "paper",
  get enabled(): boolean { return getEodConfig().paperEnabled; },

  async fetchOpenTrades(): Promise<EodTradeRow[]> {
    // ALL open paper trades, regardless of origin (manual, Buy Now, queued/
    // auto-promoted, chat-origin). Pending entries are intentionally excluded —
    // they have no fill yet and the user wants pending logic kept separate.
    const r = await dbQuery(`SELECT * FROM paper_trades WHERE status = 'open'`, []);
    return (r?.rows ?? []) as EodTradeRow[];
  },

  async attemptClose(t: EodTradeRow, phase: "soft" | "force"): Promise<EodCloseResult> {
    const expiryStr = normalizeExpiryToIso(t.expiry);
    const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));

    // closeForEod is phase-aware:
    //   soft  → fresh quote only; no fresh-quote fill → returns closed:false
    //   force → fresh quote first, else stale (bid/mid/last → intrinsic/zero);
    //           always terminates with a price so the sweep flattens 100%.
    if (phase === "soft" && !q) return { closed: false, reason: null };
    const r = await closeForEod(t, q, phase);
    if (!r.closed) return { closed: false, reason: null };
    return { closed: true, reason: r.reason, fill: r.fill ?? null };
  },
};

// ─── Live Source (placeholder, NOT registered) ───────────────────────────────
// Intentionally inert. Future broker integration must implement these methods
// against the live broker's positions API and explicitly register this source
// in paperTradeMonitor.ts AND set LIVE_EOD_CLOSE_ENABLED=true.
//
// Exported so future commits can complete it; un-imported anywhere today.
export const LiveTradeSource: EodTradeSource = {
  name: "live",
  get enabled(): boolean { return getEodConfig().liveEnabled; },
  async fetchOpenTrades(): Promise<EodTradeRow[]> {
    // No-op stub. Live broker integration not implemented yet.
    return [];
  },
  async attemptClose(_t: EodTradeRow, _phase: "soft" | "force"): Promise<EodCloseResult> {
    return { closed: false, reason: null };
  },
};

// ─── Sentinel (per-source, per-ET-day) ───────────────────────────────────────
const sentinelByDate = new Map<string, Set<string>>(); // ETDate → Set<sourceName>

function isCompleteForToday(sourceName: string, etDate: string): boolean {
  return sentinelByDate.get(etDate)?.has(sourceName) ?? false;
}

function markCompleteForToday(sourceName: string, etDate: string): void {
  if (!sentinelByDate.has(etDate)) {
    sentinelByDate.set(etDate, new Set());
    // Garbage-collect older ET dates so the map doesn't grow unbounded over
    // weeks of uptime. Lexical comparison is correct for YYYY-MM-DD strings.
    for (const k of Array.from(sentinelByDate.keys())) {
      if (k < etDate) sentinelByDate.delete(k);
    }
  }
  sentinelByDate.get(etDate)!.add(sourceName);
}

// ─── Engine entrypoint ───────────────────────────────────────────────────────
// Called once per monitor tick from paperTradeMonitor.scheduleNext. Cheap when
// outside the EOD window (early-returns after env+phase checks).
export async function runEodSweep(source: EodTradeSource): Promise<void> {
  if (!source.enabled) return;

  const cfg = getEodConfig();
  const phase: EodPhase = getEodPhaseET(cfg.closeTime, cfg.forceCloseTime);
  if (phase === "before" || phase === "after") return;

  const etDate = currentEtDateString();
  if (isCompleteForToday(source.name, etDate)) return;

  let open: EodTradeRow[];
  try {
    open = await source.fetchOpenTrades();
  } catch (e: any) {
    console.error(`[eod-close-engine] (${source.name}) fetchOpenTrades failed: ${e?.message}`);
    return;
  }

  let closed = 0;
  let failed = 0;
  let attempted = 0;
  for (const t of open) {
    attempted++;
    try {
      const r = await source.attemptClose(t, phase);
      if (r.closed && r.reason) {
        closed++;
        const f = r.fill ? ` @ ${r.fill.price.toFixed(2)} (${r.fill.source})` : "";
        console.log(`[eod-close-engine] (${source.name}/${phase}) closed ${t.ticker} ${t.option_type} $${t.strike}: ${r.reason}${f}`);
      } else if (phase === "force") {
        // Force phase should always close. A non-close here means the SQL
        // guard rejected (race with manual close) or the DB update failed.
        failed++;
        console.warn(`[eod-close-engine] (${source.name}/force) UNCLOSED trade ${t.id} ${t.ticker} ${t.option_type} $${t.strike} — investigate (likely manual-close race or DB error)`);
      }
    } catch (e: any) {
      if (phase === "force") failed++;
      console.error(`[eod-close-engine] (${source.name}) close failed for trade ${t.id}: ${e?.message}`);
    }
  }
  if (attempted > 0 || phase === "force") {
    console.log(`[eod-close-engine] (${source.name}/${phase}) sweep: attempted=${attempted} closed=${closed} failed=${failed}`);
  }

  // Trade-count-aware sentinel: only mark complete after FORCE phase finishes
  // a sweep that closed ≥1 trade. Soft phase NEVER marks. Force phase with 0
  // closes also doesn't mark — leaves room for one more retry next monitor
  // tick if we're still inside the (15:59, 16:00) window. After 16:00 phase
  // becomes "after" and we early-exit. The late-open edge is handled by the
  // POST /whale/paper/trades force-window gate, not by this sentinel.
  if (phase === "force" && closed > 0) markCompleteForToday(source.name, etDate);
}

// Test-only helpers
export function __resetEodSentinelForTests(): void { sentinelByDate.clear(); }
