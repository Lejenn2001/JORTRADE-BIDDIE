import { fetchOptionQuote, evaluateAndMaybeClose, closeExpiredNoQuote, isContractExpired, dbQuery, normalizeExpiryToIso, evaluatePendingEntry, getPaperAutomationSettings, buildOptionContractSymbol, evaluateExitFromWsQuote } from "./paperTradeService";
import { isMarketOpenET } from "./marketHours";
import { runEodSweep, PaperTradeSource } from "./eodCloseEngine";
import { optionPriceMonitor } from "./optionPriceMonitor";

const MARKET_HOURS_INTERVAL_MS = 60_000;
const OFF_HOURS_INTERVAL_MS = 5 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let started = false;

// ─── WebSocket subscription routing (Phase 1, May 2026) ──────────────────
// Maps an OCC contract symbol (e.g. "O:NVDA260515C00200000") to the set of
// paper-trade row ids that share it. Multiple users can hold the same
// contract; one WS event must dispatch to every interested trade. Updated
// in lockstep with the REST sweep so the live set stays consistent with
// the database.
//
// Gated by OPTION_WS_ENABLED env flag (default true). Set to "false" to
// fully disable the options WebSocket — falls back cleanly to REST polling.
function isOptionWsEnabled(): boolean {
  const raw = (process.env["OPTION_WS_ENABLED"] ?? "true").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
// paper_trades.id is a UUID (string). Do NOT coerce to number — Number(uuid) is NaN.
const _wsContractToTradeIds = new Map<string, Set<string>>();

// Build the desired symbol→tradeIds map from the current open ∪ pending_entry
// set, then reconcile with optionPriceMonitor. Single DB roundtrip; cheap.
async function reconcileWsSubscriptions(): Promise<void> {
  if (!isOptionWsEnabled()) return;
  try {
    const rows = await dbQuery(
      `SELECT id, ticker, expiry, option_type, strike, status
         FROM paper_trades
        WHERE status IN ('open', 'pending_entry')`,
      []
    ).catch(() => null);
    if (!rows) return;

    // Build two parallel structures:
    //   - desiredSymbols: every contract we want WS data for (open + pending_entry,
    //     so a fill that flips pending→open mid-cycle already has a hot subscription)
    //   - next (routing map): only OPEN trade IDs — pending rows must NOT be routed
    //     to evaluateExitFromWsQuote (they have no entry and the WHERE id=$1 AND
    //     status='open' guard would no-op anyway, just creating per-tick DB churn)
    const next = new Map<string, Set<string>>();
    const desiredSymbols = new Set<string>();
    for (const r of rows.rows) {
      const expiryStr = normalizeExpiryToIso(r.expiry);
      const strike = Number(r.strike);
      if (!Number.isFinite(strike) || strike <= 0) continue;
      let sym: string;
      try {
        ({ contractSymbol: sym } = buildOptionContractSymbol(r.ticker, expiryStr, r.option_type, strike));
      } catch {
        continue;
      }
      desiredSymbols.add(sym);
      if (r.status !== "open") continue;
      let set = next.get(sym);
      if (!set) { set = new Set<string>(); next.set(sym, set); }
      set.add(String(r.id));
    }

    // Replace map atomically (single-threaded JS event loop guarantees this
    // is consistent for the WS callback that reads it).
    _wsContractToTradeIds.clear();
    for (const [sym, ids] of next) _wsContractToTradeIds.set(sym, ids);

    optionPriceMonitor.updateSubscriptions([...desiredSymbols]);
  } catch (e: any) {
    console.warn(`[paper-trade-monitor] WS reconcile error: ${e?.message ?? e}`);
  }
}

// Register the WS quote callback exactly once at module init.
// Each callback dispatches to evaluateExitFromWsQuote for every trade row
// that holds this contract. The adapter handles its own per-trade lock and
// the underlying SQL race guard prevents duplicate closes vs the REST sweep.
let _wsCallbackRegistered = false;
function registerWsCallback(): void {
  if (!isOptionWsEnabled()) return;
  if (_wsCallbackRegistered) return;
  _wsCallbackRegistered = true;
  optionPriceMonitor.onQuote((symbol, quote) => {
    const ids = _wsContractToTradeIds.get(symbol);
    if (!ids || ids.size === 0) return;
    for (const id of ids) {
      // Fire-and-forget — the adapter has its own per-trade in-flight lock.
      void evaluateExitFromWsQuote(id, quote);
    }
  });
}

async function processOpenTrades(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Order by least-recently-checked first (NULLS FIRST = never checked) so that
    // when total open trades exceed the per-cycle cap, every trade still gets
    // evaluated within a few cycles via round-robin rather than starving newer
    // (or higher-id) trades indefinitely. The cap protects API rate limits and
    // cycle duration; raise it if/when concurrent batch fetching is added.
    const PER_CYCLE_CAP = 500;
    const open = await dbQuery(
      `SELECT * FROM paper_trades WHERE status = 'open' ORDER BY last_checked_at ASC NULLS FIRST, opened_at ASC LIMIT $1`,
      [PER_CYCLE_CAP]
    );
    if (!open || !open.rows.length) return;

    // ─── Market-Hours Gate (Phase 1, Apr 2026) ────────────────────────────
    // Outside regular trading hours we run an EXPIRY-ONLY pass:
    //   • If the contract has expired → close it via closeExpiredNoQuote
    //     (ITM intrinsic value or zero — no Polygon call needed).
    //   • Otherwise → just touch last_checked_at so round-robin ordering
    //     stays balanced for when the market reopens.
    // Option-P&L exits (hard_stop / profit_target / trailing_stop) and
    // underlying-based exits (signal_invalidation / signal_target) are
    // explicitly NOT evaluated outside RTH — quotes are stale, fills would
    // be fictional, and the user has been told the market is closed.
    const marketOpen = isMarketOpenET();

    let checked = 0;
    let closed = 0;
    for (const t of open.rows) {
      checked++;
      // Normalize expiry from DB (pg returns DATE columns as Date objects).
      // String(date).slice(0,10) yields "Fri May 01" (no year), which the JS Date
      // parser then defaults to year 2001 — silently producing OPRA symbols like
      // O:NVDA010501C00205000 that 404 on Polygon. normalizeExpiryToIso handles
      // Date | ISO-string | other defensively to a canonical YYYY-MM-DD.
      const expiryStr = normalizeExpiryToIso(t.expiry);

      if (!marketOpen) {
        // Expiry-only pass. No quote fetch.
        if (isContractExpired(expiryStr)) {
          const r = await closeExpiredNoQuote(t);
          if (r.closed) {
            closed++;
            console.log(`[paper-trade-monitor] (closed-market) auto-closed ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: closed_expired @ ${r.exitPrice.toFixed(2)} (${r.source})`);
          }
        } else {
          await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1`, [t.id]).catch(() => null);
        }
        continue;
      }

      const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));
      if (!q) {
        // No quote: expired contracts always close (intrinsic for ITM, 0 otherwise); else touch last_checked_at.
        if (isContractExpired(expiryStr)) {
          const r = await closeExpiredNoQuote(t);
          if (r.closed) {
            closed++;
            console.log(`[paper-trade-monitor] auto-closed (no quote, expired) ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: closed_expired @ ${r.exitPrice.toFixed(2)} (${r.source}, underlying=${r.underlying ?? "n/a"})`);
          }
        } else {
          await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1`, [t.id]).catch(() => null);
        }
        continue;
      }
      const result = await evaluateAndMaybeClose(t, q);
      if (result.closed && result.fill && result.exitReason) {
        closed++;
        console.log(`[paper-trade-monitor] auto-closed ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: ${result.exitReason} @ ${result.fill.price.toFixed(2)} (${result.fill.source})`);
      }
    }
    if (checked > 0) {
      const suffix = marketOpen ? "" : " (closed-market: expiry-only pass)";
      console.log(`[paper-trade-monitor] cycle: checked=${checked} closed=${closed}${suffix}`);
    }
  } catch (e: any) {
    console.error("[paper-trade-monitor] cycle error:", e?.message);
  } finally {
    running = false;
  }
}

