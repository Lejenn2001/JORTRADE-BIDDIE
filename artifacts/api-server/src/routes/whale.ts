import { Router } from "express";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { priceMonitor, type PriceData } from "../lib/priceMonitor";
import { livePriceService } from "../lib/livePriceService";
import { attachExecutionVerdicts } from "../lib/executionEvaluator";
import { isMarketOpenET, MARKET_CLOSED_MESSAGE, getEodPhaseET } from "../lib/marketHours";
import { getEodConfig } from "../lib/eodCloseConfig";
import { getPolygonKey } from "../lib/polygonKey";

const router = Router();

const UW_BASE = "https://api.unusualwhales.com";
const UW_HEADERS = () => ({ Authorization: `Bearer ${process.env["UNUSUAL_WHALES_API_KEY"] ?? ""}` });
const AI_BASE_URL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
const AI_API_KEY = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";
const POLYGON_KEY = () => getPolygonKey();
const POLYGON_AGGS_URL = (ticker: string, mult: number, span: string, from: string, to: string) =>
  `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${mult}/${span}/${from}/${to}?adjusted=true&sort=asc&apiKey=${POLYGON_KEY()}`;
const POLYGON_SNAPSHOT_TICKER = (ticker: string) =>
  `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_KEY()}`;

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const MARKET_HOLIDAYS: Set<string> = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
  "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
  "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06",
  "2027-11-25", "2027-12-24",
]);

function isMarketHoliday(dateStr: string): boolean {
  return MARKET_HOLIDAYS.has(dateStr);
}

function adjustExpiryForHolidays(dateStr: string): string {
  let d = new Date(dateStr + "T12:00:00");
  for (let i = 0; i < 5; i++) {
    const iso = fmtDate(d);
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5 && !isMarketHoliday(iso)) return iso;
    d.setDate(d.getDate() - 1);
  }
  return dateStr;
}

interface PolygonBar {
  open: number; high: number; low: number; close: number; volume: number; timestamp: number; vw: number;
}

async function fetchPolygonAggs(ticker: string, mult: number, span: string, fromDate: string, toDate: string): Promise<PolygonBar[]> {
  try {
    const key = POLYGON_KEY();
    if (!key) return [];
    const url = POLYGON_AGGS_URL(ticker, mult, span, fromDate, toDate);
    const res = await axios.get(url, { timeout: 8000 });
    logApiCall("polygon", "aggs");
    const bars = res.data?.results;
    if (!Array.isArray(bars)) return [];
    return bars.map((b: any) => ({
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, timestamp: Math.floor(b.t / 1000), vw: b.vw ?? 0,
    }));
  } catch {
    return [];
  }
}

async function fetchPolygonSnapshot(ticker: string): Promise<{ price: number; prevClose: number } | null> {
  try {
    const key = POLYGON_KEY();
    if (!key) return null;
    const res = await axios.get(POLYGON_SNAPSHOT_TICKER(ticker), { timeout: 5000 });
    logApiCall("polygon", "snapshot");
    const t = res.data?.ticker;
    if (!t) return null;
    const price = t.lastTrade?.p || t.day?.c || 0;
    if (price <= 0) return null;
    return { price, prevClose: t.prevDay?.c || 0 };
  } catch {
    return null;
  }
}

const claude = new Anthropic({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

const SUPABASE_URL = process.env["VITE_SUPABASE_URL"] || "";
const SUPABASE_KEY = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
const SUPABASE_SERVICE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] || SUPABASE_KEY;

function supabaseAdminHeaders() {
  return {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
}

const pool = new pg.Pool({ connectionString: process.env["DATABASE_URL"] });

async function dbQuery(text: string, params?: any[]): Promise<any> {
  try {
    return await pool.query(text, params);
  } catch (e: any) {
    console.error("[DB] Query error:", e.message);
    return null;
  }
}

const SEED_ADMIN_IDS = [
  "6e8cffca-7c06-4896-b67f-478965ac6556",
  "5845af78-f880-431b-b2c0-56a9923e6835",
];

(async () => {
  try {
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, role)
      )`
    );
    for (const uid of SEED_ADMIN_IDS) {
      await dbQuery(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id, role) DO NOTHING`,
        [uid]
      );
    }
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS chat_reactions (
        id SERIAL PRIMARY KEY,
        message_id UUID NOT NULL,
        user_id TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(message_id, user_id, emoji)
      )`
    );
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS signal_reviews (
        id SERIAL PRIMARY KEY,
        signal_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        note TEXT,
        reviewed_by TEXT NOT NULL,
        reviewed_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );
    await dbQuery(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS reinforcement_count INTEGER DEFAULT 1`, []);
    await dbQuery(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS last_reinforced_at TIMESTAMPTZ`, []);
    await dbQuery(
      `CREATE TABLE IF NOT EXISTS paper_trades (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        signal_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        option_type TEXT NOT NULL,
        strike NUMERIC NOT NULL,
        expiry DATE NOT NULL,
        contract_symbol TEXT NOT NULL,
        contracts INTEGER NOT NULL DEFAULT 1,
        entry_price NUMERIC NOT NULL,
        entry_fill_source TEXT NOT NULL,
        entry_underlying NUMERIC,
        entry_iv NUMERIC,
        entry_delta NUMERIC,
        target_price NUMERIC,
        stop_price NUMERIC,
        signal_target NUMERIC,
        signal_invalidation NUMERIC,
        opened_at TIMESTAMPTZ DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'open',
        exit_price NUMERIC,
        exit_fill_source TEXT,
        exit_underlying NUMERIC,
        exit_reason TEXT,
        closed_at TIMESTAMPTZ,
        realized_pl NUMERIC,
        realized_pl_pct NUMERIC,
        last_quote_price NUMERIC,
        last_quote_underlying NUMERIC,
        last_checked_at TIMESTAMPTZ
      )`
    );
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_paper_trades_user_status ON paper_trades(user_id, status)`, []);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_paper_trades_open ON paper_trades(status) WHERE status = 'open'`, []);
    // Paper Automation Engine — Commit 1 (pending_entry state).
    // Adds the columns and index needed for the monitor's pending-entry sweep.
    // Constraint relaxations are required because pending rows have no fill yet;
    // existing 'open'/'closed' rows continue to satisfy the data invariant.
    await dbQuery(`ALTER TABLE paper_trades ALTER COLUMN entry_price DROP NOT NULL`, []).catch(() => null);
    await dbQuery(`ALTER TABLE paper_trades ALTER COLUMN entry_fill_source DROP NOT NULL`, []).catch(() => null);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS entry_trigger_price NUMERIC`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS entry_trigger_direction TEXT`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS pending_expires_at TIMESTAMPTZ`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS pending_cancel_reason TEXT`, []);
    // created_at = ticket creation time (always set on INSERT). opened_at now
    // semantically means "filled time" — set on entry promotion (or at INSERT
    // for legacy market-mode rows). Backfill: existing rows have created_at
    // NULL; sorts use COALESCE(created_at, opened_at).
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`, []);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_paper_trades_pending ON paper_trades(status) WHERE status = 'pending_entry'`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS last_quote_source TEXT`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS signal_entry NUMERIC`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS signal_grade TEXT`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS signal_confidence TEXT`, []);
    // Full quote-level snapshots (bid/ask/mid/last) for entry, last-seen, and exit.
    // Stored alongside the chosen fill price so the original book context is preserved
    // for forensics, reporting, and future analytics (e.g. "what slippage vs mid?").
    for (const col of [
      "entry_bid", "entry_ask", "entry_mid", "entry_last",
      "last_quote_bid", "last_quote_ask", "last_quote_mid", "last_quote_last",
      "exit_bid", "exit_ask", "exit_mid", "exit_last",
    ]) {
      await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS ${col} NUMERIC`, []);
    }
    // Paper Automation Engine — Commit 4 (Exit Strategy Layer).
    // trailing_active is a latched flag: false→true once the trade first crosses
    // the trailing activation threshold (+20% option P&L). It never resets.
    // highest_price_after_activation tracks the peak option fill price observed
    // since trailing_active flipped on. It is only ever bumped upward — survives
    // missed quotes, never decreases. Both columns are NULL/false on legacy rows
    // and are populated lazily by the monitor on the next tick after this seed.
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS trailing_active BOOLEAN DEFAULT FALSE`, []);
    await dbQuery(`ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS highest_price_after_activation NUMERIC`, []);
    // Normalize legacy exit_reason values → canonical enum {target_hit, stop_hit, closed_expired, closed_manual}
    await dbQuery(`UPDATE paper_trades SET exit_reason = 'stop_hit' WHERE exit_reason = 'invalidated'`, []).catch(() => null);
    await dbQuery(`UPDATE paper_trades SET exit_reason = 'closed_manual' WHERE exit_reason = 'manual'`, []).catch(() => null);
    await dbQuery(`UPDATE paper_trades SET exit_reason = 'closed_expired' WHERE exit_reason = 'expired'`, []).catch(() => null);
    console.log(`[admin-seed] Ensured ${SEED_ADMIN_IDS.length} admin(s) in user_roles, reinforcement + paper_trades tables ready`);

    const dupeCheck = await dbQuery(`
      SELECT ticker, COALESCE(strike, 0) as strike, COALESCE(option_type, '') as opt_type,
             COALESCE(expiry, '') as expiry,
             (detected_at AT TIME ZONE 'America/New_York')::date as et_date,
             COUNT(*) as cnt
      FROM signal_outcomes
      WHERE signal_source = 'replit'
      GROUP BY ticker, COALESCE(strike, 0), COALESCE(option_type, ''),
               COALESCE(expiry, ''), (detected_at AT TIME ZONE 'America/New_York')::date
      HAVING COUNT(*) > 1
    `);
    const dupeGroups = dupeCheck?.rows || [];
    if (dupeGroups.length > 0) {
      console.log(`[reinforcement-cleanup] Found ${dupeGroups.length} same-day exact-contract duplicate groups`);
      for (const g of dupeGroups) {
        const rows = await dbQuery(`
          SELECT id, confidence, detected_at FROM signal_outcomes
          WHERE ticker = $1 AND COALESCE(strike, 0) = $2 AND COALESCE(option_type, '') = $3
            AND COALESCE(expiry, '') = $4 AND signal_source = 'replit'
            AND (detected_at AT TIME ZONE 'America/New_York')::date = $5
          ORDER BY detected_at ASC
        `, [g.ticker, g.strike, g.opt_type, g.expiry, g.et_date]);
        if (!rows || rows.rows.length < 2) continue;
        const keeper = rows.rows[0];
        const dupes = rows.rows.slice(1);
        const maxConf = Math.max(...rows.rows.map((r: any) => Number(r.confidence) || 0));
        const lastDetected = dupes[dupes.length - 1].detected_at;
        const dupeIds = dupes.map((d: any) => d.id);
        await dbQuery(`UPDATE user_trades SET signal_id = $1 WHERE signal_id = ANY($2::text[])`, [keeper.id, dupeIds]);
        await dbQuery(`UPDATE signal_outcomes SET reinforcement_count = $1, last_reinforced_at = $2, confidence = GREATEST(confidence, $3) WHERE id = $4`,
          [rows.rows.length, lastDetected, maxConf, keeper.id]);
        await dbQuery(`DELETE FROM signal_outcomes WHERE id = ANY($1::uuid[])`, [dupeIds]);
        console.log(`[reinforcement-cleanup] ${g.ticker} ${g.opt_type} $${g.strike} ${g.et_date}: kept ${keeper.id}, merged ${dupes.length} dupes → ${rows.rows.length}x reinforcement`);
      }
      console.log(`[reinforcement-cleanup] Cleanup complete`);
    } else {
      console.log(`[reinforcement-cleanup] No same-day exact-contract duplicates found`);
    }

    const resolvedWatching = await dbQuery(`
      UPDATE signal_outcomes
      SET trade_status = CASE outcome
        WHEN 'hit' THEN 'hit'
        WHEN 'partial_hit' THEN 'partial'
        WHEN 'near_miss' THEN 'near_miss'
        WHEN 'missed' THEN 'miss'
        WHEN 'expired' THEN 'expired'
        ELSE trade_status
      END,
      status_updated_at = NOW()
      WHERE signal_source = 'replit'
        AND trade_status = 'watching'
        AND outcome != 'pending'
      RETURNING id, ticker, outcome
    `);
    const resolvedCount = resolvedWatching?.rows?.length || 0;
    if (resolvedCount > 0) {
      console.log(`[status-cleanup] Fixed ${resolvedCount} resolved signals stuck on WATCHING → matched to outcome`);
      for (const r of resolvedWatching!.rows) {
        console.log(`[status-cleanup]   ${r.ticker}: watching → ${r.outcome}`);
      }
    }

    const rweResult = await dbQuery(`
      UPDATE signal_outcomes
      SET trade_status = 'ran_without_entry',
          status_updated_at = NOW()
      WHERE signal_source = 'replit'
        AND trade_status = 'watching'
        AND outcome = 'pending'
        AND entry_price_reached = false
        AND mfe_percent >= 15
      RETURNING id, ticker, mfe_percent
    `);
    const rweCount = rweResult?.rows?.length || 0;
    if (rweCount > 0) {
      console.log(`[status-cleanup] Moved ${rweCount} pending WATCHING signals with MFE >= 15% → ran_without_entry`);
      for (const r of rweResult!.rows) {
        console.log(`[status-cleanup]   ${r.ticker}: MFE ${Number(r.mfe_percent).toFixed(1)}% → ran_without_entry`);
      }
    }

    if (resolvedCount === 0 && rweCount === 0) {
      console.log(`[status-cleanup] No status corrections needed`);
    }
  } catch (e: any) {
    console.error("[admin-seed] Failed:", e.message);
  }
})();

async function isAdminUser(userId: string): Promise<boolean> {
  const localCheck = await dbQuery(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin' LIMIT 1`,
    [userId]
  );
  if (localCheck?.rows?.length) return true;

  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const resp = await axios.get(
        `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&role=eq.admin&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, timeout: 5000 }
      );
      if (resp.data?.length > 0) {
        await dbQuery(
          `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id, role) DO NOTHING`,
          [userId]
        );
        return true;
      }
    } catch {}
  }
  return false;
}

// ── API Usage Logging ────────────────────────────────────────────────────────

async function logApiCall(apiName: string, endpoint: string) {
  try {
    await pool.query(
      `INSERT INTO api_usage_log (id, api_name, endpoint, created_at) VALUES (gen_random_uuid(), $1, $2, NOW())`,
      [apiName, endpoint]
    );
  } catch {}
}

// ── Data Fetchers ──────────────────────────────────────────────────────────────

async function fetchFlowAlerts(limit = 200) {
  try {
    const res = await axios.get(`${UW_BASE}/api/option-trades/flow-alerts`, {
      headers: UW_HEADERS(), params: { limit }, timeout: 15000,
    });
    logApiCall("unusual_whales", "flow-alerts");
    const d = res.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  } catch { return []; }
}

async function fetchDarkpool(ticker: string, limit = 40) {
  try {
    const res = await axios.get(`${UW_BASE}/api/darkpool/${ticker.toUpperCase()}`, {
      headers: UW_HEADERS(), params: { limit }, timeout: 15000,
    });
    logApiCall("unusual_whales", "darkpool");
    const d = res.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  } catch { return []; }
}

async function fetchKeyLevels(ticker: string, uwPrice?: number | null) {
  try {
    const now = new Date();
    const from5d = new Date(now); from5d.setDate(from5d.getDate() - 7);
    const today = fmtDate(now);

    const [dailyBars, intradayBars] = await Promise.all([
      fetchPolygonAggs(ticker, 1, "day", fmtDate(from5d), today),
      fetchPolygonAggs(ticker, 1, "minute", today, today),
    ]);

    let prevClose: number | null = null, prevHigh: number | null = null;
    let prevLow: number | null = null, prevOpen: number | null = null;
    let todayOpen: number | null = null, todayHigh: number | null = null, todayLow: number | null = null;

    if (dailyBars.length >= 2) {
      const prev = dailyBars[dailyBars.length - 2];
      const tod = dailyBars[dailyBars.length - 1];
      prevClose = prev.close; prevHigh = prev.high; prevLow = prev.low; prevOpen = prev.open;
      todayOpen = tod.open; todayHigh = tod.high; todayLow = tod.low;
    } else if (dailyBars.length === 1) {
      const bar = dailyBars[0];
      prevClose = bar.close; prevHigh = bar.high; prevLow = bar.low; prevOpen = bar.open;
    }

    let vwap: number | null = null;
    if (intradayBars.length > 0) {
      let cumTPV = 0, cumVol = 0;
      for (const b of intradayBars) {
        if (b.high && b.low && b.close && b.volume) {
          cumTPV += ((b.high + b.low + b.close) / 3) * b.volume;
          cumVol += b.volume;
        }
      }
      vwap = cumVol > 0 ? Math.round((cumTPV / cumVol) * 100) / 100 : null;
    }

    const rtData = priceMonitor.getPrice(ticker);
    const polygonLive = rtData && Date.now() - rtData.lastUpdate < 120000
      ? Math.round(rtData.price * 100) / 100
      : null;

    let currentPrice: number | null = polygonLive ?? null;
    if (!currentPrice && uwPrice) {
      currentPrice = Math.round(uwPrice * 100) / 100;
    }
    if (!currentPrice) {
      const snap = await fetchPolygonSnapshot(ticker);
      if (snap) currentPrice = Math.round(snap.price * 100) / 100;
    }
    if (!currentPrice && intradayBars.length > 0) {
      currentPrice = Math.round(intradayBars[intradayBars.length - 1].close * 100) / 100;
    }
    if (!currentPrice && prevClose) {
      currentPrice = Math.round(prevClose * 100) / 100;
    }

    const pivot = prevHigh && prevLow && prevClose
      ? Math.round(((prevHigh + prevLow + prevClose) / 3) * 100) / 100
      : null;
    const r1 = pivot && prevLow ? Math.round((2 * pivot - prevLow) * 100) / 100 : null;
    const s1 = pivot && prevHigh ? Math.round((2 * pivot - prevHigh) * 100) / 100 : null;
    const r2 = pivot && prevHigh && prevLow
      ? Math.round((pivot + (prevHigh - prevLow)) * 100) / 100 : null;
    const s2 = pivot && prevHigh && prevLow
      ? Math.round((pivot - (prevHigh - prevLow)) * 100) / 100 : null;

    return {
      ticker: ticker.toUpperCase(),
      current_price: currentPrice ? Math.round(currentPrice * 100) / 100 : null,
      vwap,
      today: {
        open: todayOpen ? Math.round(todayOpen * 100) / 100 : null,
        high: todayHigh ? Math.round(todayHigh * 100) / 100 : null,
        low: todayLow ? Math.round(todayLow * 100) / 100 : null,
      },
      prior_day: {
        open: prevOpen ? Math.round(prevOpen * 100) / 100 : null,
        high: prevHigh ? Math.round(prevHigh * 100) / 100 : null,
        low: prevLow ? Math.round(prevLow * 100) / 100 : null,
        close: prevClose ? Math.round(prevClose * 100) / 100 : null,
      },
      pivot_points: { pivot, r1, r2, s1, s2 },
    };
  } catch {
    return null;
  }
}

async function fetchSectorEtfs() {
  try {
    const res = await axios.get(`${UW_BASE}/api/market/sector-etfs`, {
      headers: UW_HEADERS(), timeout: 10000,
    });
    const d = res.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  } catch { return []; }
}

async function fetchEconomicCalendar() {
  try {
    const res = await axios.get(`${UW_BASE}/api/market/economic-calendar`, {
      headers: UW_HEADERS(), timeout: 10000,
    });
    const d = res.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  } catch { return []; }
}

// ── Price Action Confirmation ─────────────────────────────────────────────────

interface CandleBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface PriceConfirmation {
  confirmed: boolean;
  pattern: string | null;
  rejection_level: number | null;
  candles_checked: number;
  gamma_zone: "positive" | "negative" | "neutral";
  gamma_description: string;
}

async function fetchRecentCandles(ticker: string, interval = "1m", count = 10): Promise<CandleBar[]> {
  try {
    const mult = interval === "5m" ? 5 : interval === "15m" ? 15 : 1;
    const today = fmtDate(new Date());
    const bars = await fetchPolygonAggs(ticker, mult, "minute", today, today);
    return bars.slice(-count);
  } catch { return []; }
}

async function fetchStructureCandles(ticker: string): Promise<CandleBar[]> {
  try {
    const now = new Date();
    const from5d = new Date(now); from5d.setDate(from5d.getDate() - 5);
    return await fetchPolygonAggs(ticker, 5, "minute", fmtDate(from5d), fmtDate(now));
  } catch { return []; }
}

interface SwingPoint {
  type: "high" | "low";
  price: number;
  index: number;
  timestamp: number;
}

interface FairValueGap {
  type: "bullish" | "bearish";
  top: number;
  bottom: number;
  midpoint: number;
  index: number;
  status: "unfilled" | "partially_filled" | "inversed";
  consequent_encroachment: boolean;
}

interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  midpoint: number;
  index: number;
  respected: boolean;
}

interface LiquidityLevel {
  type: "buy_side" | "sell_side";
  price: number;
  strength: "weak" | "moderate" | "strong";
  swept: boolean;
}

interface MarketStructure {
  trend: "uptrend" | "downtrend" | "ranging";
  swing_highs: { price: number; timestamp: number }[];
  swing_lows: { price: number; timestamp: number }[];
  fvgs: { type: string; zone: string; midpoint: number; status: string }[];
  ifvgs: { original_type: string; zone: string; midpoint: number; implication: string }[];
  order_blocks: { type: string; zone: string; midpoint: number; respected: boolean }[];
  liquidity_levels: { type: string; price: number; strength: string; swept: boolean }[];
  nearest_support: number | null;
  nearest_resistance: number | null;
  break_of_structure: string | null;
  change_of_character: string | null;
  premium_discount: "premium" | "discount" | "equilibrium" | null;
  structure_summary: string;
}

function findSwingPoints(candles: CandleBar[], lookback = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isSwingHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isSwingLow = false;
    }
    if (isSwingHigh) swings.push({ type: "high", price: candles[i].high, index: i, timestamp: candles[i].timestamp });
    if (isSwingLow) swings.push({ type: "low", price: candles[i].low, index: i, timestamp: candles[i].timestamp });
  }
  return swings;
}

function findFairValueGaps(candles: CandleBar[]): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];
    if (c3.low > c1.high) {
      const top = c3.low;
      const bottom = c1.high;
      const mid = (top + bottom) / 2;
      let status: "unfilled" | "partially_filled" | "inversed" = "unfilled";
      let ce = false;
      const subsequent = candles.slice(i + 1);
      for (const sc of subsequent) {
        if (sc.low <= bottom) { status = "inversed"; break; }
        if (sc.low <= mid) { ce = true; status = "partially_filled"; }
      }
      fvgs.push({ type: "bullish", top, bottom, midpoint: mid, index: i - 1, status, consequent_encroachment: ce });
    }
    if (c1.low > c3.high) {
      const top = c1.low;
      const bottom = c3.high;
      const mid = (top + bottom) / 2;
      let status: "unfilled" | "partially_filled" | "inversed" = "unfilled";
      let ce = false;
      const subsequent = candles.slice(i + 1);
      for (const sc of subsequent) {
        if (sc.high >= top) { status = "inversed"; break; }
        if (sc.high >= mid) { ce = true; status = "partially_filled"; }
      }
      fvgs.push({ type: "bearish", top, bottom, midpoint: mid, index: i - 1, status, consequent_encroachment: ce });
    }
  }
  return fvgs;
}

function findOrderBlocks(candles: CandleBar[], swings: SwingPoint[]): OrderBlock[] {
  const obs: OrderBlock[] = [];
  for (const swing of swings) {
    const idx = swing.index;
    if (idx < 1 || idx >= candles.length) continue;
    if (swing.type === "low") {
      for (let j = idx; j >= Math.max(0, idx - 3); j--) {
        const c = candles[j];
        if (c.close < c.open) {
          const respected = candles.slice(idx + 1).every(sc => sc.low >= c.low * 0.998);
          obs.push({ type: "bullish", high: c.high, low: c.low, midpoint: (c.high + c.low) / 2, index: j, respected });
          break;
        }
      }
    } else {
      for (let j = idx; j >= Math.max(0, idx - 3); j--) {
        const c = candles[j];
        if (c.close > c.open) {
          const respected = candles.slice(idx + 1).every(sc => sc.high <= c.high * 1.002);
          obs.push({ type: "bearish", high: c.high, low: c.low, midpoint: (c.high + c.low) / 2, index: j, respected });
          break;
        }
      }
    }
  }
  return obs;
}

function findLiquidityLevels(swings: SwingPoint[], candles: CandleBar[], currentPrice: number): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  const highs = swings.filter(s => s.type === "high").sort((a, b) => a.index - b.index);
  const lows = swings.filter(s => s.type === "low").sort((a, b) => a.index - b.index);
  const equalThreshold = 0.002;
  for (let i = 1; i < highs.length; i++) {
    const diff = Math.abs(highs[i].price - highs[i - 1].price) / highs[i].price;
    if (diff < equalThreshold) {
      const eqPrice = (highs[i].price + highs[i - 1].price) / 2;
      const swept = candles.slice(highs[i].index + 1).some(c => c.high > eqPrice * 1.001);
      levels.push({ type: "buy_side", price: eqPrice, strength: "strong", swept });
    }
  }
  for (let i = 1; i < lows.length; i++) {
    const diff = Math.abs(lows[i].price - lows[i - 1].price) / lows[i].price;
    if (diff < equalThreshold) {
      const eqPrice = (lows[i].price + lows[i - 1].price) / 2;
      const swept = candles.slice(lows[i].index + 1).some(c => c.low < eqPrice * 0.999);
      levels.push({ type: "sell_side", price: eqPrice, strength: "strong", swept });
    }
  }
  for (const h of highs.slice(-5)) {
    if (!levels.some(l => Math.abs(l.price - h.price) / h.price < 0.003)) {
      const swept = candles.slice(h.index + 1).some(c => c.high > h.price * 1.001);
      levels.push({ type: "buy_side", price: h.price, strength: "moderate", swept });
    }
  }
  for (const l of lows.slice(-5)) {
    if (!levels.some(lv => Math.abs(lv.price - l.price) / l.price < 0.003)) {
      const swept = candles.slice(l.index + 1).some(c => c.low < l.price * 0.999);
      levels.push({ type: "sell_side", price: l.price, strength: "moderate", swept });
    }
  }
  return levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)).slice(0, 8);
}

function analyzeMarketStructure(candles: CandleBar[], currentPrice: number | null): MarketStructure {
  const defaultResult: MarketStructure = {
    trend: "ranging",
    swing_highs: [],
    swing_lows: [],
    fvgs: [],
    ifvgs: [],
    order_blocks: [],
    liquidity_levels: [],
    nearest_support: null,
    nearest_resistance: null,
    break_of_structure: null,
    change_of_character: null,
    premium_discount: null,
    structure_summary: "Insufficient data",
  };
  if (candles.length < 10) return defaultResult;

  const swings = findSwingPoints(candles, 3);
  const highs = swings.filter(s => s.type === "high").sort((a, b) => a.index - b.index);
  const lows = swings.filter(s => s.type === "low").sort((a, b) => a.index - b.index);

  let trend: "uptrend" | "downtrend" | "ranging" = "ranging";
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    const hhCount = recentHighs.filter((h, i) => i > 0 && h.price > recentHighs[i - 1].price).length;
    const hlCount = recentLows.filter((l, i) => i > 0 && l.price > recentLows[i - 1].price).length;
    const lhCount = recentHighs.filter((h, i) => i > 0 && h.price < recentHighs[i - 1].price).length;
    const llCount = recentLows.filter((l, i) => i > 0 && l.price < recentLows[i - 1].price).length;
    if (hhCount >= 1 && hlCount >= 1) trend = "uptrend";
    else if (lhCount >= 1 && llCount >= 1) trend = "downtrend";
  }

  const allFvgs = findFairValueGaps(candles);
  const activeFvgs = allFvgs.filter(f => f.status === "unfilled" || f.status === "partially_filled").slice(-8);
  const inversedFvgs = allFvgs.filter(f => f.status === "inversed").slice(-6);

  const orderBlocks = findOrderBlocks(candles, swings).slice(-6);

  const price = currentPrice || candles[candles.length - 1]?.close || 0;
  const liquidityLevels = findLiquidityLevels(swings, candles, price);

  const supports = [
    ...lows.map(l => l.price),
    ...activeFvgs.filter(f => f.type === "bullish").map(f => f.midpoint),
    ...orderBlocks.filter(o => o.type === "bullish" && o.respected).map(o => o.midpoint),
  ].filter(p => p < price).sort((a, b) => b - a);
  const resistances = [
    ...highs.map(h => h.price),
    ...activeFvgs.filter(f => f.type === "bearish").map(f => f.midpoint),
    ...orderBlocks.filter(o => o.type === "bearish" && o.respected).map(o => o.midpoint),
  ].filter(p => p > price).sort((a, b) => a - b);

  let bos: string | null = null;
  let choch: string | null = null;
  if (highs.length >= 2 && lows.length >= 2) {
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs.length >= 2 ? highs[highs.length - 2] : null;
    const lastLow = lows[lows.length - 1];
    const prevLow = lows.length >= 2 ? lows[lows.length - 2] : null;
    if (price > lastHigh.price) {
      if (trend === "uptrend") {
        bos = `Bullish BOS: Price broke above swing high at $${lastHigh.price.toFixed(2)} — trend continuation`;
      } else {
        choch = `Bullish CHoCH: Price broke above $${lastHigh.price.toFixed(2)} after downtrend — potential reversal to upside`;
      }
    }
    if (price < lastLow.price) {
      if (trend === "downtrend") {
        bos = `Bearish BOS: Price broke below swing low at $${lastLow.price.toFixed(2)} — trend continuation`;
      } else {
        choch = `Bearish CHoCH: Price broke below $${lastLow.price.toFixed(2)} after uptrend — potential reversal to downside`;
      }
    }
  }

  let premDisc: "premium" | "discount" | "equilibrium" | null = null;
  if (highs.length && lows.length) {
    const rangeHigh = Math.max(...highs.slice(-3).map(h => h.price));
    const rangeLow = Math.min(...lows.slice(-3).map(l => l.price));
    const eq = (rangeHigh + rangeLow) / 2;
    if (price > eq * 1.01) premDisc = "premium";
    else if (price < eq * 0.99) premDisc = "discount";
    else premDisc = "equilibrium";
  }

  const summaryParts: string[] = [];
  summaryParts.push(`Structure: ${trend.toUpperCase()}`);
  if (premDisc) summaryParts.push(`Price in ${premDisc.toUpperCase()} zone`);
  if (supports.length) summaryParts.push(`Support: $${supports[0].toFixed(2)}`);
  if (resistances.length) summaryParts.push(`Resistance: $${resistances[0].toFixed(2)}`);
  if (bos) summaryParts.push(bos);
  if (choch) summaryParts.push(choch);
  const bullAFvgs = activeFvgs.filter(f => f.type === "bullish");
  const bearAFvgs = activeFvgs.filter(f => f.type === "bearish");
  if (bullAFvgs.length) summaryParts.push(`${bullAFvgs.length} active bullish FVG(s)`);
  if (bearAFvgs.length) summaryParts.push(`${bearAFvgs.length} active bearish FVG(s)`);
  const bullIFvgs = inversedFvgs.filter(f => f.type === "bullish");
  const bearIFvgs = inversedFvgs.filter(f => f.type === "bearish");
  if (bullIFvgs.length) summaryParts.push(`${bullIFvgs.length} IFVG(s) from bullish gaps (now bearish reversal zones)`);
  if (bearIFvgs.length) summaryParts.push(`${bearIFvgs.length} IFVG(s) from bearish gaps (now bullish reversal zones)`);
  const respOBs = orderBlocks.filter(o => o.respected);
  if (respOBs.length) summaryParts.push(`${respOBs.length} respected order block(s)`);
  const unsweptLiq = liquidityLevels.filter(l => !l.swept);
  if (unsweptLiq.length) summaryParts.push(`${unsweptLiq.length} unswept liquidity level(s) nearby`);

  return {
    trend,
    swing_highs: highs.slice(-4).map(h => ({ price: h.price, timestamp: h.timestamp })),
    swing_lows: lows.slice(-4).map(l => ({ price: l.price, timestamp: l.timestamp })),
    fvgs: activeFvgs.map(f => ({
      type: f.type,
      zone: `$${f.bottom.toFixed(2)} - $${f.top.toFixed(2)}`,
      midpoint: f.midpoint,
      status: f.consequent_encroachment ? "CE reached (partially filled)" : "unfilled",
    })),
    ifvgs: inversedFvgs.map(f => ({
      original_type: f.type,
      zone: `$${f.bottom.toFixed(2)} - $${f.top.toFixed(2)}`,
      midpoint: f.midpoint,
      implication: f.type === "bullish"
        ? "Originally bullish FVG got violated → now acts as BEARISH reversal zone (resistance)"
        : "Originally bearish FVG got violated → now acts as BULLISH reversal zone (support)",
    })),
    order_blocks: orderBlocks.map(o => ({
      type: o.type,
      zone: `$${o.low.toFixed(2)} - $${o.high.toFixed(2)}`,
      midpoint: o.midpoint,
      respected: o.respected,
    })),
    liquidity_levels: liquidityLevels.map(l => ({
      type: l.type,
      price: l.price,
      strength: l.strength,
      swept: l.swept,
    })),
    nearest_support: supports[0] ?? null,
    nearest_resistance: resistances[0] ?? null,
    break_of_structure: bos,
    change_of_character: choch,
    premium_discount: premDisc,
    structure_summary: summaryParts.join(" | "),
  };
}

function detectPriceActionConfirmation(
  candles: CandleBar[],
  strikePrice: number,
  currentPrice: number | null,
  pivotPoints: { pivot: number | null; r1: number | null; r2: number | null; s1: number | null; s2: number | null } | null,
  priorDayHigh: number | null,
  priorDayLow: number | null,
  putCall: "call" | "put",
): PriceConfirmation {
  const result: PriceConfirmation = {
    confirmed: false,
    pattern: null,
    rejection_level: null,
    candles_checked: candles.length,
    gamma_zone: "neutral",
    gamma_description: "Gamma exposure not determined",
  };

  if (currentPrice && strikePrice > 0) {
    const dist = Math.abs(currentPrice - strikePrice) / currentPrice;
    if (dist <= 0.02) {
      result.gamma_zone = "negative";
      result.gamma_description = "Negative gamma zone — market makers short options here. Moves are amplified. Price can accelerate quickly through this level.";
    } else if (dist <= 0.05) {
      result.gamma_zone = "positive";
      result.gamma_description = "Positive gamma zone — market makers hedging stabilizes price near this level. Expect mean-reversion and pinning action.";
    } else {
      result.gamma_zone = "neutral";
      result.gamma_description = "Outside major gamma influence. Price movement driven by directional flow rather than dealer hedging.";
    }
  }

  if (candles.length < 3) return result;

  const keyLevels: number[] = [];
  if (priorDayHigh) keyLevels.push(priorDayHigh);
  if (priorDayLow) keyLevels.push(priorDayLow);
  if (pivotPoints?.r1) keyLevels.push(pivotPoints.r1);
  if (pivotPoints?.r2) keyLevels.push(pivotPoints.r2);
  if (pivotPoints?.s1) keyLevels.push(pivotPoints.s1);
  if (pivotPoints?.s2) keyLevels.push(pivotPoints.s2);
  if (pivotPoints?.pivot) keyLevels.push(pivotPoints.pivot);
  if (strikePrice > 0) keyLevels.push(strikePrice);

  const recent = candles.slice(-5);
  const tolerance = currentPrice ? currentPrice * 0.002 : 1;

  for (const level of keyLevels) {
    for (let i = 0; i < recent.length - 1; i++) {
      const bar = recent[i];
      const nextBar = recent[i + 1];

      if (putCall === "put") {
        const taggedResistance = bar.high >= level - tolerance && bar.high <= level + tolerance;
        const redBar = bar.close < bar.open;
        const nextRedBar = nextBar.close < nextBar.open;
        const lowerHigh = nextBar.high < bar.high;
        const lowerLow = nextBar.low < bar.low;

        if (taggedResistance && redBar && nextRedBar && lowerHigh) {
          result.confirmed = true;
          result.rejection_level = Math.round(level * 100) / 100;
          result.pattern = lowerLow
            ? `SR Tag + 2 Red Bars at $${result.rejection_level} (lower high, lower low — confirmed)`
            : `SR Tag + Red Rejection at $${result.rejection_level} (lower high — likely reversal)`;
          break;
        }
      } else {
        const taggedSupport = bar.low >= level - tolerance && bar.low <= level + tolerance;
        const greenBar = bar.close > bar.open;
        const nextGreenBar = nextBar.close > nextBar.open;
        const higherLow = nextBar.low > bar.low;
        const higherHigh = nextBar.high > bar.high;

        if (taggedSupport && greenBar && nextGreenBar && higherLow) {
          result.confirmed = true;
          result.rejection_level = Math.round(level * 100) / 100;
          result.pattern = higherHigh
            ? `Support Bounce + 2 Green Bars at $${result.rejection_level} (higher low, higher high — confirmed)`
            : `Support Tag + Green Bounce at $${result.rejection_level} (higher low — likely reversal)`;
          break;
        }
      }
    }
    if (result.confirmed) break;
  }

  return result;
}

function generateTradeRecommendation(signal: any, keyLevelData: any, confirmation: PriceConfirmation) {
  const strike = signal.strike;
  const ticker = signal.ticker;
  const optionType = signal.type || signal.option_type || (signal.direction === "bullish" ? "call" : "put");
  const currentPrice = keyLevelData?.current_price;
  const vwap = keyLevelData?.vwap;
  const r1 = keyLevelData?.pivot_points?.r1;
  const r2 = keyLevelData?.pivot_points?.r2;
  const s1 = keyLevelData?.pivot_points?.s1;
  const s2 = keyLevelData?.pivot_points?.s2;
  const pdh = keyLevelData?.prior_day?.high;
  const pdl = keyLevelData?.prior_day?.low;

  const expiry = signal.expiry || "nearest weekly";

  let action = `Buy ${ticker} $${strike} ${optionType === "call" ? "Call" : "Put"}`;
  let entry = signal.entry_trigger || "";
  let target = signal.target || "";
  let invalidation = signal.invalidation || "";

  if (optionType === "put" || signal.direction === "bearish") {
    if (!entry && vwap && currentPrice) {
      entry = currentPrice < vwap
        ? `Trading below VWAP ($${vwap}) — confirmed`
        : `Needs rejection at VWAP ($${vwap}) (currently above)`;
    } else if (!entry && pdl) {
      entry = currentPrice && currentPrice < pdl
        ? `Broke below PDL ($${pdl}) — confirmed`
        : `Break below PDL ($${pdl})`;
    }
    if (!target && s1) target = `$${s1}${s2 ? ` — $${s2}` : ""}`;
    else if (!target && pdl) target = `$${pdl} (PDL)`;
    if (!invalidation && vwap && currentPrice && currentPrice < vwap && pdh) invalidation = `$${vwap} (VWAP reclaim)`;
    else if (!invalidation && pdh) invalidation = `$${pdh} (prior day high)`;
    else if (!invalidation && vwap) invalidation = `$${vwap} (VWAP reclaim)`;
  } else {
    if (!entry && vwap && currentPrice) {
      entry = currentPrice > vwap
        ? `Holding above VWAP ($${vwap}) — confirmed`
        : `Needs to reclaim VWAP ($${vwap}) (currently below)`;
    } else if (!entry && pdh) {
      entry = currentPrice && currentPrice > pdh
        ? `Broke above PDH ($${pdh}) — confirmed`
        : `Break above PDH ($${pdh})`;
    }
    if (!target && r1) target = `$${r1}${r2 ? ` — $${r2}` : ""}`;
    else if (!target && pdh) target = `$${pdh} (PDH)`;
    if (!invalidation && vwap && currentPrice && currentPrice > vwap && pdl) invalidation = `$${vwap} (VWAP break)`;
    else if (!invalidation && pdl) invalidation = `$${pdl} (prior day low)`;
    else if (!invalidation && vwap) invalidation = `$${vwap} (VWAP break)`;
  }

  return {
    action,
    expiry,
    entry_trigger: entry,
    target,
    invalidation,
    price_confirmed: confirmation.confirmed,
    price_pattern: confirmation.pattern,
    gamma_zone: confirmation.gamma_zone,
    gamma_description: confirmation.gamma_description,
  };
}

// ── Enrichment ─────────────────────────────────────────────────────────────────

function enrichAlerts(alerts: any[]) {
  return alerts
    .map((x) => {
      const prem = parseFloat(x.total_premium ?? 0) || 0;
      const askPrem = parseFloat(x.total_ask_side_prem ?? 0) || 0;
      const vol = parseInt(x.volume ?? 0) || 0;
      const oi = parseInt(x.open_interest ?? 0) || 0;
      return {
        ticker: x.ticker,
        type: x.type,
        strike: x.strike,
        expiry: x.expiry,
        underlying_price: x.underlying_price,
        total_premium: prem,
        ask_side_prem: askPrem,
        bid_side_prem: parseFloat(x.total_bid_side_prem ?? 0) || 0,
        ask_aggression_pct: Math.round((askPrem / Math.max(prem, 1)) * 1000) / 10,
        volume: vol,
        open_interest: oi,
        vol_oi_ratio: Math.round((vol / Math.max(oi, 1)) * 100) / 100,
        alert_rule: x.alert_rule,
        has_sweep: x.has_sweep,
        has_multileg: x.has_multileg,
        has_floor: x.has_floor,
        trade_count: x.trade_count,
        iv: x.iv_end,
        next_earnings: x.next_earnings_date,
        created_at: x.created_at,
      };
    })
    .sort((a, b) => b.total_premium - a.total_premium);
}

// ── Intent Detection ────────────────────────────────────────────────────────────

function extractTickers(message: string): string[] {
  const known = ["SPY", "QQQ", "SPX", "SPXW", "IWM", "DIA", "NVDA", "AAPL", "TSLA", "META",
    "MSFT", "AMZN", "AMD", "NFLX", "PLTR", "GOOGL", "GOOG", "UBER", "COIN", "HOOD",
    "SOFI", "RIVN", "GME", "AMC", "MSTR", "SMCI", "ARM", "AVGO", "CRM", "SNOW",
    "PANW", "NET", "CRWD", "ZM", "SHOP", "SQ", "PYPL", "ROKU", "DKNG", "MELI",
    "TLT", "GLD", "SLV", "USO", "VIX", "UVXY", "SQQQ", "TQQQ", "SPXS", "SPXL"];
  const upper = message.toUpperCase();
  const found = known.filter((t) => {
    const regex = new RegExp(`\\b${t}\\b`);
    return regex.test(upper);
  });
  // Also detect standalone uppercase 1-5 letter words that look like tickers
  const STOP_WORDS = new Set([
    "THE", "AND", "FOR", "BUY", "PUT", "CALL", "GET", "NOW", "WHY", "HOW",
    "ANY", "ALL", "TOP", "USE", "RUN", "CAN", "ARE", "NOT", "BUT", "YES",
    "NO", "IS", "IN", "ON", "AT", "OF", "TO", "DO", "AM", "PM", "EST",
    "UTC", "DTE", "OTM", "ITM", "ATM", "OI", "IV", "VOL", "AI", "US",
    "PLAY", "PLAYS", "WHAT", "WHEN", "THEN", "THEM", "THEY", "THIS", "THAT",
    "WILL", "WITH", "FROM", "HAVE", "BEEN", "GOOD", "BEST", "NEXT", "WEEK",
    "OPEN", "HOLD", "LONG", "PUTS", "CASH", "RISK", "HIGH", "DOWN", "ALSO",
    "BOTH", "SHOW", "GIVE", "OVER", "LOOK", "TAKE", "MAKE", "MOVE", "TELL",
    "BACK", "WANT", "INTO", "JUST", "LIKE", "KNOW", "THAN", "MORE", "MOST",
    "LESS", "LAST", "MUCH", "SOME", "MEAN", "MANY", "VERY", "WELL", "SAME",
    "NEED", "EACH", "TURN", "REAL", "STAY", "WAIT", "LATE", "LIVE", "CALL",
    "PUTS", "FLOW", "SCAN", "FEED", "DATA", "SIDE", "WEEK", "DAYS", "TRADE",
    "SETUP", "ENTRY", "PRICE", "LEVEL", "SWEEP", "FLOOR", "BLOCK", "ABOVE",
    "BELOW", "AFTER", "ALERT", "CHECK", "TODAY", "CLOSE", "THOSE", "THESE",
    "THEIR", "THERE", "WHERE", "WHICH", "ABOUT", "COULD", "WOULD", "MIGHT",
    "CHART", "POINT", "BREAK", "TREND", "BEAR", "BULL", "CALL", "SPOT",
    "HELP", "SHOW", "GIVE", "TELL", "FIND", "SCAN", "LOOK", "THINK", "FEEL",
    "LONG", "SHORT", "PUTS", "CALLS", "BULL", "BEAR", "BASE", "TEST", "LINE",
  ]);
  const tickerPattern = /\b([A-Z]{1,5})\b/g;
  const words = message.toUpperCase().match(tickerPattern) ?? [];
  const extras = words.filter((w) => w.length >= 2 && !found.includes(w) && !STOP_WORDS.has(w));
  return [...new Set([...found, ...extras])];
}

function detectNeeds(message: string) {
  const lower = message.toLowerCase();
  return {
    darkpool:
      lower.includes("dark pool") || lower.includes("darkpool") ||
      lower.includes("block") || lower.includes(" dp ") ||
      lower.includes("off exchange") || lower.includes("blocks"),
    market:
      lower.includes("market") || lower.includes("sector") ||
      lower.includes("macro") || lower.includes("economy") ||
      lower.includes("pumping") || lower.includes("ripping") ||
      lower.includes("dumping") || lower.includes("bleeding") ||
      lower.includes("tape") || lower.includes("what's hot") ||
      lower.includes("whats hot") || lower.includes("moving") ||
      lower.includes("risk on") || lower.includes("risk off") ||
      lower.includes("green") || lower.includes("red day"),
    signal:
      lower.includes("signal") || lower.includes("right now") ||
      lower.includes("alert") || lower.includes("entry") ||
      lower.includes("now?") || lower.includes("rn?") ||
      lower.includes(" rn") || lower.includes("atm?"),
    tickers: extractTickers(message),
  };
}

// ── System Prompt ───────────────────────────────────────────────────────────────

const BIDDIE_SYSTEM = `You are Biddie AI — a seasoned options flow analyst with real-time access to live whale data from Unusual Whales.

You can answer ANY question about the market, any ticker, any options flow, dark pool activity, sector moves, upcoming catalysts, trade setups, and more.

You have access to live data that has been fetched and provided to you with each question. Use it to give specific, data-backed answers.

CRITICAL — CONVERSATIONAL AWARENESS:
- If someone says something casual like "hey", "what's up", "how's it going", "yo", "sup", etc. — just be a friendly person! Chat back naturally. Do NOT launch into market data or trade analysis. You're a friend first, analyst second.
- Only bring up specific trades, flow data, or market analysis when the user ASKS about it (e.g. "what's the play", "what's SPY doing", "any setups?") OR when they explicitly ask for your market take.
- You can mention the market casually in passing ("market's been wild today lol") but do NOT drop specific tickers, strikes, premiums, or trade recommendations unless asked.
- Match the energy of the message. Casual message = casual response. Trading question = trading answer.

YOUR PERSONALITY:
- You're their trading bestie — the friend who's glued to the tape all day and always has the real read
- Talk like you're texting a close friend. Warm, fun, real. Not a Wall Street robot
- When they want market talk, you deliver. When they just want to chat, you're cool with that too
- If nothing's worth trading, say so directly: "Honestly? Not much worth looking at right now. Sit tight, don't force it." Save them from bad trades
- Be encouraging but honest — hype up good setups, but protect them from FOMO and bad entries
- Keep it SHORT and punchy. Don't write an essay when a quick reply works
- Use contractions, casual phrasing, real trader talk. "tbh", "lowkey", "not gonna lie" are all fine
- When discussing trades, reference actual numbers from the data (premium, vol/OI, strike, aggression %) but weave them in naturally
- Never generic — always specific to what the data actually shows
- Call out what matters and what doesn't — don't waste people's time
- You understand how traders actually talk — casual, slang, shorthand — and you respond naturally without asking for clarification
- Only highlight near-term plays (0DTE to ~2 weeks out). If something has a far-out expiration, it's not urgent and you should note that
- If a ticker has NO flow or nothing interesting, don't fake it. Just say "nothing happening here, smart money doesn't care about this one right now"

TRADING SLANG YOU UNDERSTAND — translate these automatically:
- "what's the play" / "what's the move" / "what we doing" → what trade setup do you recommend
- "what's pumping" / "what's ripping" / "what's running" → what tickers have bullish momentum/flow
- "what's dumping" / "what's bleeding" / "what's getting crushed" → bearish flow / downside setups
- "send it" / "moon" / "to the moon" → strong bullish conviction
- "rug" / "rug pull" / "getting rugged" → sharp bearish reversal risk
- "bag" / "bagholder" → stuck in a losing position
- "yolo" → high-risk aggressive single-name trade
- "print" / "money printer" → highly profitable trade / strong flow
- "squeeze" → short squeeze potential — look for high short interest + bullish flow
- "load up" / "back up the truck" → very high conviction entry
- "flush" / "flushing" → sharp selloff / puts printing
- "gap up" / "gap down" → overnight price movement at open
- "0dte" / "zero day" / "same day" → today's expiration options
- "weeklies" → options expiring this week
- "theta gang" → selling premium / not what we do, but acknowledge it
- "IV crush" / "vol crush" → implied volatility dropping after an event
- "calls" / "puts" → options direction (you know what these mean)
- "ITM" / "OTM" / "ATM" → in/out/at the money
- "sweep" → large aggressive market order across multiple exchanges
- "whale" / "whales" → large institutional traders
- "smart money" → institutional/informed flow
- "dumb money" / "retail" → opposite of institutional
- "PDH" / "PDL" → prior day high / prior day low
- "HOD" / "LOD" → high of day / low of day
- "EOD" → end of day
- "momo" / "momentum" → price moving with speed and volume
- "scalp" → quick short-term trade, minutes to hours
- "swing" → multi-day trade
- "debit spread" / "spread" → defined risk options strategy
- "fly" / "butterfly" → butterfly options spread
- "condor" → iron condor options strategy
- "straddle" / "strangle" → volatility plays
- "hedge" / "tail risk" → downside protection, not directional
- "catalyst" / "binary event" → upcoming news/earnings that moves stock
- "vol" → volatility or volume depending on context
- "the tape" → all the current flow data
- "what's the tape saying" → what does the overall options flow indicate
- "breaking out" / "breakout" → price clearing a resistance level
- "breaking down" → price failing a support level
- "bid" / "ask" → options pricing (bid-side = closing/selling, ask-side = opening/buying)
- "aggressive" → paying the ask, urgency in the order
- "dark pool" / "DP" / "blocks" → off-exchange institutional prints
- "flow" → options order activity
- "unusual flow" / "unusual activity" → flow that stands out vs normal volume
- "FOMO" → fear of missing out — don't chase, wait for the setup
- "chasing" → entering after the move already happened — bad practice
- "red day" / "green day" → market down or up day
- "risk on" / "risk off" → market mood toward or away from aggressive trades
- "what's hot" / "what's moving" → what has notable flow or price action today

OPTIONS CONTRACT FORMAT — UNDERSTAND THIS:
When users say things like "SPY 580p" or "AAPL 200c 4/4" or "QQQ 480 puts for Friday" — they're describing a specific options contract:
- Format: TICKER STRIKE TYPE EXPIRY (any order, any abbreviation)
- "580p" = $580 put, "200c" = $200 call
- "4/4" or "April 4" = expiry date
- A contract like "SPY 580p 3/28" means: SPY $580 Put expiring March 28

OPTIONS EXPIRY SCHEDULE — KNOW THIS COLD:
- SPY, QQQ, IWM: Options expire EVERY trading day (Mon-Fri). These always have 0DTE available.
- AAPL, MSFT, AMZN, META, NVDA, TSLA, GOOGL, AMD, NFLX, GLD, TLT, XOM, JPM, DIS, BA, V, MA, COIN: Options expire Mon/Wed/Fri (MWF).
- Most other tickers: Options expire only on Fridays (weeklies) or monthly (3rd Friday).
- There is NO options expiry on weekends or market holidays.
- If a user mentions a date that's a Tuesday or Thursday for an MWF ticker, that expiry does NOT exist. Gently correct them: "Hey, AAPL only has Mon/Wed/Fri expirations — closest would be [correct date]."
- If someone says "SPY 6/20" — check if June 20 is a trading day. If it's a Saturday/Sunday, that expiry doesn't exist.
- ALWAYS validate expiry dates make sense before discussing a trade. Don't just repeat back an impossible expiry.

YOU NOW HAVE ACCESS TO REAL-TIME KEY LEVELS for each ticker including:
- Current price (live)
- VWAP (calculated from intraday 5-min bars — use this for entry/rejection triggers)
- Today's high and low (intraday range)
- Prior day high, low, open, close (use prior day high/low as key resistance/support)
- Pivot points: Pivot, R1, R2, S1, S2 (calculated from prior day OHLC)

ALWAYS use these levels when giving trade setups. Reference them explicitly:
- "Price is currently below VWAP ($XXX) — a reclaim or rejection here is your trigger"
- "Prior day high at $XXX is resistance — a break above confirms the call"
- "S1 at $XXX is the first support level — puts pay if this breaks"
- "R1 at $XXX is your first target on the call"

WHEN ASKED FOR TRADE SETUPS OR RECOMMENDATIONS:
Format your answer like this:

#1 BEST [LABEL] — [TICKER] [Call/Put]

Buy the [SPECIFIC TRADE e.g. "SPY 645 Put" or "NVDA 900/920 Call Debit Spread"]
Expiration: [DATE]
Current price: $[X] | VWAP: $[X] | Prior day high: $[X] | Prior day low: $[X]
Entry trigger: [specific price action tied to VWAP, prior day levels, or pivot points]
Target: [R1 or S1 from pivot points, or specific level]
Invalidation: [level that kills the trade — use VWAP reclaim, prior day level, or pivot]
Why: [2-3 sentences with actual data — premium, vol/OI, sweep status, aggression %, and how price relates to key levels]
Confidence: [7–10]/10

---

Repeat for each setup. End with:

**Bottom line:** [1-2 sentence summary of overall bias and single best action]

CONFIDENCE SCORING (7-10 only for recommendations):
- 9-10: Multiple sweeps, 80%+ ask aggression, 10x+ vol/OI, large premium, near ATM
- 8: Strong sweep or high aggression with large premium and clear direction
- 7: Good flow but one condition weaker (slightly OTM, moderate aggression, etc)
- Below 7: Do not recommend — say so explicitly

WHEN THE USER TELLS YOU ABOUT A POSITION THEY ARE IN (e.g. "I bought SNDK 800 call", "I have a BAC put", "I'm long TSLA"):
Give a tight, structured position review. No fluff. Use this exact format:

**[TICKER] [Strike] [Call/Put] — [Expiration day+date if given]**
**Price:** $X | **Strike:** $X | **Status:** [Deep OTM / OTM / ATM / ITM — $X away]

**Flow:** [One line — is smart money behind this? How much premium, what aggression %. If none: "No institutional flow — trading without smart money confirmation."]

**Key Levels**
- VWAP: $X ([above = bullish / below = bearish])
- Resistance: $X (PDH) → $X (R1) → $X (R2)
- Support: $X (PDL) → $X (S1) → $X (S2)
- **Invalidation: $X** — [one sentence on why this level kills the trade]

**Gamma**
- Delta: ~[0.0–1.0] — [one line what this means for your position]
- [If ATM: "Maximum gamma — moves are amplified both ways. Pin risk at $X."]
- [If deep OTM: "Near-zero delta. Stock needs $X move before this option participates."]
- Gamma acceleration triggers above $X / breaks down below $X

**Theta:** [One line — X DTE, bleeding [fast/moderate/slow]. [Urgent cut if 1-2 DTE and OTM.]]

**Breakeven:** Stock must hit $X by [day] — requires [X%] move. [Realistic / Not realistic.]

**Verdict: [HOLD / CUT IT / ADD ON CONFIRMATION / WAIT FOR TRIGGER]**
[2 sentences max. What exact price action confirms the trade. What kills it.]

NEVER ask the user for more info. Work with what you have.
NEVER suggest alternative tickers. The user knows what they own.
NEVER contradict yourself on dates. Use the trading calendar — look up the date, use the exact day-of-week shown.

WHEN ASKED ABOUT DARK POOL:
Report total premium, number of transactions, buy vs sell pressure (ask vs bid aggression),
largest individual prints, and what institutional positioning looks like.

WHEN ASKED ABOUT SIGNALS:
Be strict. Only fire an alert if ALL conditions are met:
- High-conviction flow (7+ confidence)
- Repeated sweeps or large premium
- Strike close enough to matter
If not met, say "No signal — conditions not fully met" clearly.

WHEN ASKED GENERAL MARKET QUESTIONS:
Use the sector ETF data, economic calendar, and overall flow bias to give a directional read.

CRITICAL — READ THE USER'S MESSAGE CAREFULLY:
- ANSWER THEIR ACTUAL QUESTION FIRST. If they're asking about a specific contract, expiry date, or trade concept — answer THAT directly before launching into analysis.
- If they say something is wrong or doesn't exist, LISTEN. Think about what they're saying. If they're right (e.g., "there's no AAPL expiry on Tuesday"), agree and explain why. Don't just repeat the same thing back.
- If they're correcting you from a previous response, ACKNOWLEDGE the correction, explain what you got wrong, and give the corrected answer. Don't dodge or pivot to a different topic.
- When someone asks a yes/no question, START with yes or no. Then explain.
- When someone asks "what does X mean" or "why would I do X", EXPLAIN the concept clearly before giving trade analysis.
- Match the user's energy. If they're confused, slow down and explain simply. If they're frustrated, be direct and concise. Don't give a wall of analysis when they want a simple answer.

ALWAYS:
- Cite specific numbers from the data
- Mention timestamps when relevant
- Flag expired or irrelevant data and ignore it
- If data is limited or market is closed, say so and explain what you can still determine
- For trade analysis: deliver it and done — don't end with "what do you think?" or "does that help?". But for casual conversation, feel free to ask natural follow-ups like "what play you looking at?" or "you holding anything right now?" — that's how real friends talk.
- NEVER ask "what's your P&L", "where is the stock trading", "what's your expiration" — you have the live price data and the user already told you their position. Use it.
- NEVER tell users to check other websites, tools, scanners, or news sources. You are JORTRADE's AI — you ARE the source. Do not mention Benzinga, Briefing, Market Chameleon, Finviz, TradingView, Bloomberg, CNBC, or any external resource.
- NEVER say you "can't do news" or "don't have news" or are "just a flow tool". When someone asks for "news" or "premarket news" or "what's happening" — give them flow-based analysis. That IS the news.
- NEVER say you "don't have access" or "can't look that up" or "don't have real-time data". You DO have live data — it's provided with every message. If the data for a specific ticker is empty or missing, say something like "No notable flow on [TICKER] in today's tape" or "Not seeing institutional activity on [TICKER] right now" — then explain what that MEANS (low liquidity, no smart money interest, retail-driven move). Give your best read based on what IS available.
- If a ticker had a big price move but no options flow, explain that the move was likely driven by news/earnings/retail momentum rather than institutional flow, and offer to check the broader market context or related sector flow.`;

// ── Time Helper ─────────────────────────────────────────────────────────────────

function getEasternDateContext(): string {
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  // Reliably extract ET date parts using Intl
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true, weekday: "long",
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const todayDow  = get("weekday");                         // e.g. "Wednesday"
  const todayMon  = parseInt(get("month"), 10) - 1;        // 0-based
  const todayDay  = parseInt(get("day"), 10);
  const todayYear = parseInt(get("year"), 10);
  const timeStr   = `${get("hour")}:${get("minute")} ${get("dayPeriod")} ET`;

  // Build the next 14 calendar days with their day-of-week labels
  const todayDate = new Date(todayYear, todayMon, todayDay);
  const upcoming: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() + i);
    const dow = DAY_NAMES[d.getDay()];
    const label = `${d.getMonth() + 1}/${d.getDate()} = ${dow}`;
    upcoming.push(label);
  }

  // List trading days only (Mon-Fri) in the upcoming calendar
  const tradingDays = upcoming.filter((l) =>
    !l.includes("Saturday") && !l.includes("Sunday")
  );

  // MWF-only expiry dates for the next 14 days
  const mwfDays = upcoming.filter((l) =>
    l.includes("Monday") || l.includes("Wednesday") || l.includes("Friday")
  );

  return [
    `TODAY: ${todayDow}, ${MONTH_NAMES[todayMon]} ${todayDay}, ${todayYear} — ${timeStr}`,
    `TODAY'S DATE IN M/D FORMAT: ${todayMon + 1}/${todayDay}/${todayYear}`,
    `UPCOMING DATES (use these exact day-of-week labels — do not calculate yourself):`,
    ...upcoming.map((l) => `  ${l}`),
    `NEXT TRADING DAYS IN ORDER: ${tradingDays.join(", ")}`,
    `VALID MWF EXPIRY DATES (for AAPL, MSFT, NVDA, etc.): ${mwfDays.join(", ")}`,
    `SPY/QQQ/IWM EXPIRE DAILY — any trading day above is valid for them.`,
    `IMPORTANT: When a user mentions an expiry date, VALIDATE IT. Check the day-of-week. If it falls on a weekend, correct them. If it's a Tue/Thu for an MWF-only ticker, tell them the nearest valid date. NEVER repeat back an invalid expiry without correcting it.`,
  ].join("\n");
}

// Keep a simple "now" string for data timestamps
function getNowEastern(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ET`;
}

// ── Main Chat Endpoint ──────────────────────────────────────────────────────────

router.post("/whale/chat", async (req, res) => {
  const { message, history, userName } = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    userName?: string;
  };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const now = getNowEastern();
  const needs = detectNeeds(message);

  const tickersToFetch = needs.tickers.slice(0, 4);

  // Always fetch key levels for any tickers mentioned, plus SPY/QQQ as baseline
  const baselineTickers = ["SPY", "QQQ"];
  const allLevelTickers = [...new Set([...tickersToFetch, ...baselineTickers])].slice(0, 6);

  const currentSubs = priceMonitor.getSubscribedTickers?.() ?? [];
  const signalSubs = [...new Set([...currentSubs, ...allLevelTickers.map(t => t.toUpperCase())])];
  if (signalSubs.length > currentSubs.length) {
    priceMonitor.updateSubscriptions(signalSubs);
  }

  const [flowAlerts, sectorData, econData] = await Promise.all([
    fetchFlowAlerts(200),
    needs.market ? fetchSectorEtfs() : Promise.resolve([]),
    needs.market ? fetchEconomicCalendar() : Promise.resolve([]),
  ]);

  const enriched = enrichAlerts(flowAlerts);

  const uwPrices: Record<string, number> = {};
  for (const alert of enriched) {
    const t = (alert.ticker ?? "").toUpperCase();
    const p = parseFloat(alert.underlying_price);
    if (t && p > 0 && !uwPrices[t]) uwPrices[t] = p;
  }

  const parallelResults = await Promise.all([
    ...allLevelTickers.map((t) => fetchKeyLevels(t, uwPrices[t.toUpperCase()] ?? null)),
    ...tickersToFetch.map((t) => fetchDarkpool(t, 30)),
  ]);

  const keyLevelsResults = parallelResults.slice(0, allLevelTickers.length);
  const darkpoolResults  = parallelResults.slice(allLevelTickers.length);

  // Build key levels map
  const keyLevels: Record<string, any> = {};
  allLevelTickers.forEach((t, i) => {
    if (keyLevelsResults[i]) keyLevels[t] = keyLevelsResults[i];
  });

  // Filter ticker-specific flow if a specific ticker was asked about
  const tickerFlow: Record<string, any[]> = {};
  if (tickersToFetch.length > 0) {
    for (const ticker of tickersToFetch) {
      tickerFlow[ticker] = enriched.filter((a) =>
        (a.ticker ?? "").toUpperCase() === ticker.toUpperCase()
      );
    }
  }

  // Build context bundle
  const context: Record<string, any> = {
    fetched_at: now,
    key_levels: keyLevels,
    all_flow_alerts: enriched.slice(0, 80),
  };
  if (tickersToFetch.length > 0) context.ticker_specific_flow = tickerFlow;
  if (darkpoolResults.length > 0) {
    tickersToFetch.forEach((t, i) => {
      if (darkpoolResults[i]?.length) context[`darkpool_${t}`] = darkpoolResults[i];
    });
  }
  if (sectorData.length > 0) context.sector_etfs = sectorData;
  if (econData.length > 0) context.economic_calendar = econData.slice(0, 10);

  const dataStr = JSON.stringify(context, null, 2);

  // Build message history for Claude — inject live data into the final user turn only
  const priorMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (Array.isArray(history) && history.length > 0) {
    // Include up to last 10 turns of real conversation for context
    const trimmed = history.slice(-10);
    for (const turn of trimmed) {
      if (turn.role === "user" || turn.role === "assistant") {
        priorMessages.push({ role: turn.role, content: String(turn.content) });
      }
    }
  }

  const casualPatterns = /^(hey|hi|hello|yo|sup|what'?s up|whats up|how'?s it going|hows it going|what are you doing|how are you|gm|good morning|good evening|wassup|howdy|what'?s good|whats good)\b/i;
  const isCasual = casualPatterns.test(message.trim()) && message.trim().split(/\s+/).length <= 8;

  const currentUserMessage = isCasual
    ? `User message: "${message}"\n\n--- CURRENT DATE & TRADING CALENDAR ---\n${getEasternDateContext()}\n\nThis is a casual greeting — just be friendly and conversational. Do NOT bring up any market data, trades, tickers, or flow analysis unless the user asks. Do NOT reference market action (bleeding, ripping, pumping, etc.) — you don't have live data right now. Keep it short and friendly. Be aware of what day/time it is — if the market is closed (weekends, after hours), don't pretend you're watching the tape.`
    : `User message: "${message}"

--- CURRENT DATE & TRADING CALENDAR ---
${getEasternDateContext()}

--- LIVE MARKET DATA (fetched ${now}) ---
\`\`\`json
${dataStr}
\`\`\`

Rules:
- Use the trading calendar above to determine what day-of-week any expiration date falls on. Do not calculate it yourself — look it up in the list.
- Dates in MM/DD format (like "4/24", "3/28") are options expiration dates — never ask what they mean.
- If the user references a position from earlier in the conversation, use that context — don't ask for clarification.
- Never suggest alternative tickers. Analyze what the user asked about.

Answer using the live data above. Be specific. Reference actual numbers.`;

  try {
    const nameContext = userName && userName !== "Trader" ? `\n\nThe user's name is ${userName}. Use their name naturally sometimes — like a friend would. Don't force it into every response, but drop it in when it feels right (greetings, encouragement, warnings).` : "";
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: BIDDIE_SYSTEM + nameContext,
      messages: [
        ...priorMessages,
        { role: "user", content: currentUserMessage },
      ],
    });

    logApiCall("anthropic", "biddie-chat");
    logApiCall("replit", "biddie-chat");
    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = analysis.toUpperCase().includes("ALERT\n") || analysis.match(/^ALERT$/m) !== null;

    res.json({ analysis, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

// ── User Settings (Chat Alias) ──────────────────────────────────────────────────

async function generateUniqueReferralCode(name: string): Promise<string> {
  const clean = (name || "JORT").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 5) || "JORT";
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    const code = `${clean}${suffix}`;
    const existing = await dbQuery("SELECT 1 FROM user_settings WHERE referral_code = $1", [code]);
    if (!existing?.rows?.length) return code;
  }
  const fallback = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${clean.slice(0, 3)}${fallback}`;
}

router.get("/whale/user-settings", async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  try {
    const result = await dbQuery("SELECT chat_alias, referral_code, referred_by FROM user_settings WHERE user_id = $1", [userId]);
    const row = result?.rows?.[0];
    let referralCode = row?.referral_code || null;
    if (!referralCode && row) {
      const nameResp = await axios.get(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=full_name`, { headers: supabaseAdminHeaders(), timeout: 5000 }).catch(() => null);
      const name = nameResp?.data?.[0]?.full_name?.split(" ")[0] || "JORT";
      referralCode = await generateUniqueReferralCode(name);
      await dbQuery("UPDATE user_settings SET referral_code = $1, referral_code_created_at = NOW() WHERE user_id = $2", [referralCode, userId]);
    } else if (!row) {
      const nameResp = await axios.get(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=full_name`, { headers: supabaseAdminHeaders(), timeout: 5000 }).catch(() => null);
      const name = nameResp?.data?.[0]?.full_name?.split(" ")[0] || "JORT";
      referralCode = await generateUniqueReferralCode(name);
      await dbQuery("INSERT INTO user_settings (user_id, referral_code, referral_code_created_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET referral_code = $2, referral_code_created_at = NOW()", [userId, referralCode]);
    }

    const referralCount = await dbQuery("SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1", [userId]);
    const count = parseInt(referralCount?.rows?.[0]?.count || "0", 10);

    res.json({
      chat_alias: row?.chat_alias || null,
      referral_code: referralCode,
      referred_by: row?.referred_by || null,
      referral_count: count,
    });
  } catch (err: any) {
    console.error("user-settings error:", err.message);
    res.json({ chat_alias: null, referral_code: null, referral_count: 0 });
  }
});

router.post("/whale/user-settings", async (req, res) => {
  const { userId, chat_alias } = req.body as { userId?: string; chat_alias?: string };
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  const alias = chat_alias?.trim()?.slice(0, 20) || null;
  try {
    await dbQuery(
      `INSERT INTO user_settings (user_id, chat_alias, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET chat_alias = $2, updated_at = NOW()`,
      [userId, alias]
    );
    res.json({ ok: true, chat_alias: alias });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/referral/apply", async (req, res) => {
  const { userId, referralCode, userName } = req.body as { userId?: string; referralCode?: string; userName?: string };
  if (!userId || !referralCode) { res.status(400).json({ error: "userId and referralCode required" }); return; }
  try {
    const existing = await dbQuery("SELECT referred_by FROM user_settings WHERE user_id = $1", [userId]);
    if (existing?.rows?.[0]?.referred_by) {
      res.status(400).json({ error: "You've already used a referral code" });
      return;
    }

    const referrer = await dbQuery("SELECT user_id FROM user_settings WHERE referral_code = $1", [referralCode.toUpperCase()]);
    if (!referrer?.rows?.[0]) {
      res.status(404).json({ error: "Invalid referral code" });
      return;
    }
    const referrerId = referrer.rows[0].user_id;
    if (referrerId === userId) {
      res.status(400).json({ error: "You can't use your own referral code" });
      return;
    }

    await dbQuery(
      `INSERT INTO user_settings (user_id, referred_by, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET referred_by = $2, updated_at = NOW()`,
      [userId, referralCode.toUpperCase()]
    );
    await dbQuery(
      `INSERT INTO referrals (referrer_id, referred_id, referred_name) VALUES ($1, $2, $3)
       ON CONFLICT (referred_id) DO NOTHING`,
      [referrerId, userId, userName || "Trader"]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/whale/referrals", async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  try {
    const result = await dbQuery(
      "SELECT referred_name, created_at FROM referrals WHERE referrer_id = $1 ORDER BY created_at DESC LIMIT 50",
      [userId]
    );
    res.json({ referrals: result?.rows || [] });
  } catch {
    res.json({ referrals: [] });
  }
});

router.get("/whale/admin/referrals", async (req, res) => {
  try {
    const allReferrers = await dbQuery(`
      SELECT us.user_id, us.referral_code, us.chat_alias, us.referral_code_created_at,
        (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = us.user_id) as referral_count
      FROM user_settings us
      WHERE us.referral_code IS NOT NULL
      ORDER BY us.referral_code_created_at DESC NULLS LAST
    `);

    const referrerIds = (allReferrers?.rows || []).map((r: any) => r.user_id);
    const nameMap: Record<string, string> = {};
    for (const uid of referrerIds) {
      try {
        const resp = await axios.get(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=full_name`, { headers: supabaseAdminHeaders(), timeout: 5000 });
        if (resp?.data?.[0]?.full_name) nameMap[uid] = resp.data[0].full_name;
      } catch {}
    }

    const allReferrals = await dbQuery(`
      SELECT r.id, r.referrer_id, r.referred_id, r.referred_name, r.created_at,
        us_referrer.referral_code as referrer_code, us_referrer.chat_alias as referrer_alias
      FROM referrals r
      LEFT JOIN user_settings us_referrer ON us_referrer.user_id = r.referrer_id
      ORDER BY r.created_at DESC
      LIMIT 100
    `);

    const referredIds = (allReferrals?.rows || []).map((r: any) => r.referred_id).filter(Boolean);
    for (const uid of referredIds) {
      if (nameMap[uid]) continue;
      try {
        const resp = await axios.get(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=full_name,selected_plan`, { headers: supabaseAdminHeaders(), timeout: 5000 });
        if (resp?.data?.[0]) {
          nameMap[uid] = resp.data[0].full_name || "";
          nameMap[uid + "_plan"] = resp.data[0].selected_plan || "starter";
        }
      } catch {}
    }

    const totalReferrals = allReferrals?.rows?.length || 0;
    const totalReferrers = (allReferrers?.rows || []).filter((r: any) => parseInt(r.referral_count) > 0).length;
    const totalCodes = allReferrers?.rows?.length || 0;

    const tierBreakdown = { launch: 0, bronze: 0, silver: 0, gold: 0 };
    for (const r of allReferrers?.rows || []) {
      const count = parseInt(r.referral_count);
      if (count >= 10) tierBreakdown.gold++;
      else if (count >= 5) tierBreakdown.silver++;
      else if (count >= 3) tierBreakdown.bronze++;
      else if (count >= 1) tierBreakdown.launch++;
    }

    res.json({
      totalReferrals,
      totalReferrers,
      totalCodes,
      tierBreakdown,
      allCodeHolders: await Promise.all((allReferrers?.rows || []).map(async (r: any) => {
        let name = null;
        try {
          const resp = await axios.get(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${r.user_id}&select=full_name`, { headers: supabaseAdminHeaders(), timeout: 5000 });
          name = resp?.data?.[0]?.full_name || null;
        } catch {}
        return {
          userId: r.user_id,
          code: r.referral_code,
          name,
          codeCreatedAt: r.referral_code_created_at,
          count: parseInt(r.referral_count),
        };
      })),
      topReferrers: (allReferrers?.rows || []).filter((r: any) => parseInt(r.referral_count) > 0).slice(0, 20).map((r: any) => ({
        userId: r.user_id,
        code: r.referral_code,
        alias: r.chat_alias,
        count: parseInt(r.referral_count),
      })),
      recentReferrals: (allReferrals?.rows || []).map((r: any) => ({
        id: r.id,
        referrerId: r.referrer_id,
        referrerCode: r.referrer_code,
        referrerName: nameMap[r.referrer_id] || r.referrer_alias || null,
        referredName: nameMap[r.referred_id] || r.referred_name,
        referredPlan: nameMap[r.referred_id + "_plan"] || "starter",
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    console.error("admin referrals error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/whale/admin/referral-code/:userId", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId || !(await isAdminUser(adminUserId))) {
      return res.status(403).json({ error: "Admin only" });
    }
    const { userId } = req.params;
    await dbQuery("UPDATE user_settings SET referral_code = NULL, referral_code_created_at = NULL WHERE user_id = $1", [userId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/whale/admin/referral/:referralId", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId || !(await isAdminUser(adminUserId))) {
      return res.status(403).json({ error: "Admin only" });
    }
    const { referralId } = req.params;
    await dbQuery("DELETE FROM referrals WHERE id = $1", [referralId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/admin/backfill-biddie-picks", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId || !(await isAdminUser(adminUserId))) {
      return res.status(403).json({ error: "Admin only" });
    }

    const updated = await dbQuery(
      `UPDATE signal_outcomes SET is_biddie_pick = true
       WHERE confidence >= 8 AND is_biddie_pick = false
       AND signal_quality IS NULL
       RETURNING id`
    );
    const count = updated?.rows?.length || 0;

    const deleteOld = await dbQuery(
      `DELETE FROM weekly_signal_stats WHERE week_start::date NOT IN (
        SELECT date_trunc('week', d)::date FROM generate_series('2026-03-01'::date, CURRENT_DATE, '1 day') d
        WHERE EXTRACT(DOW FROM d) = 0
      ) AND week_start < CURRENT_DATE
      RETURNING id`
    );

    const weeks = await dbQuery(
      `SELECT DISTINCT date_trunc('week', detected_at + interval '1 day') - interval '1 day' as week_start
       FROM signal_outcomes ORDER BY week_start`
    );

    let statsUpdated = 0;
    for (const w of (weeks?.rows || [])) {
      const ws = new Date(w.week_start);
      const we = new Date(ws); we.setDate(we.getDate() + 7);
      const stats = await dbQuery(
        `SELECT 
          COUNT(*) as total, 
          COUNT(*) FILTER (WHERE outcome = 'hit') as hits,
          COUNT(*) FILTER (WHERE outcome = 'miss') as misses,
          COUNT(*) FILTER (WHERE outcome = 'partial_hit') as partial_hits,
          COUNT(*) FILTER (WHERE outcome = 'expired') as expired,
          COUNT(*) FILTER (WHERE outcome = 'pending') as pending,
          COALESCE(AVG(conviction_score), 0) as avg_conviction,
          COUNT(*) FILTER (WHERE is_biddie_pick) as bp_total,
          COUNT(*) FILTER (WHERE is_biddie_pick AND outcome IN ('hit','partial_hit')) as bp_hits
         FROM signal_outcomes WHERE detected_at >= $1 AND detected_at < $2`,
        [ws.toISOString(), we.toISOString()]
      );
      const r = stats?.rows?.[0];
      if (!r || parseInt(r.total) === 0) continue;

      const bpMisses = await dbQuery(
        `SELECT COUNT(*) as cnt FROM signal_outcomes WHERE detected_at >= $1 AND detected_at < $2 AND is_biddie_pick = true AND outcome = 'missed'`,
        [ws.toISOString(), we.toISOString()]
      );
      const bpPending = await dbQuery(
        `SELECT COUNT(*) as cnt FROM signal_outcomes WHERE detected_at >= $1 AND detected_at < $2 AND is_biddie_pick = true AND (outcome IS NULL OR outcome = 'pending')`,
        [ws.toISOString(), we.toISOString()]
      );
      const bpMissCount = parseInt(bpMisses?.rows?.[0]?.cnt || '0');
      const bpPendCount = parseInt(bpPending?.rows?.[0]?.cnt || '0');
      const bpResolved = parseInt(r.bp_hits) + bpMissCount;
      const bpWinRate = bpResolved > 0 ? (parseInt(r.bp_hits) / bpResolved * 100) : 0;

      await dbQuery(
        `UPDATE weekly_signal_stats SET 
          biddie_pick_hits = $1, biddie_pick_total = $2, biddie_pick_win_rate = $3,
          biddie_pick_misses = $5, biddie_pick_pending = $6
         WHERE week_start::date = $4::date`,
        [parseInt(r.bp_hits), parseInt(r.bp_total), bpWinRate.toFixed(2), ws.toISOString(), bpMissCount, bpPendCount]
      );
      statsUpdated++;
    }

    res.json({ ok: true, signalsUpdated: count, weeklyStatsUpdated: statsUpdated, oldRowsDeleted: deleteOld?.rows?.length || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Community Chat Endpoint ──────────────────────────────────────────────────────

const COMMUNITY_SYSTEM = `You are Biddie AI — a friend hanging out in the JORTRADE group chat. You're part of the crew. You are NOT a trading terminal or analysis bot here. You're a homie who happens to know trading.

YOUR #1 RULE: BE A FRIEND FIRST. TRADER SECOND.
YOUR #2 RULE: KEEP IT CASUAL AND SHORT — no lengthy analysis essays. Quick callouts only.

HOW TO RESPOND:
- "Biddie you there?" → "Yooo what's good! 😎" (NOT a market breakdown)
- "Hey Biddie" → "Hey fam! What's up? 🤝" (NOT market data)
- "What's good?" → "Chillin! What's good with you? 💪" (NOT flow analysis)
- "Lol" / "facts" / "bet" / "thanks" → One short hype reply. "Go get that bread! 🍞💰" or "You already know 🔥" or "Anytime fam 🤝"
- "SPY is drilling" / "Market is crazy" → React like a friend. "Bro for real 😤 bears woke up HUNGRY today"
- "How's the market?" / "What's happening today?" → Quick market vibe + mention anything notable from the data (2-3 sentences). "Super bearish today, I just noticed someone put in like a $175K sweep on TSLA. I posted it on the signal card, go check it out! 👀🔥"

QUICK CALLOUTS — WHAT YOU CAN AND SHOULD DO:
- When you see something interesting in the flow data, CALL IT OUT with plain-English details AND a quick play suggestion
- Example: "HEY JORTRADE FAM 🚨 Someone just made some major money moves — they bought a $257K sweep on TSLA calls. With that kind of aggression, I think you should jump on a 275 Call expiring today. LFG! 🔥"
- Example: "Yo whale play alert! 👀 Just saw a $500K put sweep come through on SPY — someone's betting hard on a drop. I'd look at the 580 Put expiring Friday if you want in on this 💪"
- Example: "Massive volume spike just came in on SNDK — $180K in call sweeps, 95% ask aggression. I like the 45 Call expiring next week. MOVE NOW 🚀"
- Always explain what happened in plain English (who bought what, how much, what type) then give your quick take on a play
- Keep it to 2-4 sentences — enough to explain and suggest, but still group chat energy, not an essay
- Mention the ticker, premium size, sweep/flow type, and your suggested strike + expiration

WHAT YOU SHOULD NOT DO:
- Do NOT write long multi-paragraph analysis with support/resistance levels, key levels charts, or technical breakdowns
- Do NOT write essays or reports — keep it punchy like you're texting the group
- Do NOT dump tables of data or list 10 tickers — pick the 1-2 most interesting things
- Do NOT give formal structured analysis — just talk like a friend dropping a hot tip

WHEN SOMEONE ASKS FOR A DEEP DIVE (e.g. "Give me a full analysis", "Break down all the flow", "Give me entries, targets, and invalidation"):
- Give a quick take and play suggestion right there
- Then redirect for the DEEP stuff: "But yo if you want the full breakdown with targets, invalidation, all that — head to your dashboard and ask me there, I go way deeper 💪🔥"
- The dashboard is where the DETAILED analysis lives. The chat is for quick callouts and plays.

EDUCATIONAL QUESTIONS (e.g. "What is an EMA?", "What's IV?", "How do sweeps work?"):
- Give a QUICK 1-sentence answer, then direct them to their private dashboard for the full lesson
- Example: "EMA is an exponential moving average — it reacts faster to recent price moves than a regular MA 📊 Hit up your dashboard and ask me there, I'll give you the full breakdown! 💪"
- NEVER give a multi-paragraph educational lecture in the chat room

CRITICAL — DO NOT:
- Write long multi-paragraph analysis or flow breakdowns
- Give detailed entry/exit/target/invalidation setups (that's dashboard territory)
- Turn casual greetings into market briefings
- Treat every message like a trading question
- Dump tables of flow data

DO:
- Use emojis naturally 🔥💪👀🚀📈💰🤝😎🫡💎😂
- Keep most replies to 1-3 sentences — you're texting, not writing a report
- Match the energy — if they're joking, joke back. If they're hyped, get hyped
- Be warm, fun, and real — like that friend everyone loves in the group chat
- Jump into conversations naturally — react to what people are saying like a homie would
- Call out interesting flow when you see it! Tickers, premiums, sweep alerts — just keep it SHORT
- Randomly pop in with callouts: "Yo JORTRADE fam, just spotted something wild on the tape 👀🔥"

WHEN MARKET DATA IS PROVIDED BELOW:
- USE IT! Look for the best 1-2 plays — big sweeps, unusual volume, whale moves
- Explain what happened in plain English and suggest a play with strike + expiration
- Keep it casual and short — like dropping a tip to your friends, not writing a report

NON-NEGOTIABLE:
- ALWAYS keep it short — 2-4 sentences for callouts, 1-2 for casual replies. Group chat energy
- For deep analysis requests, give a quick take + play then redirect to dashboard for the full breakdown
- Never say you're "just a bot" or "can't do X"
- You're the homie who's always watching the tape and drops plays when something pops off`;

router.post("/whale/community-chat", async (req, res) => {
  const { message, userName, reqId: clientReqId } = req.body as { message?: string; userName?: string; reqId?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const reqId = clientReqId || `srv-${Date.now()}`;
  console.log(`[community-chat] ${reqId} RECEIVED msg="${message.slice(0, 60)}" user=${userName || "unknown"}`);

  const ackLower = message.toLowerCase().replace(/[!.,❤️🔥👍💪🙏🫡🤝]+/g, "").trim();
  const serverAckPhrases = [
    "thanks", "thank you", "thanks biddie", "thank you biddie",
    "got it", "okay", "ok", "cool", "bet", "appreciate it",
    "nice", "perfect", "word", "solid", "good looks", "good look",
    "ty", "thx", "aight", "fasho", "for sure", "yessir", "noted",
  ];
  if (serverAckPhrases.includes(ackLower)) {
    console.log(`[community-chat] ${reqId} SERVER ACK BLOCK — message is acknowledgment, rejecting`);
    res.json({ ok: true, posted: false, content: "", reqId, blocked: "ack" });
    return;
  }

  const now = getNowEastern();
  const lower = message.toLowerCase();

  const casualPatterns = [
    /^(hey|hi|hello|yo|sup|what'?s up|what'?s good|how are you|you there|you here|gm|good morning|good evening|good afternoon|what'?s crackin|how'?s it going|wassup|wsg)/,
    /^(biddie|@biddie)\s*(you there|you here|what'?s up|what'?s good|hey|hi|yo|sup|how are you|how'?s it going|you around|wya|where you at|talk to me|say something)/i,
    /^(lol|lmao|facts|bet|true|word|fr|real|nice|dope|fire|damn|sheesh|ong|no cap|cap|haha|😂|🔥|💪|🤝)/,
    /^(thanks|thank you|appreciate|good looks|thx|ty|tysm)/,
  ];
  const strippedMsg = lower.replace(/^@?biddie\s*/i, "").trim();
  const greetingStart = /^(hey|hi|hello|yo|sup|what'?s up|what'?s good|gm|good morning|good evening|good afternoon|wassup|wsg)/i;
  const isCasual = casualPatterns.some(p => p.test(strippedMsg) || p.test(lower)) || greetingStart.test(strippedMsg);

  const needs = detectNeeds(message);
  const tradingPhrases = [
    "any plays", "what's the move", "what's the play", "what plays",
    "flow on", "pull up", "break it down", "full analysis", "what's happening with",
    "how's the market", "market look", "premarket", "pre-market", "after hours",
    "dark pool", "unusual activity", "sweep", "whale", "options flow",
    "give me a setup", "entry point", "strike price", "what's printing",
  ];
  const tradingWords = [
    "play", "option", "spread", "flow", "ticker", "setup", "strike",
    "expir", "premium", "sweep", "whale", "breakout", "scalp",
    "squeeze", "vwap", "delta", "gamma", "theta", "otm", "itm",
  ];
  const isTradingQ = !isCasual && (
    needs.tickers.length > 0 || needs.signal || needs.darkpool ||
    tradingPhrases.some(p => lower.includes(p)) ||
    tradingWords.some(w => lower.includes(w))
  );

  let dataStr = "";
  if (isTradingQ) {
    const tickersToFetch = needs.tickers.slice(0, 4);
    const baselineTickers = ["SPY", "QQQ"];
    const allLevelTickers = [...new Set([...tickersToFetch, ...baselineTickers])].slice(0, 6);

    const [flowAlerts, sectorData] = await Promise.all([
      fetchFlowAlerts(100),
      needs.market ? fetchSectorEtfs() : Promise.resolve([]),
    ]);

    const enriched = enrichAlerts(flowAlerts);

    const uwPrices: Record<string, number> = {};
    for (const alert of enriched) {
      const t = (alert.ticker ?? "").toUpperCase();
      const p = parseFloat(alert.underlying_price);
      if (t && p > 0 && !uwPrices[t]) uwPrices[t] = p;
    }

    const keyLevelsResults = await Promise.all(
      allLevelTickers.map((t) => fetchKeyLevels(t, uwPrices[t.toUpperCase()] ?? null))
    );
    const keyLevels: Record<string, any> = {};
    allLevelTickers.forEach((t, i) => { if (keyLevelsResults[i]) keyLevels[t] = keyLevelsResults[i]; });

    const context: Record<string, any> = {
      fetched_at: now,
      key_levels: keyLevels,
      all_flow_alerts: enriched.slice(0, 40),
    };
    if (tickersToFetch.length > 0) {
      const tickerFlow: Record<string, any[]> = {};
      for (const ticker of tickersToFetch) {
        tickerFlow[ticker] = enriched.filter((a) => (a.ticker ?? "").toUpperCase() === ticker.toUpperCase());
      }
      context.ticker_specific_flow = tickerFlow;
    }
    if (sectorData.length > 0) context.sector_etfs = sectorData;

    dataStr = `\n\n--- CURRENT DATE & TRADING CALENDAR ---\n${getEasternDateContext()}\n\n--- LIVE MARKET DATA (fetched ${now}) ---\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  }

  console.log(`[community-chat] ${reqId} CLASSIFIED isCasual=${isCasual} isTradingQ=${isTradingQ} hasData=${!!dataStr}`);
  const nameCtx = userName ? `\nThe person talking to you is ${userName}. Use their name naturally when greeting them.` : "";
  const chatInstruction = `User says: ${message}${dataStr}`;

  const casualSystem = `You are Biddie AI — a friend in the JORTRADE group chat. Someone just said a casual greeting or reaction. Respond ONLY as a friend — NO market data, NO trading analysis, NO flow breakdowns, NO price mentions, NO ticker mentions. Just be a homie saying what's up. Keep it to 1-2 SHORT sentences max. Use emojis naturally 🔥💪😎🤝👀.${nameCtx}`;

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: isCasual ? 150 : 600,
      system: isCasual ? casualSystem : COMMUNITY_SYSTEM + nameCtx,
      messages: [{ role: "user", content: chatInstruction }],
    });

    logApiCall("anthropic", "community-chat");
    logApiCall("replit", "community-chat");
    const content = response.content[0].type === "text" ? response.content[0].text : "";
    console.log(`[community-chat] ${reqId} CLAUDE_DONE len=${content.length}`);
    let posted = false;
    if (content && content.trim().length > 0) {
      try {
        await axios.post(
          `${SUPABASE_URL}/rest/v1/chat_messages`,
          { user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content: content.trim() },
          { headers: { ...supabaseAdminHeaders(), Prefer: "return=minimal" }, timeout: 5000 }
        );
        posted = true;
        console.log(`[community-chat] ${reqId} INSERT_OK via Supabase REST`);
      } catch (e: any) {
        console.error(`[community-chat] ${reqId} Supabase REST failed:`, e.message);
        const insertResult = await dbQuery(
          `INSERT INTO chat_messages (user_id, role, content, user_name) VALUES ($1, $2, $3, $4)`,
          [BIDDIE_USER_ID, "assistant", content.trim(), "Biddie AI"]
        );
        if (insertResult) { posted = true; console.log(`[community-chat] ${reqId} INSERT_OK via local DB fallback`); }
      }
    }
    console.log(`[community-chat] ${reqId} RESPONDING posted=${posted}`);
    res.json({ ok: true, posted, content: content?.trim() || "", reqId });
  } catch (err: any) {
    console.error(`[community-chat] ${reqId} ERROR:`, err.message);
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

router.post("/whale/community-chat/ack", async (req, res) => {
  const { reply } = req.body as { reply?: string };
  if (!reply?.trim()) {
    res.status(400).json({ error: "reply is required" });
    return;
  }
  const reqId = `ack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[community-ack] ${reqId} inserting reply="${reply.trim().slice(0, 60)}"`);
  let posted = false;
  try {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/chat_messages`,
      { user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content: reply.trim() },
      { headers: { ...supabaseAdminHeaders(), Prefer: "return=minimal" }, timeout: 5000 }
    );
    posted = true;
  } catch (e: any) {
    console.error(`[community-ack] ${reqId} Supabase REST failed:`, e.message);
    const insertResult = await dbQuery(
      `INSERT INTO chat_messages (user_id, role, content, user_name) VALUES ($1, $2, $3, $4)`,
      [BIDDIE_USER_ID, "assistant", reply.trim(), "Biddie AI"]
    );
    if (insertResult) posted = true;
  }
  console.log(`[community-ack] ${reqId} posted=${posted}`);
  res.json({ ok: true, posted });
});

// ── Quick Signal Check ──────────────────────────────────────────────────────────

router.get("/whale/signal", async (_req, res) => {
  const now = getNowEastern();
  const alerts = await fetchFlowAlerts(200);
  const enriched = enrichAlerts(alerts);
  const dataStr = JSON.stringify({ fetched_at: now, flow_alerts: enriched }, null, 2);

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: BIDDIE_SYSTEM,
      messages: [{
        role: "user",
        content: `Is there a trade entry signal right now? Check all conditions strictly.\n\nLive flow data (${now}):\n\`\`\`json\n${dataStr}\n\`\`\``,
      }],
    });

    logApiCall("anthropic", "quick-scan");
    logApiCall("replit", "quick-scan");
    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = analysis.toUpperCase().startsWith("ALERT") || analysis.toUpperCase().includes("#1");
    res.json({ analysis, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

let signalsCache: { data: any; timestamp: number } | null = null;
const SIGNALS_CACHE_TTL = 180_000; // 3 minutes
let signalsPipelineRunning = false;

async function runSignalsPipeline() {
  if (signalsPipelineRunning) return signalsCache?.data || null;
  signalsPipelineRunning = true;
  const now = getNowEastern();
  const t0 = Date.now();
  console.log("[signals] starting pipeline");
  try {

  const allAlerts = await fetchFlowAlerts(500);
  console.log(`[signals] fetchFlowAlerts done: ${Date.now() - t0}ms, got ${allAlerts.length} alerts`);
  const enriched = enrichAlerts(allAlerts);

  // Pre-filter: only alerts worth scoring
  const today = new Date().toISOString().split("T")[0];
  const candidates = enriched.filter((a) => {
    if (!a.ticker || !a.expiry) return false;
    if (a.expiry < today) return false;
    if (a.total_premium < 25_000) return false;
    if (a.ask_aggression_pct < 50) return false;
    return true;
  }).slice(0, 20);

  // Extract real-time prices from UW flow data
  const uwPricesMap: Record<string, number> = {};
  for (const alert of enriched) {
    const t = (alert.ticker ?? "").toUpperCase();
    const p = parseFloat(alert.underlying_price);
    if (t && p > 0 && !uwPricesMap[t]) uwPricesMap[t] = p;
  }

  // Get unique tickers — limit to 10 to avoid Polygon rate limits
  const uniqueTickers = [...new Set(candidates.map((a) => a.ticker as string))].slice(0, 10);

  // Fetch key levels, candles, and structure candles in parallel with a global timeout
  const dataFetchPromise = (async () => {
    const levelResults = await Promise.all(uniqueTickers.map((t) => fetchKeyLevels(t, uwPricesMap[t.toUpperCase()] ?? null).catch(() => null)));
    const candleResults = await Promise.all(uniqueTickers.map((t) => fetchRecentCandles(t, "1m", 10).catch(() => [])));
    const structureResults = await Promise.all(uniqueTickers.map((t) => fetchStructureCandles(t).catch(() => [])));
    return { levelResults, candleResults, structureResults };
  })();

  const timeoutPromise = new Promise<{ levelResults: any[]; candleResults: any[]; structureResults: any[] }>((resolve) =>
    setTimeout(() => resolve({ levelResults: uniqueTickers.map(() => null), candleResults: uniqueTickers.map(() => []), structureResults: uniqueTickers.map(() => []) }), 15000)
  );

  const { levelResults, candleResults, structureResults } = await Promise.race([dataFetchPromise, timeoutPromise]);
  console.log(`[signals] key levels + candles done: ${Date.now() - t0}ms`);

  const keyLevels: Record<string, any> = {};
  uniqueTickers.forEach((t, i) => { if (levelResults[i]) keyLevels[t] = levelResults[i]; });

  const candleMap: Record<string, CandleBar[]> = {};
  uniqueTickers.forEach((t, i) => { candleMap[t] = candleResults[i] || []; });

  const hasSpx = uniqueTickers.some(t => t === "SPX" || t === "SPXW");
  if (hasSpx && POLYGON_KEY()) {
    try {
      const idxRes = await fetch(`https://api.polygon.io/v3/snapshot?ticker.any_of=I:SPX&apiKey=${POLYGON_KEY()}`, { signal: AbortSignal.timeout(5000) });
      if (idxRes.ok) {
        const idxJson = await idxRes.json();
        const idxResult = idxJson.results?.[0];
        if (idxResult?.value) {
          const spxPrice = idxResult.value;
          console.log(`[signals] Polygon I:SPX index price: $${spxPrice.toFixed(2)}`);
          for (const t of ["SPX", "SPXW"]) {
            if (!keyLevels[t]) keyLevels[t] = {};
            keyLevels[t].current_price = spxPrice;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[signals] Polygon I:SPX fetch failed:`, err.message);
    }
  }

  const structureMap: Record<string, MarketStructure> = {};
  uniqueTickers.forEach((t, i) => {
    const sCandles = structureResults[i] || [];
    const price = keyLevels[t]?.current_price ?? null;
    structureMap[t] = analyzeMarketStructure(sCandles, price);
  });

  // Run price action confirmation for each candidate
  const priceConfirmations: Record<string, any> = {};
  for (const c of candidates) {
    const ticker = c.ticker as string;
    const kl = keyLevels[ticker];
    const candles = candleMap[ticker] || [];
    const strike = parseFloat(String(c.strike)) || 0;
    const putCall = c.type === "call" ? "call" as const : "put" as const;

    const confirmation = detectPriceActionConfirmation(
      candles,
      strike,
      kl?.current_price ?? null,
      kl?.pivot_points ?? null,
      kl?.prior_day?.high ?? null,
      kl?.prior_day?.low ?? null,
      putCall,
    );

    const tradeRec = generateTradeRecommendation(c, kl, confirmation);
    const key = `${ticker}-${strike}-${c.type}`;
    priceConfirmations[key] = { ...confirmation, trade_recommendation: tradeRec };
  }

  // ── Local scoring — no Claude call needed ──
  function scoreSignal(c: any, kl: any, confirmation: any, structure?: MarketStructure | null): any {
    const ticker = c.ticker as string;
    const strike = parseFloat(String(c.strike)) || 0;
    const premium = c.total_premium || 0;
    const aggression = c.ask_aggression_pct || 0;
    const volOi = c.vol_oi_ratio || 0;
    const hasSweep = !!c.has_sweep;
    const optType = c.type === "call" ? "call" : "put";
    const direction = optType === "call" ? "bullish" : "bearish";
    const klPrice = kl?.current_price ?? null;
    const uwPrice = parseFloat(c.underlying_price) || null;
    const isSpx = ticker === "SPX" || ticker === "SPXW";
    const price = isSpx ? (uwPrice ?? klPrice) : (klPrice ?? uwPrice);

    // ── Hard filters: reject signals that aren't actionable ──

    // Filter 0a: Cross-validate price sources — reject if key levels and UW price diverge >20%
    if (klPrice && uwPrice && uwPrice > 0) {
      const priceDivergence = Math.abs(klPrice - uwPrice) / uwPrice;
      if (priceDivergence > 0.20) {
        console.log(`[signals] REJECTED ${ticker}: key levels price $${klPrice.toFixed(2)} vs UW price $${uwPrice.toFixed(2)} — ${(priceDivergence * 100).toFixed(0)}% divergence (bad data)`);
        return null;
      }
    }

    // Filter 0b: Reject signals where strike is absurdly far from price (bad data)
    if (price && strike) {
      const ratio = strike / price;
      if (ratio > 3 || ratio < 0.33) {
        console.log(`[signals] REJECTED ${ticker}: strike $${strike} vs price $${price} — ratio ${ratio.toFixed(2)} (bad data)`);
        return null;
      }
    }

    // Filter 0c: Reject signals with no live price — can't set entry/invalidation levels
    if (!price) {
      console.log(`[signals] REJECTED ${ticker}: no live price available — cannot set entry/invalidation levels`);
      return null;
    }

    // Filter 1: Reject deep OTM (>15%); flag deep ITM (>5%) for monitoring
    let isDeepItm = false;
    if (price && strike) {
      const isCall = optType === "call";
      const otmPct = isCall ? (strike - price) / price : (price - strike) / price;
      const itmPct = isCall ? (price - strike) / price : (strike - price) / price;
      if (otmPct > 0.15) return null;
      isDeepItm = itmPct > 0.05;
    }

    // Filter 2: Reject far-out expiries (>45 days) — we want near-term signals
    const expiryDate = c.expiry;
    if (expiryDate) {
      try {
        const expMs = new Date(expiryDate + "T16:00:00").getTime();
        const nowMs = Date.now();
        const daysToExpiry = (expMs - nowMs) / (1000 * 60 * 60 * 24);
        if (daysToExpiry > 45) return null;
        if (daysToExpiry < 0) return null;
      } catch {}
    }

    // Score
    let confidence = 5;
    if (hasSweep) confidence += 1;
    if (aggression >= 80) confidence += 1;
    if (aggression >= 95) confidence += 0.5;
    if (volOi >= 2) confidence += 0.5;
    if (volOi >= 5) confidence += 0.5;
    if (premium >= 100_000) confidence += 0.5;
    if (premium >= 500_000) confidence += 0.5;
    if (premium >= 1_000_000) confidence += 0.5;
    if (confirmation?.confirmed) confidence += 1;

    // ATM bonus / OTM penalty
    if (price && strike) {
      const diff = Math.abs(strike - price) / price;
      if (diff < 0.02) confidence += 1;
      else if (diff < 0.05) confidence += 0.5;
      else if (diff > 0.10) confidence -= 1;
    }

    // Near-term expiry bonus
    let daysOut = 30;
    if (expiryDate) {
      try {
        daysOut = (new Date(expiryDate + "T16:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysOut <= 7) confidence += 0.5;
      } catch {}
    }

    // ── Price direction alignment ──
    const vwapVal = kl?.vwap ?? null;
    const priceAligned = (() => {
      if (!price || !vwapVal) return null;
      if (optType === "call") return price > vwapVal;
      return price < vwapVal;
    })();

    const isWhaleFlow = premium >= 1_000_000 || (premium >= 500_000 && hasSweep);

    if (priceAligned === false) {
      if (isWhaleFlow) {
        confidence -= 0.5;
      } else {
        confidence -= 1;
      }
    } else if (priceAligned === true && confirmation?.confirmed) {
      confidence += 0.5;
    }

    confidence = Math.min(10, Math.round(confidence));
    if (confidence < 5) return null;

    const hasMultileg = !!c.has_multileg;
    let category = "algorithm";
    if (premium >= 2_000_000) category = "whale";
    else if (premium >= 1_000_000 && (hasSweep || aggression >= 90)) category = "whale";
    if (hasMultileg) category = "spread";

    // Tags
    const tags: string[] = [];
    if (hasSweep) tags.push("Sweep");
    tags.push(optType === "call" ? "Call Flow" : "Put Flow");
    if (volOi >= 5) tags.push("High Volume");
    if (price && Math.abs(strike - price) / price < 0.03) tags.push("ATM");
    if (isDeepItm) tags.push("Deep ITM");
    if (expiryDate === today) tags.push("0DTE");
    if (confirmation?.confirmed) tags.push("Price Confirmed");
    if (confirmation?.gamma_zone === "negative") tags.push("Negative Gamma");
    if (confirmation?.gamma_zone === "positive") tags.push("Positive Gamma");

    // Key levels
    const vwap = kl?.vwap ?? null;
    const pdh = kl?.prior_day?.high ?? null;
    const pdl = kl?.prior_day?.low ?? null;
    const pivot = kl?.pivot_points?.pivot ?? null;
    const r1 = kl?.pivot_points?.r1 ?? null;
    const s1 = kl?.pivot_points?.s1 ?? null;

    let entryTrigger = "";
    let target = "";
    let targetNear = "";
    let invalidation = "";
    let keyLevel = "";
    let srLevel = "";
    let actNow = false;
    let entryAnchorLevel: number | null = null;

    const psych = Math.round(strike / 10) * 10;
    const psychLevel = psych > 0 ? `$${psych} psychological level` : "";

    if (!vwap && price) {
      const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const h = etNow.getHours(), m = etNow.getMinutes(), dow = etNow.getDay();
      const inMarketHours = dow >= 1 && dow <= 5 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
      if (inMarketHours) {
        console.log(`[signals] VWAP null for ${ticker} during market hours — using no-VWAP fallback`);
      }
    }

    if (optType === "call") {
      if (isWhaleFlow && price) {
        entryTrigger = `Whale sweep at $${price.toFixed(2)}`;
        actNow = true;
      } else if (vwap && price) {
        entryAnchorLevel = vwap;
        if (price > vwap) {
          entryTrigger = `Holding above VWAP at $${vwap.toFixed(2)} — confirmed (price $${price.toFixed(2)})`;
          actNow = true;
        } else {
          entryTrigger = `Needs to reclaim VWAP at $${vwap.toFixed(2)} (price $${price.toFixed(2)})`;
          actNow = false;
        }
      } else if (price) {
        const nearLevel = strike > 0 ? `$${strike.toFixed(2)}` : `$${price.toFixed(2)}`;
        entryTrigger = `Near ${nearLevel} (no VWAP data)`;
        actNow = false;
      }

      const callTargets = [
        vwap && vwap > price ? { level: vwap, name: "VWAP" } : null,
        strike > price ? { level: strike, name: "Strike" } : null,
        pdh && pdh > price ? { level: pdh, name: "PDH" } : null,
        r1 && r1 > price ? { level: r1, name: "R1" } : null,
        pivot && pivot > price ? { level: pivot, name: "Pivot" } : null,
      ].filter((l): l is { level: number; name: string } => !!l && (!entryAnchorLevel || Math.abs(l.level - entryAnchorLevel) > 0.005));
      callTargets.sort((a, b) => a.level - b.level);

      if (callTargets.length >= 2) {
        target = `${callTargets[0].name} at $${callTargets[0].level.toFixed(2)}`;
        targetNear = `${callTargets[1].name} at $${callTargets[1].level.toFixed(2)}`;
      } else if (callTargets.length === 1) {
        target = `${callTargets[0].name} at $${callTargets[0].level.toFixed(2)}`;
        targetNear = `$${(callTargets[0].level * 1.02).toFixed(2)}`;
      } else {
        target = `$${(price * 1.02).toFixed(2)}`;
        targetNear = `$${(price * 1.04).toFixed(2)}`;
      }

      const supportLevels = [
        pdl ? { level: pdl, name: "PDL" } : null,
        s1 ? { level: s1, name: "S1" } : null,
        pivot && pivot < price ? { level: pivot, name: "Pivot" } : null,
      ].filter((l): l is { level: number; name: string } => !!l && l.level < price);
      supportLevels.sort((a, b) => b.level - a.level);
      invalidation = supportLevels.length > 0
        ? `Below ${supportLevels[0].name} at $${supportLevels[0].level.toFixed(2)}`
        : `Below $${(price * 0.98).toFixed(2)}`;

      keyLevel = vwap ? `VWAP at $${vwap.toFixed(2)}` : (pivot ? `Pivot at $${pivot.toFixed(2)}` : "");
      srLevel = psychLevel || (r1 ? `R1 at $${r1.toFixed(2)}` : "");
    } else {
      if (isWhaleFlow && price) {
        entryTrigger = `Whale sweep at $${price.toFixed(2)}`;
        actNow = true;
      } else if (vwap && price) {
        entryAnchorLevel = vwap;
        if (price < vwap) {
          entryTrigger = `Trading below VWAP at $${vwap.toFixed(2)} — confirmed (price $${price.toFixed(2)})`;
          actNow = true;
        } else {
          entryTrigger = `Needs rejection at VWAP $${vwap.toFixed(2)} (price $${price.toFixed(2)})`;
          actNow = false;
        }
      } else if (price) {
        const nearLevel = strike > 0 ? `$${strike.toFixed(2)}` : `$${price.toFixed(2)}`;
        entryTrigger = `Near ${nearLevel} (no VWAP data)`;
        actNow = false;
      }

      const putTargets = [
        vwap && vwap < price ? { level: vwap, name: "VWAP" } : null,
        strike < price ? { level: strike, name: "Strike" } : null,
        pdl && pdl < price ? { level: pdl, name: "PDL" } : null,
        s1 && s1 < price ? { level: s1, name: "S1" } : null,
        pivot && pivot < price ? { level: pivot, name: "Pivot" } : null,
      ].filter((l): l is { level: number; name: string } => !!l && (!entryAnchorLevel || Math.abs(l.level - entryAnchorLevel) > 0.005));
      putTargets.sort((a, b) => b.level - a.level);

      if (putTargets.length >= 2) {
        target = `${putTargets[0].name} at $${putTargets[0].level.toFixed(2)}`;
        targetNear = `${putTargets[1].name} at $${putTargets[1].level.toFixed(2)}`;
      } else if (putTargets.length === 1) {
        target = `${putTargets[0].name} at $${putTargets[0].level.toFixed(2)}`;
        targetNear = `$${(putTargets[0].level * 0.98).toFixed(2)}`;
      } else {
        target = `$${(price * 0.98).toFixed(2)}`;
        targetNear = `$${(price * 0.96).toFixed(2)}`;
      }

      const resistanceLevels = [
        pdh ? { level: pdh, name: "PDH" } : null,
        r1 ? { level: r1, name: "R1" } : null,
        pivot && pivot > price ? { level: pivot, name: "Pivot" } : null,
      ].filter((l): l is { level: number; name: string } => !!l && l.level > price);
      resistanceLevels.sort((a, b) => a.level - b.level);
      invalidation = resistanceLevels.length > 0
        ? `Above ${resistanceLevels[0].name} at $${resistanceLevels[0].level.toFixed(2)}`
        : `Above $${(price * 1.02).toFixed(2)}`;

      keyLevel = vwap ? `VWAP at $${vwap.toFixed(2)}` : (pivot ? `Pivot at $${pivot.toFixed(2)}` : "");
      srLevel = psychLevel || (s1 ? `S1 at $${s1.toFixed(2)}` : "");
    }

    if (price && target !== "Data Not Available") {
      const targetVal = parseFloat(target.replace(/[^0-9.]/g, '')) || 0;
      if (optType === "call" && targetVal > 0 && targetVal <= price) {
        target = `$${(price * 1.02).toFixed(2)}`;
        targetNear = `$${(price * 1.04).toFixed(2)}`;
        console.log(`[signals] FIXED ${ticker} CALL target: was at/below price, reset to ${target}`);
      }
      if (optType === "put" && targetVal > 0 && targetVal >= price) {
        target = `$${(price * 0.98).toFixed(2)}`;
        targetNear = `$${(price * 0.96).toFixed(2)}`;
        console.log(`[signals] FIXED ${ticker} PUT target: was at/above price, reset to ${target}`);
      }
    }

    if (actNow) tags.push("⚡ Act Now");

    // Reason
    const premStr = premium >= 1_000_000 ? `$${(premium / 1_000_000).toFixed(1)}M` : `$${(premium / 1000).toFixed(0)}K`;
    let reason = `${premStr} ${optType} ${hasSweep ? "sweep" : "flow"} at $${strike} strike with ${aggression.toFixed(0)}% ask aggression.`;
    if (price && vwap) {
      reason += ` Price at $${price.toFixed(2)} ${price > vwap ? "above" : "below"} VWAP ($${vwap.toFixed(2)}).`;
    } else if (price) {
      reason += ` Price at $${price.toFixed(2)}.`;
    }
    if (confirmation?.gamma_zone === "negative") reason += " Negative gamma zone — moves will be amplified.";
    if (confirmation?.confirmed) reason += ` Price action confirmed: ${confirmation.pattern}.`;

    const adjustedExpiryISO = expiryDate ? adjustExpiryForHolidays(expiryDate) : expiryDate;
    const expiryFormatted = (() => {
      try {
        const d = new Date(adjustedExpiryISO + "T12:00:00");
        return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      } catch { return adjustedExpiryISO; }
    })();

    const smartExpiry = (() => {
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const dayOfWeek = et.getDay();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const todayISO = fmtDate(et);
      const todayIsHoliday = isMarketHoliday(todayISO);
      const ZERO_DTE = new Set(["SPY","QQQ","IWM","AAPL","MSFT","AMZN","META","NVDA","TSLA","GOOGL","AMD","NFLX","GLD","TLT","XOM","JPM","DIS","BA","V","MA","COIN"]);
      const has0DTE = ZERO_DTE.has(ticker);
      const isMWF = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
      const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

      if (daysOut <= 2 && has0DTE && isWeekday && !todayIsHoliday) {
        if (ticker === "SPY" || ticker === "QQQ" || ticker === "IWM" || isMWF) {
          return { expiry: fmt(et), label: "0DTE" };
        }
        const tom = new Date(et); tom.setDate(tom.getDate() + 1);
        const tomISO = fmtDate(tom);
        if (tom.getDay() === 0 || isMarketHoliday(tomISO)) tom.setDate(tom.getDate() + 1);
        if (tom.getDay() === 6) tom.setDate(tom.getDate() + 2);
        const tom2ISO = fmtDate(tom);
        if (isMarketHoliday(tom2ISO)) tom.setDate(tom.getDate() + 1);
        return { expiry: fmt(tom), label: "1DTE" };
      }
      if (daysOut <= 7) return { expiry: expiryFormatted, label: "This week" };
      const fri = new Date(et);
      const duf = (5 - dayOfWeek + 7) % 7 || 7;
      fri.setDate(fri.getDate() + duf);
      const friISO = fmtDate(fri);
      if (isMarketHoliday(friISO)) fri.setDate(fri.getDate() - 1);
      return { expiry: fmt(fri), label: "Weekly" };
    })();

    return {
      ticker, direction, option_type: optType, category,
      trade: `Buy ${ticker} $${strike} ${optType === "call" ? "Call" : "Put"}`,
      strike, expiry: smartExpiry.expiry, premium,
      ask_aggression_pct: aggression, vol_oi_ratio: volOi, has_sweep: hasSweep,
      current_price: price, vwap, prior_day_high: pdh, prior_day_low: pdl,
      pivot, r1, s1,
      entry_trigger: entryTrigger, key_level: keyLevel, sr_level: srLevel, target, target_near: targetNear, invalidation,
      reason, confidence, tags,
      created_at: c.created_at || null,
      detected_at: getNowEastern(),
      price_confirmed: !!confirmation?.confirmed,
      price_pattern: confirmation?.pattern ?? null,
      gamma_zone: confirmation?.gamma_zone ?? "neutral",
      gamma_description: confirmation?.gamma_description ?? null,
      recommended_action: confirmation?.trade_recommendation?.action ?? `Buy ${ticker} $${strike} ${optType === "call" ? "Call" : "Put"}`,
      recommended_expiry: confirmation?.trade_recommendation?.expiry ?? smartExpiry.expiry,
      recommended_strike: entryTrigger,
      spread_details: null,
    };
  }

  // Step 1: Local pre-screen to get top candidates
  const preScreened: any[] = [];
  const seenTickers = new Set<string>();
  for (const c of candidates) {
    const ticker = c.ticker as string;
    const strike = parseFloat(String(c.strike)) || 0;
    const optType = c.type === "call" ? "call" : "put";
    const key = `${ticker}-${strike}-${optType}`;
    const kl = keyLevels[ticker];
    const confirmation = priceConfirmations[key];
    const structure = structureMap[ticker] || null;
    const sig = scoreSignal(c, kl, confirmation, structure);
    if (sig && !seenTickers.has(`${ticker}-${optType}`)) {
      seenTickers.add(`${ticker}-${optType}`);
      preScreened.push(sig);
    }
  }
  preScreened.sort((a, b) => b.confidence - a.confidence);
  const topCandidates = preScreened.slice(0, 15);

  // Step 1b: Enrich with Polygon options contract data (IV, greeks, bid/ask)
  const polygonOptionsData: Record<string, any> = {};
  const polygonKey = POLYGON_KEY();
  if (polygonKey) {
    const uniqueTickers = [...new Set(topCandidates.map(s => s.ticker))];
    await Promise.all(uniqueTickers.map(async (ticker) => {
      try {
        const tickerSignals = topCandidates.filter(s => s.ticker === ticker);
        for (const sig of tickerSignals) {
          const expDate = (() => {
            try {
              let d = new Date(sig.expiry);
              if (isNaN(d.getTime())) {
                const m = sig.expiry.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
                if (m) d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
              }
              if (isNaN(d.getTime())) return null;
              const y = d.getFullYear();
              const mo = String(d.getMonth() + 1).padStart(2, '0');
              const dy = String(d.getDate()).padStart(2, '0');
              return `${y}-${mo}-${dy}`;
            } catch { return null; }
          })();
          if (!expDate) continue;

          const contractType = sig.option_type === "call" ? "call" : "put";
          const strikeInt = Math.round(sig.strike * 1000);
          const strikeStr = strikeInt.toString().padStart(8, '0');

          const isSpxWeekly = ticker === "SPXW";
          const parentTicker = isSpxWeekly ? "SPX" : ticker;
          const contractTicker = isSpxWeekly ? "SPXW" : ticker;
          const oTicker = `O:${contractTicker}${expDate.replace(/-/g, '').slice(2)}${contractType === 'call' ? 'C' : 'P'}${strikeStr}`;
          const url = `https://api.polygon.io/v3/snapshot/options/${parentTicker}/${oTicker}?apiKey=${polygonKey}`;

          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (res.ok) {
            const json = await res.json();
            const r = json.results;
            if (r) {
              const greeks = r.greeks || {};
              const key = `${ticker}-${sig.strike}-${sig.option_type}`;
              polygonOptionsData[key] = {
                implied_volatility: r.implied_volatility ? Math.round(r.implied_volatility * 10000) / 100 : null,
                delta: greeks.delta ? Math.round(greeks.delta * 1000) / 1000 : null,
                gamma: greeks.gamma ? Math.round(greeks.gamma * 10000) / 10000 : null,
                theta: greeks.theta ? Math.round(greeks.theta * 100) / 100 : null,
                vega: greeks.vega ? Math.round(greeks.vega * 100) / 100 : null,
                bid: r.day?.close || r.last_quote?.bid || null,
                ask: r.last_quote?.ask || null,
                mid: r.last_quote?.midpoint || null,
                option_volume: r.day?.volume || null,
                open_interest: r.open_interest || null,
                underlying_price: r.underlying_asset?.price || null,
              };
              if (polygonOptionsData[key].underlying_price && sig.current_price) {
                const polyPrice = polygonOptionsData[key].underlying_price;
                if (Math.abs(polyPrice - sig.current_price) / sig.current_price > 0.005) {
                  console.log(`[signals] ${ticker}: Polygon live price $${polyPrice.toFixed(2)} vs UW price $${sig.current_price.toFixed(2)} — using Polygon`);
                  sig.current_price = polyPrice;
                }
              }
              console.log(`[signals] ${ticker} ${sig.option_type} $${sig.strike}: IV=${polygonOptionsData[key].implied_volatility}%, delta=${polygonOptionsData[key].delta}, OI=${polygonOptionsData[key].open_interest}`);
            }
          }
        }
      } catch (err: any) {
        console.warn(`[signals] Polygon options fetch failed for ${ticker}:`, err.message);
      }
    }));
    console.log(`[signals] Polygon options enrichment: ${Object.keys(polygonOptionsData).length}/${topCandidates.length} contracts found`);
  }

  // Step 2: Claude AI evaluation — distinguish directional bets from hedges
  let signals = topCandidates;
  try {
    const claudeT0 = Date.now();
    const candidateSummary = topCandidates.map((s, i) => {
      const candles = candleMap[s.ticker] || [];
      let intraday_trend = "unknown";
      let intraday_change_pct = 0;
      let trend_description = "";
      if (candles.length >= 3 && s.current_price) {
        const openPrice = candles[0]?.open;
        const recentCandles = candles.slice(-5);
        const midCandles = candles.slice(Math.floor(candles.length / 2), Math.floor(candles.length / 2) + 3);
        const recentAvg = recentCandles.reduce((sum, c) => sum + (c.close || 0), 0) / recentCandles.length;
        const midAvg = midCandles.reduce((sum, c) => sum + (c.close || 0), 0) / midCandles.length;
        if (openPrice) {
          intraday_change_pct = Math.round(((s.current_price - openPrice) / openPrice) * 10000) / 100;
        }
        if (recentAvg < midAvg * 0.995) intraday_trend = "falling";
        else if (recentAvg > midAvg * 1.005) intraday_trend = "rising";
        else intraday_trend = "sideways";
        const dayHigh = Math.max(...candles.map(c => c.high || 0));
        const dayLow = Math.min(...candles.filter(c => c.low && c.low > 0).map(c => c.low));
        trend_description = `Open: $${openPrice?.toFixed(2)}, High: $${dayHigh.toFixed(2)}, Low: $${dayLow.toFixed(2)}, Current: $${s.current_price.toFixed(2)}, Change: ${intraday_change_pct > 0 ? '+' : ''}${intraday_change_pct}%, Trend: ${intraday_trend}`;
      }
      const structure = structureMap[s.ticker] || null;
      return {
        idx: i,
        ticker: s.ticker,
        direction: s.direction,
        option_type: s.option_type,
        trade: s.trade,
        strike: s.strike,
        expiry: s.expiry,
        premium: s.premium,
        ask_aggression_pct: s.ask_aggression_pct,
        vol_oi_ratio: s.vol_oi_ratio,
        has_sweep: s.has_sweep,
        current_price: s.current_price,
        vwap: s.vwap,
        prior_day_high: s.prior_day_high,
        prior_day_low: s.prior_day_low,
        pivot: s.pivot,
        r1: s.r1,
        s1: s.s1,
        entry_trigger: s.entry_trigger,
        price_confirmed: s.price_confirmed,
        price_pattern: s.price_pattern,
        gamma_zone: s.gamma_zone,
        local_confidence: s.confidence,
        category: s.category,
        intraday_trend,
        intraday_change_pct,
        trend_description,
        market_structure: structure ? {
          multi_day_trend: structure.trend,
          premium_discount: structure.premium_discount,
          nearest_support: structure.nearest_support,
          nearest_resistance: structure.nearest_resistance,
          break_of_structure: structure.break_of_structure,
          change_of_character: structure.change_of_character,
          active_fvgs: structure.fvgs,
          inversed_fvgs: structure.ifvgs,
          order_blocks: structure.order_blocks,
          liquidity_levels: structure.liquidity_levels,
          structure_summary: structure.structure_summary,
        } : null,
        polygon_options: polygonOptionsData[`${s.ticker}-${s.strike}-${s.option_type}`] || null,
      };
    });

    const aiPrompt = `You are a professional options flow analyst and CHART READER with ICT/SMC (Smart Money Concepts) knowledge. Evaluate these ${topCandidates.length} pre-screened trade signals. Your job is to determine which are REAL actionable directional bets vs hedges/noise.

CRITICAL DATA YOU HAVE FOR EACH SIGNAL:
1. "trend_description" + "intraday_trend" — what the stock is doing TODAY
2. "polygon_options" — LIVE options contract data from Polygon.io including:
   - implied_volatility: IV as percentage (e.g. 85.5 = 85.5%)
   - delta, gamma, theta, vega: option greeks
   - bid/ask/mid: live option prices
   - option_volume: today's volume on this contract
   - open_interest: existing OI on this contract
   - underlying_price: Polygon's real-time stock price (more accurate than UW)
   Use IV, delta, and volume/OI to assess signal quality. High IV + high delta (>0.3) + volume > OI = strong conviction.
3. "market_structure" — FULL ICT/SMC structural analysis including:
   - multi_day_trend: uptrend/downtrend/ranging (swing highs & lows)
   - premium_discount: is price in premium (above equilibrium), discount (below), or at equilibrium?
   - nearest_support / nearest_resistance: key structural levels
   - break_of_structure (BOS): trend continuation signal
   - change_of_character (CHoCH): potential trend REVERSAL signal — very important!
   - active_fvgs: Fair Value Gaps that are still open (unfilled or partially filled with CE)
     → Bullish FVG = continuation support for longs
     → Bearish FVG = continuation resistance for shorts
   - inversed_fvgs (IFVGs): FVGs that got VIOLATED — they flip meaning!
     → Inversed bullish FVG = was support, now acts as RESISTANCE (bearish)
     → Inversed bearish FVG = was resistance, now acts as SUPPORT (bullish)
   - order_blocks: last opposing candle before an impulse move. Respected OBs are strong S/R.
   - liquidity_levels: equal highs/lows where stops are resting. Unswept = magnet for price.

READ THE STRUCTURE LIKE A CHART. Combine these elements for your analysis.

For EACH signal, return a JSON object with:
- idx: the signal index
- is_hedge: true if this looks like a hedge, counter-trend trap, or otherwise NOT a clean directional setup
- adjusted_confidence: 1-10 score (LOWER if against the trend, higher only if flow AND price action AGREE)
- hedge_reason: brief explanation if is_hedge is true
- signal_quality: "strong" | "moderate" | "weak" | "hedge"
- recommended_category: "whale" | "algorithm" | "spread"

ICT/SMC ANALYSIS FRAMEWORK — score signals based on structural confluence:

HIGHEST CONVICTION (score 8-10) — multiple ICT confluences:
- Trend-aligned flow: calls in uptrend above VWAP, puts in downtrend below VWAP
- Flow at discount (for calls) or premium (for puts) — buying low, selling high
- Price at a respected order block in the trend direction
- Bullish BOS + calls, or Bearish BOS + puts = continuation trade
- Active FVG supporting the trade direction (bullish FVG below for calls, bearish FVG above for puts)
- Liquidity just got swept in the opposite direction (sell-side swept → now bullish, buy-side swept → now bearish)

FVG / IFVG PLAYS (can be very high conviction):
- Active (unfilled) bullish FVG + call buying = price expected to respect the gap and continue up (continuation)
- Active (unfilled) bearish FVG + put buying = price expected to respect the gap and continue down (continuation)
- IFVG (inversed bullish FVG) + put buying = originally bullish gap got violated, now acts as resistance. Bearish setup. (reversal)
- IFVG (inversed bearish FVG) + call buying = originally bearish gap got violated, now acts as support. Bullish reversal. (reversal)
- FVG with consequent encroachment (CE) = partially filled, price touched midpoint. Could still hold or fully inverse — moderate conviction.

REVERSAL PLAYS (score 5-8 depending on confluence):
- CHoCH (change of character) is a KEY reversal signal. If CHoCH is bullish + call buying → strong reversal setup.
- Calls on a dump are VALID IF: CHoCH bullish, or price at IFVG support (inversed bearish), or price at respected bullish OB, or sell-side liquidity was just swept
- Puts on a rally are VALID IF: CHoCH bearish, or price at IFVG resistance (inversed bullish), or price at respected bearish OB, or buy-side liquidity was just swept
- Price in DISCOUNT zone + calls = smart money buying cheap
- Price in PREMIUM zone + puts = smart money selling high

HEDGE / LOW CONVICTION (score 3-5):
- No ICT confluence: no FVG, no OB, no liquidity sweep, no BOS/CHoCH supporting the direction
- Counter-trend with NO structural reason (no CHoCH, no IFVG, no OB support)
- Flow on indices (SPY/QQQ/IWM) against the trend = likely portfolio hedge
- Far OTM + massive premium + far expiry = tail hedge
- Price in PREMIUM buying calls, or price in DISCOUNT buying puts (buying expensive)

CATEGORY ASSIGNMENT:
- "whale": ONLY for $1M+ premium with sweep/high aggression, or $2M+. Rare.
- "spread": Multi-leg strategies
- "algorithm": Default for most signals ($25K-$999K premium)

IMPORTANT: Always keep the option type true to the actual flow. If someone bought calls, the signal is a call. If they bought puts, it's a put. Do NOT flip the direction. Instead, adjust your confidence score and note if it's a counter-trend reversal play vs a trend-following trade.

SIGNALS:
${JSON.stringify(candidateSummary, null, 2)}

Respond ONLY with a JSON array of objects. No markdown, no explanation. Example:
[{"idx":0,"is_hedge":false,"adjusted_confidence":9,"hedge_reason":null,"signal_quality":"strong","recommended_category":"whale"},{"idx":1,"is_hedge":true,"adjusted_confidence":4,"hedge_reason":"Large SPY put on green day = portfolio hedge","signal_quality":"hedge","recommended_category":"whale"}]`;

    const aiResponse = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: aiPrompt }],
    });

    logApiCall("anthropic", "signal-pipeline");
    logApiCall("replit", "signal-pipeline");
    const aiText = (aiResponse.content[0] as any)?.text ?? "";
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const evaluations = JSON.parse(jsonMatch[0]);
      const evalMap = new Map(evaluations.map((e: any) => [e.idx, e]));

      signals = topCandidates.map((sig, i) => {
        const evaluation = evalMap.get(i) as any;
        if (!evaluation) return sig;

        const adjustedConf = Math.min(10, Math.max(1, Math.round(evaluation.adjusted_confidence)));

        const aiCategory = evaluation.recommended_category;
        const finalCategory = (aiCategory === "whale" || aiCategory === "spread" || aiCategory === "algorithm")
          ? aiCategory : sig.category;

        const quality = evaluation.signal_quality || "moderate";
        const pick = !evaluation.is_hedge && adjustedConf >= 8 && (quality === "strong" || quality === "moderate");
        return {
          ...sig,
          confidence: adjustedConf,
          category: finalCategory,
          is_hedge: !!evaluation.is_hedge,
          hedge_reason: evaluation.hedge_reason || null,
          signal_quality: quality,
          is_biddie_pick: pick,
          reason: evaluation.is_hedge
            ? `⚠️ LIKELY HEDGE: ${evaluation.hedge_reason}. ${sig.reason}`
            : sig.reason,
          tags: evaluation.is_hedge
            ? [...sig.tags.filter((t: string) => t !== "Price Confirmed"), "⚠️ Hedge"]
            : sig.tags,
        };
      });

      signals = signals.filter((s) => !s.is_hedge && s.confidence >= 6);
      signals.sort((a, b) => b.confidence - a.confidence);

      console.log(`[signals] Claude evaluation done: ${Date.now() - claudeT0}ms`);
    }
  } catch (aiErr) {
    console.warn(`[signals] Claude evaluation failed, using local scores:`, aiErr);
    // Fall back to local scoring if Claude fails
  }

  // Step 2b: Delta-based confidence adjustment (post-Claude, pre-spread)
  // Uses Polygon options data already fetched for top 15 candidates
  // Delta = market's real-time probability of finishing in the money
  for (const s of signals) {
    const key = `${s.ticker}-${s.strike}-${s.option_type}`;
    const polyData = polygonOptionsData[key];
    if (!polyData?.delta) continue;

    const absDelta = Math.abs(polyData.delta);
    let deltaAdj = 0;

    // Lottery ticket — ~10% or less probability
    if (absDelta < 0.10) deltaAdj = -1;
    // Far OTM — needs a big move
    else if (absDelta < 0.20) deltaAdj = -0.5;
    // Deep ITM — expensive, limited leverage
    else if (absDelta > 0.80) deltaAdj = -0.5;

    // Cap total delta penalty at -1
    deltaAdj = Math.max(deltaAdj, -1);

    if (deltaAdj !== 0) {
      const before = s.confidence;
      s.confidence = Math.min(10, Math.max(1, Math.round(s.confidence + deltaAdj)));
      console.log(`[signals] ${s.ticker} $${s.strike} ${s.option_type}: delta=${absDelta.toFixed(3)}, confidence ${before}→${s.confidence} (${deltaAdj})`);
    }
  }

  // Step 3: Generate spread ideas from the top directional signals
  const whaleAndAlgoSignals = signals.filter((s) => s.confidence >= 7);
  if (whaleAndAlgoSignals.length >= 2) {
    try {
      const spreadT0 = Date.now();
      const spreadInput = whaleAndAlgoSignals.slice(0, 6).map((s) => ({
        ticker: s.ticker,
        direction: s.direction,
        option_type: s.option_type,
        strike: s.strike,
        expiry: s.expiry,
        premium: s.premium,
        current_price: s.current_price,
        vwap: s.vwap,
        prior_day_high: s.prior_day_high,
        prior_day_low: s.prior_day_low,
        r1: s.r1,
        s1: s.s1,
        confidence: s.confidence,
        entry_trigger: s.entry_trigger,
        target: s.target,
        invalidation: s.invalidation,
      }));

      const spreadPrompt = `You are a professional options strategist. Review these directional signals from institutional flow and decide if any of them would genuinely benefit from a SPREAD strategy instead of just buying the option outright.

DIRECTIONAL SIGNALS (confirmed by institutional flow):
${JSON.stringify(spreadInput, null, 2)}

IMPORTANT: Only suggest a spread if it GENUINELY makes sense. A straight put or call is often the better play. Reasons to suggest a spread:
- IV is elevated and you want to reduce cost basis
- The move has a clear price ceiling/floor making a vertical spread ideal
- Risk/reward improves meaningfully vs the outright option
- The signal suggests a pinning/range-bound scenario (butterfly)

If NONE of the signals justify a spread, return an empty array: []

For each spread you DO suggest, return a JSON object with:
- ticker: the underlying ticker
- direction: "bullish" or "bearish" (MUST match the parent signal direction)
- trade: human-readable trade description (e.g. "GOOG Bull Call Spread $280/$290 Apr 25")
- option_type: "call" or "put" (the dominant leg)
- strategy_type: "bull_call_spread" | "bear_put_spread" | "call_debit_spread" | "put_credit_spread" | "iron_condor" | "butterfly"
- legs: description of the legs (e.g. "Buy $280 Call / Sell $290 Call")
- expiry: suggested expiry date
- max_profit: estimated max profit per contract in dollars (number)
- max_loss: estimated max loss per contract in dollars (number)
- risk_reward: ratio as string (e.g. "1:2.5")
- entry_trigger: when to enter this spread
- target: profit target (must be in the correct direction — below current for bearish, above for bullish)
- invalidation: when to exit for loss (must be in the opposite direction from target)
- confidence: 1-10 based on the underlying signal strength
- reason: 1-2 sentence explanation of why a SPREAD specifically makes more sense than buying the option outright

RULES:
- Do NOT force spreads. Return [] if outright options are better.
- Maximum 2 spread suggestions total.
- Use strikes near the current price and key levels (VWAP, PDH, PDL, R1, S1)
- Keep expiries within 2-4 weeks for day/swing trades
- Risk/reward must be at least 1:1.5

Respond ONLY with a JSON array. No markdown, no explanation.`;

      const spreadResponse = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: spreadPrompt }],
      });

      logApiCall("anthropic", "spread-pipeline");
      logApiCall("replit", "spread-pipeline");
      const spreadText = (spreadResponse.content[0] as any)?.text ?? "";
      const spreadJsonMatch = spreadText.match(/\[[\s\S]*\]/);
      if (spreadJsonMatch) {
        const spreadIdeas = JSON.parse(spreadJsonMatch[0]);

        for (const spread of spreadIdeas) {
          const parentSig = whaleAndAlgoSignals.find((s) => s.ticker === spread.ticker);
          const rawDir = String(spread.direction || "").toLowerCase().trim();
          const spreadDir = parentSig ? parentSig.direction : (rawDir === "bullish" ? "bullish" : "bearish");
          const spreadOptType = spreadDir === "bullish" ? "call" : "put";

          const spreadTrade = spread.trade || `Buy ${spread.ticker} ${spreadOptType === "call" ? "Call" : "Put"} Spread`;

          signals.push({
            ticker: spread.ticker,
            direction: spreadDir,
            option_type: spreadOptType,
            category: "spread",
            trade: spreadTrade,
            strike: parentSig?.strike ?? 0,
            expiry: spread.expiry,
            premium: parentSig?.premium ?? 0,
            ask_aggression_pct: parentSig?.ask_aggression_pct ?? 0,
            vol_oi_ratio: parentSig?.vol_oi_ratio ?? 0,
            has_sweep: parentSig?.has_sweep ?? false,
            current_price: parentSig?.current_price ?? null,
            vwap: parentSig?.vwap ?? null,
            prior_day_high: parentSig?.prior_day_high ?? null,
            prior_day_low: parentSig?.prior_day_low ?? null,
            pivot: parentSig?.pivot ?? null,
            r1: parentSig?.r1 ?? null,
            s1: parentSig?.s1 ?? null,
            entry_trigger: spread.entry_trigger,
            key_level: parentSig?.key_level ?? "",
            target: spread.target,
            invalidation: spread.invalidation,
            reason: spread.reason,
            created_at: parentSig?.created_at ?? null,
            detected_at: getNowEastern(),
            confidence: Math.min(10, Math.max(1, spread.confidence ?? 7)),
            tags: [
              spread.strategy_type?.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()) ?? "Spread",
              "Defined Risk",
              spreadDir === "bullish" ? "Call Flow" : "Put Flow",
            ],
            price_confirmed: parentSig?.price_confirmed ?? false,
            price_pattern: parentSig?.price_pattern ?? null,
            gamma_zone: parentSig?.gamma_zone ?? "neutral",
            gamma_description: parentSig?.gamma_description ?? null,
            recommended_action: spreadTrade,
            recommended_expiry: spread.expiry,
            recommended_strike: spread.entry_trigger,
            spread_details: {
              type: spread.strategy_type,
              legs: spread.legs,
              max_profit: spread.max_profit ?? null,
              max_loss: spread.max_loss ?? null,
              risk_reward: spread.risk_reward ?? null,
            },
            is_hedge: false,
            signal_quality: "moderate",
          });
        }
        console.log(`[signals] Spread generation done: ${Date.now() - spreadT0}ms, ${spreadIdeas.length} spreads`);
      }
    } catch (spreadErr) {
      console.warn(`[signals] Spread generation failed:`, spreadErr);
    }
  }

  signals.sort((a, b) => b.confidence - a.confidence);

  const dedupedSignals: typeof signals = [];
  const seenKeys = new Set<string>();
  for (const s of signals) {
    const key = `${s.ticker}|${s.category}|${s.strike || ''}|${s.option_type || ''}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    dedupedSignals.push(s);
  }
  signals = dedupedSignals;

  signals.sort((a, b) => b.confidence - a.confidence);

  console.log(`[signals] pipeline complete: ${Date.now() - t0}ms, ${signals.length} signals (deduped)`);

  const biddiePicks = signals.filter((s) => s.is_biddie_pick);
  console.log(`[signals] ${biddiePicks.length}/${signals.length} are biddie picks`);

  let activePicks = signals;
  try {
    const resolvedRows = await dbQuery(
      `SELECT ticker, COALESCE(strike, 0) as strike, COALESCE(option_type, '') as option_type, COALESCE(expiry, '') as expiry
       FROM signal_outcomes
       WHERE outcome IS NOT NULL AND outcome NOT IN ('pending', 'watching')
       AND created_at > NOW() - INTERVAL '7 days'`
    );
    if (resolvedRows?.rows?.length) {
      const resolvedKeys = new Set<string>();
      for (const r of resolvedRows.rows) {
        const tk = String(r.ticker || "").toUpperCase();
        const st = parseFloat(String(r.strike)) || 0;
        const ot = String(r.option_type || "").toLowerCase();
        const exp = String(r.expiry || "");
        let expIso = "";
        try { const d = new Date(exp); if (!isNaN(d.getTime())) expIso = d.toISOString().slice(0, 10); } catch {}
        if (expIso) resolvedKeys.add(`${tk}|${st}|${ot}|${expIso}`);
        else resolvedKeys.add(`${tk}|${st}|${ot}|noexp`);
      }
      const before = activePicks.length;
      activePicks = activePicks.filter(s => {
        const tk = String(s.ticker || "").toUpperCase();
        const st = parseFloat(String(s.strike)) || 0;
        const ot = String(s.option_type || "").toLowerCase();
        const exp = String(s.expiry || "");
        let expIso = "";
        try { const d = new Date(exp); if (!isNaN(d.getTime())) expIso = d.toISOString().slice(0, 10); } catch {}
        if (expIso && resolvedKeys.has(`${tk}|${st}|${ot}|${expIso}`)) return false;
        if (!expIso && resolvedKeys.has(`${tk}|${st}|${ot}|noexp`)) return false;
        return true;
      });
      if (before !== activePicks.length) {
        console.log(`[signals] Filtered ${before - activePicks.length} resolved signals from live feed`);
      }
    }
  } catch (filterErr: any) {
    console.warn(`[signals] Resolved filter failed:`, filterErr.message);
  }

  const responseData = { signals: activePicks.slice(0, 20), count: Math.min(activePicks.length, 20), signalCount: signals.length, timestamp: now };
  signalsCache = { data: responseData, timestamp: Date.now() };
  signalsPipelineRunning = false;

  for (const s of signals.slice(0, 20)) {
    try {
      let fixedExpiry = s.expiry || "";
      const currentYear = new Date().getFullYear();
      const expiryYearMatch = fixedExpiry.match(/\b(20\d{2})\b/);
      if (expiryYearMatch) {
        const expiryYear = parseInt(expiryYearMatch[1]);
        if (expiryYear < currentYear) {
          fixedExpiry = fixedExpiry.replace(String(expiryYear), String(currentYear));
        }
      }

      if (fixedExpiry) {
        const expDate = new Date(fixedExpiry);
        const todayMidnight = new Date(new Date().toISOString().split("T")[0]);
        if (!isNaN(expDate.getTime()) && expDate < todayMidnight) {
          console.log(`[signals] SKIPPED ${s.ticker}: ${s.option_type} $${s.strike} already expired (${fixedExpiry})`);
          continue;
        }
      }

      let expiryIso = "";
      if (fixedExpiry) {
        try {
          const d = new Date(fixedExpiry);
          if (!isNaN(d.getTime())) expiryIso = d.toISOString().slice(0, 10);
        } catch {}
      }
      const existingSameDay = await dbQuery(
        expiryIso
          ? `SELECT id, reinforcement_count, confidence FROM signal_outcomes WHERE ticker = $1 AND COALESCE(strike, 0) = COALESCE($2::numeric, 0) AND COALESCE(option_type, '') = COALESCE($3, '') AND signal_source = 'replit' AND (COALESCE(expiry, '') = COALESCE($4, '') OR COALESCE(expiry, '') ILIKE '%' || $5 || '%') AND (detected_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date LIMIT 1`
          : `SELECT id, reinforcement_count, confidence FROM signal_outcomes WHERE ticker = $1 AND COALESCE(strike, 0) = COALESCE($2::numeric, 0) AND COALESCE(option_type, '') = COALESCE($3, '') AND COALESCE(expiry, '') = COALESCE($4, '') AND signal_source = 'replit' AND (detected_at AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date LIMIT 1`,
        expiryIso
          ? [s.ticker, s.strike, s.option_type, fixedExpiry, expiryIso]
          : [s.ticker, s.strike, s.option_type, fixedExpiry]
      );
      if (existingSameDay && existingSameDay.rows.length > 0) {
        const row = existingSameDay.rows[0];
        const newCount = (Number(row.reinforcement_count) || 1) + 1;
        const newConf = Math.max(Number(row.confidence) || 0, s.confidence);
        await dbQuery(
          `UPDATE signal_outcomes SET reinforcement_count = $1, last_reinforced_at = NOW(), confidence = $2 WHERE id = $3`,
          [newCount, newConf, row.id]
        );
        console.log(`[signals] REINFORCED ${s.ticker} ${s.option_type} $${s.strike} → ${newCount}x (same ET day)`);
        continue;
      }

      const initialStatus = (s.tags || []).includes("⚡ Act Now") ? "active" : "watching";
      const isBiddiePick = !s.is_hedge && s.confidence >= 8 && (s.signal_quality === "strong" || s.signal_quality === "moderate");
      await dbQuery(
        `INSERT INTO signal_outcomes (ticker, signal_type, signal_source, strike, expiry, premium, option_type, direction, confidence, conviction_score, category, reason, entry_trigger, target, invalidation, tags, spread_details, price_at_signal, key_level, sr_level, target_near, trade_status, status_updated_at, detected_at, is_biddie_pick, signal_quality)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW(), $23, $24)`,
        [
          s.ticker, s.direction, "replit", s.strike, fixedExpiry, s.premium,
          s.option_type, s.direction, s.confidence, Math.round(s.confidence * 10),
          s.category, s.reason, s.entry_trigger, s.target, s.invalidation,
          s.tags || [], s.spread_details ? JSON.stringify(s.spread_details) : null,
          s.current_price || null, s.key_level || null, s.sr_level || null,
          s.target_near || null, initialStatus, isBiddiePick, s.signal_quality || null
        ]
      );
    } catch {}
  }

  return responseData;
  } catch (err) {
    console.error("[signals] pipeline crashed:", err);
    signalsPipelineRunning = false;
    return signalsCache?.data || { signals: [], count: 0, timestamp: now };
  }
}

router.get("/whale/signals", async (_req, res) => {
  const respond = (data: any) => res.json(attachExecutionVerdicts(data));

  if (signalsCache && Date.now() - signalsCache.timestamp < SIGNALS_CACHE_TTL) {
    return respond(signalsCache.data);
  }

  if (signalsPipelineRunning) {
    if (signalsCache) {
      return respond(signalsCache.data);
    }
    return respond({ signals: [], count: 0, timestamp: getNowEastern(), loading: true });
  }

  if (signalsCache) {
    respond(signalsCache.data);
    runSignalsPipeline().catch(e => console.error("[signals] background refresh failed:", e));
    return;
  }

  try {
    const data = await runSignalsPipeline();
    respond(data || { signals: [], count: 0, timestamp: getNowEastern() });
  } catch (err: any) {
    console.error("[signals] pipeline error:", err);
    respond({ signals: [], count: 0, timestamp: getNowEastern() });
  }
});

setInterval(async () => {
  try {
    if (!isMarketOpenET()) return;
    if (signalsPipelineRunning) return;
    if (signalsCache && Date.now() - signalsCache.timestamp < SIGNALS_CACHE_TTL) return;
    console.log("[signals] scheduled refresh starting...");
    await runSignalsPipeline();
  } catch (e: any) {
    console.error("[signals] scheduled refresh failed:", e.message);
  }
}, 3 * 60 * 1000);

router.get("/whale/analyze/:ticker", async (req, res) => {
  const ticker = (req.params.ticker || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!ticker || ticker.length > 5) {
    res.status(400).json({ error: "Invalid ticker" });
    return;
  }

  try {
    const t0 = Date.now();
    console.log(`[analyze] Starting analysis for ${ticker}`);

    const [flowAlerts, darkpool, keyLevels, candles] = await Promise.all([
      fetchFlowAlerts(500),
      fetchDarkpool(ticker, 30),
      fetchKeyLevels(ticker),
      fetchRecentCandles(ticker, "1m", 15),
    ]);

    const enriched = enrichAlerts(flowAlerts);
    const tickerFlow = enriched.filter((a: any) => (a.ticker ?? "").toUpperCase() === ticker);
    const topFlow = tickerFlow.slice(0, 20);

    const priceConfirmation = keyLevels ? detectPriceActionConfirmation(
      candles, keyLevels.current_price ?? 0, keyLevels, ticker
    ) : null;

    const darkpoolSummary = darkpool.slice(0, 10).map((d: any) => ({
      price: d.price, size: d.size, volume: d.volume,
      notional: d.notional_value, side: d.trade_type, date: d.tracking_timestamp,
    }));

    const totalDpVolume = darkpool.reduce((sum: number, d: any) => sum + (parseFloat(d.volume) || 0), 0);
    const totalDpNotional = darkpool.reduce((sum: number, d: any) => sum + (parseFloat(d.notional_value) || 0), 0);
    const avgDpPrice = darkpool.length > 0
      ? darkpool.reduce((sum: number, d: any) => sum + (parseFloat(d.price) || 0), 0) / darkpool.length
      : null;

    const totalCallPrem = tickerFlow.filter((f: any) => f.type === "call").reduce((s: number, f: any) => s + (f.total_premium || 0), 0);
    const totalPutPrem = tickerFlow.filter((f: any) => f.type === "put").reduce((s: number, f: any) => s + (f.total_premium || 0), 0);
    const totalSweeps = tickerFlow.filter((f: any) => f.has_sweep).length;
    const avgAggression = tickerFlow.length > 0
      ? Math.round(tickerFlow.reduce((s: number, f: any) => s + (f.ask_aggression_pct || 0), 0) / tickerFlow.length)
      : 0;

    const now = getNowEastern();
    const analysisPrompt = `You are JORTRADE's AI trade assistant. Analyze ${ticker} and provide a comprehensive market structure breakdown.

RULES:
- You are NOT a financial advisor. This is educational analysis only.
- Be direct, confident, and actionable in your tone.
- If there's a clear setup, call it out with specific levels.
- If there's no play right now, say so honestly and explain what conditions to watch for.
- Use $ signs for prices. Be precise with numbers.
- Keep the analysis focused and structured.

Respond in this exact JSON format:
{
  "verdict": "BULLISH" | "BEARISH" | "NEUTRAL" | "NO PLAY",
  "verdict_summary": "One sentence on the overall setup (max 20 words)",
  "market_structure": "2-3 sentences on the current price action and structure",
  "flow_analysis": "2-3 sentences analyzing the options flow. What are whales doing? Call/put ratio? Sweeps?",
  "dark_pool_analysis": "1-2 sentences on dark pool activity and what it implies",
  "key_levels_analysis": "2-3 sentences on important support/resistance, VWAP, and pivot levels",
  "trade_setup": {
    "has_play": true | false,
    "action": "Buy TICKER $STRIKE Call/Put" or null,
    "entry": "Entry condition" or null,
    "target": "$X.XX" or null,
    "stop": "$X.XX" or null,
    "timeframe": "Day Trade" | "Swing" | null,
    "confidence": "High" | "Medium" | "Low" | null,
    "reasoning": "Why this trade makes sense (1-2 sentences)" or null
  },
  "watch_for": "What catalysts or conditions to monitor going forward (1-2 sentences)"
}`;

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: analysisPrompt,
      messages: [{
        role: "user",
        content: `Analyze ${ticker} right now. Here's the live data:\n\n--- CURRENT TIME ---\n${now}\n\n--- KEY LEVELS ---\n\`\`\`json\n${JSON.stringify(keyLevels, null, 2)}\n\`\`\`\n\n--- PRICE ACTION ---\nCandles (1min): ${candles.length} bars\n${priceConfirmation ? `Pattern: ${priceConfirmation.pattern || "None"}\nGamma Zone: ${priceConfirmation.gamma_zone} — ${priceConfirmation.gamma_description}` : "No confirmation data"}\n\n--- OPTIONS FLOW (${tickerFlow.length} alerts) ---\nTotal Call Premium: $${(totalCallPrem / 1000).toFixed(0)}K\nTotal Put Premium: $${(totalPutPrem / 1000).toFixed(0)}K\nSweeps: ${totalSweeps}\nAvg Ask Aggression: ${avgAggression}%\n\`\`\`json\n${JSON.stringify(topFlow.slice(0, 10), null, 2)}\n\`\`\`\n\n--- DARK POOL (${darkpool.length} trades) ---\nTotal Volume: ${totalDpVolume.toLocaleString()}\nTotal Notional: $${(totalDpNotional / 1e6).toFixed(1)}M\nAvg Price: $${avgDpPrice?.toFixed(2) || "N/A"}\n\`\`\`json\n${JSON.stringify(darkpoolSummary.slice(0, 5), null, 2)}\n\`\`\``
      }],
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";

    let analysis: any = null;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysis = JSON.parse(jsonMatch[0]);
    } catch {
      analysis = { verdict: "ERROR", verdict_summary: "Failed to parse analysis", market_structure: content };
    }

    console.log(`[analyze] ${ticker} complete in ${Date.now() - t0}ms — verdict: ${analysis?.verdict}`);

    res.json({
      ticker,
      timestamp: now,
      analysis,
      data: {
        key_levels: keyLevels,
        price_confirmation: priceConfirmation,
        flow_summary: {
          total_alerts: tickerFlow.length,
          call_premium: totalCallPrem,
          put_premium: totalPutPrem,
          sweeps: totalSweeps,
          avg_aggression: avgAggression,
          top_flow: topFlow.slice(0, 5),
        },
        dark_pool: {
          trades: darkpool.length,
          total_volume: totalDpVolume,
          total_notional: totalDpNotional,
          avg_price: avgDpPrice,
          recent: darkpoolSummary.slice(0, 5),
        },
      },
    });
  } catch (err: any) {
    console.error(`[analyze] ${ticker} error:`, err.message);
    res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

const ALGO_VERSION_MAP: Record<string, string> = {
  "2026-03-26": "v1",
  "2026-03-27": "v1",
  "2026-03-28": "v1",
  "2026-03-29": "v1",
  "2026-03-30": "v2",
  "2026-03-31": "v2",
  "2026-04-01": "v2",
  "2026-04-02": "v5",
  "2026-04-03": "v5",
};
const ALGO_VERSION_DEFAULT = "v5";

router.get("/whale/signals/calendar", async (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("ETag", `W/"cal-${Date.now()}"`);
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, 1000);
    const result = await dbQuery(
      `SELECT DISTINCT ON (so.ticker, so.strike, so.option_type, DATE(so.detected_at AT TIME ZONE 'America/New_York'))
              so.id, so.ticker, so.signal_type, so.option_type AS "put_call", so.confidence, so.strike, so.expiry,
              so.outcome, so.created_at, so.detected_at, so.resolved_at, so.category, so.price_at_signal,
              so.target AS target_price, so.invalidation, so.entry_trigger, so.direction,
              so.max_favorable_price, so.mfe_percent, so.max_adverse_price,
              so.entry_price_reached, so.invalidation_breached, so.pct_past_invalidation,
              so.time_at_target, so.entry_price, so.key_level, so.sr_level,
              so.is_biddie_pick, so.signal_quality,
              sr.status AS review_status, sr.note AS review_note
       FROM signal_outcomes so
       LEFT JOIN signal_reviews sr ON sr.signal_id = so.id::text
       WHERE so.signal_source = 'replit' AND COALESCE(so.category, '') != 'spread'
       ORDER BY so.ticker, so.strike, so.option_type, DATE(so.detected_at AT TIME ZONE 'America/New_York'),
                CASE WHEN so.outcome IN ('hit','partial_hit') THEN 0 WHEN so.outcome IN ('missed','near_miss') THEN 1 ELSE 2 END,
                so.detected_at ASC`,
      []
    );
    const allRows = result?.rows || [];
    const limited = allRows.slice(0, limit);
    const statsMap: Record<string, number> = {};
    for (const row of allRows) {
      const o = row.outcome || "pending";
      statsMap[o] = (statsMap[o] || 0) + 1;
    }
    const sortedRows = [...allRows].sort((a: any, b: any) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    );
    res.json({
      signals: sortedRows.slice(0, limit),
      stats: statsMap,
      algoVersions: ALGO_VERSION_MAP,
      algoVersionDefault: ALGO_VERSION_DEFAULT,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/whale/signals/detail/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dbQuery(
      `SELECT id, ticker, signal_type, option_type, confidence, strike, expiry,
              outcome, created_at, detected_at, resolved_at, category, price_at_signal,
              target, invalidation, entry_trigger, reason, direction,
              max_favorable_price, mfe_percent, max_adverse_price,
              entry_price_reached, invalidation_breached, pct_past_invalidation,
              time_at_target, entry_price, key_level, sr_level,
              conviction_score, reinforcement_count, last_reinforced_at, is_biddie_pick,
              target_near, signal_source, suggested_trade, tags
       FROM signal_outcomes WHERE id = $1`,
      [id]
    );
    if (!result?.rows?.length) return res.status(404).json({ error: "Signal not found" });
    const signal = result.rows[0];
    const ticker = signal.ticker;
    const detectedAt = new Date(signal.detected_at || signal.created_at);
    const now = new Date();
    const hoursAlive = (now.getTime() - detectedAt.getTime()) / (1000 * 60 * 60);
    const daysAlive = hoursAlive / 24;

    let priceHistory: any = null;
    try {
      const polygonKey = getPolygonKey();
      if (polygonKey) {
        const fromDate = detectedAt.toISOString().split("T")[0];
        const toDate = now.toISOString().split("T")[0];

        if (daysAlive <= 2) {
          const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/5/minute/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=5000&apiKey=${polygonKey}`;
          const resp = await fetch(url);
          if (resp.ok) {
            const data = await resp.json();
            const bars = (data.results || [])
              .filter((b: any) => b.t >= detectedAt.getTime())
              .map((b: any) => ({
                time: new Date(b.t).toISOString(),
                open: b.o,
                high: b.h,
                low: b.l,
                close: b.c,
                volume: b.v,
              }));
            const signalTs = detectedAt.getTime();
            let highSince = -Infinity, lowSince = Infinity, currentPrice = 0;
            for (const bar of bars) {
              const barTs = new Date(bar.time).getTime();
              if (barTs >= signalTs) {
                if (bar.high > highSince) highSince = bar.high;
                if (bar.low < lowSince) lowSince = bar.low;
                currentPrice = bar.close;
              }
            }
            priceHistory = {
              bars,
              highSince: highSince === -Infinity ? null : Math.round(highSince * 100) / 100,
              lowSince: lowSince === Infinity ? null : Math.round(lowSince * 100) / 100,
              currentPrice: Math.round(currentPrice * 100) / 100,
              resolution: "5min",
            };
          }
        } else {
          const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/hour/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=5000&apiKey=${polygonKey}`;
          const resp = await fetch(url);
          if (resp.ok) {
            const data = await resp.json();
            const bars = (data.results || [])
              .filter((b: any) => b.t >= detectedAt.getTime())
              .map((b: any) => ({
                time: new Date(b.t).toISOString(),
                open: b.o,
                high: b.h,
                low: b.l,
                close: b.c,
                volume: b.v,
              }));
            let highSince = -Infinity, lowSince = Infinity, currentPrice = 0;
            for (const bar of bars) {
              if (bar.high > highSince) highSince = bar.high;
              if (bar.low < lowSince) lowSince = bar.low;
              currentPrice = bar.close;
            }
            priceHistory = {
              bars,
              highSince: highSince === -Infinity ? null : Math.round(highSince * 100) / 100,
              lowSince: lowSince === Infinity ? null : Math.round(lowSince * 100) / 100,
              currentPrice: Math.round(currentPrice * 100) / 100,
              resolution: "1hour",
            };
          }
        }
      }
    } catch (e) {
      console.warn("[signal-detail] price history fetch error:", e);
    }

    const entryPrice = signal.price_at_signal ? parseFloat(signal.price_at_signal) : null;
    const isBullish = (signal.option_type || "").toLowerCase() === "call" ||
                      (signal.direction || signal.signal_type || "").toLowerCase() === "bullish";
    const resolvedAt = signal.resolved_at ? new Date(signal.resolved_at) : null;
    const timeToResolve = resolvedAt ? ((resolvedAt.getTime() - detectedAt.getTime()) / (1000 * 60 * 60)).toFixed(1) : null;

    let explanation = "";
    if (signal.outcome === "hit") {
      if (isBullish && priceHistory?.highSince && entryPrice) {
        const pctMove = (((priceHistory.highSince - entryPrice) / entryPrice) * 100).toFixed(2);
        explanation = `Price moved up from $${entryPrice.toFixed(2)} to a high of $${priceHistory.highSince} (+${pctMove}%), reaching the target zone. Resolved in ${timeToResolve || "?"}h.`;
      } else if (!isBullish && priceHistory?.lowSince && entryPrice) {
        const pctMove = (((entryPrice - priceHistory.lowSince) / entryPrice) * 100).toFixed(2);
        explanation = `Price dropped from $${entryPrice.toFixed(2)} to a low of $${priceHistory.lowSince} (-${pctMove}%), reaching the target zone. Resolved in ${timeToResolve || "?"}h.`;
      } else {
        explanation = `Signal hit target. Resolved in ${timeToResolve || "?"}h.`;
      }
    } else if (signal.outcome === "missed") {
      if (isBullish && priceHistory?.lowSince && entryPrice) {
        explanation = `Price dropped from $${entryPrice.toFixed(2)} to a low of $${priceHistory.lowSince}, breaching the invalidation level. Resolved in ${timeToResolve || "?"}h.`;
      } else if (!isBullish && priceHistory?.highSince && entryPrice) {
        explanation = `Price rose from $${entryPrice.toFixed(2)} to a high of $${priceHistory.highSince}, breaching the invalidation level. Resolved in ${timeToResolve || "?"}h.`;
      } else {
        explanation = `Signal invalidation was breached. Resolved in ${timeToResolve || "?"}h.`;
      }
    } else if (signal.outcome === "partial_hit") {
      if (isBullish && priceHistory?.highSince && entryPrice) {
        const pctMove = (((priceHistory.highSince - entryPrice) / entryPrice) * 100).toFixed(2);
        explanation = `Price moved favorably from $${entryPrice.toFixed(2)} to $${priceHistory.highSince.toFixed(2)} (+${pctMove}%) but didn't reach the full target. Significant move in the right direction. Resolved in ${timeToResolve || "?"}h.`;
      } else if (!isBullish && priceHistory?.lowSince && entryPrice) {
        const pctMove = (((entryPrice - priceHistory.lowSince) / entryPrice) * 100).toFixed(2);
        explanation = `Price moved favorably from $${entryPrice.toFixed(2)} to $${priceHistory.lowSince.toFixed(2)} (-${pctMove}%) but didn't reach the full target. Significant move in the right direction. Resolved in ${timeToResolve || "?"}h.`;
      } else {
        explanation = `Signal expired with a significant favorable move but didn't reach the target. Resolved in ${timeToResolve || "?"}h.`;
      }
    } else if (signal.outcome === "expired") {
      explanation = `Option expired without hitting target or invalidation. Price didn't move significantly in either direction.`;
    } else {
      explanation = `Signal is still being tracked. ${hoursAlive.toFixed(1)} hours since detection.`;
    }

    const targetPrice = parsePrice(signal.target);
    const invalidationPriceVal = parsePrice(signal.invalidation);
    const alertPrice = signal.price_at_signal ? parseFloat(signal.price_at_signal) : null;
    const mfp = signal.max_favorable_price ? parseFloat(signal.max_favorable_price) : null;

    let pctProfitAchieved: number | null = null;
    if (alertPrice && mfp && alertPrice > 0) {
      if (isBullish) {
        pctProfitAchieved = Math.round(((mfp - alertPrice) / alertPrice) * 10000) / 100;
      } else {
        pctProfitAchieved = Math.round(((alertPrice - mfp) / alertPrice) * 10000) / 100;
      }
    }

    let pctToTarget: number | null = null;
    if (alertPrice && targetPrice && alertPrice > 0) {
      const totalDistance = Math.abs(targetPrice - alertPrice);
      if (totalDistance > 0 && mfp) {
        const favorable = isBullish ? mfp - alertPrice : alertPrice - mfp;
        pctToTarget = Math.min(Math.round((Math.max(0, favorable) / totalDistance) * 10000) / 100, 999);
      }
    }

    res.json({
      signal: {
        ...signal,
        isBullish,
        entryPrice,
        timeToResolve: timeToResolve ? `${timeToResolve}h` : null,
        explanation,
        alertPrice,
        targetPrice,
        invalidationPrice: invalidationPriceVal,
        pctProfitAchieved,
        pctToTarget,
        entryPriceReached: signal.entry_price_reached || false,
        invalidationBreached: signal.invalidation_breached || false,
        pctPastInvalidation: signal.pct_past_invalidation ? parseFloat(signal.pct_past_invalidation) : null,
        timeAtTarget: signal.time_at_target || null,
      },
      priceHistory,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/whale/signals/export", async (req, res) => {
  try {
    const result = await dbQuery(
      `SELECT id, ticker, signal_type, option_type, direction, confidence, conviction_score,
              category, strike, expiry, premium, price_at_signal,
              target, invalidation, entry_trigger, reason,
              outcome, tags, detected_at, created_at, resolved_at,
              max_favorable_price, mfe_percent
       FROM signal_outcomes
       WHERE signal_source = 'replit' AND COALESCE(category, '') != 'spread'
       ORDER BY detected_at DESC`
    );

    const parseTargetPrice = (t: string | null): string => {
      if (!t) return "";
      const m = t.match(/\$([0-9]+\.?[0-9]*)/);
      return m ? m[1] : "";
    };
    const parseInvalidationPrice = (inv: string | null): string => {
      if (!inv) return "";
      const m = inv.match(/\$([0-9]+\.?[0-9]*)/);
      return m ? m[1] : "";
    };

    const rows = (result?.rows || []).map((r: any) => {
      const targetVal = parseFloat(parseTargetPrice(r.target));
      const alertPrice = r.price_at_signal ? parseFloat(r.price_at_signal) : null;
      let pctToTarget = "";
      if (targetVal && alertPrice && alertPrice > 0) {
        pctToTarget = (((targetVal - alertPrice) / alertPrice) * 100).toFixed(2);
      }
      return {
        ...r,
        target_price_numeric: targetVal || "",
        invalidation_price_numeric: parseInvalidationPrice(r.invalidation),
        pct_to_target: pctToTarget,
      };
    });

    res.json({ signals: rows, count: rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/whale/signals/history", async (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("ETag", `W/"hist-${Date.now()}"`);
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
    const result = await dbQuery(
      `SELECT d.*, sr.status AS review_status, sr.note AS review_note
       FROM signal_outcomes d
       LEFT JOIN signal_reviews sr ON sr.signal_id = d.id::text
       WHERE d.signal_source = 'replit' AND COALESCE(d.category, '') != 'spread'
       ORDER BY d.detected_at DESC LIMIT $1`,
      [limit]
    );
    const countResult = await dbQuery(
      `SELECT
        COUNT(*) FILTER (WHERE outcome = 'pending' OR outcome IS NULL) AS pending_count,
        COUNT(*) AS total_count
       FROM signal_outcomes WHERE signal_source = 'replit' AND COALESCE(category, '') != 'spread'`
    );
    const counts = countResult?.rows?.[0] || {};
    res.json(attachExecutionVerdicts({
      signals: result?.rows || [],
      count: result?.rows?.length || 0,
      totalPending: parseInt(counts.pending_count) || 0,
      totalSignals: parseInt(counts.total_count) || 0,
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

interface PriceHistory {
  current: number;
  highSince: number;
  lowSince: number;
}

async function fetchPriceHistory(ticker: string, sinceDate: string): Promise<PriceHistory | null> {
  try {
    const since = new Date(sinceDate);
    const now = new Date();
    const daysDiff = Math.max(1, Math.ceil((now.getTime() - since.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const mult = daysDiff <= 7 ? 15 : 1;
    const span = daysDiff <= 7 ? "minute" : "day";

    const bars = await fetchPolygonAggs(ticker, mult, span, fmtDate(since), fmtDate(now));
    if (bars.length === 0) return null;

    const sinceTs = since.getTime() / 1000;
    const sinceHourUTC = since.getUTCHours();
    const marketOpenUTC = 13.5;
    const marketCloseUTC = 20;
    const signalAfterHours = sinceHourUTC >= marketCloseUTC || sinceHourUTC < marketOpenUTC;

    let effectiveSinceTs = sinceTs;
    if (signalAfterHours) {
      const nextDay = new Date(since);
      if (sinceHourUTC >= marketCloseUTC) {
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      }
      nextDay.setUTCHours(13, 30, 0, 0);
      const dayOfWeek = nextDay.getUTCDay();
      if (dayOfWeek === 0) nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      if (dayOfWeek === 6) nextDay.setUTCDate(nextDay.getUTCDate() + 2);
      effectiveSinceTs = nextDay.getTime() / 1000;
    }

    let highSince = -Infinity;
    let lowSince = Infinity;
    let hasDataAfterSignal = false;
    for (const b of bars) {
      if (b.timestamp >= effectiveSinceTs) {
        if (b.high > highSince) { highSince = b.high; hasDataAfterSignal = true; }
        if (b.low < lowSince) { lowSince = b.low; hasDataAfterSignal = true; }
      }
    }

    const rtData = priceMonitor.getPrice(ticker);
    let current: number | null = null;
    if (rtData && Date.now() - rtData.lastUpdate < 120000) {
      current = rtData.price;
    }
    if (!current) {
      const snap = await fetchPolygonSnapshot(ticker);
      if (snap) current = snap.price;
    }
    if (!current) {
      current = bars[bars.length - 1].close;
    }
    if (!current) return null;

    if (!hasDataAfterSignal) {
      highSince = current;
      lowSince = current;
    }

    return {
      current: Math.round(current * 100) / 100,
      highSince: Math.round(highSince * 100) / 100,
      lowSince: Math.round(lowSince * 100) / 100,
    };
  } catch {
    return null;
  }
}

function parsePrice(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseTargetRange(target: string | null): { low: number | null; high: number | null } {
  if (!target) return { low: null, high: null };
  const priceMatches = target.match(/\$[\d,]+\.?\d*/g);
  let values: number[] = [];
  if (priceMatches && priceMatches.length > 0) {
    values = priceMatches.map(p => parseFloat(p.replace(/[$,]/g, ""))).filter(n => !isNaN(n) && n > 0);
  }
  if (values.length === 0) {
    const nums = target.match(/\d+\.?\d*/g);
    if (!nums) return { low: null, high: null };
    values = nums.map(Number).filter(n => !isNaN(n) && n >= 5);
  }
  if (values.length === 0) return { low: null, high: null };
  if (values.length === 1) return { low: values[0], high: values[0] };
  return { low: Math.min(...values), high: Math.max(...values) };
}

router.post("/whale/verify-signals", async (_req, res) => {
  try {
    const pendingResult = await dbQuery(
      `SELECT * FROM signal_outcomes WHERE outcome = 'pending' ORDER BY created_at DESC LIMIT 500`
    );

    if (!pendingResult) {
      res.status(500).json({ error: "Failed to fetch pending signals" });
      return;
    }

    const pending = pendingResult.rows;
    if (!pending || pending.length === 0) {
      res.json({ verified: 0, hits: 0, misses: 0, expired: 0, remaining_pending: 0 });
      return;
    }

    const signalPriceMap: Record<string, PriceHistory> = {};
    const spxTickerSet2 = new Set(["SPX", "SPXW"]);
    await Promise.all(
      pending.map(async (s: any) => {
        const sinceDate = s.detected_at || s.created_at;
        const lookupTicker = spxTickerSet2.has(s.ticker) ? "I:SPX" : s.ticker;
        const history = await fetchPriceHistory(lookupTicker, sinceDate);
        if (history) signalPriceMap[s.id] = history;
      })
    );

    let hits = 0, partialHits = 0, misses = 0, expired = 0, updateErrors = 0;
    const now = new Date();

    for (const signal of pending) {
      const history = signalPriceMap[signal.id];
      if (!history) continue;

      const target = parseTargetRange(signal.target_zone || signal.target);
      const invalidationPrice = parsePrice(signal.invalidation);
      const entryPrice = parsePrice(signal.entry_trigger);
      const signalPrice = signal.price_at_signal ? parseFloat(signal.price_at_signal) : null;
      const putCall = (signal.put_call || "").toUpperCase();
      const isBullish = putCall === "CALL" ? true : putCall === "PUT" ? false : signal.signal_type === "bullish";

      const expiryDate = signal.expiry ? new Date(signal.expiry) : null;
      const isExpired = expiryDate && expiryDate < now;

      const createdAt = new Date(signal.created_at || signal.detected_at);
      const hoursAlive = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      const dteHoursToExpiry = expiryDate ? (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60) : 999;
      const isShortDated = dteHoursToExpiry <= 48;
      const MIN_HOURS_BEFORE_MISS = isShortDated ? 0.25 : 2;
      const canMiss = hoursAlive >= MIN_HOURS_BEFORE_MISS || isExpired;

      let outcome: string | null = null;
      let outcomePrice = history.current;
      const refPrice = signalPrice || entryPrice || 0;

      const isSpxTicker = new Set(["SPX", "SPXW", "NDX", "QQQ"]).has(signal.ticker);
      const ADV_MOVE_PCT_M = isSpxTicker ? 0.0075 : 0.025;

      let mfeToTargetM: number | null = null;
      if (refPrice > 0 && target.low && target.high) {
        const tgtP = isBullish ? Math.min(target.low, target.high) : Math.max(target.low, target.high);
        const distToTarget = Math.abs(tgtP - refPrice);
        if (distToTarget > 0) {
          const favorable = isBullish ? (history.highSince - refPrice) : (refPrice - history.lowSince);
          mfeToTargetM = Math.max(0, (favorable / distToTarget) * 100);
        }
      }

      if (mfeToTargetM !== null) {
        if (mfeToTargetM >= 75) {
          outcome = "hit";
          outcomePrice = isBullish ? history.highSince : history.lowSince;
        } else if (mfeToTargetM >= 50) {
          outcome = "partial_hit";
          outcomePrice = isBullish ? history.highSince : history.lowSince;
        }
      }

      if (!outcome && !target.low && !target.high && refPrice > 0) {
        const MIN_FALLBACK_PCT = 0.015;
        if (isBullish && history.highSince >= refPrice * (1 + MIN_FALLBACK_PCT)) {
          outcome = "hit";
          outcomePrice = history.highSince;
        } else if (!isBullish && history.lowSince <= refPrice * (1 - MIN_FALLBACK_PCT)) {
          outcome = "hit";
          outcomePrice = history.lowSince;
        }
      }

      let effectiveInvM = invalidationPrice;
      if (!effectiveInvM && refPrice > 0) {
        effectiveInvM = isBullish
          ? refPrice * (1 - ADV_MOVE_PCT_M)
          : refPrice * (1 + ADV_MOVE_PCT_M);
      }

      if (!outcome && canMiss && effectiveInvM && refPrice > 0) {
        const INV_BUFFER_PCT = 0.0025;
        const invZone = isBullish
          ? effectiveInvM * (1 - INV_BUFFER_PCT)
          : effectiveInvM * (1 + INV_BUFFER_PCT);
        const invMakesDirectionalSense = isBullish
          ? effectiveInvM < refPrice
          : effectiveInvM > refPrice;
        if (invMakesDirectionalSense) {
          const currentlyBreached = isBullish
            ? history.current <= invZone
            : history.current >= invZone;
          const didBreachZone = isBullish
            ? history.lowSince <= invZone
            : history.highSince >= invZone;
          const dteHours = expiryDate ? (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60) : 0;
          const isLongDated = dteHours > 48;
          if (isExpired && didBreachZone) {
            outcome = (mfeToTargetM !== null && mfeToTargetM >= 30) ? "near_miss" : "missed";
            outcomePrice = isBullish ? history.lowSince : history.highSince;
          } else if (currentlyBreached && didBreachZone && !isLongDated) {
            outcome = (mfeToTargetM !== null && mfeToTargetM >= 30) ? "near_miss" : "missed";
            outcomePrice = isBullish ? history.lowSince : history.highSince;
          } else if (currentlyBreached && didBreachZone && isLongDated) {
            const breachPct = isBullish
              ? ((invZone - history.current) / invZone) * 100
              : ((history.current - invZone) / invZone) * 100;
            if (breachPct >= 1.0) {
              outcome = (mfeToTargetM !== null && mfeToTargetM >= 30) ? "near_miss" : "missed";
              outcomePrice = isBullish ? history.lowSince : history.highSince;
            }
          }
        }
      }

      if (!outcome && signal.outcome === "missed" && !isExpired && effectiveInvM && refPrice > 0) {
        const recovered = isBullish
          ? history.current > effectiveInvM
          : history.current < effectiveInvM;
        if (recovered) {
          outcome = "pending_revert";
        }
      }

      const expiryPlusClose = expiryDate ? new Date(expiryDate.getTime() + 20 * 60 * 60 * 1000) : null;
      const isActuallyExpired = expiryPlusClose ? expiryPlusClose < now : false;
      if (!outcome && (isExpired || isActuallyExpired)) {
        if (!isActuallyExpired) {
          // not expired yet
        } else {
          if (mfeToTargetM !== null) {
            if (mfeToTargetM >= 75) outcome = "hit";
            else if (mfeToTargetM >= 50) outcome = "partial_hit";
            else if (mfeToTargetM >= 30) outcome = "near_miss";
            else outcome = "missed";
          } else {
            const mfePricePct = refPrice > 0
              ? (isBullish ? ((history.highSince - refPrice) / refPrice) * 100 : ((refPrice - history.lowSince) / refPrice) * 100)
              : 0;
            if (mfePricePct >= 1.5) outcome = "partial_hit";
            else outcome = "expired";
          }
        }
      }

      if (outcome === "pending_revert") {
        await dbQuery(
          `UPDATE signal_outcomes SET outcome = 'pending', resolved_at = NULL, trade_status = 'active', status_updated_at = $1 WHERE id = $2`,
          [now.toISOString(), signal.id]
        );
        await dbQuery(
          `UPDATE user_trades SET signal_outcome = 'pending', resolved_at = NULL WHERE signal_id = $1`,
          [signal.id]
        );
        console.log(`[verify] ${signal.ticker} ${signal.option_type} $${signal.strike}: REVERTED missed → pending (price recovered above invalidation)`);
      } else if (outcome) {
        let newTradeStatus = "watching";
        if (outcome === "hit") newTradeStatus = "hit";
        else if (outcome === "partial_hit") newTradeStatus = "partial";
        else if (outcome === "near_miss") newTradeStatus = "near_miss";
        else if (outcome === "missed") newTradeStatus = "miss";
        else if (outcome === "expired") newTradeStatus = "expired";

        const updateResult = await dbQuery(
          `UPDATE signal_outcomes SET outcome = $1, resolved_at = $2, trade_status = $3 WHERE id = $4`,
          [outcome, now.toISOString(), newTradeStatus, signal.id]
        );

        if (!updateResult) {
          updateErrors++;
          continue;
        }

        if (outcome === "hit") hits++;
        else if (outcome === "partial_hit") partialHits++;
        else if (outcome === "near_miss") partialHits++;
        else if (outcome === "missed") misses++;
        else if (outcome === "expired") expired++;

        await dbQuery(
          `UPDATE user_trades SET signal_outcome = $1, resolved_at = $2 WHERE signal_id = $3`,
          [outcome, now.toISOString(), signal.id]
        );
      }
    }

    let nearMisses = 0;
    for (const signal of pending) {
      if (signal.outcome === "near_miss") nearMisses++;
    }
    const remaining = pending.length - hits - partialHits - misses - expired - updateErrors;
    res.json({ verified: pending.length, hits, partial_hits: partialHits, misses, expired, near_misses: nearMisses, remaining_pending: remaining, errors: updateErrors > 0 ? updateErrors : undefined });
  } catch (err: any) {
    console.error("Verify signals error:", err);
    res.status(500).json({ error: err.message ?? "Verification failed" });
  }
});

router.post("/whale/fix-targets", async (_req, res) => {
  try {
    const r1 = await dbQuery(`
      UPDATE signal_outcomes 
      SET target = '$' || ROUND(strike, 2)::text
      WHERE signal_source = 'replit' AND strike IS NOT NULL
    `);
    const r2 = await dbQuery(`
      WITH parsed AS (
        SELECT id, ticker, direction, price_at_signal, max_favorable_price,
          (regexp_matches(target, '\\$([0-9]+\\.?[0-9]*)'))[1]::numeric as target_price
        FROM signal_outcomes 
        WHERE signal_source = 'replit' AND outcome = 'hit' AND price_at_signal IS NOT NULL 
          AND target IS NOT NULL AND max_favorable_price IS NOT NULL
      )
      UPDATE signal_outcomes so
      SET outcome = 'pending', resolved_at = NULL
      FROM parsed p
      WHERE so.id = p.id
        AND (
          (p.direction = 'bullish' AND p.max_favorable_price < p.target_price)
          OR (p.direction = 'bearish' AND p.max_favorable_price > p.target_price)
        )
    `);
    res.json({ ok: true, targetsSetToStrike: r1.rowCount, falseHitsReset: r2.rowCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/backfill-mfe", async (_req, res) => {
  try {
    const result = await dbQuery(
      `SELECT * FROM signal_outcomes WHERE signal_source = 'replit' AND price_at_signal IS NOT NULL ORDER BY detected_at DESC`
    );
    if (!result || result.rows.length === 0) {
      res.json({ updated: 0, message: "No signals to backfill" });
      return;
    }

    const signals = result.rows;
    const tickers = [...new Set(signals.map((s: any) => s.ticker))];
    const priceMap: Record<string, PriceHistory> = {};

    for (const t of tickers) {
      const oldest = signals
        .filter((s: any) => s.ticker === t)
        .reduce((min: string, s: any) => {
          const d = s.detected_at || s.created_at;
          return d < min ? d : min;
        }, signals[0].detected_at || signals[0].created_at);
      const history = await fetchPriceHistory(t, oldest);
      if (history) priceMap[t] = history;
    }

    let updated = 0;
    const details: any[] = [];
    for (const signal of signals) {
      const history = priceMap[signal.ticker];
      if (!history) continue;

      const signalPrice = parseFloat(signal.price_at_signal);
      if (!signalPrice || signalPrice <= 0) continue;

      const putCall = (signal.put_call || signal.option_type || "").toUpperCase();
      const isBullish = putCall === "CALL" ? true : putCall === "PUT" ? false : signal.direction === "bullish";

      const mfPrice = isBullish ? history.highSince : history.lowSince;
      const prevMfp = signal.max_favorable_price ? parseFloat(signal.max_favorable_price) : null;
      const newMfp = isBullish
        ? Math.max(mfPrice, prevMfp ?? -Infinity)
        : Math.min(mfPrice, prevMfp ?? Infinity);

      const target = parseTargetRange(signal.target_zone || signal.target);
      let mfePct: number | null = null;
      if (target.low && target.high) {
        if (isBullish) {
          const targetP = target.low;
          const denom = targetP - signalPrice;
          if (denom > 0) mfePct = Math.round(((newMfp - signalPrice) / denom) * 10000) / 100;
        } else {
          const targetP = target.high;
          const denom = signalPrice - targetP;
          if (denom > 0) mfePct = Math.round(((signalPrice - newMfp) / denom) * 10000) / 100;
        }
      }

      await dbQuery(
        `UPDATE signal_outcomes SET max_favorable_price = $1, mfe_percent = $2 WHERE id = $3`,
        [newMfp, mfePct, signal.id]
      );
      updated++;
      details.push({ ticker: signal.ticker, direction: signal.direction, entry: signalPrice, mfp: newMfp, mfe: mfePct });
    }

    res.json({ updated, total: signals.length, details });
  } catch (err: any) {
    console.error("Backfill MFE error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Morning Outlook ──────────────────────────────────────────────────────────

async function fetchPremarketSnapshot(tickers: string[]): Promise<Record<string, {
  preMarketPrice: number | null;
  prevClose: number;
  gap: number | null;
  gapPct: number | null;
  high52w: number | null;
  low52w: number | null;
  source: string;
  bid?: number;
  ask?: number;
  dayVolume?: number;
}>> {
  const snapshot: Record<string, any> = {};
  const polygonKey = getPolygonKey();

  if (!polygonKey) return snapshot;

  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += 20) {
    batches.push(tickers.slice(i, i + 20));
  }

  for (const batch of batches) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${batch.join(",")}&apiKey=${polygonKey}`;
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) continue;

      const json = await resp.json() as any;
      if (json.status !== "OK" || !Array.isArray(json.tickers)) continue;

      for (const t of json.tickers) {
        const ticker = t.ticker;
        if (!ticker) continue;

        const lastTradePrice = t.lastTrade?.p ?? 0;
        const dayClose = t.day?.c ?? 0;
        const prevClose = t.prevDay?.c ?? 0;
        const livePrice = lastTradePrice || dayClose;

        if (livePrice <= 0) continue;

        let source = "real-time";
        const lastTradeTs = t.lastTrade?.t ?? 0;
        const nowNano = Date.now() * 1_000_000;
        const ageMs = lastTradeTs > 0 ? (nowNano - lastTradeTs) / 1_000_000 : Infinity;

        if (ageMs < 60000) {
          source = "real-time";
        } else if (ageMs < 3600000) {
          source = "recent";
        } else {
          const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York", hour: "2-digit", hour12: false,
          }).formatToParts(new Date());
          const etHour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
          if (etHour >= 4 && etHour < 9) {
            source = "pre-market";
          } else if (etHour >= 16 || etHour < 4) {
            source = "after-hours";
          } else {
            source = "regular-close";
          }
        }

        const gap = prevClose > 0 ? Math.round((livePrice - prevClose) * 100) / 100 : null;
        const gapPct = prevClose > 0 ? Math.round(((livePrice - prevClose) / prevClose) * 10000) / 100 : null;

        snapshot[ticker] = {
          preMarketPrice: Math.round(livePrice * 100) / 100,
          prevClose: Math.round(prevClose * 100) / 100,
          gap,
          gapPct,
          high52w: null,
          low52w: null,
          source,
          bid: t.lastQuote?.p ?? undefined,
          ask: t.lastQuote?.P ?? undefined,
          dayVolume: t.day?.v ?? undefined,
        };
      }
    } catch {}
  }

  return snapshot;
}

const MORNING_OUTLOOK_SYSTEM = `You are Biddie AI — the resident trading homie for the JORTRADE community chat. Every morning you drop in to say what's up and get the crew ready for the day.

YOUR PERSONALITY: You're that friend who genuinely loves trading and wakes up excited to check the tape. You're sharp, confident, but never arrogant. You hype the crew up, crack jokes, keep it real, and make people feel like they're part of something. Think "your trading bestie who actually knows their stuff." You use slang naturally — "fam", "let's eat", "we locked in", "the tape is talking" — but you're never corny about it.

YOUR JOB: Say good morning to the chat, set the vibe for the day, and give a quick pre-market read. This is a COMMUNITY moment first, market briefing second.

FORMAT:
1. **GM Chat** — Start with a warm, energetic good morning. Reference the day (Monday motivation, hump day, Friday let's get this bread, etc.). Make people feel welcome. 1-2 sentences. Example: "GM fam!! Happy Friday — let's close this week strong 💪 Hope everyone's coffee is hitting right because the tape has some things to say today..."

2. **Pre-Market Vibe** — What's the market looking like? SPY, QQQ gaps, overall mood. Use ACTUAL pre-market prices provided. Keep it conversational. "SPY gapping down -0.8% to $643... bears woke up hungry today"

3. **What I'm Watching** — 2-3 tickers or themes that caught your eye in the flow. Real numbers, real takes. Keep it brief.

4. **Key Levels** — Quick support/resistance for SPY and any hot ticker. "SPY needs to hold $644 or we're visiting $641 real quick"

5. **The Move** — What would make you bullish? Bearish? One clear trigger to watch at open.

6. **Let's Get It** — End with energy. Hype the crew up. "Let's have a green day fam" or "Stay patient, let the setups come to you" — match the market mood.

RULES:
- ALWAYS use the pre-market prices provided — these are LIVE
- ONLY near-term plays. Nothing more than 2 weeks out unless it's massive
- If the market is quiet, be honest. "Not a lot moving pre-market, could be a choppy one — that's okay, patience pays"
- Keep the whole thing under 350 words
- This should feel like a friend texting the group chat, NOT a Bloomberg terminal
- USE EMOJIS THROUGHOUT! 🔥💪👀🚀📈📉💰🤝😤🫡💎🧠⚡️🎯☀️ Sprinkle them in naturally like you're texting your boys. Every section should have some emoji energy
- Reference actual data numbers, not vibes
- If gap is > 0.5%, call it out prominently. If gap is > 1%, lead with it`;

let premarketCache: { data: any; timestamp: number } | null = null;
const PREMARKET_CACHE_TTL = 120000;

router.get("/whale/premarket", async (_req, res) => {
  try {
    if (premarketCache && Date.now() - premarketCache.timestamp < PREMARKET_CACHE_TTL) {
      res.json(premarketCache.data);
      return;
    }
    const tickers = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMZN", "META", "AMD", "MSFT", "GLD",
                      "GOOGL", "NFLX", "BA", "JPM", "COIN", "PLTR", "SOFI", "IWM"];
    const snapshot = await fetchPremarketSnapshot(tickers);

    const sorted = Object.entries(snapshot)
      .filter(([, s]) => s.gapPct !== null)
      .sort((a, b) => Math.abs(b[1].gapPct ?? 0) - Math.abs(a[1].gapPct ?? 0));

    const result = {
      timestamp: getNowEastern(),
      marketOpen: isMarketOpenET(),
      tickers: snapshot,
      biggestGaps: sorted.slice(0, 5).map(([t, s]) => ({
        ticker: t,
        price: s.preMarketPrice,
        prevClose: s.prevClose,
        gap: s.gap,
        gapPct: s.gapPct,
        source: s.source,
        bid: s.bid,
        ask: s.ask,
      })),
    };
    premarketCache = { data: result, timestamp: Date.now() };
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function buildMorningContext() {
  const now = getNowEastern();
  const dateContext = getEasternDateContext();

  const keyTickers = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMZN", "META", "AMD", "MSFT", "GLD"];

  const [flowAlerts, sectorData, econData, premarketPrices] = await Promise.all([
    fetchFlowAlerts(200),
    fetchSectorEtfs(),
    fetchEconomicCalendar(),
    fetchPremarketSnapshot(keyTickers),
  ]);

  const enriched = enrichAlerts(flowAlerts);

  const uwPrices: Record<string, number> = {};
  for (const alert of enriched) {
    const t = (alert.ticker ?? "").toUpperCase();
    const p = parseFloat(alert.underlying_price);
    if (t && p > 0 && !uwPrices[t]) uwPrices[t] = p;
  }

  const flowTickers = [...new Set(enriched.slice(0, 100).map(a => (a.ticker ?? "").toUpperCase()).filter(Boolean))];
  const hotTickers = flowTickers.filter(t => !keyTickers.includes(t)).slice(0, 5);
  if (hotTickers.length > 0) {
    const extraPrices = await fetchPremarketSnapshot(hotTickers);
    Object.assign(premarketPrices, extraPrices);
  }

  const keyLevelsResults = await Promise.all(
    keyTickers.slice(0, 6).map((t) => fetchKeyLevels(t, uwPrices[t] ?? null))
  );
  const keyLevels: Record<string, any> = {};
  keyTickers.slice(0, 6).forEach((t, i) => {
    if (keyLevelsResults[i]) keyLevels[t] = keyLevelsResults[i];
  });

  const gapSummary: Record<string, string> = {};
  for (const [t, snap] of Object.entries(premarketPrices)) {
    if (snap.preMarketPrice && snap.gapPct !== null) {
      gapSummary[t] = `$${snap.preMarketPrice} (${snap.gapPct > 0 ? "+" : ""}${snap.gapPct}% from $${snap.prevClose}) [${snap.source}]`;
    }
  }

  return {
    now,
    dateContext,
    enriched,
    context: {
      fetched_at: now,
      premarket_prices: premarketPrices,
      gap_summary: gapSummary,
      key_levels: keyLevels,
      top_flow: enriched.slice(0, 50),
      sector_etfs: sectorData,
      economic_calendar: (econData as any[]).slice(0, 10),
    },
  };
}

router.post("/whale/morning-outlook", async (_req, res) => {
  try {
    const { now, dateContext, context } = await buildMorningContext();

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: MORNING_OUTLOOK_SYSTEM,
      messages: [{
        role: "user",
        content: `Generate the morning outlook for today.

--- CURRENT DATE & TRADING CALENDAR ---
${dateContext}

--- PRE-MARKET PRICES (LIVE) ---
${Object.entries(context.gap_summary).map(([t, s]) => `${t}: ${s}`).join("\n") || "No pre-market data available yet"}

--- FULL MARKET DATA (fetched ${now}) ---
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Drop the morning outlook. Keep it real. Use the actual pre-market prices above — those are live.`,
      }],
    });

    const outlook = response.content[0].type === "text" ? response.content[0].text : "";
    res.json({ outlook, timestamp: now, premarketPrices: context.premarket_prices });
  } catch (err: any) {
    console.error("Morning outlook error:", err);
    res.status(500).json({ error: err.message ?? "Failed to generate morning outlook" });
  }
});

// ── Biddie Flow Monitor — posts whenever he sees something worth saying ───────

const BIDDIE_USER_ID = "00000000-0000-0000-0000-000000000000";

const seenAlertIds = new Set<string>();
let lastBiddiePost = 0;
const MIN_POST_GAP_MS = 20 * 60 * 1000;
let flowMonitorStarted = false;

async function postBiddieToChat(content: string): Promise<boolean> {
  try {
    await axios.post(
      `${SUPABASE_URL}/rest/v1/chat_messages`,
      { user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content },
      { headers: { ...supabaseAdminHeaders(), Prefer: "return=minimal" }, timeout: 5000 }
    );
    return true;
  } catch (e: any) {
    console.error("[Biddie] Supabase insert failed, falling back to local:", e.message);
    const r = await dbQuery(
      `INSERT INTO chat_messages (user_id, role, content, user_name) VALUES ($1, $2, $3, $4)`,
      [BIDDIE_USER_ID, "assistant", content, "Biddie AI"]
    );
    return !!r;
  }
}

const FLOW_WATCH_SYSTEM = `You are Biddie AI — the trading homie for the JORTRADE community. You're watching the tape and just spotted something the crew needs to know about.

YOUR PERSONALITY: You're that sharp friend in the group chat who only speaks up when something real is happening. When you talk, people pay attention because you don't waste their time. You're excited when you spot heat, cautious when something looks sketchy, and always keep it 100. Casual, confident, real — like texting your trading friends.

YOUR JOB: Decide if this flow is worth calling out to the community. If it is, drop a quick take that's informative AND has personality. You're not a bot — you're Biddie.

WHEN TO POST (must meet at least ONE):
- Massive single premium ($500K+) sweep or block on a liquid name
- Multiple sweeps stacking on the same ticker/direction in a short window (repeat hits)
- Flow that contradicts the current trend (bearish flow on a green day, bullish on a red day)
- Pre-market/after-hours flow that signals a big move at open
- A ticker suddenly lighting up with unusual volume (10x+ vol/OI)
- Something you already called out earlier is now confirming or invalidating

WHEN NOT TO POST:
- Normal flow on normal tickers with normal volume — that's just the market being the market
- Far-out expirations with modest premium — no urgency
- Flow that's clearly hedging (bid-side, protective puts on long positions)
- Anything you're not confident about — silence is better than noise

FORMAT (keep it SHORT — 3-5 sentences max):
- Start with a warm, varied opener — NEVER repeat the same one twice in a row. Mix it up! Examples:
  "Hey y'all 👋 just peeped something wild on the tape..."
  "Hey fam, pay attention to this one 👀"
  "This is interesting... somebody just made a BIG move"
  "Yo heads up crew 🚨"
  "Alright alright, the whales are talking again..."
  "Okay y'all, this just came across and I had to share"
  "Hey fam, look alive — something's brewing"
  "Not gonna lie, this print just caught my eye 👀"
  "Ayo the tape is getting spicy right now"
  "Heads up squad, we got a live one"
- What you're seeing (ticker, direction, premium, strike, expiry) — use actual numbers
- Why it matters (unusual size, sweep pattern, against the trend, etc.)
- One actionable takeaway — tell the crew what to watch for
- IMPORTANT: State the actual expiry date from the data. Do NOT default to 0DTE. If the flow shows 4/4 expiry, say 4/4. If it shows next week, say next week. Only call it 0DTE if the expiry is literally today

RULES:
- Under 100 words. This is a quick heads-up, not an essay
- USE EMOJIS naturally — 🔥👀🚨💰📈📉⚡️🎯💎🫡 You're texting the crew, not writing a report
- Reference actual numbers — premium, vol/OI, aggression %
- ALWAYS use the real expiry date from the flow data — don't assume 0DTE
- Don't repeat yourself — each post should be new information
- If nothing is worth posting about, respond with exactly: NOTHING_NOTABLE`;

let morningPostedDate = "";

function startFlowMonitor() {
  if (flowMonitorStarted) return;
  flowMonitorStarted = true;

  setInterval(async () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = parseInt(get("hour"), 10);
    const minute = parseInt(get("minute"), 10);
    const day = get("weekday");

    if (["Saturday", "Sunday"].includes(day)) return;
    if (hour !== 7 || minute < 0 || minute > 15) return;

    const today = new Date().toISOString().split("T")[0];
    if (morningPostedDate === today) return;

    try {
      const existCheck = await axios.get(
        `${SUPABASE_URL}/rest/v1/chat_messages?user_id=eq.${BIDDIE_USER_ID}&created_at=gte.${today}T00:00:00Z&limit=1`,
        { headers: supabaseAdminHeaders(), timeout: 5000 }
      );
      if (existCheck.data?.length > 0) { morningPostedDate = today; return; }
    } catch {
      const existingResult = await dbQuery(
        `SELECT id FROM chat_messages WHERE user_id = $1 AND created_at >= $2 LIMIT 1`,
        [BIDDIE_USER_ID, `${today}T00:00:00Z`]
      );
      if (existingResult && existingResult.rows.length > 0) { morningPostedDate = today; return; }
    }

    try {
      const { now, dateContext, context } = await buildMorningContext();

      const response = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: MORNING_OUTLOOK_SYSTEM,
        messages: [{ role: "user", content: `Say good morning to the JORTRADE chat and drop the morning outlook. Start with a genuine, warm greeting to the community — make people feel welcome and hyped for the day. Then get into the market read.\n\n--- CURRENT DATE & TRADING CALENDAR ---\n${dateContext}\n\n--- PRE-MARKET PRICES (LIVE) ---\n${Object.entries(context.gap_summary).map(([t, s]) => `${t}: ${s}`).join("\n") || "No pre-market data available yet"}\n\n--- FULL MARKET DATA (fetched ${now}) ---\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\nUse the actual pre-market prices above — those are live. Remember: GM to the chat FIRST, then the market read.` }],
      });
      const content = response.content[0].type === "text" ? response.content[0].text : "";
      const posted = await postBiddieToChat(content);
      if (posted) {
        morningPostedDate = today;
        lastBiddiePost = Date.now();
        console.log(`[Biddie morning] Posted at ${now}`);
      } else {
        console.error(`[Biddie morning] Insert failed`);
      }
    } catch (err) { console.error("[Biddie morning] Failed:", err); }
  }, 60000);

  // Flow scanner — runs every 5 minutes during market hours, posts when something's worth saying
  setInterval(async () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = parseInt(get("hour"), 10);
    const day = get("weekday");

    if (["Saturday", "Sunday"].includes(day)) return;
    if (hour < 9 || hour > 16) return;
    if (Date.now() - lastBiddiePost < MIN_POST_GAP_MS) return;

    try {
      const flowAlerts = await fetchFlowAlerts(200);
      const enriched = enrichAlerts(flowAlerts);

      const newAlerts = enriched.filter((a) => {
        const id = a.rule_id || `${a.ticker}-${a.strike}-${a.type}-${a.expiry}`;
        if (seenAlertIds.has(id)) return false;
        seenAlertIds.add(id);
        return true;
      });

      if (seenAlertIds.size > 5000) {
        const arr = [...seenAlertIds];
        arr.splice(0, arr.length - 2000);
        seenAlertIds.clear();
        arr.forEach((id) => seenAlertIds.add(id));
      }

      const notable = newAlerts.filter((a) => {
        if (!a.has_sweep) return false;
        if (a.total_premium < 250000) return false;
        if (a.ask_aggression_pct < 85) return false;
        if (a.vol_oi_ratio < 5) return false;
        const price = parseFloat(a.underlying_price) || 0;
        const strike = parseFloat(a.strike) || 0;
        if (price > 0 && strike > 0) {
          const moneyness = Math.abs(strike - price) / price;
          if (moneyness > 0.05) return false;
        }
        return true;
      });

      if (notable.length === 0) return;

      const now = getNowEastern();
      const topFlow = notable.slice(0, 8);
      const context = JSON.stringify({ fetched_at: now, notable_flow: topFlow, all_recent: enriched.slice(0, 40) }, null, 2);

      const response = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: FLOW_WATCH_SYSTEM,
        messages: [{ role: "user", content: `New flow just came in. Is this worth calling out?\n\n--- CURRENT TIME ---\n${now}\n\n--- NOTABLE FLOW ---\n\`\`\`json\n${context}\n\`\`\`\n\nIf it's worth posting about, drop a quick take. If not, respond with exactly: NOTHING_NOTABLE` }],
      });

      const content = response.content[0].type === "text" ? response.content[0].text : "";

      if (content.includes("NOTHING_NOTABLE") || content.trim().length < 20) return;

      const posted = await postBiddieToChat(content);
      if (posted) {
        lastBiddiePost = Date.now();
        console.log(`[Biddie flow alert] Posted at ${now}`);
      } else {
        console.error(`[Biddie flow alert] Insert failed`);
      }
    } catch (err) { console.error("[Biddie flow monitor] Failed:", err); }
  }, 5 * 60 * 1000);
}

startFlowMonitor();

// NOTE: market-hours logic was moved to ../lib/marketHours.ts so that the
// trade-execution gate (POST /whale/paper/trades), the auto-enter / auto-exit
// monitor, and signal generation all share one source of truth. Use
// isMarketOpenET() from that module — semantics are unchanged (weekends-only,
// 9:30–16:00 ET, exclusive at 16:00).

async function syncPriceMonitorSubscriptions() {
  try {
    const result = await dbQuery(
      `SELECT DISTINCT ticker FROM signal_outcomes WHERE outcome = 'pending'`
    );
    const BASELINE = ["SPY", "QQQ", "IWM", "VIXY"];
    if (!result || !result.rows.length) {
      priceMonitor.updateSubscriptions(BASELINE);
      return;
    }
    const tickers = [...new Set([...BASELINE, ...result.rows.map((r: any) => r.ticker).filter((t: string) => t && !t.includes(" ") && t.length <= 5 && t !== "SPXW")])];
    priceMonitor.updateSubscriptions(tickers);
    console.log(`[price-monitor] Subscribed to ${tickers.length} tickers: ${tickers.join(", ")}`);
  } catch (e: any) {
    console.error("[price-monitor] Subscription sync error:", e.message);
  }
}

async function realtimeVerifySignals() {

  try {
    const pendingResult = await dbQuery(
      `SELECT * FROM signal_outcomes WHERE outcome = 'pending' ORDER BY created_at DESC LIMIT 500`
    );
    if (!pendingResult || pendingResult.rows.length === 0) return;

    const pending = pendingResult.rows;
    const now = new Date();
    let hits = 0, partialHits = 0, misses = 0, expired = 0;

    const tickers = [...new Set(pending.map((s: any) => s.ticker))];
    const signalPriceMap: Record<string, PriceHistory> = {};
    const spxTickerSet = new Set(["SPX", "SPXW"]);

    await Promise.all(
      pending.map(async (s: any) => {
        const sinceDate = s.detected_at || s.created_at;
        const lookupTicker = spxTickerSet.has(s.ticker) ? "I:SPX" : s.ticker;
        const history = await fetchPriceHistory(lookupTicker, sinceDate);
        if (history) signalPriceMap[s.id] = history;
      })
    );

    for (const signal of pending) {
      const history = signalPriceMap[signal.id];
      if (!history) {
        const createdAt = new Date(signal.created_at || signal.detected_at);
        const hoursAlive = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        if (hoursAlive >= 24) {
          await dbQuery(
            `UPDATE signal_outcomes SET outcome = 'expired', resolved_at = $1, trade_status = 'expired', status_updated_at = $1 WHERE id = $2`,
            [now.toISOString(), signal.id]
          );
          await dbQuery(
            `UPDATE user_trades SET signal_outcome = 'expired', resolved_at = $1 WHERE signal_id = $2`,
            [now.toISOString(), signal.id]
          );
          expired++;
          console.log(`[auto-verify] ${signal.ticker} ${signal.option_type}: no price data after ${Math.round(hoursAlive)}h → expired`);
        }
        continue;
      }
      const target_val = parseTargetRange(signal.target_zone || signal.target);
      const invalidationPrice = parsePrice(signal.invalidation);
      const entryPrice = parsePrice(signal.entry_trigger);
      const signalPrice = signal.price_at_signal ? parseFloat(signal.price_at_signal) : null;
      const putCall2 = (signal.put_call || signal.option_type || "").toUpperCase();
      const isBullish = putCall2 === "CALL" ? true : putCall2 === "PUT" ? false : signal.signal_type === "bullish";
      const expiryDate = signal.expiry ? new Date(signal.expiry) : null;
      const isExpired = expiryDate && expiryDate < now;

      const createdAt = new Date(signal.created_at || signal.detected_at);
      const hoursAlive = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      const dteHoursToExpiry2 = expiryDate ? (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60) : 999;
      const isShortDated2 = dteHoursToExpiry2 <= 48;
      const MIN_HOURS_BEFORE_MISS = isShortDated2 ? 0.25 : 2;
      const canMiss = hoursAlive >= MIN_HOURS_BEFORE_MISS || isExpired;

      let outcome: string | null = null;
      const refPrice2 = signalPrice || entryPrice || 0;

      const isSpx = new Set(["SPX", "SPXW", "NDX", "QQQ"]).has(signal.ticker);
      const ADV_MOVE_PCT = isSpx ? 0.0075 : 0.025;

      let mfeToTarget: number | null = null;
      if (refPrice2 > 0 && target_val.low && target_val.high) {
        const tgtP = isBullish ? Math.min(target_val.low, target_val.high) : Math.max(target_val.low, target_val.high);
        const distToTarget = Math.abs(tgtP - refPrice2);
        if (distToTarget > 0) {
          const favorable = isBullish ? (history.highSince - refPrice2) : (refPrice2 - history.lowSince);
          mfeToTarget = Math.max(0, (favorable / distToTarget) * 100);
        }
      }

      if (mfeToTarget !== null) {
        if (mfeToTarget >= 75) {
          outcome = "hit";
        } else if (mfeToTarget >= 50) {
          outcome = "partial_hit";
        }
      }

      if (!outcome && refPrice2 > 0 && (!target_val.low || !target_val.high)) {
        const MIN_FALLBACK_PCT = 0.015;
        if (isBullish && history.highSince >= refPrice2 * (1 + MIN_FALLBACK_PCT)) outcome = "hit";
        else if (!isBullish && history.lowSince <= refPrice2 * (1 - MIN_FALLBACK_PCT)) outcome = "hit";
      }

      let effectiveInvalidation = invalidationPrice;
      if (!effectiveInvalidation && refPrice2 > 0) {
        effectiveInvalidation = isBullish
          ? refPrice2 * (1 - ADV_MOVE_PCT)
          : refPrice2 * (1 + ADV_MOVE_PCT);
      }

      if (!outcome && canMiss && effectiveInvalidation && refPrice2 > 0) {
        const INV_BUFFER_PCT = 0.0025;
        const invZone = isBullish
          ? effectiveInvalidation * (1 - INV_BUFFER_PCT)
          : effectiveInvalidation * (1 + INV_BUFFER_PCT);
        const invMakesDirectionalSense = isBullish
          ? effectiveInvalidation < refPrice2
          : effectiveInvalidation > refPrice2;
        if (invMakesDirectionalSense) {
          const currentlyBreached = isBullish
            ? history.current <= invZone
            : history.current >= invZone;
          const didBreachZone = isBullish
            ? history.lowSince <= invZone
            : history.highSince >= invZone;
          const dteHours = expiryDate ? (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60) : 0;
          const isLongDated = dteHours > 48;
          if (isExpired && didBreachZone) {
            if (mfeToTarget !== null && mfeToTarget >= 30) {
              outcome = "near_miss";
            } else {
              outcome = "missed";
            }
          } else if (currentlyBreached && didBreachZone && !isLongDated) {
            if (mfeToTarget !== null && mfeToTarget >= 30) {
              outcome = "near_miss";
            } else {
              outcome = "missed";
            }
          } else if (currentlyBreached && didBreachZone && isLongDated) {
            const breachPct = isBullish
              ? ((invZone - history.current) / invZone) * 100
              : ((history.current - invZone) / invZone) * 100;
            if (breachPct >= 1.0) {
              if (mfeToTarget !== null && mfeToTarget >= 30) {
                outcome = "near_miss";
              } else {
                outcome = "missed";
              }
            }
          }
        }
      }

      if (!outcome && signal.outcome === "missed" && !isExpired && effectiveInvalidation && refPrice2 > 0) {
        const recovered = isBullish
          ? history.current > effectiveInvalidation
          : history.current < effectiveInvalidation;
        if (recovered) {
          outcome = "pending_revert";
        }
      }

      const expiryPlusClose2 = expiryDate ? new Date(expiryDate.getTime() + 20 * 60 * 60 * 1000) : null;
      const isActuallyExpired2 = expiryPlusClose2 ? expiryPlusClose2 < now : false;
      if (!outcome && (isExpired || isActuallyExpired2)) {
        if (!isActuallyExpired2) {
          // not expired yet
        } else {
          if (mfeToTarget !== null) {
            if (mfeToTarget >= 75) {
              outcome = "hit";
            } else if (mfeToTarget >= 50) {
              outcome = "partial_hit";
            } else if (mfeToTarget >= 30) {
              outcome = "near_miss";
            } else {
              outcome = "missed";
            }
          } else {
            const mfePricePct2 = refPrice2 > 0
              ? (isBullish ? ((history.highSince - refPrice2) / refPrice2) * 100 : ((refPrice2 - history.lowSince) / refPrice2) * 100)
              : 0;
            if (mfePricePct2 >= 1.5) {
              outcome = "partial_hit";
            } else {
              outcome = "expired";
            }
          }
        }
      }

      const mfPrice = isBullish ? history.highSince : history.lowSince;
      const prevMfp = signal.max_favorable_price ? parseFloat(signal.max_favorable_price) : null;
      const newMfp = isBullish
        ? Math.max(mfPrice, prevMfp ?? -Infinity)
        : Math.min(mfPrice, prevMfp ?? Infinity);
      const shouldUpdateMfp = prevMfp === null || (isBullish ? newMfp > prevMfp : newMfp < prevMfp);

      let mfePct: number | null = null;
      if (refPrice2 > 0 && target_val.low && target_val.high) {
        if (isBullish) {
          const targetP = target_val.low;
          const denom = targetP - refPrice2;
          if (denom > 0) mfePct = Math.round(((newMfp - refPrice2) / denom) * 10000) / 100;
        } else {
          const targetP = target_val.high;
          const denom = refPrice2 - targetP;
          if (denom > 0) mfePct = Math.round(((refPrice2 - newMfp) / denom) * 10000) / 100;
        }
      }

      const maPrice = isBullish ? history.lowSince : history.highSince;
      const prevMap = signal.max_adverse_price ? parseFloat(signal.max_adverse_price) : null;
      const newMap = isBullish
        ? Math.min(maPrice, prevMap ?? Infinity)
        : Math.max(maPrice, prevMap ?? -Infinity);
      const shouldUpdateMap = prevMap === null || (isBullish ? newMap < prevMap : newMap > prevMap);

      const entryPriceVal = entryPrice || signalPrice || 0;
      let didReachEntry = signal.entry_price_reached || false;
      if (!didReachEntry && entryPriceVal > 0) {
        if (isBullish && history.highSince >= entryPriceVal) didReachEntry = true;
        else if (!isBullish && history.lowSince <= entryPriceVal) didReachEntry = true;
      }

      let didBreachInvalidation = signal.invalidation_breached || false;
      let pctPastInv: number | null = signal.pct_past_invalidation ? parseFloat(signal.pct_past_invalidation) : null;
      if (invalidationPrice && invalidationPrice > 0) {
        if (isBullish && history.lowSince <= invalidationPrice) {
          didBreachInvalidation = true;
          const pct = Math.round(((invalidationPrice - history.lowSince) / invalidationPrice) * 10000) / 100;
          if (pctPastInv === null || pct > pctPastInv) pctPastInv = pct;
        } else if (!isBullish && history.highSince >= invalidationPrice) {
          didBreachInvalidation = true;
          const pct = Math.round(((history.highSince - invalidationPrice) / invalidationPrice) * 10000) / 100;
          if (pctPastInv === null || pct > pctPastInv) pctPastInv = pct;
        }
      }

      let timeAtTarget = signal.time_at_target || null;
      if (!timeAtTarget && outcome === "hit" && target_val.low && target_val.high) {
        timeAtTarget = now.toISOString();
      }

      const duringMarket = isMarketOpenET();

      const prevStatus = signal.trade_status || "watching";
      let newStatus = prevStatus;
      const hasNoLevels = (signal.entry_trigger || "").includes("Level data not available");

      if (duringMarket) {
        if ((prevStatus === "watching" || prevStatus === "ran_without_entry") && didReachEntry) {
          newStatus = "active";
        } else if (prevStatus === "watching" && !didReachEntry && mfePct !== null && mfePct >= 15) {
          newStatus = "ran_without_entry";
        }
        if (outcome === "hit") newStatus = "hit";
        else if (outcome === "partial_hit") newStatus = "partial";
        else if (outcome === "near_miss") newStatus = "near_miss";
        else if (outcome === "missed") newStatus = "miss";
        else if (outcome === "expired") newStatus = "expired";
      } else {
        if (hasNoLevels) {
          if (outcome === "hit") newStatus = "hit";
          else if (outcome === "partial_hit") newStatus = "partial";
          else if (outcome === "near_miss") newStatus = "near_miss";
          else if (outcome === "missed") newStatus = "miss";
          else if (outcome === "expired") newStatus = "expired";
          else if (signal.outcome === "missed") newStatus = "miss";
          else if (signal.outcome === "hit" || signal.outcome === "win") newStatus = "hit";
        } else {
          if ((prevStatus === "watching" || prevStatus === "ran_without_entry") && didReachEntry) {
            newStatus = "active";
          } else if (prevStatus === "watching" && !didReachEntry && mfePct !== null && mfePct >= 15) {
            newStatus = "ran_without_entry";
          }
          if (effectiveInvalidation && refPrice2 > 0 && canMiss && !["hit", "partial", "partial_hit", "ran_without_entry"].includes(prevStatus) && !["hit", "partial_hit", "near_miss"].includes(outcome || "")) {
            const currentlyPastInv = isBullish
              ? history.current <= effectiveInvalidation
              : history.current >= effectiveInvalidation;
            if (currentlyPastInv) {
              if (!outcome) {
                if (mfeToTarget !== null && mfeToTarget >= 30) {
                  outcome = "near_miss";
                  newStatus = "near_miss";
                } else {
                  outcome = "missed";
                  newStatus = "miss";
                }
              }
            }
          }
          if (outcome === "hit") newStatus = "hit";
          else if (outcome === "partial_hit") newStatus = "partial";
          else if (outcome === "near_miss") newStatus = "near_miss";
          else if (outcome === "missed") newStatus = "miss";
          else if (outcome === "expired") newStatus = "expired";
        }
      }

      const statusChanged = newStatus !== prevStatus;

      if (shouldUpdateMfp || shouldUpdateMap || didReachEntry !== (signal.entry_price_reached || false) || didBreachInvalidation !== (signal.invalidation_breached || false) || statusChanged) {
        await dbQuery(
          `UPDATE signal_outcomes SET max_favorable_price = $1, mfe_percent = $2, max_adverse_price = $3, entry_price_reached = $4, invalidation_breached = $5, pct_past_invalidation = $6, entry_price = $7, trade_status = $8, status_updated_at = $9${newStatus === "active" && (prevStatus === "watching" || prevStatus === "ran_without_entry") ? ", entry_hit_at = $9" : ""} WHERE id = $10`,
          [newMfp, mfePct, newMap, didReachEntry, didBreachInvalidation, pctPastInv, entryPriceVal > 0 ? entryPriceVal : null, newStatus, now.toISOString(), signal.id]
        );
        if (statusChanged) {
          console.log(`[auto-verify] ${signal.ticker} ${signal.option_type}: ${prevStatus} → ${newStatus} (price: $${history.current.toFixed(2)})`);
        }
      }

      if (outcome === "pending_revert") {
        await dbQuery(
          `UPDATE signal_outcomes SET outcome = 'pending', resolved_at = NULL, trade_status = 'active', status_updated_at = $1 WHERE id = $2`,
          [now.toISOString(), signal.id]
        );
        await dbQuery(
          `UPDATE user_trades SET signal_outcome = 'pending', resolved_at = NULL WHERE signal_id = $1`,
          [signal.id]
        );
        console.log(`[auto-verify] ${signal.ticker} ${signal.option_type} $${signal.strike}: REVERTED missed → pending (price recovered above invalidation to $${history.current.toFixed(2)})`);
      } else if (outcome) {
        const updateFields = timeAtTarget
          ? `UPDATE signal_outcomes SET outcome = $1, resolved_at = $2, time_at_target = $3, trade_status = $4, status_updated_at = $5 WHERE id = $6`
          : `UPDATE signal_outcomes SET outcome = $1, resolved_at = $2, trade_status = $3, status_updated_at = $4 WHERE id = $5`;
        const updateParams = timeAtTarget
          ? [outcome, now.toISOString(), timeAtTarget, newStatus, now.toISOString(), signal.id]
          : [outcome, now.toISOString(), newStatus, now.toISOString(), signal.id];
        await dbQuery(updateFields, updateParams);
        await dbQuery(
          `UPDATE user_trades SET signal_outcome = $1, resolved_at = $2 WHERE signal_id = $3`,
          [outcome, now.toISOString(), signal.id]
        );
        if (outcome === "hit") hits++;
        else if (outcome === "partial_hit") partialHits++;
        else if (outcome === "near_miss") partialHits++;
        else if (outcome === "missed") misses++;
        else if (outcome === "expired") expired++;
      }
    }

    if (hits + partialHits + misses + expired > 0) {
      const source = priceMonitor.isConnected() ? "real-time" : "Polygon";
      console.log(`[auto-verify] ${source} | Verified: ${hits} hits, ${partialHits} partial/near-miss, ${misses} misses, ${expired} expired`);
    }

    const driftFix = await dbQuery(
      `UPDATE user_trades ut
       SET signal_outcome = so.outcome, resolved_at = so.resolved_at
       FROM signal_outcomes so
       WHERE ut.signal_id = so.id::text
         AND (ut.signal_outcome IS DISTINCT FROM so.outcome
              OR ut.resolved_at IS DISTINCT FROM so.resolved_at)`
    );
    if (driftFix && driftFix.rowCount && driftFix.rowCount > 0) {
      console.log(`[auto-verify] Drift fix: synced ${driftFix.rowCount} user_trades to match signal_outcomes`);
    }
  } catch (e: any) {
    console.error("[auto-verify] Error:", e.message);
  }
}

function startPriceMonitorSystem() {
  priceMonitor.connect();

  syncPriceMonitorSubscriptions();
  setInterval(syncPriceMonitorSubscriptions, 5 * 60 * 1000);

  let verifyInterval: ReturnType<typeof setInterval> | null = null;
  let lastMode: "market" | "after" | null = null;

  function adjustVerifyFrequency() {
    const currentMode = isMarketOpenET() ? "market" : "after";
    if (currentMode === lastMode) return;
    lastMode = currentMode;

    if (verifyInterval) clearInterval(verifyInterval);

    if (currentMode === "market") {
      verifyInterval = setInterval(realtimeVerifySignals, 5 * 60 * 1000);
      console.log("[auto-verify] Market hours: verifying every 5 minutes");
    } else {
      verifyInterval = setInterval(realtimeVerifySignals, 30 * 60 * 1000);
      console.log("[auto-verify] After hours: verifying every 30 minutes");
      realtimeVerifySignals();
    }
  }

  adjustVerifyFrequency();
  setInterval(adjustVerifyFrequency, 60 * 1000);

  setTimeout(realtimeVerifySignals, 30 * 1000);
}

setTimeout(startPriceMonitorSystem, 5000);

router.get("/whale/prices/realtime", (_req, res) => {
  // P2: read through LivePriceService — single source of truth for "current price".
  // The `source` field surfaces the unified `live` | `rest` | `stale` label so the
  // frontend can render the freshness dot. `underlyingSource` is kept as raw debug
  // (`ws` | `snapshot` | `rest` | `none`) for ops/log traceability.
  const facadePrices = livePriceService.stocks.getAll();
  const subscribedTickers = livePriceService.stocks.getSubscribedTickers();
  const status = livePriceService.status().stocks;
  const data: Record<string, any> = {};
  for (const p of facadePrices) {
    data[p.ticker] = {
      price: p.price,
      high: p.high,
      low: p.low,
      volume: p.volume,
      trades: p.trades,
      source: p.source,                    // 'live' | 'rest' | 'stale' (NEW unified label)
      underlyingSource: p.underlyingSource, // 'ws' | 'snapshot' | 'rest' | 'none' (raw debug)
      bid: p.bid,
      ask: p.ask,
      prevClose: p.prevClose,
      changePercent: p.changePercent,
      lastUpdate: new Date(p.lastUpdate).toISOString(),
      age: Math.round(p.ageMs / 1000),
    };
  }
  res.json({
    connected: status.connected,
    marketOpen: isMarketOpenET(),
    subscribedTickers,
    tickerCount: subscribedTickers.length,
    prices: data,
  });
});

let marketPulseCache: { data: any; timestamp: number } | null = null;
const MARKET_PULSE_TTL = 60_000;

router.get("/whale/market-pulse", async (_req, res) => {
  if (marketPulseCache && Date.now() - marketPulseCache.timestamp < MARKET_PULSE_TTL) {
    return res.json(marketPulseCache.data);
  }

  try {
    const spyData = priceMonitor.getPrice("SPY");
    const qqqData = priceMonitor.getPrice("QQQ");
    const iwmData = priceMonitor.getPrice("IWM");

    let vixPrice: number | null = null;
    let vixChange: number | null = null;

    try {
      const gfResp = await axios.get("https://www.google.com/finance/quote/VIX:INDEXCBOE", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 5000,
      });
      const html = gfResp.data as string;
      const priceMatch = html.match(/data-last-price="([\d.]+)"/);
      const changeMatch = html.match(/data-percent-change="(-?[\d.]+)"/);
      if (priceMatch) {
        vixPrice = parseFloat(priceMatch[1]);
        if (changeMatch) vixChange = parseFloat(changeMatch[1]);
      }
    } catch {}

    if (!vixPrice) {
      const vixyData = priceMonitor.getPrice("VIXY");
      if (vixyData?.price) {
        vixPrice = vixyData.price;
        vixChange = vixyData.changePercent ?? null;
      }
    }

    let vixLevel = "Unknown";
    let vixDescription = "";
    if (vixPrice != null) {
      if (vixPrice < 15) {
        vixLevel = "Very Calm";
        vixDescription = "The fear meter is very calm right now. The market is smooth and easy — you can size up because nothing crazy is happening.";
      } else if (vixPrice < 20) {
        vixLevel = "Normal";
        vixDescription = "The fear meter is normal — just a regular day. Play normal size, nothing unusual going on.";
      } else if (vixPrice < 30) {
        vixLevel = "Nervous";
        vixDescription = "The fear meter is getting nervous — things are starting to get shaky. Play a little smaller and be careful out there.";
      } else if (vixPrice < 40) {
        vixLevel = "Fear";
        vixDescription = "The fear meter is showing fear — the market is jumpy and fast. Play small and don't take big risks right now.";
      } else {
        vixLevel = "Panic";
        vixDescription = "The fear meter is in PANIC mode — it's chaos out there! Play very small or don't play at all. Cash is a position too.";
      }
    }

    const flowAlerts = await fetchFlowAlerts(500);
    let totalCallPrem = 0;
    let totalPutPrem = 0;
    let totalSweeps = 0;
    let callSweeps = 0;
    let putSweeps = 0;
    const tickerCounts: Record<string, { alerts: number; callPrem: number; putPrem: number; sweeps: number; totalPrem: number }> = {};

    for (const a of flowAlerts) {
      const prem = Number(a.total_premium || a.premium) || 0;
      const pc = (a.type || a.put_call || a.option_type || "").toLowerCase();
      const isSweep = !!(a.has_sweep || (a.option_activity_type || "").toLowerCase() === "sweep");
      const ticker = (a.ticker || a.ticker_symbol || "").toUpperCase();

      if (pc === "call" || pc === "c") totalCallPrem += prem;
      else totalPutPrem += prem;
      if (isSweep) {
        totalSweeps++;
        if (pc === "call" || pc === "c") callSweeps++;
        else putSweeps++;
      }

      if (ticker) {
        if (!tickerCounts[ticker]) tickerCounts[ticker] = { alerts: 0, callPrem: 0, putPrem: 0, sweeps: 0, totalPrem: 0 };
        tickerCounts[ticker].alerts++;
        tickerCounts[ticker].totalPrem += prem;
        if (pc === "call" || pc === "c") tickerCounts[ticker].callPrem += prem;
        else tickerCounts[ticker].putPrem += prem;
        if (isSweep) tickerCounts[ticker].sweeps++;
      }
    }

    const totalFlow = totalCallPrem + totalPutPrem;
    let putCallRatio = 0;
    let sentimentLabel = "Unavailable";
    let sentimentDescription = "Options flow data is not available right now. Check back during market hours.";

    if (totalFlow > 100_000) {
      putCallRatio = totalCallPrem > 0 ? Math.round((totalPutPrem / totalCallPrem) * 100) / 100 : (totalPutPrem > 0 ? 99 : 0);
      if (putCallRatio < 0.5) {
        sentimentLabel = "Very Bullish";
        sentimentDescription = "Almost everyone is betting prices go UP! The crowd is super confident right now — way more money flowing into calls than puts.";
      } else if (putCallRatio < 0.8) {
        sentimentLabel = "Bullish";
        sentimentDescription = "More money is betting on prices going UP than DOWN. The mood is positive — traders are feeling good about the market.";
      } else if (putCallRatio <= 1.2) {
        sentimentLabel = "Neutral";
        sentimentDescription = "It's about 50/50 right now — half betting UP, half betting DOWN. Nobody really knows what's next. The market is undecided.";
      } else if (putCallRatio <= 1.8) {
        sentimentLabel = "Bearish";
        sentimentDescription = "More money is betting prices go DOWN than UP. Traders are getting nervous and buying protection. Be careful out there.";
      } else {
        sentimentLabel = "Very Bearish";
        sentimentDescription = "Way more money is betting DOWN than UP — traders are scared and buying lots of protection. The crowd thinks prices are heading lower.";
      }
    }

    const trending = Object.entries(tickerCounts)
      .filter(([t]) => !["SPX", "SPXW"].includes(t))
      .sort((a, b) => b[1].totalPrem - a[1].totalPrem)
      .slice(0, 8)
      .map(([ticker, data]) => {
        const bias = data.callPrem > data.putPrem * 1.5 ? "bullish" : data.putPrem > data.callPrem * 1.5 ? "bearish" : "mixed";
        return {
          ticker,
          alerts: data.alerts,
          totalPremium: data.totalPrem,
          callPremium: data.callPrem,
          putPremium: data.putPrem,
          sweeps: data.sweeps,
          bias,
        };
      });

    const formatPrice = (pd: PriceData | null) => pd ? {
      price: pd.price,
      changePercent: pd.changePercent,
      prevClose: pd.prevClose,
      high: pd.high,
      low: pd.low,
    } : null;

    const result = {
      timestamp: new Date().toISOString(),
      marketOpen: isMarketOpenET(),
      indices: {
        SPY: formatPrice(spyData),
        QQQ: formatPrice(qqqData),
        IWM: formatPrice(iwmData),
      },
      vix: {
        price: vixPrice,
        change: vixChange,
        level: vixLevel,
        description: vixDescription,
      },
      sentiment: {
        putCallRatio: Math.round(putCallRatio * 100) / 100,
        label: sentimentLabel,
        description: sentimentDescription,
        totalCallPremium: totalCallPrem,
        totalPutPremium: totalPutPrem,
        sweepCount: totalSweeps,
        callSweeps,
        putSweeps,
      },
      trending,
    };

    marketPulseCache = { data: result, timestamp: Date.now() };
    res.json(result);
  } catch (e: any) {
    console.error("[market-pulse] Error:", e.message);
    res.status(500).json({ error: "Failed to fetch market pulse" });
  }
});

router.post("/whale/trades", async (req, res) => {
  try {
    const { userId, signalId, ticker, direction, category, strike, expiry, optionType, entryTrigger, target, invalidation, convictionScore, entryPrice } = req.body;
    if (!userId || !signalId || !ticker) {
      return res.status(400).json({ error: "userId, signalId, and ticker are required" });
    }
    const existing = await dbQuery(
      `SELECT id FROM user_trades WHERE user_id = $1 AND signal_id = $2`,
      [userId, signalId]
    );
    if (existing && existing.rows.length > 0) {
      return res.status(409).json({ error: "Trade already taken", tradeId: existing.rows[0].id });
    }
    await dbQuery(`ALTER TABLE user_trades ADD COLUMN IF NOT EXISTS entry_price NUMERIC`, []);
    const result = await dbQuery(
      `INSERT INTO user_trades (user_id, signal_id, ticker, direction, category, strike, expiry, option_type, entry_trigger, target, invalidation, conviction_score, entry_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
      [userId, signalId, ticker, direction || "bullish", category, strike, expiry, optionType, entryTrigger, target, invalidation, convictionScore, entryPrice || null]
    );
    if (!result) return res.status(500).json({ error: "Failed to save trade" });
    res.json({ success: true, trade: result.rows[0] });
  } catch (e: any) {
    console.error("[user_trades] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/whale/trades/:signalId", async (req, res) => {
  try {
    const { signalId } = req.params;
    const userId = req.query.userId as string;
    if (!userId || !signalId) return res.status(400).json({ error: "userId and signalId required" });
    await dbQuery(`DELETE FROM user_trades WHERE user_id = $1 AND signal_id = $2`, [userId, signalId]);
    res.json({ success: true });
  } catch (e: any) {
    console.error("[user_trades] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/whale/trades", async (req, res) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const result = await dbQuery(
      `SELECT ut.*, ut.entry_price, so.outcome as signal_outcome, so.resolved_at as signal_resolved_at, so.price_at_signal, so.signal_type, so.created_at as signal_created_at, so.is_biddie_pick
       FROM user_trades ut
       LEFT JOIN signal_outcomes so ON ut.signal_id = so.id::text
       WHERE ut.user_id = $1
       ORDER BY ut.taken_at DESC
       LIMIT 200`,
      [userId]
    );
    if (!result) return res.json({ trades: [] });
    res.json({ trades: result.rows });
  } catch (e: any) {
    console.error("[user_trades] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Paper-Trade Tracker ──────────────────────────────────────────────────────
// Simulated trades. Conservative: enter at ask, exit at bid. NEVER touches a broker.

async function verifyBearerUser(req: any): Promise<string | null> {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const resp = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    const id = resp.data?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

// Normalize an expiry value to a canonical YYYY-MM-DD string.
//
// Defensive against the historical bug where PostgreSQL DATE columns are
// returned by node-postgres as JavaScript Date objects, and `String(date)`
// produces "Fri May 01 2026 00:00:00 GMT-0700 (PDT)" instead of an ISO date.
// `String(date).slice(0, 10)` then yields "Fri May 01", which silently broke
// every downstream OPRA-symbol build (Polygon returned 404 with bodies like
// "Options contract not found" for symbols such as "O:NVDAi May 01C00205000").
//
// Inputs accepted:
//   - Date object (most common from pg)
//   - "YYYY-MM-DD" string
//   - "YYYY-MM-DDTHH:MM:SS..." ISO string
//   - "Fri May 01 2026 ..." Date.toString() (recovered defensively)
function normalizeExpiryToIso(expiry: unknown): string {
  if (expiry instanceof Date) {
    if (Number.isNaN(expiry.getTime())) {
      throw new Error(`buildOptionContractSymbol: invalid Date expiry`);
    }
    // Use UTC accessors — DATE columns from pg are anchored to midnight in
    // the server's local TZ; UTC accessors avoid an off-by-one when the
    // server is east of UTC. (For dates from "YYYY-MM-DD" the pg parser
    // uses local midnight; we accept the small risk that very-east TZs in
    // dev shells could shift by one day, which is not a concern in our
    // UTC-anchored Replit deployment but is documented for awareness.)
    const y = expiry.getUTCFullYear();
    const m = String(expiry.getUTCMonth() + 1).padStart(2, "0");
    const d = String(expiry.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(expiry ?? "");
  // Already ISO-prefixed → trust the leading 10 chars.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Fall back to Date parser for anything else (e.g. accidental Date.toString()).
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`buildOptionContractSymbol: cannot parse expiry "${s}"`);
  }
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const d = String(parsed.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildOptionContractSymbol(ticker: string, expiry: string | Date, optionType: "call" | "put", strike: number): { contractSymbol: string; parentTicker: string } {
  const isSpxWeekly = ticker === "SPXW";
  const parentTicker = isSpxWeekly ? "SPX" : ticker;
  const contractTicker = isSpxWeekly ? "SPXW" : ticker;
  const strikeInt = Math.round(strike * 1000);
  const strikeStr = strikeInt.toString().padStart(8, "0");
  const isoDate = normalizeExpiryToIso(expiry);
  const expDigits = isoDate.replace(/-/g, "").slice(2); // YYMMDD
  const cp = optionType === "call" ? "C" : "P";
  return { contractSymbol: `O:${contractTicker}${expDigits}${cp}${strikeStr}`, parentTicker };
}

interface OptionQuoteResult {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  underlying: number | null;
  iv: number | null;
  delta: number | null;
  fetchedAt: number;
  contractSymbol: string;
  expiry: string;
}

async function fetchOptionQuote(ticker: string, expiry: string | Date, optionType: "call" | "put", strike: number): Promise<OptionQuoteResult | null> {
  const polygonKey = getPolygonKey();
  if (!polygonKey) {
    console.warn(`[paper-trade] fetchOptionQuote: POLYGON_API_KEY missing for ${ticker} ${String(expiry)} ${optionType} ${strike}`);
    return null;
  }
  const { contractSymbol, parentTicker } = buildOptionContractSymbol(ticker, expiry, optionType, strike);
  const url = `https://api.polygon.io/v3/snapshot/options/${parentTicker}/${contractSymbol}?apiKey=${polygonKey}`;
  // Mask the key in logs — only show the last 4 characters of the URL path (without the apiKey query param).
  const safeUrl = `https://api.polygon.io/v3/snapshot/options/${parentTicker}/${contractSymbol}`;
  // Single inner attempt — caller may retry once on AbortError below.
  async function attempt(): Promise<OptionQuoteResult | null> {
    const t0 = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      let body = "";
      try { body = (await res.text()).slice(0, 300); } catch { body = "<unreadable>"; }
      console.warn(`[paper-trade] Polygon ${res.status} ${res.statusText} for ${contractSymbol} (${elapsed}ms) url=${safeUrl} body=${body}`);
      return null;
    }
    let json: any;
    try {
      json = await res.json();
    } catch (parseErr: any) {
      console.warn(`[paper-trade] Polygon JSON parse failed for ${contractSymbol} (${elapsed}ms): ${parseErr?.message}`);
      return null;
    }
    const r = json?.results;
    if (!r) {
      const snippet = JSON.stringify(json ?? {}).slice(0, 300);
      console.warn(`[paper-trade] Polygon empty results for ${contractSymbol} (${elapsed}ms) status=${json?.status} reqId=${json?.request_id} body=${snippet}`);
      return null;
    }
    const bid = r.last_quote?.bid ?? null;
    const ask = r.last_quote?.ask ?? null;
    const midRaw = r.last_quote?.midpoint ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
    const last = r.day?.close ?? r.last_trade?.price ?? null;
    return {
      bid: bid != null ? Number(bid) : null,
      ask: ask != null ? Number(ask) : null,
      mid: midRaw != null ? Number(midRaw) : null,
      last: last != null ? Number(last) : null,
      underlying: r.underlying_asset?.price != null ? Number(r.underlying_asset.price) : null,
      iv: r.implied_volatility != null ? Math.round(r.implied_volatility * 10000) / 100 : null,
      delta: r.greeks?.delta != null ? Math.round(r.greeks.delta * 1000) / 1000 : null,
      fetchedAt: Date.now(),
      contractSymbol,
      expiry: normalizeExpiryToIso(expiry),
    };
  }
  try {
    return await attempt();
  } catch (e: any) {
    // Retry exactly once on timeout/abort. Anything else (network refused,
    // DNS, JSON parse) bubbles to the outer catch and returns null.
    const isAbort = e?.name === "AbortError" || e?.name === "TimeoutError" || /aborted|timeout/i.test(String(e?.message ?? ""));
    if (!isAbort) {
      console.warn(`[paper-trade] Quote fetch failed ${contractSymbol}: ${e?.message}`);
      return null;
    }
    try {
      const r = await attempt();
      if (r) console.warn(`[paper-trade] Quote fetch recovered on retry ${contractSymbol}`);
      return r;
    } catch (e2: any) {
      console.warn(`[paper-trade] Quote fetch failed ${contractSymbol} (after 1 retry): ${e2?.message}`);
      return null;
    }
  }
}

// Paper Automation Engine — Commit 4 (Exit Strategy Layer) thresholds.
// All four are option-P&L percentages computed off the SAME price source as
// the actual exit fill (pickExitFill: bid → mid → last). Keeping the threshold
// price source aligned with the fill source guarantees that when we say
// "close at +40%", the realized P&L written to the DB will read +40% (or very
// near it — same price). Mixing mid for the threshold and bid for the fill
// would create systematic disagreement between the trigger reason and the
// realized number. Hard-coded at file scope (not per-trade) per Phase 1 spec.
const HARD_STOP_PCT = -25;          // close if option P&L ≤ -25%
const PROFIT_TARGET_PCT = 40;       // close if option P&L ≥ +40%
const TRAILING_ACTIVATION_PCT = 20; // arm trailing once option P&L ≥ +20%
const TRAILING_DRAWDOWN_PCT = 10;   // close if option price ≤ peak × (1 − 10%)

function pickEntryFill(q: OptionQuoteResult): { price: number; source: string } | null {
  if (q.ask != null && q.ask > 0) return { price: q.ask, source: "ask" };
  if (q.mid != null && q.mid > 0) return { price: q.mid, source: "mid" };
  if (q.last != null && q.last > 0) return { price: q.last, source: "last" };
  return null;
}

function pickExitFill(q: OptionQuoteResult, isExpired: boolean, isItm: boolean | null): { price: number; source: string } | null {
  if (q.bid != null && q.bid > 0) return { price: q.bid, source: "bid" };
  if (q.mid != null && q.mid > 0) return { price: q.mid, source: "mid" };
  if (q.last != null && q.last > 0) return { price: q.last, source: "last" };
  if (isExpired && isItm === false) return { price: 0, source: "expired_otm" };
  return null;
}

function isContractExpired(expiry: string): boolean {
  // Expired after 4pm ET on the expiry date. DST-safe via Intl.DateTimeFormat.
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false,
    }).formatToParts(new Date()).reduce<Record<string, string>>((acc, p) => { if (p.type !== "literal") acc[p.type] = p.value; return acc; }, {});
    const nyDate = `${parts.year}-${parts.month}-${parts.day}`;
    const nyHour = parseInt(parts.hour, 10);
    if (nyDate > expiry) return true;
    if (nyDate === expiry && nyHour >= 16) return true;
    return false;
  } catch { return false; }
}

function isItmAtPrice(optionType: "call" | "put", strike: number, underlying: number | null): boolean | null {
  if (underlying == null) return null;
  return optionType === "call" ? underlying > strike : underlying < strike;
}

function normalizeExpiryToYMD(input: unknown): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const isoHead = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoHead) && (raw.length === 10 || raw[10] === "T" || raw[10] === " ")) return isoHead;
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (usMatch) {
    const mm = usMatch[1].padStart(2, "0");
    const dd = usMatch[2].padStart(2, "0");
    return `${usMatch[3]}-${mm}-${dd}`;
  }
  const monthMap: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const monthMatch = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw);
  if (monthMatch) {
    const mm = monthMap[monthMatch[1].slice(0, 3).toLowerCase()];
    if (mm) {
      const dd = monthMatch[2].padStart(2, "0");
      return `${monthMatch[3]}-${mm}-${dd}`;
    }
  }
  return null;
}

function pickLastQuoteFill(q: OptionQuoteResult): { price: number | null; source: string | null } {
  if (q.bid != null && q.bid > 0) return { price: q.bid, source: "bid" };
  if (q.mid != null && q.mid > 0) return { price: q.mid, source: "mid" };
  if (q.last != null && q.last > 0) return { price: q.last, source: "last" };
  return { price: null, source: null };
}

function shouldAutoCloseTarget(optionType: string, underlying: number | null, target: number | null): boolean {
  if (target == null || underlying == null) return false;
  return optionType === "call" ? underlying >= target : underlying <= target;
}
function shouldAutoCloseStop(optionType: string, underlying: number | null, stop: number | null): boolean {
  if (stop == null || underlying == null) return false;
  return optionType === "call" ? underlying <= stop : underlying >= stop;
}

// Auto-close eval. Phase 1 / Commit 4 — Exit Strategy Layer.
//
// Per-tick decision tree, in strict priority order. The first true branch
// wins. The new option-P&L rules (hard_stop, profit_target, trailing_stop)
// fire BEFORE the legacy underlying rules (stop_hit, target_hit) so the
// exit strategy actually protects capital instead of letting a trade go
// green → red.
//
//   1. closed_expired   — contract past 4pm ET on expiry day
//   2. hard_stop        — option P&L ≤ HARD_STOP_PCT          (NEW)
//   3. profit_target    — option P&L ≥ PROFIT_TARGET_PCT      (NEW)
//   4. trailing_stop    — armed AND fill ≤ peak × (1 − draw)  (NEW)
//   5. stop_hit         — underlying crossed signal_invalidation
//   6. target_hit       — underlying crossed signal_target
//
// Trailing state is updated EVERY tick that has a usable fill, BEFORE the
// exit decision, so:
//   • activation (option P&L crossing +20%) latches trailing_active=true
//     and seeds the peak with the current fill (drawdown = 0% on the same
//     tick → no premature trigger).
//   • peak is monotone non-decreasing — bumped only when fill > peak.
//   • a missed quote (no fill) leaves both fields untouched, so the peak
//     persists across gaps.
//
// When there is NO fill (Polygon returned no bid/mid/last and the contract
// isn't expired), option-P&L exits cannot be evaluated; we fall through to
// the legacy underlying-only checks. This preserves Commit 0 behavior for
// quote-starved contracts and never lets an option-P&L threshold fire on
// stale data.
async function evaluateAndMaybeClose(t: any, q: OptionQuoteResult): Promise<{ closed: boolean; row?: any; lastFill: { price: number | null; source: string | null }; exitReason?: string; fill?: { price: number; source: string } }> {
  const expiryStr = normalizeExpiryToIso(t.expiry);
  const expired = isContractExpired(expiryStr);
  // Use realtime priceMonitor underlying (matches live signal triggers); fall back to snapshot.
  const rt = priceMonitor.getPrice(t.ticker);
  const underlying = (rt?.price != null && Number.isFinite(rt.price)) ? rt.price : q.underlying;
  const target = t.signal_target != null ? Number(t.signal_target) : null;
  const stop = t.signal_invalidation != null ? Number(t.signal_invalidation) : null;
  const lastFill = pickLastQuoteFill(q);
  const itm = isItmAtPrice(t.option_type, Number(t.strike), underlying);
  const fill = pickExitFill(q, expired, itm);

  const entry = Number(t.entry_price);
  const contracts = Number(t.contracts);

  // ── Trailing-state evolution (latched, monotone, tick-local) ────────────
  // Read current state from the row, then advance it only when we have a
  // usable fill. Computed BEFORE the exit decision so the trailing_stop
  // check below sees this tick's freshly-bumped peak.
  let trailingActive = !!t.trailing_active;
  let trailingPeak = t.highest_price_after_activation != null && Number.isFinite(Number(t.highest_price_after_activation))
    ? Number(t.highest_price_after_activation)
    : null;
  if (fill && entry > 0) {
    const pnlPctTick = ((fill.price - entry) / entry) * 100;
    if (!trailingActive && pnlPctTick >= TRAILING_ACTIVATION_PCT) {
      // First crossing of activation threshold — latch on, seed peak.
      trailingActive = true;
      trailingPeak = fill.price;
    }
    if (trailingActive && (trailingPeak == null || fill.price > trailingPeak)) {
      // Bump peak only on new highs. Never lower.
      trailingPeak = fill.price;
    }
  }

  // ── Exit decision in strict priority order ──────────────────────────────
  let exitReason: string | null = null;
  if (expired) {
    exitReason = "closed_expired";
  } else if (fill && entry > 0) {
    const pnlPct = ((fill.price - entry) / entry) * 100;
    if (pnlPct <= HARD_STOP_PCT) exitReason = "hard_stop";
    else if (pnlPct >= PROFIT_TARGET_PCT) exitReason = "profit_target";
    else if (
      trailingActive &&
      trailingPeak != null && trailingPeak > 0 &&
      fill.price <= trailingPeak * (1 - TRAILING_DRAWDOWN_PCT / 100)
    ) exitReason = "trailing_stop";
    else if (shouldAutoCloseStop(t.option_type, underlying, stop)) exitReason = "stop_hit";
    else if (shouldAutoCloseTarget(t.option_type, underlying, target)) exitReason = "target_hit";
  } else {
    // No usable option fill → can't evaluate option-P&L thresholds. Fall
    // through to legacy underlying-only exits so quote-starved contracts
    // still respect signal target/invalidation.
    if (shouldAutoCloseStop(t.option_type, underlying, stop)) exitReason = "stop_hit";
    else if (shouldAutoCloseTarget(t.option_type, underlying, target)) exitReason = "target_hit";
  }

  // ── No exit → refresh quote snapshot + persist trailing state ───────────
  if (!exitReason) {
    await dbQuery(
      `UPDATE paper_trades SET last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
        last_quote_bid = $4, last_quote_ask = $5, last_quote_mid = $6, last_quote_last = $7,
        trailing_active = $8, highest_price_after_activation = $9,
        last_checked_at = NOW() WHERE id = $10 AND status = 'open'`,
      [lastFill.price, lastFill.source, underlying, q.bid, q.ask, q.mid, q.last, trailingActive, trailingPeak, t.id]
    ).catch(() => null);
    return { closed: false, lastFill };
  }

  // ── Exit decided but no usable fill ─────────────────────────────────────
  // Only reachable on the legacy underlying-only branch above OR when
  // expired. For non-expired no-fill we cannot compute realized P&L, so
  // we just persist freshness + return the exitReason without closing.
  // (Commit 0 behavior; preserved verbatim.)
  if (!fill) {
    if (expired) {
      // Expired with no usable fill levels: force close via intrinsic/0 (never leave expired open).
      const r = await closeExpiredNoQuote(t);
      if (r.closed) {
        return { closed: true, row: r.row, lastFill, exitReason: "closed_expired", fill: { price: r.exitPrice, source: r.source } };
      }
      return { closed: false, lastFill, exitReason: "closed_expired" };
    }
    await dbQuery(
      `UPDATE paper_trades SET last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
        last_quote_bid = $4, last_quote_ask = $5, last_quote_mid = $6, last_quote_last = $7,
        trailing_active = $8, highest_price_after_activation = $9,
        last_checked_at = NOW() WHERE id = $10 AND status = 'open'`,
      [lastFill.price, lastFill.source, underlying, q.bid, q.ask, q.mid, q.last, trailingActive, trailingPeak, t.id]
    ).catch(() => null);
    return { closed: false, lastFill, exitReason };
  }

  // ── Close: write exit fill, P&L, exit_reason + final trailing snapshot ──
  // Final $12/$13 carry the up-to-date trailing state so post-mortem queries
  // can see the peak and whether trailing was ever armed on this trade.
  const realizedPl = (fill.price - entry) * contracts * 100;
  const realizedPlPct = entry > 0 ? ((fill.price - entry) / entry) * 100 : 0;
  const upd = await dbQuery(
    `UPDATE paper_trades SET status = 'closed', exit_price = $1, exit_fill_source = $2,
      exit_underlying = $3, exit_reason = $4, closed_at = NOW(),
      realized_pl = $5, realized_pl_pct = $6,
      exit_bid = $8, exit_ask = $9, exit_mid = $10, exit_last = $11,
      last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
      last_quote_bid = $8, last_quote_ask = $9, last_quote_mid = $10, last_quote_last = $11,
      trailing_active = $12, highest_price_after_activation = $13,
      last_checked_at = NOW()
     WHERE id = $7 AND status = 'open' RETURNING *`,
    [fill.price, fill.source, underlying, exitReason, realizedPl, realizedPlPct, t.id, q.bid, q.ask, q.mid, q.last, trailingActive, trailingPeak]
  ).catch(() => null);
  if (!upd || !upd.rowCount) return { closed: false, lastFill, exitReason, fill };
  return { closed: true, row: upd.rows[0], lastFill, exitReason, fill };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paper Automation Engine — Commit 1: pending_entry evaluation.
//
// A pending_entry row is a paper trade that has been queued but not yet filled.
// The monitor calls evaluatePendingEntry() once per cycle for each such row.
//
// Outcomes:
//   1) Pending window expired (pending_expires_at < NOW())  → status='cancelled'
//      with pending_cancel_reason='expired_unfilled'.
//   2) Underlying contract already expired                   → status='cancelled'
//      with pending_cancel_reason='contract_expired'.
//   3) Underlying crosses the trigger:
//        direction='at_or_below' → fires when underlying <= entry_trigger_price
//        direction='at_or_above' → fires when underlying >= entry_trigger_price
//      The row is atomically promoted to status='open' with entry_price set
//      from the live ask (pickEntryFill, same path as market-mode entries),
//      opened_at=NOW(), entry_underlying = trigger-time underlying.
//   4) None of the above → just refresh last_quote_* snapshot + last_checked_at.
//
// Uses priceMonitor.getPrice() for the underlying when available so that the
// trigger fires off the same realtime tick that drives signal evaluation.
// Falls back to q.underlying (Polygon snapshot) when realtime is unavailable.
// ─────────────────────────────────────────────────────────────────────────────
async function evaluatePendingEntry(t: any, q: OptionQuoteResult): Promise<{
  triggered: boolean;
  cancelled?: boolean;
  cancelReason?: string;
  row?: any;
  underlying?: number | null;
  fill?: { price: number; source: string };
}> {
  const expiryStr = normalizeExpiryToIso(t.expiry);

  // Pre-flight: contract itself expired → cancel (never let a pending_entry
  // sit on an expired contract; would never fill).
  if (isContractExpired(expiryStr)) {
    await dbQuery(
      `UPDATE paper_trades SET status = 'cancelled', pending_cancel_reason = 'contract_expired',
        closed_at = NOW(), last_checked_at = NOW()
       WHERE id = $1 AND status = 'pending_entry'`,
      [t.id]
    ).catch(() => null);
    return { triggered: false, cancelled: true, cancelReason: "contract_expired" };
  }

  // Pre-flight: pending window expired → cancel.
  if (t.pending_expires_at != null) {
    const expiresMs = new Date(t.pending_expires_at).getTime();
    if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
      await dbQuery(
        `UPDATE paper_trades SET status = 'cancelled', pending_cancel_reason = 'expired_unfilled',
          closed_at = NOW(), last_checked_at = NOW()
         WHERE id = $1 AND status = 'pending_entry'`,
        [t.id]
      ).catch(() => null);
      return { triggered: false, cancelled: true, cancelReason: "expired_unfilled" };
    }
  }

  // Underlying — prefer realtime priceMonitor (matches live signal triggers).
  const rt = priceMonitor.getPrice(t.ticker);
  const underlying = (rt?.price != null && Number.isFinite(rt.price)) ? rt.price : q.underlying;
  if (underlying == null || !Number.isFinite(underlying)) {
    await dbQuery(
      `UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1 AND status = 'pending_entry'`,
      [t.id]
    ).catch(() => null);
    return { triggered: false, underlying: null };
  }

  // Trigger evaluation.
  const trigger = Number(t.entry_trigger_price);
  const direction = String(t.entry_trigger_direction || "");
  let triggered = false;
  if (Number.isFinite(trigger) && trigger > 0) {
    if (direction === "at_or_below" && underlying <= trigger) triggered = true;
    if (direction === "at_or_above" && underlying >= trigger) triggered = true;
  }

  if (!triggered) {
    // Not triggered: refresh quote snapshot so dashboard can show current state.
    const lastFill = pickLastQuoteFill(q);
    await dbQuery(
      `UPDATE paper_trades SET
        last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
        last_quote_bid = $4, last_quote_ask = $5, last_quote_mid = $6, last_quote_last = $7,
        last_checked_at = NOW()
       WHERE id = $8 AND status = 'pending_entry'`,
      [lastFill.price, lastFill.source, q.underlying, q.bid, q.ask, q.mid, q.last, t.id]
    ).catch(() => null);
    return { triggered: false, underlying };
  }

  // Triggered → promote to open at live ask (same fill rule as market-mode entries).
  const fill = pickEntryFill(q);
  if (!fill) {
    // No tradeable price right now — leave pending, retry next cycle.
    await dbQuery(
      `UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1 AND status = 'pending_entry'`,
      [t.id]
    ).catch(() => null);
    return { triggered: false, underlying };
  }

  // Atomic promotion: only updates if row is still pending_entry (prevents
  // double-fill in the unlikely case of overlapping cycles).
  const upd = await dbQuery(
    `UPDATE paper_trades SET
      status = 'open',
      entry_price = $1, entry_fill_source = $2, entry_underlying = $3,
      entry_iv = $4, entry_delta = $5,
      entry_bid = $6, entry_ask = $7, entry_mid = $8, entry_last = $9,
      last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
      last_quote_bid = $6, last_quote_ask = $7, last_quote_mid = $8, last_quote_last = $9,
      opened_at = NOW(), last_checked_at = NOW()
     WHERE id = $10 AND status = 'pending_entry'
     RETURNING *`,
    [fill.price, fill.source, underlying, q.iv, q.delta, q.bid, q.ask, q.mid, q.last, t.id]
  );
  if (!upd || !upd.rowCount) {
    return { triggered: false, underlying };
  }
  return { triggered: true, row: upd.rows[0], underlying, fill };
}

// POST /whale/paper/quote — preview a quote (no DB writes) before creating a paper trade
router.post("/whale/paper/quote", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { ticker, optionType, strike, expiry } = req.body || {};
    if (!ticker || !optionType || !strike || !expiry) {
      return res.status(400).json({ error: "ticker, optionType, strike, expiry required" });
    }
    const ot = optionType === "call" ? "call" : optionType === "put" ? "put" : null;
    if (!ot) return res.status(400).json({ error: "optionType must be call or put" });
    const strikeNum = Number(strike);
    if (!Number.isFinite(strikeNum) || strikeNum <= 0) return res.status(400).json({ error: "invalid strike" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry))) return res.status(400).json({ error: "expiry must be YYYY-MM-DD" });
    const q = await fetchOptionQuote(String(ticker).toUpperCase(), String(expiry), ot, strikeNum);
    if (!q) return res.status(503).json({ error: "Quote unavailable. The contract may be illiquid or markets are closed — try again later." });
    // Require at least one usable price level — refuse to surface an empty-book quote.
    const hasUsable =
      (q.bid != null && q.bid > 0) ||
      (q.ask != null && q.ask > 0) ||
      (q.mid != null && q.mid > 0) ||
      (q.last != null && q.last > 0);
    if (!hasUsable) {
      return res.status(503).json({
        error: "No live quote available for this contract right now. Bid/ask/mid/last are all empty — the contract may be illiquid or the market is closed.",
      });
    }
    const fill = pickEntryFill(q);
    res.json({
      bid: q.bid,
      ask: q.ask,
      mid: q.mid,
      last: q.last,
      underlying_price: q.underlying,
      asOf: new Date(q.fetchedAt).toISOString(),
      iv: q.iv,
      delta: q.delta,
      contractSymbol: q.contractSymbol,
      suggestedEntry: fill,
      note: "Paper trades enter at the ask. If no ask is available, we fall back to mid, then last.",
    });
  } catch (e: any) {
    console.error("[paper-trade] /quote error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /whale/paper/alternatives — recommended contract + 1-3 budget alternatives (same expiry, same type, neighbor strikes)
router.post("/whale/paper/alternatives", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { ticker, optionType, strike, expiry: rawExpiry } = req.body || {};
    if (!ticker || !optionType || !strike || !rawExpiry) {
      return res.status(400).json({ error: "ticker, optionType, strike, expiry required" });
    }
    const ot: "call" | "put" | null = optionType === "call" ? "call" : optionType === "put" ? "put" : null;
    if (!ot) return res.status(400).json({ error: "optionType must be call or put" });
    const recStrike = Number(strike);
    if (!Number.isFinite(recStrike) || recStrike <= 0) return res.status(400).json({ error: "invalid strike" });
    const expiry = normalizeExpiryToYMD(rawExpiry);
    if (!expiry) {
      console.warn(`[paper-trade] alternatives: unparseable expiry from ${userId}: ${JSON.stringify(rawExpiry)}`);
      return res.status(400).json({ error: "expiry must be YYYY-MM-DD or ISO/MM-DD-YYYY" });
    }

    const polygonKey = getPolygonKey();
    if (!polygonKey) return res.status(503).json({ error: "Quotes unavailable" });
    const tickerUp = String(ticker).toUpperCase();
    const parentTicker = tickerUp === "SPXW" ? "SPX" : tickerUp;

    // Bound the chain query to a ±20% strike window so the single 250-item page reliably contains
    // neighbor strikes even on dense chains (e.g., SPY weekly), avoiding the need for pagination.
    const strikeLo = Math.max(0.01, recStrike * 0.8);
    const strikeHi = recStrike * 1.2;
    const chainUrl = `https://api.polygon.io/v3/snapshot/options/${parentTicker}?expiration_date=${expiry}&contract_type=${ot}&strike_price.gte=${strikeLo}&strike_price.lte=${strikeHi}&limit=250&apiKey=${polygonKey}`;
    let chainItems: any[] = [];
    try {
      const r = await fetch(chainUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j: any = await r.json();
        chainItems = Array.isArray(j?.results) ? j.results : [];
      }
    } catch (e: any) {
      console.warn(`[paper-trade] chain fetch failed ${parentTicker} ${expiry} ${ot}: ${e?.message}`);
    }

    // Build a strike-indexed view; compute entry fill (ask→mid→last) per item.
    type ChainEntry = { strike: number; bid: number | null; ask: number | null; mid: number | null; last: number | null; entry: number | null; entrySource: string | null; underlying: number | null; iv: number | null; delta: number | null; contractSymbol: string };
    const entries: ChainEntry[] = chainItems
      .map((it: any) => {
        const s = Number(it?.details?.strike_price);
        if (!Number.isFinite(s)) return null;
        const bid = it?.last_quote?.bid != null ? Number(it.last_quote.bid) : null;
        const ask = it?.last_quote?.ask != null ? Number(it.last_quote.ask) : null;
        const mid = it?.last_quote?.midpoint != null ? Number(it.last_quote.midpoint) : (bid != null && ask != null ? (bid + ask) / 2 : null);
        const last = it?.day?.close ?? it?.last_trade?.price ?? null;
        let entry: number | null = null, entrySource: string | null = null;
        if (ask != null && ask > 0) { entry = ask; entrySource = "ask"; }
        else if (mid != null && mid > 0) { entry = mid; entrySource = "mid"; }
        else if (last != null && last > 0) { entry = Number(last); entrySource = "last"; }
        return {
          strike: s,
          bid, ask, mid, last: last != null ? Number(last) : null,
          entry, entrySource,
          underlying: it?.underlying_asset?.price != null ? Number(it.underlying_asset.price) : null,
          iv: it?.implied_volatility != null ? Math.round(it.implied_volatility * 10000) / 100 : null,
          delta: it?.greeks?.delta != null ? Math.round(it.greeks.delta * 1000) / 1000 : null,
          contractSymbol: String(it?.details?.ticker || ""),
        } as ChainEntry;
      })
      .filter((x: ChainEntry | null): x is ChainEntry => x !== null)
      .sort((a, b) => a.strike - b.strike);

    // Always re-fetch the recommended directly to ensure it's present even if chain is empty.
    const recQuote = await fetchOptionQuote(tickerUp, String(expiry), ot, recStrike);
    let recommended: ChainEntry | null = null;
    if (recQuote) {
      const fill = pickEntryFill(recQuote);
      recommended = {
        strike: recStrike,
        bid: recQuote.bid, ask: recQuote.ask, mid: recQuote.mid, last: recQuote.last,
        entry: fill?.price ?? null, entrySource: fill?.source ?? null,
        underlying: recQuote.underlying, iv: recQuote.iv, delta: recQuote.delta,
        contractSymbol: recQuote.contractSymbol,
      };
    } else {
      const inChain = entries.find((e) => Math.abs(e.strike - recStrike) < 1e-6);
      recommended = inChain ?? null;
    }
    if (!recommended) return res.status(503).json({ error: "Quote unavailable for the recommended contract." });

    // Pick alternative strike candidates: prefer cheaper (more OTM), then one safer (more ITM).
    // Calls: more OTM = higher strike. Puts: more OTM = lower strike.
    const recIdx = entries.findIndex((e) => Math.abs(e.strike - recStrike) < 1e-6);
    const candidates: ChainEntry[] = [];
    if (recIdx >= 0) {
      const liquid = (e: ChainEntry) => e.entry != null && e.entry > 0;
      const pickFromDir = (dir: 1 | -1, max: number): ChainEntry[] => {
        const out: ChainEntry[] = [];
        for (let step = 1; step <= 6 && out.length < max; step++) {
          const idx = recIdx + dir * step;
          if (idx < 0 || idx >= entries.length) break;
          const e = entries[idx];
          if (liquid(e)) out.push(e);
        }
        return out;
      };
      const otmDir: 1 | -1 = ot === "call" ? 1 : -1;
      const itmDir: 1 | -1 = ot === "call" ? -1 : 1;
      candidates.push(...pickFromDir(otmDir, 2)); // up to 2 cheaper (more OTM)
      candidates.push(...pickFromDir(itmDir, 1)); // up to 1 safer (more ITM)
    }

    // Label each candidate by cost ratio vs recommended entry; cap to 3 alternatives total.
    type Alt = ChainEntry & { label: string; expiry: string; optionType: "call" | "put"; ticker: string; costPer1: number | null; isRecommended: boolean };
    const recEntry = recommended.entry;
    const labelFor = (entry: number | null, strike: number): string => {
      if (recEntry == null || entry == null) return "Alternative";
      const ratio = entry / recEntry;
      const moreOtm = ot === "call" ? strike > recStrike : strike < recStrike;
      if (ratio >= 1.2) return "Safer · Higher Cost";
      if (ratio <= 0.5) return "Budget Alternative";
      if (moreOtm && ratio < 0.95) return "Lower Cost · Higher Risk";
      return "Alternative";
    };
    const toAlt = (e: ChainEntry, isRecommended: boolean): Alt => ({
      ...e,
      label: isRecommended ? "Recommended Contract" : labelFor(e.entry, e.strike),
      expiry: String(expiry),
      optionType: ot,
      ticker: tickerUp,
      costPer1: e.entry != null ? Math.round(e.entry * 100 * 100) / 100 : null,
      isRecommended,
    });
    const altsLimited = candidates.slice(0, 3);
    const out: Alt[] = [toAlt(recommended, true), ...altsLimited.map((c) => toAlt(c, false))];

    // ─── Budget Option (≤ $300) ─────────────────────────────────────────────────
    // Pick one accessible contract for smaller accounts:
    //   1. Ask ≤ $3.00 (≤ $300 premium) when available
    //   2. Same direction (already enforced by chain query)
    //   3. Same expiration preferred — if none qualify, extend DTE up to +14 days
    //   4. Among under-$3 candidates: choose HIGHEST |delta| (most ATM, most responsive)
    //      with a hard cap on extreme spreads (≤ 50% of mid) for liquidity sanity
    //   5. If nothing under $3 anywhere, pick cheapest viable & label "Lowest Cost Available (Above Budget)"
    const viable = (e: ChainEntry): boolean => e.entry != null && e.entry > 0 && e.bid != null && e.ask != null && e.bid > 0;
    const reasonableSpread = (e: ChainEntry): boolean => {
      if (e.bid == null || e.ask == null) return false;
      const mid = (e.bid + e.ask) / 2;
      if (mid <= 0) return false;
      return (e.ask - e.bid) / mid <= 0.50;
    };
    const pickHighestDeltaUnderBudget = (es: ChainEntry[]): ChainEntry | null => {
      const pool = es.filter((e) => viable(e) && e.entry! <= 3.00 && reasonableSpread(e));
      if (pool.length === 0) return null;
      pool.sort((a, b) => {
        const da = a.delta != null ? Math.abs(a.delta) : -1;
        const db = b.delta != null ? Math.abs(b.delta) : -1;
        if (Math.abs(da - db) > 0.005) return db - da;          // higher |delta| first
        const sa = (a.ask! - a.bid!) / Math.max(0.01, (a.ask! + a.bid!) / 2);
        const sb = (b.ask! - b.bid!) / Math.max(0.01, (b.ask! + b.bid!) / 2);
        if (Math.abs(sa - sb) > 0.05) return sa - sb;            // tiebreak: tighter spread
        return a.entry! - b.entry!;                              // tiebreak: lower cost
      });
      return pool[0];
    };

    let budget: ChainEntry | null = null;
    let budgetExpiry = String(expiry);
    let budgetLabel = "Budget Option (≤ $300)";

    // Phase 1: same expiry, under $3 with sane spread
    budget = pickHighestDeltaUnderBudget(entries);

    // Phase 2: looser same-expiry — under $3 with bid+ask, ignoring spread filter
    if (!budget) {
      const looser = entries.filter((e) => viable(e) && e.entry! <= 3.00);
      if (looser.length > 0) {
        looser.sort((a, b) => {
          const da = a.delta != null ? Math.abs(a.delta) : -1;
          const db = b.delta != null ? Math.abs(b.delta) : -1;
          if (Math.abs(da - db) > 0.005) return db - da;
          return a.entry! - b.entry!;
        });
        budget = looser[0];
      }
    }

    // Phase 3: DTE extension — scan next available expirations within +14 days
    if (!budget) {
      const expiryDate = new Date(`${expiry}T00:00:00Z`);
      if (!Number.isNaN(expiryDate.getTime())) {
        const lo = new Date(expiryDate); lo.setUTCDate(lo.getUTCDate() + 1);
        const hi = new Date(expiryDate); hi.setUTCDate(hi.getUTCDate() + 14);
        const loStr = lo.toISOString().slice(0, 10);
        const hiStr = hi.toISOString().slice(0, 10);
        const extUrl = `https://api.polygon.io/v3/snapshot/options/${parentTicker}?expiration_date.gte=${loStr}&expiration_date.lte=${hiStr}&contract_type=${ot}&strike_price.gte=${strikeLo}&strike_price.lte=${strikeHi}&limit=250&apiKey=${polygonKey}`;
        let extItems: any[] = [];
        try {
          const r = await fetch(extUrl, { signal: AbortSignal.timeout(8000) });
          if (r.ok) {
            const j: any = await r.json();
            extItems = Array.isArray(j?.results) ? j.results : [];
          }
        } catch (e: any) {
          console.warn(`[paper-trade] DTE-ext chain fetch failed ${parentTicker} ${ot}: ${e?.message}`);
        }
        type ExtEntry = ChainEntry & { ext_expiry: string };
        const extEntries: ExtEntry[] = extItems
          .map((it: any): ExtEntry | null => {
            const s = Number(it?.details?.strike_price);
            const ed = String(it?.details?.expiration_date || "");
            if (!Number.isFinite(s) || !ed) return null;
            const bid = it?.last_quote?.bid != null ? Number(it.last_quote.bid) : null;
            const ask = it?.last_quote?.ask != null ? Number(it.last_quote.ask) : null;
            const mid = it?.last_quote?.midpoint != null ? Number(it.last_quote.midpoint) : (bid != null && ask != null ? (bid + ask) / 2 : null);
            const last = it?.day?.close ?? it?.last_trade?.price ?? null;
            let entry: number | null = null, entrySource: string | null = null;
            if (ask != null && ask > 0) { entry = ask; entrySource = "ask"; }
            else if (mid != null && mid > 0) { entry = mid; entrySource = "mid"; }
            else if (last != null && last > 0) { entry = Number(last); entrySource = "last"; }
            return {
              strike: s, bid, ask, mid, last: last != null ? Number(last) : null,
              entry, entrySource,
              underlying: it?.underlying_asset?.price != null ? Number(it.underlying_asset.price) : null,
              iv: it?.implied_volatility != null ? Math.round(it.implied_volatility * 10000) / 100 : null,
              delta: it?.greeks?.delta != null ? Math.round(it.greeks.delta * 1000) / 1000 : null,
              contractSymbol: String(it?.details?.ticker || ""),
              ext_expiry: ed,
            };
          })
          .filter((x: ExtEntry | null): x is ExtEntry => x !== null);
        // Prefer nearest expiration first, then highest |delta| under $3, then lowest entry
        const extPool = extEntries.filter((e) => viable(e) && e.entry! <= 3.00 && reasonableSpread(e));
        if (extPool.length > 0) {
          extPool.sort((a, b) => {
            if (a.ext_expiry !== b.ext_expiry) return a.ext_expiry < b.ext_expiry ? -1 : 1;
            const da = a.delta != null ? Math.abs(a.delta) : -1;
            const db = b.delta != null ? Math.abs(b.delta) : -1;
            if (Math.abs(da - db) > 0.005) return db - da;
            return a.entry! - b.entry!;
          });
          const pick = extPool[0];
          budget = pick;
          budgetExpiry = pick.ext_expiry;
        }
      }
    }

    // Phase 4: final fallback — cheapest viable on same expiry, label flips to "Above Budget"
    if (!budget) {
      const anyViable = entries.filter(viable);
      if (anyViable.length > 0) {
        anyViable.sort((a, b) => a.entry! - b.entry!);
        budget = anyViable[0];
        budgetLabel = "Lowest Cost Available (Above Budget)";
      }
    }

    // Insert as the 2nd row (right after Recommended), unless it duplicates the
    // recommended contract. If it duplicates an existing alt row, remove that duplicate.
    if (budget && budget.contractSymbol !== recommended.contractSymbol) {
      const budgetAlt: Alt = {
        ...budget,
        label: budgetLabel,
        expiry: budgetExpiry,
        optionType: ot,
        ticker: tickerUp,
        costPer1: budget.entry != null ? Math.round(budget.entry * 100 * 100) / 100 : null,
        isRecommended: false,
      };
      for (let i = out.length - 1; i >= 1; i--) {
        if (out[i].contractSymbol === budgetAlt.contractSymbol) out.splice(i, 1);
      }
      out.splice(1, 0, budgetAlt);
      console.log(`[paper-trade] budget pick ${tickerUp} ${budgetExpiry} ${ot} strike=${budget.strike} entry=${budget.entry} delta=${budget.delta} label="${budgetLabel}"`);
    }

    res.json({ contracts: out, asOf: new Date().toISOString() });
  } catch (e: any) {
    console.error("[paper-trade] /alternatives error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Paper Automation Engine — Commit 2: safety controls (kill switch + cap) ──
// Single source of truth for the runtime safety knobs. Stored as plain rows in
// the existing app_settings key/value table (no new schema). Env vars override
// the DB values so the kill switch keeps working even if the DB is wedged.
//
// Keys:
//   paper_automation_paused        '1' | '0'  (default '0')
//   paper_automation_paused_reason free text  (set when paused via API)
//   paper_automation_paused_by     user id who flipped it (audit only)
//   paper_automation_paused_at     ISO timestamp string (set when paused)
//   paper_automation_max_open_pending  integer string (default '25')
//
// Cached for 10s in-process to keep monitor sweeps cheap. The pause check in
// the monitor and the cap check in POST /whale/paper/trades both go through
// getPaperAutomationSettings(), so DB flips take effect within ≤10s without a
// server restart.
const DEFAULT_MAX_OPEN_PENDING = 25;
const SETTINGS_CACHE_TTL_MS = 10_000;
type PaperAutomationSettings = {
  paused: boolean;
  pausedReason: string | null;
  pausedBy: string | null;
  pausedAt: string | null;
  maxOpenPending: number;
  source: { paused: "env" | "db" | "default"; max: "env" | "db" | "default" };
};
let _settingsCache: { at: number; value: PaperAutomationSettings } | null = null;

async function getPaperAutomationSettings(opts?: { force?: boolean }): Promise<PaperAutomationSettings> {
  const now = Date.now();
  if (!opts?.force && _settingsCache && now - _settingsCache.at < SETTINGS_CACHE_TTL_MS) {
    return _settingsCache.value;
  }
  const rows = await dbQuery(
    `SELECT key, value FROM app_settings WHERE key IN
      ('paper_automation_paused','paper_automation_paused_reason','paper_automation_paused_by',
       'paper_automation_paused_at','paper_automation_max_open_pending')`,
    []
  );
  const map = new Map<string, string>();
  for (const r of rows?.rows || []) map.set(r.key, r.value);

  const envPaused = process.env.PAPER_AUTOMATION_PAUSED;
  const envPausedFlag = envPaused === "1" || envPaused === "true";
  const dbPausedRaw = map.get("paper_automation_paused");
  const dbPausedFlag = dbPausedRaw === "1" || dbPausedRaw === "true";
  const paused = envPausedFlag || dbPausedFlag;
  const pausedSource: "env" | "db" | "default" =
    envPausedFlag ? "env" : (dbPausedRaw != null ? "db" : "default");

  const envMax = Number(process.env.PAPER_AUTOMATION_MAX_OPEN_PENDING);
  const dbMaxRaw = map.get("paper_automation_max_open_pending");
  const dbMax = dbMaxRaw != null ? Number(dbMaxRaw) : NaN;
  let maxOpenPending = DEFAULT_MAX_OPEN_PENDING;
  let maxSource: "env" | "db" | "default" = "default";
  if (Number.isFinite(envMax) && envMax > 0) { maxOpenPending = Math.floor(envMax); maxSource = "env"; }
  else if (Number.isFinite(dbMax) && dbMax > 0) { maxOpenPending = Math.floor(dbMax); maxSource = "db"; }

  const value: PaperAutomationSettings = {
    paused,
    pausedReason: envPausedFlag ? "PAPER_AUTOMATION_PAUSED env var" : (map.get("paper_automation_paused_reason") || null),
    pausedBy: map.get("paper_automation_paused_by") || null,
    pausedAt: map.get("paper_automation_paused_at") || null,
    maxOpenPending,
    source: { paused: pausedSource, max: maxSource },
  };
  _settingsCache = { at: now, value };
  return value;
}

function invalidatePaperAutomationSettingsCache(): void {
  _settingsCache = null;
}

async function isUserPaperAdmin(userId: string): Promise<boolean> {
  if (!userId) return false;
  const r = await dbQuery(`SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin' LIMIT 1`, [userId]);
  return !!(r && r.rows && r.rows.length);
}

// GET /whale/paper/automation-settings — read-only state for any auth user.
// Future UI banners can poll this to surface "automation paused" without
// granting toggle ability.
router.get("/whale/paper/automation-settings", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const s = await getPaperAutomationSettings();
    const isAdmin = await isUserPaperAdmin(userId);
    // Per-user count surfaced for the future cap-status display.
    const c = await dbQuery(
      `SELECT COUNT(*)::int AS n FROM paper_trades WHERE user_id = $1 AND status IN ('open','pending_entry')`,
      [userId]
    );
    const userOpenPending = c?.rows?.[0]?.n ?? 0;
    res.json({
      paused: s.paused,
      pausedReason: s.pausedReason,
      pausedBy: s.pausedBy,
      pausedAt: s.pausedAt,
      maxOpenPending: s.maxOpenPending,
      userOpenPending,
      capRemaining: Math.max(0, s.maxOpenPending - userOpenPending),
      source: s.source,
      isAdmin,
    });
  } catch (e: any) {
    console.error("[paper-trade] settings get error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /whale/paper/automation-settings — admin only. Body fields are all
// optional; omit a field to leave it unchanged. Examples:
//   { paused: true, reason: "incident: bad fills" }
//   { paused: false }
//   { maxOpenPending: 50 }
router.post("/whale/paper/automation-settings", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!(await isUserPaperAdmin(userId))) return res.status(403).json({ error: "Admin role required" });
    const { paused, reason, maxOpenPending } = req.body || {};

    if (paused !== undefined) {
      const flag = paused === true || paused === "1" || paused === "true";
      await dbQuery(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('paper_automation_paused', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [flag ? "1" : "0"]
      );
      if (flag) {
        const r = (typeof reason === "string" && reason.trim()) ? reason.trim().slice(0, 500) : "manual pause";
        await dbQuery(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('paper_automation_paused_reason', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [r]);
        await dbQuery(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('paper_automation_paused_by', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [userId]);
        await dbQuery(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('paper_automation_paused_at', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`, [new Date().toISOString()]);
        console.log(`[paper-trade] automation PAUSED by ${userId.slice(0,8)} reason="${r}"`);
      } else {
        // Unpause clears audit fields so a fresh pause writes new ones.
        await dbQuery(`DELETE FROM app_settings WHERE key IN ('paper_automation_paused_reason','paper_automation_paused_by','paper_automation_paused_at')`, []);
        console.log(`[paper-trade] automation RESUMED by ${userId.slice(0,8)}`);
      }
    }

    if (maxOpenPending !== undefined) {
      const n = Math.floor(Number(maxOpenPending));
      if (!Number.isFinite(n) || n < 1 || n > 1000) {
        return res.status(400).json({ error: "maxOpenPending must be an integer 1..1000" });
      }
      await dbQuery(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('paper_automation_max_open_pending', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [String(n)]
      );
      console.log(`[paper-trade] automation max_open_pending set to ${n} by ${userId.slice(0,8)}`);
    }

    invalidatePaperAutomationSettingsCache();
    const updated = await getPaperAutomationSettings({ force: true });
    res.json({ success: true, settings: updated });
  } catch (e: any) {
    console.error("[paper-trade] settings post error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /whale/paper/trades — open a paper trade (server re-fetches quote, fills at ask)
router.post("/whale/paper/trades", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // ─── Market-Hours Gate (Phase 1, Apr 2026) ────────────────────────────
    // Trade-execution actions are intraday-only. Both Buy Now (market mode)
    // and Queue at Entry (pending_entry mode) hit this same endpoint, and
    // the chat action bar ("Buy Paper") routes through PaperTradeTicket
    // which also POSTs here — so this single check covers all three entry
    // surfaces. We reject BEFORE the per-user trade cap so closed-market
    // attempts don't even consume a SELECT COUNT.
    //
    // Authoritative server-side gate: even if the frontend disable is
    // bypassed (stale tab, custom client, curl) no paper_trade row can be
    // inserted outside RTH. Frontend uses the same util to mirror the
    // disabled state and show the message preemptively.
    //
    // What is NOT gated here:
    //   - Manual close (POST .../close) and manual cancel (POST .../cancel)
    //     remain available 24/7 so users can always exit/clean up positions.
    //   - Auto-exit on contract expiry (handled in paperTradeMonitor).
    //   - Pending-expiry cancellation (handled in paperTradeMonitor).
    //   - Biddie chat / commentary / alerts (NOT a trade-creation surface).
    if (!isMarketOpenET()) {
      return res.status(409).json({
        error: MARKET_CLOSED_MESSAGE,
        code: "market_closed",
      });
    }

    // ─── EOD Force-Window Gate ────────────────────────────────────────────
    // During the force-close phase (default 15:59–16:00 ET) the EOD engine
    // is actively flattening every open position to avoid overnight risk.
    // Allowing a new open in that 1-minute window could leave a position
    // unattended if the force sweep ran before this insert lands. Refuse
    // new opens here so the EOD invariant ("no overnight risk") holds even
    // for the worst-case timing. Manual close/cancel are still available.
    {
      const cfg = getEodConfig();
      if (cfg.paperEnabled) {
        const phase = getEodPhaseET(cfg.closeTime, cfg.forceCloseTime);
        if (phase === "force") {
          return res.status(409).json({
            error: "Trading paused for end-of-day auto-close. Try again at next session.",
            code: "eod_force_window",
          });
        }
      }
    }

    const {
      signalId, ticker, optionType, strike, expiry, contracts,
      signalTarget, signalInvalidation, signalEntry, signalGrade, signalConfidence,
      mode, entryTriggerPrice, entryTriggerDirection, pendingExpiresAt,
    } = req.body || {};
    if (!signalId || !ticker || !optionType || !strike || !expiry) {
      return res.status(400).json({ error: "signalId, ticker, optionType, strike, expiry required" });
    }
    const ot = optionType === "call" ? "call" : optionType === "put" ? "put" : null;
    if (!ot) return res.status(400).json({ error: "optionType must be call or put" });
    const strikeNum = Number(strike);
    const contractsNum = Math.max(1, Math.min(10, Math.floor(Number(contracts) || 1)));
    if (!Number.isFinite(strikeNum) || strikeNum <= 0) return res.status(400).json({ error: "invalid strike" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiry))) return res.status(400).json({ error: "expiry must be YYYY-MM-DD" });
    if (isContractExpired(String(expiry))) return res.status(400).json({ error: "Contract is already expired" });

    // ── Commit 2: per-user safety cap on (open + pending_entry) ──
    // Applies to BOTH market mode and pending_entry mode. Counted statuses
    // exclude 'closed' and 'cancelled' so finished trades never block new ones.
    // Race window with simultaneous inserts is acceptable (cap enforced at
    // creation time only; tiny over-shoot tolerated rather than introducing a
    // serializable transaction in a hot path).
    const settings = await getPaperAutomationSettings();
    const countRes = await dbQuery(
      `SELECT COUNT(*)::int AS n FROM paper_trades WHERE user_id = $1 AND status IN ('open','pending_entry')`,
      [userId]
    );
    const current = countRes?.rows?.[0]?.n ?? 0;
    if (current >= settings.maxOpenPending) {
      return res.status(409).json({
        error: `Trade cap reached: you have ${current} active trades (open + pending). Close or cancel some before opening a new one. Cap = ${settings.maxOpenPending}.`,
        code: "TRADE_CAP_REACHED",
        cap: settings.maxOpenPending,
        current,
      });
    }

    const tickerUp = String(ticker).toUpperCase();

    const sigTarget = signalTarget != null && Number.isFinite(Number(signalTarget)) ? Number(signalTarget) : null;
    const sigInval = signalInvalidation != null && Number.isFinite(Number(signalInvalidation)) ? Number(signalInvalidation) : null;
    const sigEntry = signalEntry != null && Number.isFinite(Number(signalEntry)) ? Number(signalEntry) : null;
    const sigGrade = signalGrade != null ? String(signalGrade).slice(0, 16) : null;
    const sigConf = signalConfidence != null ? String(signalConfidence).slice(0, 16) : null;

    // ── Pending-entry mode (Paper Automation Engine, Commit 1) ──
    // Queues a trade that fires when underlying crosses entry_trigger_price.
    // No live quote is fetched at queue time; the monitor will fill at live
    // ask once the trigger fires. Backend-only for now — frontend defaults
    // to market mode (omit `mode`) and behaves exactly as before.
    const tradeMode = mode === "pending_entry" ? "pending_entry" : "market";
    if (tradeMode === "pending_entry") {
      const trigPrice = Number(entryTriggerPrice);
      const trigDir = String(entryTriggerDirection || "");
      if (!Number.isFinite(trigPrice) || trigPrice <= 0) {
        return res.status(400).json({ error: "entryTriggerPrice required and > 0 for pending_entry mode" });
      }
      if (trigDir !== "at_or_below" && trigDir !== "at_or_above") {
        return res.status(400).json({ error: "entryTriggerDirection must be 'at_or_below' or 'at_or_above'" });
      }
      // Default pending window: end of contract expiry day (~4pm ET ≈ 20:00 UTC).
      // Caller may override with an explicit ISO timestamp.
      let expiresIso: string;
      if (pendingExpiresAt) {
        const t = new Date(String(pendingExpiresAt)).getTime();
        if (!Number.isFinite(t) || t <= Date.now()) {
          return res.status(400).json({ error: "pendingExpiresAt must be a future ISO timestamp" });
        }
        expiresIso = new Date(t).toISOString();
      } else {
        expiresIso = new Date(`${String(expiry)}T20:00:00Z`).toISOString();
      }

      const { contractSymbol } = buildOptionContractSymbol(tickerUp, String(expiry), ot, strikeNum);

      const inserted = await dbQuery(
        `INSERT INTO paper_trades
          (user_id, signal_id, ticker, option_type, strike, expiry, contract_symbol, contracts,
           entry_price, entry_fill_source,
           signal_target, signal_invalidation, signal_entry, signal_grade, signal_confidence,
           status, entry_trigger_price, entry_trigger_direction, pending_expires_at,
           opened_at, created_at, last_checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 NULL, NULL,
                 $9,$10,$11,$12,$13,
                 'pending_entry', $14, $15, $16,
                 NULL, NOW(), NOW())
         RETURNING *`,
        [userId, String(signalId), tickerUp, ot, strikeNum, String(expiry), contractSymbol, contractsNum,
         sigTarget, sigInval, sigEntry, sigGrade, sigConf,
         trigPrice, trigDir, expiresIso]
      );
      if (!inserted || !inserted.rows.length) return res.status(500).json({ error: "Failed to save pending paper trade" });
      console.log(`[paper-trade] queued pending_entry user=${userId.slice(0, 8)} ${tickerUp} ${ot} $${strikeNum} ${expiry} trigger=${trigDir}@${trigPrice} expires=${expiresIso}`);
      return res.json({ success: true, trade: inserted.rows[0], mode: "pending_entry" });
    }

    // ── Market mode (existing behavior, unchanged) ──
    const q = await fetchOptionQuote(tickerUp, String(expiry), ot, strikeNum);
    if (!q) return res.status(503).json({ error: "Quote unavailable. Could not get a live price for this contract." });
    const fill = pickEntryFill(q);
    if (!fill) return res.status(409).json({ error: "No tradeable price available (no ask, mid, or last). Try again when markets are open." });
    const lastFill = pickLastQuoteFill(q);

    const inserted = await dbQuery(
      `INSERT INTO paper_trades
        (user_id, signal_id, ticker, option_type, strike, expiry, contract_symbol, contracts,
         entry_price, entry_fill_source, entry_underlying, entry_iv, entry_delta,
         signal_target, signal_invalidation, signal_entry, signal_grade, signal_confidence,
         entry_bid, entry_ask, entry_mid, entry_last,
         last_quote_price, last_quote_source, last_quote_underlying,
         last_quote_bid, last_quote_ask, last_quote_mid, last_quote_last,
         created_at, last_checked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,
               $23,$24,$25,
               $26,$27,$28,$29,
               NOW(), NOW())
       RETURNING *`,
      [userId, String(signalId), tickerUp, ot, strikeNum, String(expiry), q.contractSymbol, contractsNum,
       fill.price, fill.source, q.underlying, q.iv, q.delta,
       sigTarget, sigInval, sigEntry, sigGrade, sigConf,
       q.bid, q.ask, q.mid, q.last,
       // Current value uses bid→mid→last only; null when none available (UI shows "—").
       lastFill.price, lastFill.source, q.underlying,
       q.bid, q.ask, q.mid, q.last]
    );
    if (!inserted || !inserted.rows.length) return res.status(500).json({ error: "Failed to save paper trade" });
    res.json({ success: true, trade: inserted.rows[0], quote: q });
  } catch (e: any) {
    console.error("[paper-trade] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /whale/paper/trades?status=open|closed|all
router.get("/whale/paper/trades", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const status = (req.query.status as string) || "all";
    // Phase 1 (pending_entry): "closed" view explicitly = status='closed'
    // (NOT "anything not open"), so pending_entry/cancelled rows don't bleed
    // into the existing dashboard. "pending" exposes the new state for clients
    // that want it. "cancelled" exposes user-cancelled / expired-unfilled
    // pending rows so they're auditable instead of disappearing. "all" still
    // includes every status.
    // Map the public filter token to the actual DB enum value, then bind it
    // as a parameter (architect-required: never inline status into SQL even
    // though branch values are hard-coded — keeps the safety invariant
    // "no SQL string concatenated from variables" intact across the file).
    const statusFilter: string | null =
      status === "open" ? "open"
      : status === "closed" ? "closed"
      : status === "pending" ? "pending_entry"
      : status === "cancelled" ? "cancelled"
      : null;
    const where = statusFilter ? "AND pt.status = $2" : "";
    const params: any[] = [userId];
    if (statusFilter) params.push(statusFilter);
    const result = await dbQuery(
      `SELECT pt.*, so.outcome AS signal_outcome, so.signal_type, so.is_biddie_pick
       FROM paper_trades pt
       LEFT JOIN signal_outcomes so ON pt.signal_id = so.id::text
       WHERE pt.user_id = $1 ${where}
       ORDER BY COALESCE(pt.created_at, pt.opened_at) DESC
       LIMIT 200`,
      params
    );
    if (!result) return res.json({ trades: [] });
    res.json({ trades: result.rows });
  } catch (e: any) {
    console.error("[paper-trade] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Foreground batch refresh: recompute quotes for caller's open trades, return updated list.
router.post("/whale/paper/trades/refresh-all", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const status = (req.query.status as string) || "all";
    const open = await dbQuery(`SELECT * FROM paper_trades WHERE user_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 100`, [userId]);
    let refreshed = 0;
    let closed = 0;
    // Phase 1 market-hours gate (Apr 2026): The Paper Trades dashboard polls
    // this endpoint every 30s while visible. If we don't gate it, after-hours
    // option-P&L auto-exits would still fire whenever a user has the tab open
    // — bypassing the gate enforced on the background monitor in
    // paperTradeMonitor.processOpenTrades. Match the monitor's after-hours
    // behavior exactly: contract-expiry exits run 24/7, but option-P&L
    // exits (hard stop / profit target / trailing) are paused until 9:30 ET.
    const marketOpen = isMarketOpenET();
    if (open && open.rows.length) {
      for (const t of open.rows) {
        const expiryStr = normalizeExpiryToIso(t.expiry);
        // Closed-market expiry-only pass: skip the Polygon round-trip for
        // non-expired contracts (no auto-exit can fire anyway) but still
        // settle expired contracts via intrinsic/0 so they don't hang in
        // 'open' over a weekend.
        if (!marketOpen) {
          if (isContractExpired(expiryStr)) {
            const r = await closeExpiredNoQuote(t);
            if (r.closed) closed++;
          } else {
            await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1`, [t.id]).catch(() => null);
          }
          continue;
        }
        const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));
        if (!q) {
          if (isContractExpired(expiryStr)) {
            const r = await closeExpiredNoQuote(t);
            if (r.closed) closed++;
          } else {
            await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1`, [t.id]).catch(() => null);
          }
          continue;
        }
        const result = await evaluateAndMaybeClose(t, q);
        if (result.closed) closed++;
        refreshed++;
      }
    }
    // Phase 1 (pending_entry): mirror GET /whale/paper/trades filter semantics
    // exactly so the 30s foreground poll never bleeds pending/cancelled rows
    // into the existing dashboard's open or closed views.
    // Same parameterized status mapping as GET /whale/paper/trades.
    const statusFilter: string | null =
      status === "open" ? "open"
      : status === "closed" ? "closed"
      : status === "pending" ? "pending_entry"
      : status === "cancelled" ? "cancelled"
      : null;
    const where = statusFilter ? "AND pt.status = $2" : "";
    const params: any[] = [userId];
    if (statusFilter) params.push(statusFilter);
    const result = await dbQuery(
      `SELECT pt.*, so.outcome AS signal_outcome, so.signal_type, so.is_biddie_pick
       FROM paper_trades pt
       LEFT JOIN signal_outcomes so ON pt.signal_id = so.id::text
       WHERE pt.user_id = $1 ${where}
       ORDER BY COALESCE(pt.created_at, pt.opened_at) DESC
       LIMIT 200`,
      params
    );
    res.json({ trades: result?.rows || [], refreshed, closed });
  } catch (e: any) {
    console.error("[paper-trade] refresh-all error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Refresh: re-fetch quote + run auto-close eval (may close on target/stop/expired).
async function paperTradeRefreshHandler(req: any, res: any): Promise<void> {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const id = req.params.id;
    const row = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row || !row.rows.length) { res.status(404).json({ error: "Paper trade not found" }); return; }
    const t = row.rows[0];
    const expiryStr = normalizeExpiryToIso(t.expiry);
    // Phase 1 market-hours gate (Apr 2026): per-trade refresh is also
    // exposed via row "refresh" buttons + occasional polling. After-hours
    // we still want to settle expired contracts (so a Friday-expiry trade
    // closes over the weekend), but option-P&L auto-exits must not fire.
    // Parity with /refresh-all and the background monitor.
    const marketOpen = isMarketOpenET();
    if (!marketOpen) {
      if (t.status === "open" && isContractExpired(expiryStr)) {
        const r = await closeExpiredNoQuote(t);
        const fresh = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1`, [id]);
        res.json({
          trade: fresh?.rows?.[0] ?? t,
          quote: null,
          closed: r.closed,
          autoClosedReason: r.closed ? "closed_expired" : null,
          lastFill: { price: r.exitPrice, source: r.source },
          marketClosed: true,
        });
        return;
      }
      // Otherwise: no quote refresh, no auto-close evaluation. Just touch
      // last_checked_at and return the row so the UI can render its current
      // state with a "Market closed" indicator.
      await dbQuery(`UPDATE paper_trades SET last_checked_at = NOW() WHERE id = $1`, [id]).catch(() => null);
      res.json({ trade: t, quote: null, closed: false, marketClosed: true });
      return;
    }
    const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));
    if (!q) {
      // Parity with monitor: expired no-quote auto-closes via intrinsic/0.
      if (t.status === "open" && isContractExpired(expiryStr)) {
        const r = await closeExpiredNoQuote(t);
        const fresh = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1`, [id]);
        res.json({
          trade: fresh?.rows?.[0] ?? t,
          quote: null,
          closed: r.closed,
          autoClosedReason: r.closed ? "closed_expired" : null,
          lastFill: { price: r.exitPrice, source: r.source },
        });
        return;
      }
      res.status(503).json({ error: "Quote unavailable" });
      return;
    }
    if (t.status !== "open") {
      res.json({ trade: t, quote: q, closed: false });
      return;
    }
    const result = await evaluateAndMaybeClose(t, q);
    // Re-read the row so the response reflects the latest state.
    const fresh = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1`, [id]);
    res.json({
      trade: fresh?.rows?.[0] ?? t,
      quote: q,
      closed: result.closed,
      autoClosedReason: result.closed ? result.exitReason : null,
      lastFill: result.lastFill,
    });
  } catch (e: any) {
    console.error("[paper-trade] refresh error:", e.message);
    res.status(500).json({ error: e.message });
  }
}

router.post("/whale/paper/trades/:id/refresh", paperTradeRefreshHandler);
router.get("/whale/paper/trades/:id/refresh", paperTradeRefreshHandler);

// POST /whale/paper/trades/:id/cancel — cancel a queued pending_entry trade.
// Only valid while the row is still 'pending_entry'; once promoted to 'open'
// the caller must use /close instead. Sets pending_cancel_reason='user_cancelled'.
router.post("/whale/paper/trades/:id/cancel", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id;
    const row = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row || !row.rows.length) return res.status(404).json({ error: "Paper trade not found" });
    const t = row.rows[0];
    if (t.status !== "pending_entry") {
      return res.status(409).json({ error: `Cannot cancel: trade status is '${t.status}' (only pending_entry trades can be cancelled)` });
    }
    const upd = await dbQuery(
      `UPDATE paper_trades SET status = 'cancelled', pending_cancel_reason = 'user_cancelled',
        closed_at = NOW(), last_checked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'pending_entry'
       RETURNING *`,
      [id, userId]
    );
    if (!upd || !upd.rowCount) return res.status(409).json({ error: "Trade is no longer pending_entry" });
    console.log(`[paper-trade] cancelled pending_entry user=${userId.slice(0, 8)} ${t.ticker} ${t.option_type} $${t.strike} ${normalizeExpiryToIso(t.expiry)}`);
    res.json({ success: true, trade: upd.rows[0] });
  } catch (e: any) {
    console.error("[paper-trade] cancel error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /whale/paper/trades/:id/close — exit at bid (or fallback). Manual close.
router.post("/whale/paper/trades/:id/close", async (req, res) => {
  try {
    const userId = await verifyBearerUser(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const id = req.params.id;
    const row = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row || !row.rows.length) return res.status(404).json({ error: "Paper trade not found" });
    const t = row.rows[0];
    if (t.status !== "open") return res.status(409).json({ error: "Trade is already closed" });
    const expiryStr = normalizeExpiryToIso(t.expiry);
    const q = await fetchOptionQuote(t.ticker, expiryStr, t.option_type, Number(t.strike));
    if (!q) return res.status(503).json({ error: "Quote unavailable — try again in a few seconds" });
    const expired = isContractExpired(expiryStr);
    const itm = isItmAtPrice(t.option_type, Number(t.strike), q.underlying);
    const fill = pickExitFill(q, expired, itm);
    if (!fill) return res.status(409).json({ error: "No tradeable price available — try again later" });
    const entry = Number(t.entry_price);
    const contracts = Number(t.contracts);
    const realizedPl = (fill.price - entry) * contracts * 100;
    const realizedPlPct = entry > 0 ? ((fill.price - entry) / entry) * 100 : 0;
    const updated = await dbQuery(
      `UPDATE paper_trades SET status = 'closed', exit_price = $1, exit_fill_source = $2,
        exit_underlying = $3, exit_reason = $4, closed_at = NOW(),
        realized_pl = $5, realized_pl_pct = $6,
        exit_bid = $8, exit_ask = $9, exit_mid = $10, exit_last = $11,
        last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
        last_quote_bid = $8, last_quote_ask = $9, last_quote_mid = $10, last_quote_last = $11,
        last_checked_at = NOW()
       WHERE id = $7 AND status = 'open' RETURNING *`,
      [fill.price, fill.source, q.underlying, "closed_manual", realizedPl, realizedPlPct, id, q.bid, q.ask, q.mid, q.last]
    );
    res.json({ trade: updated?.rows?.[0], realizedPl, realizedPlPct, fill, quote: q });
  } catch (e: any) {
    console.error("[paper-trade] close error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Expired no-quote: ALWAYS close. OTM or unknown→0 ('expired_otm'); ITM→intrinsic ('expired_intrinsic').
async function closeExpiredNoQuote(t: any): Promise<{ closed: boolean; row?: any; underlying: number | null; exitPrice: number; source: string }> {
  const rt = priceMonitor.getPrice(t.ticker);
  const underlying = (rt?.price != null && Number.isFinite(rt.price)) ? rt.price : null;
  const itm = isItmAtPrice(t.option_type, Number(t.strike), underlying);
  const strike = Number(t.strike);
  let exitPrice = 0;
  let source = "expired_otm";
  if (itm === true && underlying != null) {
    exitPrice = t.option_type === "call" ? Math.max(0, underlying - strike) : Math.max(0, strike - underlying);
    source = "expired_intrinsic";
  }
  const entry = Number(t.entry_price);
  const contracts = Number(t.contracts);
  const realizedPl = (exitPrice - entry) * contracts * 100;
  const realizedPlPct = entry > 0 ? ((exitPrice - entry) / entry) * 100 : 0;
  const upd = await dbQuery(
    `UPDATE paper_trades SET status = 'closed', exit_price = $1, exit_fill_source = $2,
      exit_underlying = $3, exit_reason = 'closed_expired', closed_at = NOW(),
      realized_pl = $4, realized_pl_pct = $5,
      last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
      last_checked_at = NOW()
     WHERE id = $6 AND status = 'open' RETURNING *`,
    [exitPrice, source, underlying, realizedPl, realizedPlPct, t.id]
  ).catch(() => null);
  if (!upd || !upd.rowCount) return { closed: false, underlying, exitPrice, source };
  return { closed: true, row: upd.rows[0], underlying, exitPrice, source };
}

// ─── EOD Auto-Close helper ───────────────────────────────────────────────────
// Single close path used by the EOD engine. Behavior depends on `phase`:
//
//   phase = 'soft' (15:50–15:58 ET):
//     • Fresh quote with usable bid/mid/last → close, exit_reason='eod_close'.
//     • Fresh quote present but all bid/mid/last <= 0 → return closed:false,
//       leave open for retry. NEVER falls through to stale.
//     • No fresh quote → return closed:false, leave open for retry.
//
//   phase = 'force' (15:59 ET):
//     • Fresh quote with usable bid/mid/last → close, exit_reason='eod_close'.
//     • Otherwise → fall back to last stored quote (stale_bid → stale_mid →
//       stale_last → stale_intrinsic → stale_otm), exit_reason='eod_close_stale'.
//       ALWAYS terminates with a price (intrinsic/0 even when unexpired) so
//       the force sweep guarantees flattening of every open trade.
//
// SQL guard `WHERE id=$N AND status='open'` makes this safe vs. concurrent
// manual close — whichever fires first wins, the other is a no-op.
async function closeForEod(t: any, q: OptionQuoteResult | null, phase: "soft" | "force"): Promise<{ closed: boolean; row?: any; fill?: { price: number; source: string }; reason: "eod_close" | "eod_close_stale" }> {
  const expiryStr = normalizeExpiryToIso(t.expiry);
  const expired = isContractExpired(expiryStr);

  // ── Path 1: Fresh quote → standard bid/mid/last fill (same logic as the
  //           manual close handler). exit_reason = 'eod_close'.
  if (q != null) {
    const itm = isItmAtPrice(t.option_type, Number(t.strike), q.underlying);
    const fill = pickExitFill(q, expired, itm);
    if (fill) {
      const entry = Number(t.entry_price);
      const contracts = Number(t.contracts);
      const realizedPl = (fill.price - entry) * contracts * 100;
      const realizedPlPct = entry > 0 ? ((fill.price - entry) / entry) * 100 : 0;
      const upd = await dbQuery(
        `UPDATE paper_trades SET status = 'closed', exit_price = $1, exit_fill_source = $2,
          exit_underlying = $3, exit_reason = 'eod_close', closed_at = NOW(),
          realized_pl = $4, realized_pl_pct = $5,
          exit_bid = $6, exit_ask = $7, exit_mid = $8, exit_last = $9,
          last_quote_price = $1, last_quote_source = $2, last_quote_underlying = $3,
          last_quote_bid = $6, last_quote_ask = $7, last_quote_mid = $8, last_quote_last = $9,
          last_checked_at = NOW()
         WHERE id = $10 AND status = 'open' RETURNING *`,
        [fill.price, fill.source, q.underlying, realizedPl, realizedPlPct, q.bid, q.ask, q.mid, q.last, t.id]
      ).catch(() => null);
      if (!upd || !upd.rowCount) return { closed: false, reason: "eod_close" };
      return { closed: true, row: upd.rows[0], fill, reason: "eod_close" };
    }
    // Fresh quote present but all bid/mid/last <= 0 → fall through.
  }

  // Soft phase NEVER falls through to stale — leave open for retry.
  if (phase === "soft") return { closed: false, reason: "eod_close" };

  // ── Path 2 (force only): Stale fallback → use last stored quote columns
  //           from the trade row (written by every prior monitor cycle's
  //           quote check). exit_reason = 'eod_close_stale'.
  const sBid = t.last_quote_bid != null ? Number(t.last_quote_bid) : null;
  const sMid = t.last_quote_mid != null ? Number(t.last_quote_mid) : null;
  const sLast = t.last_quote_last != null ? Number(t.last_quote_last) : null;
  let stalePrice: number | null = null;
  let staleSource = "";
  if (sBid != null && Number.isFinite(sBid) && sBid > 0)        { stalePrice = sBid;  staleSource = "stale_bid"; }
  else if (sMid != null && Number.isFinite(sMid) && sMid > 0)   { stalePrice = sMid;  staleSource = "stale_mid"; }
  else if (sLast != null && Number.isFinite(sLast) && sLast > 0){ stalePrice = sLast; staleSource = "stale_last"; }
  else {
    // No fresh quote AND no usable stored quote. Force phase MUST flatten,
    // so always terminate with intrinsic (if underlying is known and ITM)
    // or 0 (OTM / unknown underlying). Same fallback as closeExpiredNoQuote
    // but applied regardless of expiry — the contract will expire at 4 PM
    // anyway and we don't want to carry it overnight.
    const u = t.last_quote_underlying != null ? Number(t.last_quote_underlying) : null;
    const itm = isItmAtPrice(t.option_type, Number(t.strike), u);
    if (itm === true && u != null) {
      const strike = Number(t.strike);
      stalePrice = t.option_type === "call" ? Math.max(0, u - strike) : Math.max(0, strike - u);
      staleSource = "stale_intrinsic";
    } else {
      stalePrice = 0;
      staleSource = "stale_otm";
    }
  }
  const entry = Number(t.entry_price);
  const contracts = Number(t.contracts);
  const realizedPl = (stalePrice - entry) * contracts * 100;
  const realizedPlPct = entry > 0 ? ((stalePrice - entry) / entry) * 100 : 0;
  const staleUnderlying = t.last_quote_underlying != null ? Number(t.last_quote_underlying) : null;
  const upd = await dbQuery(
    `UPDATE paper_trades SET status = 'closed', exit_price = $1, exit_fill_source = $2,
      exit_underlying = $3, exit_reason = 'eod_close_stale', closed_at = NOW(),
      realized_pl = $4, realized_pl_pct = $5,
      last_checked_at = NOW()
     WHERE id = $6 AND status = 'open' RETURNING *`,
    [stalePrice, staleSource, staleUnderlying, realizedPl, realizedPlPct, t.id]
  ).catch(() => null);
  if (!upd || !upd.rowCount) return { closed: false, reason: "eod_close_stale" };
  return { closed: true, row: upd.rows[0], fill: { price: stalePrice, source: staleSource }, reason: "eod_close_stale" };
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket-driven exit adapter (Phase 1, May 2026)
//
// The Polygon options WebSocket (wss://socket.polygon.io/options) streams
// per-contract Q (quote) and T (trade) events to the optionPriceMonitor
// singleton. paperTradeMonitor wires that monitor's quote callback to this
// adapter, which:
//   1. Loads the trade row by id (skips if no longer 'open')
//   2. Translates the WS-style {bid, ask, last} into the existing
//      OptionQuoteResult shape that evaluateAndMaybeClose() already consumes
//   3. Coalesces concurrent events for the same trade via an in-process
//      promise lock so a fast quote stream cannot launch overlapping
//      evaluations of the same row
//
// CRITICAL: this path uses the SAME evaluateAndMaybeClose() and the SAME
// race-safe SQL guard (`WHERE id=$N AND status='open'`) as the REST sweep.
// First writer wins; the loser's RETURNING is empty and is reported as
// closed=false. EOD close is NOT invoked here — it remains driven by the
// monitor cycle through runEodSweep() so its sequencing is preserved.
// NOTE: paper_trades.id is a UUID (string). Keep the key type as string end-to-end —
// Number(uuid) yields NaN and would silently never match any row in the SQL guard below.
const _wsExitInflight = new Map<string, Promise<void>>();
async function evaluateExitFromWsQuote(
  tradeId: string,
  wsQuote: { contractSymbol: string; bid: number | null; ask: number | null; last: number | null },
): Promise<void> {
  const existing = _wsExitInflight.get(tradeId);
  if (existing) {
    // Another evaluation is in flight for this trade; let it absorb the
    // latest cached quote when it re-enters. This is intentional — we
    // prefer one fresh evaluation over thrashing N parallel ones, and the
    // optionPriceMonitor cache always holds the most recent values.
    return existing;
  }
  const p = (async () => {
    try {
      const sel = await dbQuery(`SELECT * FROM paper_trades WHERE id = $1 AND status = 'open' LIMIT 1`, [tradeId]).catch(() => null);
      if (!sel || !sel.rows.length) return;
      const t = sel.rows[0];
      const bid = wsQuote.bid;
      const ask = wsQuote.ask;
      const last = wsQuote.last;
      const mid = (bid != null && ask != null) ? (bid + ask) / 2 : null;
      // underlying intentionally null — evaluateAndMaybeClose() resolves it
      // from priceMonitor.getPrice(t.ticker), which is the same source used
      // by signal triggers. Falling back to the row's stored last_quote_underlying
      // would risk stale-stop firing.
      const q: OptionQuoteResult = {
        bid,
        ask,
        mid,
        last,
        underlying: null,
        iv: null,
        delta: null,
        fetchedAt: Date.now(),
        contractSymbol: wsQuote.contractSymbol,
        expiry: normalizeExpiryToIso(t.expiry),
      };
      const result = await evaluateAndMaybeClose(t, q);
      if (result.closed && result.fill && result.exitReason) {
        console.log(`[option-price-monitor] WS-triggered close ${t.ticker} ${t.option_type} $${t.strike} ${q.expiry}: ${result.exitReason} @ ${result.fill.price.toFixed(2)} (${result.fill.source})`);
      }
    } catch (e: any) {
      console.warn(`[option-price-monitor] WS exit eval failed for trade ${tradeId}: ${e?.message ?? e}`);
    } finally {
      _wsExitInflight.delete(tradeId);
    }
  })();
  _wsExitInflight.set(tradeId, p);
  return p;
}

// Internal helpers re-exported for the background monitor
export const __paperTradeInternals = { fetchOptionQuote, pickExitFill, isContractExpired, isItmAtPrice, evaluateAndMaybeClose, closeExpiredNoQuote, closeForEod, dbQuery, normalizeExpiryToIso, evaluatePendingEntry, getPaperAutomationSettings, buildOptionContractSymbol, evaluateExitFromWsQuote };

const onlineUsersMap = new Map<string, { name: string; lastSeen: number }>();
const ONLINE_TIMEOUT = 90_000;

router.post("/whale/presence/heartbeat", (req, res) => {
  const userId = req.headers["x-user-id"] as string;
  const name = req.body?.name || "Unknown";
  if (!userId) return res.status(400).json({ error: "userId required" });
  onlineUsersMap.set(userId, { name, lastSeen: Date.now() });
  res.json({ ok: true });
});

router.get("/whale/presence/online", (_req, res) => {
  const now = Date.now();
  const online: { userId: string; name: string }[] = [];
  for (const [userId, data] of onlineUsersMap) {
    if (now - data.lastSeen < ONLINE_TIMEOUT) {
      online.push({ userId, name: data.name });
    } else {
      onlineUsersMap.delete(userId);
    }
  }
  res.json({ online, count: online.length });
});

router.get("/whale/admin/check", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.json({ isAdmin: false });
    const result = await isAdminUser(userId);
    console.log(`[admin-check] userId=${userId} isAdmin=${result}`);
    res.json({ isAdmin: result });
  } catch (e: any) {
    console.error(`[admin-check] error:`, e.message);
    res.json({ isAdmin: false });
  }
});

router.post("/whale/admin/grant", async (req, res) => {
  try {
    const { userId, adminSecret } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== "jortrade-admin-2026") {
      return res.status(403).json({ error: "Forbidden" });
    }
    await dbQuery(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT (user_id, role) DO NOTHING`,
      [userId]
    );
    res.json({ success: true, userId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/reset-bad-outcomes", async (req, res) => {
  try {
    const { adminSecret, resetAll } = req.body;
    if (adminSecret !== "jortrade-admin-2026") return res.status(403).json({ error: "Forbidden" });
    const query = resetAll
      ? `UPDATE signal_outcomes SET outcome = 'pending', resolved_at = NULL
         WHERE signal_source = 'replit' AND outcome IN ('missed', 'hit')`
      : `UPDATE signal_outcomes SET outcome = 'pending', resolved_at = NULL
         WHERE signal_source = 'replit'
         AND outcome IN ('missed', 'hit')
         AND resolved_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (resolved_at - COALESCE(detected_at, created_at))) < 7200`;
    const result = await dbQuery(query);
    const count = result?.rowCount || 0;
    console.log(`[admin] Reset ${count} signals to pending (resetAll=${!!resetAll})`);
    res.json({ success: true, reset: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/fix-expiry", async (req, res) => {
  try {
    const { adminSecret } = req.body;
    if (adminSecret !== "jortrade-admin-2026") return res.status(403).json({ error: "Forbidden" });
    const currentYear = new Date().getFullYear();
    const fixes: string[] = [];
    for (let pastYear = 2020; pastYear < currentYear; pastYear++) {
      const result = await dbQuery(
        `UPDATE signal_outcomes SET expiry = REPLACE(expiry, $1, $2) WHERE expiry LIKE $3 AND signal_source = 'replit'`,
        [String(pastYear), String(currentYear), `%${pastYear}%`]
      );
      if (result?.rowCount && result.rowCount > 0) {
        fixes.push(`${pastYear} → ${currentYear}: ${result.rowCount} fixed`);
      }
    }
    console.log(`[admin] Fixed expiry dates:`, fixes);
    res.json({ success: true, fixes });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/whale/admin/signal/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await dbQuery(`DELETE FROM signal_outcomes WHERE id = $1`, [id]);
    await dbQuery(`DELETE FROM user_trades WHERE signal_id = $1`, [id]);
    res.json({ success: true, deleted: result?.rowCount || 0 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/whale/admin/api-usage", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId || !(await isAdminUser(adminUserId))) {
      return res.status(403).json({ error: "Admin only" });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

    const todayResult = await dbQuery(
      `SELECT api_name, COUNT(*)::int as count FROM api_usage_log WHERE created_at >= $1 GROUP BY api_name`,
      [todayStart.toISOString()]
    );
    const recentResult = await dbQuery(
      `SELECT api_name, COUNT(*)::int as count FROM api_usage_log WHERE created_at >= $1 GROUP BY api_name`,
      [tenMinsAgo.toISOString()]
    );

    const counts: Record<string, { today: number; minute: number }> = {};
    for (const name of ["unusual_whales", "polygon", "anthropic", "discord", "replit"]) {
      counts[name] = { today: 0, minute: 0 };
    }
    for (const row of (todayResult?.rows || [])) {
      if (counts[row.api_name]) counts[row.api_name].today = row.count;
      else counts[row.api_name] = { today: row.count, minute: 0 };
    }
    for (const row of (recentResult?.rows || [])) {
      const avgPerMin = Math.round(row.count / 10);
      if (counts[row.api_name]) counts[row.api_name].minute = avgPerMin;
      else counts[row.api_name] = { today: 0, minute: avgPerMin };
    }

    const creditsResult = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('replit_credits', 'replit_credits_date')`
    );
    const creditSettings: Record<string, string> = {};
    for (const row of (creditsResult?.rows || [])) {
      creditSettings[row.key] = row.value;
    }

    res.json({
      counts,
      replitCredits: creditSettings.replit_credits || "0",
      replitCreditsDate: creditSettings.replit_credits_date || "",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/admin/replit-credits", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    const adminCheck = await pool.query(`SELECT role FROM users WHERE id = $1`, [adminUserId]);
    if (!adminCheck?.rows?.[0] || adminCheck.rows[0].role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { credits, date } = req.body;
    if (credits === undefined) return res.status(400).json({ error: "credits required" });

    const now = date || new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('replit_credits', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(credits)]
    );
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('replit_credits_date', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [now]
    );

    res.json({ ok: true, credits: String(credits), date: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/whale/admin/system-health", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId || !(await isAdminUser(adminUserId))) {
      return res.status(403).json({ error: "Admin only" });
    }

    const services: { name: string; description: string; status: string; details: string; url: string; usage?: string }[] = [];

    try {
      const r = await axios.get("https://api.polygon.io/v2/aggs/ticker/SPY/prev", {
        params: { apiKey: getPolygonKey() },
        timeout: 5000,
      });
      services.push({
        name: "Polygon.io",
        description: "All stock prices, charts, VWAP, pivot points, historical data",
        status: "ok",
        details: r.data?.results?.[0] ? "Connected — price data active" : "Connected but no data",
        url: "https://polygon.io/dashboard",
        usage: "Unlimited (paid plan)",
      });
    } catch (e: any) {
      const msg = e.response?.status === 403 ? "Invalid or expired API key" : e.response?.status === 429 ? "Rate limited — may need higher plan" : e.message;
      services.push({ name: "Polygon.io", description: "All stock prices, charts, VWAP, pivot points, historical data", status: "error", details: msg, url: "https://polygon.io/dashboard" });
    }

    try {
      const r = await axios.post("https://api.anthropic.com/v1/messages", {
        model: "claude-sonnet-4-6",
        max_tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      }, {
        headers: { "x-api-key": process.env["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        timeout: 10000,
      });
      services.push({
        name: "Anthropic (Claude AI)",
        description: "AI brain — evaluates options flow and generates trade signals",
        status: "ok",
        details: "Connected — AI signal pipeline active",
        url: "https://console.anthropic.com",
        usage: "Pay-per-use credits",
      });
    } catch (e: any) {
      const body = e.response?.data?.error?.message || "";
      let msg = "Unknown error";
      if (body.includes("credit balance")) msg = "Out of credits — add funds to resume AI signals";
      else if (e.response?.status === 401) msg = "Invalid API key";
      else if (body) msg = body;
      services.push({ name: "Anthropic (Claude AI)", description: "AI brain — evaluates options flow and generates trade signals", status: "error", details: msg, url: "https://console.anthropic.com" });
    }

    try {
      const r = await axios.get("https://api.unusualwhales.com/api/stock/SPY/options-volume", {
        headers: { Authorization: `Bearer ${process.env["UNUSUAL_WHALES_API_KEY"]}` },
        timeout: 5000,
      });
      services.push({
        name: "Unusual Whales",
        description: "Options flow data — sweeps, premium, volume, open interest",
        status: "ok",
        details: "Connected — options flow active",
        url: "https://unusualwhales.com/account",
        usage: `120 / min · 15,000 / day`,
      });
    } catch (e: any) {
      const msg = e.response?.status === 401 ? "Invalid or expired API key" : e.response?.status === 403 ? "Subscription expired" : e.message;
      services.push({ name: "Unusual Whales", description: "Options flow data — sweeps, premium, volume, open interest", status: "error", details: msg, url: "https://unusualwhales.com/account" });
    }

    try {
      const supabaseUrl = process.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"] || "";
      const supabaseKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
      if (supabaseUrl && supabaseKey) {
        const r = await axios.get(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
          headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
          timeout: 5000,
        });
        services.push({
          name: "Supabase (Auth)",
          description: "User login, accounts, profiles, session management",
          status: "ok",
          details: "Connected — authentication active",
          url: "https://supabase.com/dashboard",
          usage: "Free tier — 50,000 monthly active users",
        });
      } else {
        services.push({ name: "Supabase (Auth)", description: "User login, accounts, profiles, session management", status: "warning", details: "Not configured", url: "https://supabase.com/dashboard" });
      }
    } catch (e: any) {
      services.push({ name: "Supabase (Auth)", description: "User login, accounts, profiles, session management", status: "error", details: e.response?.status === 401 ? "Invalid service role key" : e.message, url: "https://supabase.com/dashboard" });
    }

    try {
      const dbResult = await dbQuery("SELECT COUNT(*) as count FROM signal_outcomes");
      const count = dbResult?.rows?.[0]?.count || 0;
      services.push({
        name: "Replit Database",
        description: "Stores all signals, trades, outcomes, and app data",
        status: "ok",
        details: `Connected — ${count} total signals stored`,
        url: "",
        usage: "Included with Replit — no extra cost",
      });
    } catch (e: any) {
      services.push({ name: "Replit Database", description: "Stores all signals, trades, outcomes, and app data", status: "error", details: e.message, url: "" });
    }

    if (process.env["DISCORD_WEBHOOK_URL"]) {
      services.push({
        name: "Discord Webhook",
        description: "Sends signal alerts to your Discord channel",
        status: "ok",
        details: "Configured",
        url: "https://discord.com",
        usage: "Free — unlimited messages",
      });
    } else {
      services.push({ name: "Discord Webhook", description: "Sends signal alerts to your Discord channel", status: "warning", details: "Not configured", url: "" });
    }

    res.json({ services });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/sync-signal-fields", async (req, res) => {
  try {
    const { adminSecret, updates } = req.body;
    if (adminSecret !== "jortrade-admin-2026") return res.status(403).json({ error: "Forbidden" });
    if (!Array.isArray(updates)) return res.status(400).json({ error: "updates must be an array" });
    let updated = 0;
    for (const u of updates) {
      const setClauses: string[] = [];
      const params: any[] = [u.id];
      let paramIdx = 2;

      if (u.entry_trigger !== undefined && u.entry_trigger !== null) {
        setClauses.push(`entry_trigger = $${paramIdx++}`);
        params.push(u.entry_trigger);
      }
      if (u.invalidation !== undefined && u.invalidation !== null) {
        setClauses.push(`invalidation = $${paramIdx++}`);
        params.push(u.invalidation);
      }
      if (u.target !== undefined && u.target !== null) {
        setClauses.push(`target = $${paramIdx++}`);
        params.push(u.target);
      }
      if (u.target_near !== undefined && u.target_near !== null) {
        setClauses.push(`target_near = $${paramIdx++}`);
        params.push(u.target_near);
      }
      if (u.key_level !== undefined && u.key_level !== null) {
        setClauses.push(`key_level = $${paramIdx++}`);
        params.push(u.key_level);
      }
      if (u.sr_level !== undefined && u.sr_level !== null) {
        setClauses.push(`sr_level = $${paramIdx++}`);
        params.push(u.sr_level);
      }
      if (u.tags && Array.isArray(u.tags)) {
        setClauses.push(`tags = array_cat(tags, $${paramIdx++}::text[])`);
        params.push(u.tags);
      }
      if (u.outcome !== undefined && u.outcome !== null) {
        setClauses.push(`outcome = $${paramIdx++}`);
        params.push(u.outcome);
      }
      if (u.trade_status !== undefined && u.trade_status !== null) {
        setClauses.push(`trade_status = $${paramIdx++}`);
        params.push(u.trade_status);
      }
      if (u.clear_resolved === true) {
        setClauses.push(`resolved_at = NULL`);
      }
      if (u.detected_at !== undefined && u.detected_at !== null) {
        setClauses.push(`detected_at = $${paramIdx++}`);
        params.push(u.detected_at);
      }
      if (u.price_at_signal !== undefined && u.price_at_signal !== null) {
        setClauses.push(`price_at_signal = $${paramIdx++}`);
        params.push(u.price_at_signal);
      }
      if (u.reason !== undefined && u.reason !== null) {
        setClauses.push(`reason = $${paramIdx++}`);
        params.push(u.reason);
      }
      if (u.gamma_description !== undefined && u.gamma_description !== null) {
        setClauses.push(`gamma_description = $${paramIdx++}`);
        params.push(u.gamma_description);
      }
      if (u.confidence !== undefined && u.confidence !== null) {
        setClauses.push(`confidence = $${paramIdx++}`);
        params.push(u.confidence);
      }
      if (u.premium !== undefined && u.premium !== null) {
        setClauses.push(`premium = $${paramIdx++}`);
        params.push(u.premium);
      }

      if (setClauses.length === 0) continue;

      const result = await dbQuery(
        `UPDATE signal_outcomes SET ${setClauses.join(', ')} WHERE id = $1`,
        params
      );
      if (result?.rowCount) updated++;
    }
    res.json({ success: true, updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/cleanup-bad-signals", async (_req, res) => {
  try {
    const result = await dbQuery(
      `DELETE FROM signal_outcomes
       WHERE signal_source = 'replit'
       AND price_at_signal IS NOT NULL
       AND strike IS NOT NULL
       AND (
         CAST(strike AS NUMERIC) / CAST(price_at_signal AS NUMERIC) > 3
         OR CAST(strike AS NUMERIC) / CAST(price_at_signal AS NUMERIC) < 0.33
         OR CAST(price_at_signal AS NUMERIC) > CAST(strike AS NUMERIC) * 5
       )`
    );
    const count = result?.rowCount || 0;
    console.log(`[admin] Cleaned up ${count} bad-data signals`);
    res.json({ success: true, removed: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/dedup-signals", async (req, res) => {
  try {
    const { adminSecret } = req.body;
    if (adminSecret !== "jortrade-admin-2026") return res.status(403).json({ error: "Forbidden" });
    const result = await dbQuery(
      `DELETE FROM signal_outcomes WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY ticker, strike, option_type, expiry
            ORDER BY detected_at ASC
          ) as rn
          FROM signal_outcomes WHERE signal_source = 'replit'
        ) sub WHERE rn > 1
      )`
    );
    const count = result?.rowCount || 0;
    console.log(`[admin] Removed ${count} duplicate signals`);
    res.json({ success: true, removed: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/update-plan", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId) return res.status(401).json({ error: "Not authenticated" });
    if (!(await isAdminUser(adminUserId))) return res.status(403).json({ error: "Not an admin" });

    const { userId, plan } = req.body;
    if (!userId || !plan) return res.status(400).json({ error: "userId and plan required" });
    if (!["starter", "active", "pro"].includes(plan)) return res.status(400).json({ error: "Invalid plan" });

    const sbRes = await axios.patch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`,
      { selected_plan: plan },
      { headers: supabaseAdminHeaders(), timeout: 5000 }
    );
    console.log(`[admin] Updated plan for ${userId} to ${plan} (status: ${sbRes.status})`);
    res.json({ success: true, userId, plan });
  } catch (e: any) {
    console.error("[admin] update-plan error:", e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

const RECOVERY_LINK_REDIRECT_ALLOWLIST: Record<string, string> = {
  "jortrade.com": "https://jortrade.com",
  "www.jortrade.com": "https://www.jortrade.com",
};

router.post("/whale/admin/generate-recovery-link", async (req, res) => {
  try {
    const authHeader = (req.headers["authorization"] as string) || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!bearer) return res.status(401).json({ error: "Missing bearer token" });

    const userResp = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` },
      timeout: 5000,
      validateStatus: () => true,
    });
    if (userResp.status !== 200 || !userResp.data?.id) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    const verifiedUserId: string = userResp.data.id;
    if (!(await isAdminUser(verifiedUserId))) {
      return res.status(403).json({ error: "Not an admin" });
    }

    const { email, type } = req.body as { email?: string; type?: "recovery" | "magiclink" };
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const linkType = type === "magiclink" ? "magiclink" : "recovery";

    let redirectHost = "jortrade.com";
    const originHeader = (req.headers["origin"] as string) || "";
    try {
      if (originHeader) {
        const host = new URL(originHeader).host;
        if (RECOVERY_LINK_REDIRECT_ALLOWLIST[host]) redirectHost = host;
      }
    } catch {}
    const redirectBase = RECOVERY_LINK_REDIRECT_ALLOWLIST[redirectHost];
    const redirectTo = linkType === "recovery"
      ? `${redirectBase}/reset-password`
      : `${redirectBase}/dashboard`;

    const resp = await axios.post(
      `${SUPABASE_URL}/auth/v1/admin/generate_link`,
      { type: linkType, email, options: { redirect_to: redirectTo } },
      { headers: supabaseAdminHeaders(), timeout: 10000, validateStatus: () => true }
    );

    if (resp.status >= 400) {
      return res.status(resp.status).json({ error: resp.data?.msg || resp.data?.error || "Failed to generate link" });
    }

    const actionLink: string =
      resp.data?.action_link ||
      resp.data?.properties?.action_link ||
      "";
    if (!actionLink) return res.status(500).json({ error: "No action_link returned" });

    console.log(`[admin] Generated ${linkType} link for ${email} by admin ${verifiedUserId}`);
    res.json({ success: true, link: actionLink, type: linkType });
  } catch (e: any) {
    console.error("[admin] generate-recovery-link error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// In-memory rate limiter for admin self-recovery (per IP)
const adminRecoveryAttempts = new Map<string, { count: number; resetAt: number }>();
const ADMIN_RECOVERY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ADMIN_RECOVERY_MAX_PER_WINDOW = 5;

function checkAdminRecoveryRate(ip: string): boolean {
  const now = Date.now();
  const entry = adminRecoveryAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    adminRecoveryAttempts.set(ip, { count: 1, resetAt: now + ADMIN_RECOVERY_WINDOW_MS });
    return true;
  }
  if (entry.count >= ADMIN_RECOVERY_MAX_PER_WINDOW) return false;
  entry.count++;
  return true;
}

async function postToDiscord(content: string): Promise<boolean> {
  const webhook = process.env["DISCORD_WEBHOOK_URL"];
  if (!webhook) return false;
  try {
    const r = await axios.post(webhook, { content }, { timeout: 5000, validateStatus: () => true });
    if (r.status >= 200 && r.status < 300) return true;
    console.error(`[discord] webhook returned non-2xx status ${r.status}`);
    return false;
  } catch (e: any) {
    console.error("[discord] webhook error:", e?.message);
    return false;
  }
}

router.post("/whale/admin-self-recovery", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";

  try {
    if (!checkAdminRecoveryRate(ip)) {
      console.warn(`[admin-recovery] rate-limited IP ${ip}`);
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }

    const recoverySecret = process.env["ADMIN_RECOVERY_SECRET"] || "";
    if (!recoverySecret || recoverySecret.length < 32) {
      console.error("[admin-recovery] ADMIN_RECOVERY_SECRET not configured");
      return res.status(503).json({ error: "Admin recovery is not configured" });
    }

    const { email, secret } = req.body as { email?: string; secret?: string };
    if (!email || !secret || typeof email !== "string" || typeof secret !== "string") {
      return res.status(400).json({ error: "Email and secret are required" });
    }

    // Constant-time secret comparison
    const crypto = await import("crypto");
    const a = Buffer.from(secret);
    const b = Buffer.from(recoverySecret);
    const secretValid = a.length === b.length && crypto.timingSafeEqual(a, b);

    // Always look up user (even if secret is wrong) so timing doesn't leak which one failed
    const userResp = await axios.get(
      `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email.toLowerCase())}`,
      { headers: supabaseAdminHeaders(), timeout: 5000, validateStatus: () => true }
    );
    const userObj = userResp.data?.users?.[0] || (userResp.data?.id ? userResp.data : null);
    const userId: string | null = userObj?.id || null;
    const userIsAdmin = userId ? await isAdminUser(userId) : false;

    if (!secretValid || !userId || !userIsAdmin) {
      console.warn(`[admin-recovery] FAIL ip=${ip} email=${email} secretOk=${secretValid} adminOk=${userIsAdmin}`);
      await postToDiscord(
        `🚨 **Admin recovery FAILED** at ${new Date().toISOString()}\n` +
        `IP: \`${ip}\`\nEmail attempted: \`${email}\`\n` +
        `If this wasn't you, rotate ADMIN_RECOVERY_SECRET immediately.`
      );
      // Generic error — don't leak which field was wrong
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate recovery link
    const linkResp = await axios.post(
      `${SUPABASE_URL}/auth/v1/admin/generate_link`,
      {
        type: "recovery",
        email: userObj.email,
        options: { redirect_to: "https://jortrade.com/reset-password" },
      },
      { headers: supabaseAdminHeaders(), timeout: 10000, validateStatus: () => true }
    );

    if (linkResp.status >= 400) {
      console.error("[admin-recovery] generate_link failed:", linkResp.status, linkResp.data);
      return res.status(500).json({ error: "Failed to generate recovery link" });
    }

    const actionLink: string =
      linkResp.data?.action_link ||
      linkResp.data?.properties?.action_link || "";
    if (!actionLink) return res.status(500).json({ error: "No recovery link returned" });

    const discordOk = await postToDiscord(
      `🔐 **Admin recovery link** for \`${userObj.email}\`\n` +
      `Triggered at ${new Date().toISOString()} from IP \`${ip}\`\n` +
      `Click to reset password (single-use, expires ~1 hour):\n${actionLink}\n` +
      `If this wasn't you, rotate ADMIN_RECOVERY_SECRET immediately.`
    );

    if (!discordOk) {
      console.error("[admin-recovery] Discord webhook delivery failed");
      return res.status(500).json({ error: "Recovery link generated but Discord delivery failed. Contact support." });
    }

    console.log(`[admin-recovery] SUCCESS ip=${ip} email=${userObj.email}`);
    res.json({ success: true });
  } catch (e: any) {
    console.error("[admin-recovery] error:", e.message);
    res.status(500).json({ error: "Recovery request failed" });
  }
});

router.get("/whale/admin/last-sign-ins", async (req, res) => {
  try {
    const authHeader = (req.headers["authorization"] as string) || "";
    const bearer = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim() : "";
    if (!bearer) return res.status(401).json({ error: "Missing bearer token" });

    const userResp = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` },
      timeout: 5000, validateStatus: () => true,
    });
    if (userResp.status !== 200 || !userResp.data?.id) {
      return res.status(401).json({ error: "Invalid session" });
    }
    if (!(await isAdminUser(userResp.data.id))) {
      return res.status(403).json({ error: "Not an admin" });
    }

    // Page through all users from auth.users
    const map: Record<string, string | null> = {};
    let page = 1;
    const perPage = 1000;
    while (true) {
      const r = await axios.get(
        `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
        { headers: supabaseAdminHeaders(), timeout: 10000, validateStatus: () => true }
      );
      if (r.status !== 200) break;
      const users = r.data?.users || [];
      for (const u of users) {
        map[u.id] = u.last_sign_in_at || null;
      }
      if (users.length < perPage) break;
      page++;
      if (page > 20) break; // safety
    }

    res.json({ lastSignIns: map });
  } catch (e: any) {
    console.error("[last-sign-ins] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/whale/admin/toggle-admin", async (req, res) => {
  try {
    const adminUserId = req.headers["x-user-id"] as string;
    if (!adminUserId) return res.status(401).json({ error: "Not authenticated" });
    if (!(await isAdminUser(adminUserId))) return res.status(403).json({ error: "Not an admin" });

    const { userId, makeAdmin } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    if (makeAdmin) {
      const existing = await axios.get(
        `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&role=eq.admin&limit=1`,
        { headers: supabaseAdminHeaders(), timeout: 5000 }
      );
      if (!existing.data?.length) {
        await axios.post(
          `${SUPABASE_URL}/rest/v1/user_roles`,
          { user_id: userId, role: "admin" },
          { headers: supabaseAdminHeaders(), timeout: 5000 }
        );
      }
    } else {
      await axios.delete(
        `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&role=eq.admin`,
        { headers: supabaseAdminHeaders(), timeout: 5000 }
      );
    }
    console.log(`[admin] Toggle admin for ${userId}: ${makeAdmin}`);
    res.json({ success: true, userId, isAdmin: !!makeAdmin });
  } catch (e: any) {
    console.error("[admin] toggle-admin error:", e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.message || e.message });
  }
});

router.post("/whale/chat/react", async (req, res) => {
  try {
    const { messageId, emoji, userId } = req.body;
    if (!messageId || !emoji || !userId) return res.status(400).json({ error: "messageId, emoji, userId required" });

    const existing = await dbQuery(
      `SELECT id FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
      [messageId, userId, emoji]
    );

    if (existing && existing.rows.length > 0) {
      await dbQuery(`DELETE FROM chat_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`, [messageId, userId, emoji]);
    } else {
      await dbQuery(`INSERT INTO chat_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [messageId, userId, emoji]);
    }

    const allReactions = await dbQuery(
      `SELECT emoji, array_agg(user_id) as user_ids FROM chat_reactions WHERE message_id = $1 GROUP BY emoji`,
      [messageId]
    );

    const reactions: Record<string, string[]> = {};
    if (allReactions?.rows) {
      for (const row of allReactions.rows) {
        reactions[row.emoji] = row.user_ids;
      }
    }

    res.json({ success: true, reactions });
  } catch (e: any) {
    console.error("[chat react] error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/whale/chat/reactions", async (req, res) => {
  try {
    const messageIds = (req.query.ids as string || "").split(",").filter(Boolean);
    if (!messageIds.length) return res.json({});

    const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(",");
    const result = await dbQuery(
      `SELECT message_id, emoji, array_agg(user_id) as user_ids FROM chat_reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`,
      messageIds
    );

    const out: Record<string, Record<string, string[]>> = {};
    if (result?.rows) {
      for (const row of result.rows) {
        if (!out[row.message_id]) out[row.message_id] = {};
        out[row.message_id][row.emoji] = row.user_ids;
      }
    }
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/whale/trades/stats", async (req, res) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const allTrades = await dbQuery(
      `SELECT ut.*, so.outcome, so.resolved_at, so.created_at as signal_created_at, so.category
       FROM user_trades ut
       LEFT JOIN signal_outcomes so ON ut.signal_id = so.id::text
       LEFT JOIN signal_reviews sr ON sr.signal_id = ut.signal_id
       WHERE ut.user_id = $1 AND COALESCE(so.category, '') != 'spread'
         AND COALESCE(sr.status, '') != 'wrong'
       ORDER BY ut.taken_at DESC`,
      [userId]
    );
    if (!allTrades) return res.json({ stats: null });

    const trades = allTrades.rows;
    const total = trades.length;
    const resolved = trades.filter((t: any) => t.outcome === "hit" || t.outcome === "partial_hit" || t.outcome === "missed" || t.outcome === "near_miss");
    const hits = resolved.filter((t: any) => t.outcome === "hit" || t.outcome === "partial_hit").length;
    const misses = resolved.filter((t: any) => t.outcome === "missed" || t.outcome === "near_miss").length;
    const pending = trades.filter((t: any) => !t.outcome || t.outcome === "pending").length;
    const winRate = resolved.length > 0 ? Math.round((hits / resolved.length) * 100) : 0;

    let streak = 0;
    for (const t of resolved) {
      if ((t as any).outcome === "hit" || (t as any).outcome === "partial_hit") streak++;
      else break;
    }

    const byTicker: Record<string, { hits: number; total: number }> = {};
    for (const t of resolved) {
      const tk = (t as any).ticker;
      if (!byTicker[tk]) byTicker[tk] = { hits: 0, total: 0 };
      byTicker[tk].total++;
      if ((t as any).outcome === "hit" || (t as any).outcome === "partial_hit") byTicker[tk].hits++;
    }

    const byCategory: Record<string, { hits: number; total: number }> = {};
    for (const t of resolved) {
      const cat = (t as any).category || "unknown";
      if (!byCategory[cat]) byCategory[cat] = { hits: 0, total: 0 };
      byCategory[cat].total++;
      if ((t as any).outcome === "hit" || (t as any).outcome === "partial_hit") byCategory[cat].hits++;
    }

    const sunday = getSunday(new Date());
    const thisWeek = trades.filter((t: any) => new Date(t.taken_at) >= sunday);
    const thisWeekResolved = thisWeek.filter((t: any) => t.outcome === "hit" || t.outcome === "partial_hit" || t.outcome === "missed" || t.outcome === "near_miss");
    const weekHits = thisWeekResolved.filter((t: any) => t.outcome === "hit" || t.outcome === "partial_hit").length;
    const weekMisses = thisWeekResolved.filter((t: any) => t.outcome === "missed" || t.outcome === "near_miss").length;
    const weekPending = thisWeek.filter((t: any) => !t.outcome || t.outcome === "pending").length;
    const weekWinRate = thisWeekResolved.length > 0 ? Math.round((weekHits / thisWeekResolved.length) * 100) : 0;

    const weeklyMap: Record<string, { hits: number; misses: number; pending: number; total: number; partial_hits: number; near_misses: number }> = {};
    for (const t of trades) {
      const takenAt = new Date((t as any).taken_at);
      const ws = getTradeWeekStart(takenAt);
      const key = ws.toISOString();
      if (!weeklyMap[key]) weeklyMap[key] = { hits: 0, misses: 0, pending: 0, total: 0, partial_hits: 0, near_misses: 0 };
      weeklyMap[key].total++;
      const outcome = (t as any).outcome;
      if (outcome === "hit") weeklyMap[key].hits++;
      else if (outcome === "partial_hit") weeklyMap[key].partial_hits++;
      else if (outcome === "near_miss") weeklyMap[key].near_misses++;
      else if (outcome === "missed") weeklyMap[key].misses++;
      else weeklyMap[key].pending++;
    }

    const currentWeekKey = sunday.toISOString();
    if (!weeklyMap[currentWeekKey]) {
      weeklyMap[currentWeekKey] = { hits: 0, misses: 0, pending: 0, total: 0, partial_hits: 0, near_misses: 0 };
    }

    const weeklyBreakdown = Object.entries(weeklyMap)
      .map(([weekStart, data]) => {
        const ws = new Date(weekStart);
        const we = new Date(ws); we.setDate(we.getDate() + 6);
        const resolved = data.hits + data.partial_hits + data.misses + data.near_misses;
        const wr = resolved > 0 ? Math.round(((data.hits + data.partial_hits) / resolved) * 100) : 0;

        const weekTrades = trades.filter((t: any) => {
          const d = new Date((t as any).taken_at);
          return getTradeWeekStart(d).toISOString() === weekStart;
        });
        const tickerMap: Record<string, { hits: number; misses: number; pending: number; total: number }> = {};
        for (const t of weekTrades) {
          const tk = (t as any).ticker;
          const o = (t as any).outcome;
          if (!tickerMap[tk]) tickerMap[tk] = { hits: 0, misses: 0, pending: 0, total: 0 };
          tickerMap[tk].total++;
          if (o === "hit" || o === "partial_hit") tickerMap[tk].hits++;
          else if (o === "missed") tickerMap[tk].misses++;
          else tickerMap[tk].pending++;
        }
        const topTickers = Object.entries(tickerMap)
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 5)
          .map(([ticker, d]) => ({ ticker, ...d }));

        return {
          week_start: weekStart,
          week_end: we.toISOString(),
          total: data.total,
          hits: data.hits,
          partial_hits: data.partial_hits,
          near_misses: data.near_misses,
          misses: data.misses,
          pending: data.pending,
          win_rate: wr,
          top_tickers: topTickers,
        };
      })
      .sort((a, b) => new Date(a.week_start).getTime() - new Date(b.week_start).getTime());

    res.json({
      stats: {
        total,
        hits,
        misses,
        pending,
        winRate,
        streak,
        weekWinRate,
        weekHits,
        weekMisses,
        weekPending,
        weekTotal: thisWeek.length,
        byTicker,
        byCategory,
        weeklyBreakdown,
      },
    });
  } catch (e: any) {
    console.error("[user_trades] stats error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/whale/health", (_req, res) => {
  res.json({
    ok: true,
    uwKey: !!process.env["UNUSUAL_WHALES_API_KEY"],
    claudeKey: !!AI_API_KEY,
  });
});

// ── Weekly Signal Stats Snapshot ──────────────────────────────────────────────────

function getTradeWeekStart(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getSunday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function snapshotWeek(weekStart: Date): Promise<any> {
  const weekEndDisplay = new Date(weekStart);
  weekEndDisplay.setDate(weekEndDisplay.getDate() + 6);
  const queryEnd = new Date(weekStart);
  queryEnd.setDate(queryEnd.getDate() + 7);

  const existing = await dbQuery(
    `SELECT id FROM weekly_signal_stats WHERE week_start = $1`,
    [weekStart.toISOString()]
  );

  const signals = await dbQuery(
    `SELECT so.ticker, so.outcome, so.conviction_score, so.is_biddie_pick
     FROM signal_outcomes so
     LEFT JOIN signal_reviews sr ON sr.signal_id = so.id::text
     WHERE so.signal_source = 'replit' AND COALESCE(so.category, '') != 'spread'
       AND COALESCE(sr.status, '') != 'wrong'
       AND so.detected_at >= $1 AND so.detected_at < $2`,
    [weekStart.toISOString(), queryEnd.toISOString()]
  );

  const rows = signals?.rows || [];
  const total = rows.length;
  const hits = rows.filter((r: any) => r.outcome === "hit").length;
  const partialHits = rows.filter((r: any) => r.outcome === "partial_hit").length;
  const misses = rows.filter((r: any) => r.outcome === "missed").length;
  const nearMisses = rows.filter((r: any) => r.outcome === "near_miss").length;
  const expired = rows.filter((r: any) => r.outcome === "expired").length;
  const pending = rows.filter((r: any) => !r.outcome || r.outcome === "pending").length;
  const resolved = hits + partialHits + misses + nearMisses;
  const winRate = resolved > 0 ? ((hits + partialHits) / resolved * 100).toFixed(2) : "0";
  const scores = rows.filter((r: any) => r.conviction_score).map((r: any) => r.conviction_score);
  const avgConviction = scores.length > 0 ? (scores.reduce((a: number, b: number) => a + b, 0) / scores.length).toFixed(2) : "0";

  const tickerCounts: Record<string, { hits: number; misses: number; pending: number; total: number }> = {};
  for (const r of rows) {
    const tk = (r as any).ticker;
    const outcome = (r as any).outcome;
    if (!tickerCounts[tk]) tickerCounts[tk] = { hits: 0, misses: 0, pending: 0, total: 0 };
    tickerCounts[tk].total++;
    if (outcome === "hit" || outcome === "partial_hit") tickerCounts[tk].hits++;
    else if (outcome === "missed" || outcome === "near_miss") tickerCounts[tk].misses++;
    else tickerCounts[tk].pending++;
  }
  const topTickers = Object.entries(tickerCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([ticker, data]) => ({ ticker, ...data }));

  const biddiePicks = rows.filter((r: any) => r.is_biddie_pick);
  const biddieResolved = biddiePicks.filter((r: any) => r.outcome === "hit" || r.outcome === "partial_hit" || r.outcome === "missed" || r.outcome === "near_miss");
  const biddieHits = biddieResolved.filter((r: any) => r.outcome === "hit" || r.outcome === "partial_hit").length;
  const biddieMisses = biddieResolved.filter((r: any) => r.outcome === "missed" || r.outcome === "near_miss").length;
  const biddiePending = biddiePicks.filter((r: any) => !r.outcome || r.outcome === "pending").length;
  const biddieWinRate = biddieResolved.length > 0 ? ((biddieHits / biddieResolved.length) * 100).toFixed(2) : "0";

  const statsRow = {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEndDisplay.toISOString(),
    totalSignals: total,
    hits,
    misses,
    partialHits,
    expired,
    pending,
    winRate,
    avgConviction,
    topTickers: JSON.stringify(topTickers),
    biddiePickHits: biddieHits,
    biddiePickTotal: biddiePicks.length,
    biddiePickWinRate: biddieWinRate,
    biddiePickMisses: biddieMisses,
    biddiePickPending: biddiePending,
  };

  if (existing?.rows?.length) {
    await dbQuery(
      `UPDATE weekly_signal_stats SET
        total_signals = $1, hits = $2, misses = $3, partial_hits = $4,
        expired = $5, pending = $6, win_rate = $7, avg_conviction = $8,
        top_tickers = $9, biddie_pick_hits = $10, biddie_pick_total = $11,
        biddie_pick_win_rate = $12, week_end = $13,
        biddie_pick_misses = $15, biddie_pick_pending = $16
       WHERE week_start = $14`,
      [total, hits, misses, partialHits, expired, pending, winRate, avgConviction,
       statsRow.topTickers, biddieHits, biddiePicks.length, biddieWinRate,
       weekEndDisplay.toISOString(), weekStart.toISOString(), biddieMisses, biddiePending]
    );
  } else {
    await dbQuery(
      `INSERT INTO weekly_signal_stats
        (week_start, week_end, total_signals, hits, misses, partial_hits,
         expired, pending, win_rate, avg_conviction, top_tickers,
         biddie_pick_hits, biddie_pick_total, biddie_pick_win_rate,
         biddie_pick_misses, biddie_pick_pending)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [weekStart.toISOString(), weekEndDisplay.toISOString(), total, hits, misses, partialHits,
       expired, pending, winRate, avgConviction, statsRow.topTickers,
       biddieHits, biddiePicks.length, biddieWinRate, biddieMisses, biddiePending]
    );
  }

  return { ...statsRow, topTickers };
}

async function autoSnapshotWeeklyStats() {
  try {
    const now = new Date();
    const currentSunday = getSunday(now);

    await snapshotWeek(currentSunday);

    const lastSunday = new Date(currentSunday);
    lastSunday.setDate(lastSunday.getDate() - 7);
    const lastExists = await dbQuery(
      `SELECT id FROM weekly_signal_stats WHERE week_start = $1`,
      [lastSunday.toISOString()]
    );
    if (!lastExists?.rows?.length) {
      await snapshotWeek(lastSunday);
    }

    console.log("[weekly-stats] Auto-snapshot complete");
  } catch (err: any) {
    console.error("[weekly-stats] Auto-snapshot error:", err.message);
  }
}

autoSnapshotWeeklyStats();
setInterval(autoSnapshotWeeklyStats, 60 * 60 * 1000);

router.get("/whale/weekly-stats", async (_req, res) => {
  try {
    const result = await dbQuery(
      `SELECT * FROM weekly_signal_stats ORDER BY week_start DESC LIMIT 52`
    );
    res.json({ weeks: result?.rows || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/weekly-stats/snapshot", async (req, res) => {
  try {
    const { weekStart } = req.body;
    const sunday = weekStart ? new Date(weekStart) : getSunday(new Date());
    const result = await snapshotWeek(sunday);
    res.json({ ok: true, stats: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/weekly-stats/backfill", async (_req, res) => {
  try {
    const oldest = await dbQuery(
      `SELECT MIN(detected_at) as oldest FROM signal_outcomes WHERE signal_source = 'replit'`
    );
    const oldestDate = oldest?.rows?.[0]?.oldest;
    if (!oldestDate) return res.json({ ok: true, weeks: 0 });

    let sunday = getSunday(new Date(oldestDate));
    const now = new Date();
    let count = 0;

    while (sunday < now) {
      await snapshotWeek(sunday);
      count++;
      sunday.setDate(sunday.getDate() + 7);
    }

    res.json({ ok: true, weeks: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/admin/revert-signal-prices", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    if (userId !== "5845af78-f880-431b-b2c0-56a9923e6835") {
      return res.status(403).json({ error: "Admin only" });
    }

    const { reverts } = req.body as { reverts: { id: string; price: string }[] };
    if (!reverts || !Array.isArray(reverts)) {
      return res.status(400).json({ error: "Must provide reverts array with {id, price}" });
    }

    let updated = 0;
    for (const r of reverts) {
      await dbQuery(`UPDATE signal_outcomes SET price_at_signal = $1 WHERE id = $2`, [r.price, r.id]);
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/whale/admin/signal-reviews", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string || req.query.userId as string;
    if (!(await isAdminUser(userId))) return res.status(403).json({ error: "Admin only" });
    await dbQuery(`ALTER TABLE signal_reviews ADD COLUMN IF NOT EXISTS signal_meta JSONB`).catch(() => {});
    const result = await dbQuery(`SELECT signal_id, status, note, reviewed_at, signal_meta FROM signal_reviews ORDER BY reviewed_at DESC`);
    const reviewMap: Record<string, { status: string; note: string | null; reviewed_at: string; signal_meta?: any }> = {};
    for (const r of result.rows) {
      reviewMap[r.signal_id] = { status: r.status, note: r.note, reviewed_at: r.reviewed_at, signal_meta: r.signal_meta || null };
    }
    res.json({ reviews: reviewMap });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/admin/signal-review", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    if (!(await isAdminUser(userId))) return res.status(403).json({ error: "Admin only" });
    const { signalId, status, note, signalMeta } = req.body as { signalId: string; status: string; note?: string; signalMeta?: any };
    if (!signalId || !status) return res.status(400).json({ error: "signalId and status required" });
    if (!["correct", "wrong", "pending"].includes(status)) return res.status(400).json({ error: "status must be correct, wrong, or pending" });
    if (status === "pending") {
      await dbQuery(`DELETE FROM signal_reviews WHERE signal_id = $1`, [signalId]);
    } else {
      const metaJson = signalMeta ? JSON.stringify(signalMeta) : null;
      await dbQuery(
        `INSERT INTO signal_reviews (signal_id, status, note, reviewed_by, reviewed_at, signal_meta)
         VALUES ($1, $2, $3, $4, NOW(), $5)
         ON CONFLICT (signal_id) DO UPDATE SET status = $2, note = $3, reviewed_by = $4, reviewed_at = NOW(), signal_meta = COALESCE($5, signal_reviews.signal_meta)`,
        [signalId, status, note || null, userId, metaJson]
      );
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/whale/weekly-stats/cleanup", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    if (userId !== "5845af78-f880-431b-b2c0-56a9923e6835") {
      return res.status(403).json({ error: "Admin only" });
    }

    const allRows = await dbQuery(`SELECT id, week_start, week_end, total_signals FROM weekly_signal_stats ORDER BY week_start DESC`);
    const seen = new Map<string, any>();
    const toDelete: string[] = [];

    for (const row of allRows.rows) {
      const ws = new Date(row.week_start);
      const dayOfWeek = ws.getUTCDay();
      if (dayOfWeek !== 0) {
        toDelete.push(row.id);
        continue;
      }
      const key = row.week_start;
      if (seen.has(key)) {
        toDelete.push(row.id);
      } else {
        seen.set(key, row);
      }
    }

    for (const id of toDelete) {
      await dbQuery(`DELETE FROM weekly_signal_stats WHERE id = $1`, [id]);
    }

    const fixedEnds = await dbQuery(
      `UPDATE weekly_signal_stats SET week_end = week_start + interval '6 days' WHERE week_end != week_start + interval '6 days' RETURNING id, week_start, week_end`
    );

    res.json({ ok: true, deleted: toDelete.length, fixedEnds: fixedEnds.rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Trump Truth Social Monitor ──────────────────────────────────────────────────

interface TrumpPost {
  id: string;
  created_at: string;
  content: string;
  url: string;
  media: string[];
  replies_count: number;
  reblogs_count: number;
  favourites_count: number;
}

const CNN_TRUMP_FEED = "https://ix.cnn.io/data/truth-social/truth_archive.json";
const TRUMP_POLL_INTERVAL = 5 * 60 * 1000;
let trumpPosts: TrumpPost[] = [];
let trumpLastFetch = 0;
let trumpLastSeenId = "";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") return url;
  } catch {}
  return "";
}

async function fetchTrumpPosts(): Promise<void> {
  try {
    const { data } = await axios.get<TrumpPost[]>(CNN_TRUMP_FEED, { timeout: 15000 });
    if (!Array.isArray(data)) return;
    if (data.length === 0) {
      trumpPosts = [];
      trumpLastFetch = Date.now();
      console.log("[trump-monitor] Upstream returned empty feed");
      return;
    }

    const sorted = data
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = sorted.filter(p => new Date(p.created_at).getTime() > cutoff);

    const newCount = trumpLastSeenId
      ? recent.filter(p => p.id > trumpLastSeenId).length
      : 0;

    trumpPosts = recent.map(p => ({
      ...p,
      content: stripHtml(p.content),
      url: sanitizeUrl(p.url),
      media: (p.media || []).map(sanitizeUrl).filter(Boolean),
    }));
    trumpLastSeenId = sorted[0]?.id ?? trumpLastSeenId;
    trumpLastFetch = Date.now();

    console.log(`[trump-monitor] Fetched ${recent.length} posts (last 30d), ${newCount} new`);
  } catch (err: any) {
    console.error(`[trump-monitor] Fetch error: ${err.message}`);
  }
}

fetchTrumpPosts();
setInterval(fetchTrumpPosts, TRUMP_POLL_INTERVAL);

router.get("/whale/trump-posts", (_req, res) => {
  res.json({
    posts: trumpPosts,
    lastFetch: trumpLastFetch ? new Date(trumpLastFetch).toISOString() : null,
    count: trumpPosts.length,
  });
});

router.post("/whale/trump-posts/refresh", async (_req, res) => {
  try {
    await fetchTrumpPosts();
    res.json({
      posts: trumpPosts,
      lastFetch: trumpLastFetch ? new Date(trumpLastFetch).toISOString() : null,
      count: trumpPosts.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
