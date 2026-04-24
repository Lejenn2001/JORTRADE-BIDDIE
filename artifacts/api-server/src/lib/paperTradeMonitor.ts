import { __paperTradeInternals } from "../routes/whale";

const { fetchOptionQuote, evaluateAndMaybeClose, closeExpiredNoQuote, isContractExpired, dbQuery } = __paperTradeInternals;

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
      const expiryStr = String(t.expiry).slice(0, 10);
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

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  const delay = isMarketHoursET() ? MARKET_HOURS_INTERVAL_MS : OFF_HOURS_INTERVAL_MS;
  timer = setTimeout(async () => {
    await processOpenTrades();
    scheduleNext();
  }, delay);
}

export function startPaperTradeMonitor(): void {
  if (started) return;
  started = true;
  console.log("[paper-trade-monitor] starting (60s market hours / 5min off-hours)");
  setTimeout(async () => {
    await processOpenTrades();
    scheduleNext();
  }, 5_000);
}