// Paper Automation Engine — Commit 1: pending_entry sweep.
// Runs after the open-trades sweep on every monitor cycle. For each row in
// status='pending_entry', delegates to evaluatePendingEntry() which either
// (a) cancels expired/contract-expired pendings without a quote, (b) refreshes
// the quote snapshot when the trigger hasn't fired, or (c) atomically promotes
// the row to status='open' at live ask when the trigger has fired.
//
// Cap protects API rate limits (same shape as open-trades cap). NULLS FIRST
// ordering guarantees newly-queued pendings get checked promptly.
// Tracks the most recently logged paused state so we log a single line on each
// transition (paused→running, running→paused) instead of every cycle.
let _lastLoggedPausedState: boolean | null = null;

async function processPendingEntries(): Promise<void> {
  try {
    // Commit 2: respect the global kill switch. When paused we skip the entire
    // sweep — pending rows stay pending, no quote calls, no promotions, no
    // expiries. The existing open-trade exit monitor (processOpenTrades) is
    // intentionally NOT paused: live positions still need their TP/SL/expiry
    // evaluated regardless of whether new automation is paused.
    const settings = await getPaperAutomationSettings();
    if (settings.paused) {
      if (_lastLoggedPausedState !== true) {
        console.log(`[paper-trade-monitor] PAUSED (source=${settings.source.paused}, reason="${settings.pausedReason || "n/a"}") — pending sweep skipped`);
        _lastLoggedPausedState = true;
      }
      return;
    } else if (_lastLoggedPausedState === true) {
      console.log(`[paper-trade-monitor] RESUMED — pending sweep active`);
      _lastLoggedPausedState = false;
    } else if (_lastLoggedPausedState === null) {
      _lastLoggedPausedState = false;
    }
    const PER_CYCLE_CAP = 200;
    const pending = await dbQuery(
      `SELECT * FROM paper_trades WHERE status = 'pending_entry' ORDER BY last_checked_at ASC NULLS FIRST, created_at ASC LIMIT $1`,
      [PER_CYCLE_CAP]
    );
    if (!pending || !pending.rows.length) return;

    // ─── Market-Hours Gate (Phase 1, Apr 2026) ────────────────────────────
    // Outside RTH we do NOT auto-promote pending → open. Pending rows just
    // wait for the next session. BUT pending-expiry cancellation runs 24/7
    // (per product spec): if the contract has expired or the pending
    // window has elapsed, we still flip to 'cancelled' so the user's slot
    // counter stays accurate and stale rows don't accumulate.
    const marketOpen = isMarketOpenET();

    let checked = 0;
    let triggered = 0;
    let cancelled = 0;
    for (const t of pending.rows) {
      checked++;
      const expiryStr = normalizeExpiryToIso(t.expiry);
      // Pre-flight: if the contract or pending window has expired, cancel
      // without paying a Polygon quote call. evaluatePendingEntry() also
      // handles these (defense in depth) but doing it here avoids the fetch.
      // This pre-flight runs 24/7 — it is housekeeping, not trade execution.
      const contractExpired = isContractExpired(expiryStr);
      const pendingExpired = t.pending_expires_at != null && new Date(t.pending_expires_at).getTime() < Date.now();
      if (contractExpired || pendingExpired) {
        const reason = contractExpired ? "contract_expired" : "expired_unfilled";
        await dbQuery(
          `UPDATE paper_trades SET status = 'cancelled', pending_cancel_reason = $2,
            closed_at = NOW(), last_checked_at = NOW()
           WHERE id = $1 AND status = 'pending_entry'`,
          [t.id, reason]
        ).catch(() => null);
        cancelled++;
        console.log(`[paper-trade-monitor] pending cancelled ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: ${reason}`);
        continue;
      }

      // Trigger evaluation is RTH-only. Outside RTH: stay queued, touch
      // last_checked_at so round-robin ordering stays balanced.
      if (!marketOpen) {
        await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1 AND status = 'pending_entry'`, [t.id]).catch(() => null);
        continue;
      }

      const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));
      if (!q) {
        await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1 AND status = 'pending_entry'`, [t.id]).catch(() => null);
        continue;
      }
      const r = await evaluatePendingEntry(t, q);
      if (r.cancelled) {
        cancelled++;
        console.log(`[paper-trade-monitor] pending cancelled ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: ${r.cancelReason}`);
      } else if (r.triggered && r.row && r.fill) {
        triggered++;
        const u = r.underlying != null ? r.underlying.toFixed(2) : "n/a";
        console.log(`[paper-trade-monitor] pending → open ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: trigger=${t.entry_trigger_direction}@${Number(t.entry_trigger_price).toFixed(2)} underlying=${u} fill=${r.fill.price.toFixed(2)} (${r.fill.source})`);
      }
    }
    if (checked > 0) {
      const suffix = marketOpen ? "" : " (closed-market: cancellations only, triggers paused)";
      console.log(`[paper-trade-monitor] pending cycle: checked=${checked} triggered=${triggered} cancelled=${cancelled}${suffix}`);
    }
  } catch (e: any) {
    console.error("[paper-trade-monitor] pending cycle error:", e?.message);
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  const delay = isMarketOpenET() ? MARKET_HOURS_INTERVAL_MS : OFF_HOURS_INTERVAL_MS;
  timer = setTimeout(async () => {
    await processOpenTrades();
    await processPendingEntries();
    // EOD auto-close: cheap no-op outside the ET EOD window or when disabled.
    // Runs AFTER the regular open-trade sweep so that hard_stop / profit_target /
    // trailing_stop exits get first crack on every tick — EOD only handles the
    // residue of trades that those existing rules didn't already close.
    // Only PaperTradeSource is registered today; LiveTradeSource is intentionally
    // not invoked (gated by LIVE_EOD_CLOSE_ENABLED env var, default false).
    await runEodSweep(PaperTradeSource);
    // Reconcile the Polygon options WS subscription set against the current
    // open ∪ pending_entry rows. Runs every cycle so subscribe/unsubscribe
    // tracks trade lifecycle even when the REST sweep performs no work.
    await reconcileWsSubscriptions();
    scheduleNext();
  }, delay);
}

export function startPaperTradeMonitor(): void {
  if (started) return;
  started = true;
  const wsFlag = isOptionWsEnabled() ? "ws-options-stream" : "ws-options-DISABLED";
  console.log(`[paper-trade-monitor] starting (60s market hours / 5min off-hours, processes open + pending_entry + eod-sweep + ${wsFlag})`);
  // Wire the options WS quote callback before the first reconcile so any
  // events that arrive immediately after subscribe are routed to the right
  // trade rows. The callback is idempotent and registers exactly once.
  registerWsCallback();
  setTimeout(async () => {
    await processOpenTrades();
    await processPendingEntries();
    await runEodSweep(PaperTradeSource);
    await reconcileWsSubscriptions();
    scheduleNext();
  }, 5_000);
}
