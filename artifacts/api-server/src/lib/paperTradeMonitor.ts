import { fetchOptionQuote, evaluateAndMaybeClose, closeExpiredNoQuote, isContractExpired, dbQuery, normalizeExpiryToIso, evaluatePendingEntry } from "./paperTradeService";

const MARKET_HOURS_INTERVAL_MS = 60_000;
const OFF_HOURS_INTERVAL_MS = 5 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let started = false;

function isMarketHoursET(): boolean {
  try {
    const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const day = nowEt.getDay();
    if (day === 0 || day === 6) return false;
    const minutes = nowEt.getHours() * 60 + nowEt.getMinutes();
    return minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
  } catch {
    return false;
  }
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
    if (checked > 0) console.log(`[paper-trade-monitor] cycle: checked=${checked} closed=${closed}`);
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
async function processPendingEntries(): Promise<void> {
  try {
    const PER_CYCLE_CAP = 200;
    const pending = await dbQuery(
      `SELECT * FROM paper_trades WHERE status = 'pending_entry' ORDER BY last_checked_at ASC NULLS FIRST, created_at ASC LIMIT $1`,
      [PER_CYCLE_CAP]
    );
    if (!pending || !pending.rows.length) return;
    let checked = 0;
    let triggered = 0;
    let cancelled = 0;
    for (const t of pending.rows) {
      checked++;
      const expiryStr = normalizeExpiryToIso(t.expiry);
      // Pre-flight: if the contract or pending window has expired, cancel
      // without paying a Polygon quote call. evaluatePendingEntry() also
      // handles these (defense in depth) but doing it here avoids the fetch.
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
    if (checked > 0) console.log(`[paper-trade-monitor] pending cycle: checked=${checked} triggered=${triggered} cancelled=${cancelled}`);
  } catch (e: any) {
    console.error("[paper-trade-monitor] pending cycle error:", e?.message);
  }
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  const delay = isMarketHoursET() ? MARKET_HOURS_INTERVAL_MS : OFF_HOURS_INTERVAL_MS;
  timer = setTimeout(async () => {
    await processOpenTrades();
    await processPendingEntries();
    scheduleNext();
  }, delay);
}

export function startPaperTradeMonitor(): void {
  if (started) return;
  started = true;
  console.log("[paper-trade-monitor] starting (60s market hours / 5min off-hours, processes open + pending_entry)");
  setTimeout(async () => {
    await processOpenTrades();
    await processPendingEntries();
    scheduleNext();
  }, 5_000);
}
