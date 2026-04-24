import { __paperTradeInternals } from "../routes/whale";

const { fetchOptionQuote, pickExitFill, isContractExpired, isItmAtPrice, dbQuery } = __paperTradeInternals;

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

function shouldAutoCloseOnTarget(optionType: string, underlying: number | null, target: number | null): boolean {
  if (target == null || underlying == null) return false;
  return optionType === "call" ? underlying >= target : underlying <= target;
}

function shouldAutoCloseOnInvalidation(optionType: string, underlying: number | null, invalidation: number | null): boolean {
  if (invalidation == null || underlying == null) return false;
  return optionType === "call" ? underlying <= invalidation : underlying >= invalidation;
}

async function processOpenTrades(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const open = await dbQuery(`SELECT * FROM paper_trades WHERE status = 'open' ORDER BY opened_at ASC LIMIT 200`, []);
    if (!open || !open.rows.length) return;
    let checked = 0;
    let closed = 0;
    for (const t of open.rows) {
      checked++;
      const expiryStr = String(t.expiry).slice(0, 10);
      const expired = isContractExpired(expiryStr);
      const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));
      if (!q) {
        await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1`, [t.id]).catch(() => null);
        continue;
      }
      const underlying = q.underlying;
      const target = t.signal_target != null ? Number(t.signal_target) : null;
      const inval = t.signal_invalidation != null ? Number(t.signal_invalidation) : null;

      const lastPrice = q.bid != null && q.bid > 0 ? q.bid : q.mid != null && q.mid > 0 ? q.mid : q.last;
      await dbQuery(
        `UPDATE paper_trades SET last_quote_price = $1, last_quote_underlying = $2, last_checked_at = NOW() WHERE id = $3`,
        [lastPrice, underlying, t.id]
      ).catch(() => null);

      let exitReason: string | null = null;
      if (expired) exitReason = "expired";
      else if (shouldAutoCloseOnTarget(t.option_type, underlying, target)) exitReason = "target_hit";
      else if (shouldAutoCloseOnInvalidation(t.option_type, underlying, inval)) exitReason = "invalidated";

      if (!exitReason) continue;

      const itm = isItmAtPrice(t.option_type, Number(t.strike), underlying);
      const fill = pickExitFill(q, expired, itm);
      if (!fill) {
        await dbQuery(
          `UPDATE paper_trades SET exit_reason = $1, last_checked_at = NOW() WHERE id = $2`,
          [`${exitReason}_pending_quote`, t.id]
        ).catch(() => null);
        continue;
      }

      const entry = Number(t.entry_price);
      const contracts = Number(t.contracts);
      const realizedPl = (fill.price - entry) * contracts * 100;
      const realizedPlPct = entry > 0 ? ((fill.price - entry) / entry) * 100 : 0;
      const upd = await dbQuery(
        `UPDATE paper_trades SET status = 'closed', exit_price = $1, exit_fill_source = $2,
          exit_underlying = $3, exit_reason = $4, closed_at = NOW(),
          realized_pl = $5, realized_pl_pct = $6,
          last_quote_price = $1, last_quote_underlying = $3, last_checked_at = NOW()
         WHERE id = $7 AND status = 'open' RETURNING id`,
        [fill.price, fill.source, underlying, exitReason, realizedPl, realizedPlPct, t.id]
      ).catch(() => null);
      if (!upd || !upd.rowCount) continue;
      closed++;
      console.log(`[paper-trade-monitor] auto-closed ${t.ticker} ${t.option_type} $${t.strike} ${expiryStr}: ${exitReason} @ ${fill.price.toFixed(2)} (${fill.source}), P/L $${realizedPl.toFixed(2)}`);
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
  // Initial run shortly after boot
  setTimeout(async () => {
    await processOpenTrades();
    scheduleNext();
  }, 5_000);
}
