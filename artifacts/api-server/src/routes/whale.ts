import { Router } from "express";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { priceMonitor, type PriceData } from "../lib/priceMonitor";

const router = Router();

const UW_BASE = "https://api.unusualwhales.com";
const UW_HEADERS = () => ({ Authorization: `Bearer ${process.env["UNUSUAL_WHALES_API_KEY"] ?? ""}` });
const AI_BASE_URL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
const AI_API_KEY = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";
const POLYGON_KEY = () => process.env["POLYGON_API_KEY"] ?? "";
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
  open: number; high: number; low: number; close: number; volume: number; timestamp: number;
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
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0, timestamp: Math.floor(b.t / 1000),
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
    console.log(`[admin-seed] Ensured ${SEED_ADMIN_IDS.length} admin(s) in user_roles`);
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
      fetchPolygonAggs(ticker, 5, "minute", today, today),
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
  const { message, userName } = req.body as { message?: string; userName?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
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

  console.log(`[community-chat] msg="${message.slice(0,50)}" isCasual=${isCasual} isTradingQ=${isTradingQ} hasData=${!!dataStr} user=${userName || "unknown"}`);
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
    let posted = false;
    if (content && content.trim().length > 0) {
      try {
        await axios.post(
          `${SUPABASE_URL}/rest/v1/chat_messages`,
          { user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content: content.trim() },
          { headers: { ...supabaseAdminHeaders(), Prefer: "return=minimal" }, timeout: 5000 }
        );
        posted = true;
      } catch (e: any) {
        console.error("Failed to insert Biddie community response to Supabase:", e.message);
        const insertResult = await dbQuery(
          `INSERT INTO chat_messages (user_id, role, content, user_name) VALUES ($1, $2, $3, $4)`,
          [BIDDIE_USER_ID, "assistant", content.trim(), "Biddie AI"]
        );
        if (insertResult) posted = true;
      }
    }
    res.json({ ok: true, posted, content: content?.trim() || "" });
  } catch (err: any) {
    console.error("Community chat error:", err.message);
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
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
  function scoreSignal(c: any, kl: any, confirmation: any): any {
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
    const price = klPrice ?? uwPrice;

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

    // Filter 1: Reject deep OTM (>15%) or deep ITM (>5%)
    if (price && strike) {
      const isCall = optType === "call";
      const otmPct = isCall ? (strike - price) / price : (price - strike) / price;
      const itmPct = isCall ? (price - strike) / price : (strike - price) / price;
      if (otmPct > 0.15) return null;
      if (itmPct > 0.05) {
        console.log(`[signals] REJECTED ${ticker}: $${strike} ${optType} is ${(itmPct * 100).toFixed(1)}% deep ITM at $${price.toFixed(2)} — likely hedge/institutional`);
        return null;
      }
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

    // Entry/target/invalidation
    let entryTrigger = "";
    let target = "";
    let targetNear = "";
    let invalidation = "";
    let keyLevel = "";

    const aboveVwap = price && vwap ? price > vwap : null;
    const abovePdh = price && pdh ? price > pdh : null;
    const belowPdl = price && pdl ? price < pdl : null;
    const abovePivot = price && pivot ? price > pivot : null;

    let srLevel = "";
    const psych = Math.round(strike / 10) * 10;
    const psychLevel = psych > 0 ? `$${psych} psychological level` : "";

    let actNow = false;

    const hasKeyLevels = !!(vwap || pivot || pdh || pdl || r1 || s1);

    if (optType === "call") {
      if (price) {
        if (isWhaleFlow) {
          entryTrigger = `Whale sweep at $${price.toFixed(2)}`;
          actNow = true;
        } else if (vwap) {
          const distToVwap = Math.abs(price - vwap) / price;
          if (distToVwap < 0.005) {
            entryTrigger = `At VWAP ($${vwap.toFixed(2)}) — Near $${price.toFixed(2)}`;
            actNow = true;
          } else if (price > vwap) {
            entryTrigger = `Above VWAP ($${vwap.toFixed(2)}) — Near $${price.toFixed(2)}`;
            actNow = true;
          } else {
            entryTrigger = `On bounce from VWAP ($${vwap.toFixed(2)}) — Near $${price.toFixed(2)}`;
            actNow = false;
          }
        } else if (pivot) {
          entryTrigger = `Near Pivot ($${pivot.toFixed(2)}) — $${price.toFixed(2)}`;
          actNow = price >= pivot;
        } else {
          entryTrigger = `Near $${price.toFixed(2)} (no VWAP data)`;
          actNow = false;
        }

        const callTargets = [
          vwap && vwap > price ? { level: vwap, name: "VWAP" } : null,
          strike > price ? { level: strike, name: "Strike" } : null,
          pdh && pdh > price ? { level: pdh, name: "PDH" } : null,
          r1 && r1 > price ? { level: r1, name: "R1" } : null,
          pivot && pivot > price ? { level: pivot, name: "Pivot" } : null,
        ].filter((l): l is { level: number; name: string } => !!l);
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
      } else {
        entryTrigger = `Data Not Available`;
        target = `Data Not Available`;
        targetNear = "";
        invalidation = `Data Not Available`;
      }
      keyLevel = pivot ? `Pivot at $${pivot.toFixed(2)}` : (vwap ? `VWAP at $${vwap.toFixed(2)}` : "");
      srLevel = psychLevel || (r1 ? `R1 at $${r1.toFixed(2)}` : "");
    } else {
      if (price) {
        if (isWhaleFlow) {
          entryTrigger = `Whale sweep at $${price.toFixed(2)}`;
          actNow = true;
        } else if (vwap) {
          const distToVwap = Math.abs(price - vwap) / price;
          if (distToVwap < 0.005) {
            entryTrigger = `At VWAP ($${vwap.toFixed(2)}) — Near $${price.toFixed(2)}`;
            actNow = true;
          } else if (price < vwap) {
            entryTrigger = `Below VWAP ($${vwap.toFixed(2)}) — Near $${price.toFixed(2)}`;
            actNow = true;
          } else {
            entryTrigger = `On rejection from VWAP ($${vwap.toFixed(2)}) — Near $${price.toFixed(2)}`;
            actNow = false;
          }
        } else if (pivot) {
          entryTrigger = `Near Pivot ($${pivot.toFixed(2)}) — $${price.toFixed(2)}`;
          actNow = price <= pivot;
        } else {
          entryTrigger = `Near $${price.toFixed(2)} (no VWAP data)`;
          actNow = false;
        }

        const putTargets = [
          vwap && vwap < price ? { level: vwap, name: "VWAP" } : null,
          strike < price ? { level: strike, name: "Strike" } : null,
          pdl && pdl < price ? { level: pdl, name: "PDL" } : null,
          s1 && s1 < price ? { level: s1, name: "S1" } : null,
          pivot && pivot < price ? { level: pivot, name: "Pivot" } : null,
        ].filter((l): l is { level: number; name: string } => !!l);
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
      } else {
        entryTrigger = `Data Not Available`;
        target = `Data Not Available`;
        targetNear = "";
        invalidation = `Data Not Available`;
      }
      keyLevel = pivot ? `Pivot at $${pivot.toFixed(2)}` : (vwap ? `VWAP at $${vwap.toFixed(2)}` : "");
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
    const sig = scoreSignal(c, kl, confirmation);
    if (sig && !seenTickers.has(`${ticker}-${optType}`)) {
      seenTickers.add(`${ticker}-${optType}`);
      preScreened.push(sig);
    }
  }
  preScreened.sort((a, b) => b.confidence - a.confidence);
  const topCandidates = preScreened.slice(0, 15);

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
      };
    });

    const aiPrompt = `You are a professional options flow analyst and CHART READER with ICT/SMC (Smart Money Concepts) knowledge. Evaluate these ${topCandidates.length} pre-screened trade signals. Your job is to determine which are REAL actionable directional bets vs hedges/noise.

CRITICAL DATA YOU HAVE FOR EACH SIGNAL:
1. "trend_description" + "intraday_trend" — what the stock is doing TODAY
2. "market_structure" — FULL ICT/SMC structural analysis including:
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

  console.log(`[signals] pipeline complete: ${Date.now() - t0}ms, ${signals.length} signals (deduped)`);

  const biddiePicks = signals.filter((s) => s.is_biddie_pick);
  const responseData = { signals: biddiePicks.slice(0, 20), count: Math.min(biddiePicks.length, 20), signalCount: signals.length, timestamp: now };
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
        if (!isNaN(expDate.getTime()) && expDate < new Date()) {
          console.log(`[signals] SKIPPED ${s.ticker}: ${s.option_type} $${s.strike} already expired (${fixedExpiry})`);
          continue;
        }
      }

      const existing = await dbQuery(
        `SELECT id FROM signal_outcomes WHERE ticker = $1 AND COALESCE(strike, 0) = COALESCE($2::numeric, 0) AND COALESCE(option_type, '') = COALESCE($3, '') AND COALESCE(expiry, '') = COALESCE($4, '') AND signal_source = 'replit' LIMIT 1`,
        [s.ticker, s.strike, s.option_type, fixedExpiry]
      );
      if (existing && existing.rows.length > 0) continue;

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
  if (signalsCache && Date.now() - signalsCache.timestamp < SIGNALS_CACHE_TTL) {
    return res.json(signalsCache.data);
  }

  if (signalsPipelineRunning) {
    if (signalsCache) {
      return res.json(signalsCache.data);
    }
    return res.json({ signals: [], count: 0, timestamp: getNowEastern(), loading: true });
  }

  if (signalsCache) {
    res.json(signalsCache.data);
    runSignalsPipeline().catch(e => console.error("[signals] background refresh failed:", e));
    return;
  }

  try {
    const data = await runSignalsPipeline();
    res.json(data || { signals: [], count: 0, timestamp: getNowEastern() });
  } catch (err: any) {
    console.error("[signals] pipeline error:", err);
    res.json({ signals: [], count: 0, timestamp: getNowEastern() });
  }
});

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

router.get("/whale/signals/calendar", async (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("ETag", `W/"cal-${Date.now()}"`);
  try {
    const limit = Math.min(parseInt(String(req.query.limit)) || 500, 1000);
    const result = await dbQuery(
      `SELECT so.id, so.ticker, so.signal_type, so.option_type AS "put_call", so.confidence, so.strike, so.expiry,
              so.outcome, so.created_at, so.detected_at, so.resolved_at, so.category, so.price_at_signal,
              so.target AS target_price, so.invalidation, so.entry_trigger, so.direction,
              so.max_favorable_price, so.mfe_percent, so.max_adverse_price,
              so.entry_price_reached, so.invalidation_breached, so.pct_past_invalidation,
              so.time_at_target, so.entry_price, so.key_level, so.sr_level,
              so.is_biddie_pick, so.signal_quality,
              sr.status AS review_status, sr.note AS review_note
       FROM signal_outcomes so
       LEFT JOIN signal_reviews sr ON sr.signal_id = so.id::text
       WHERE so.signal_source = 'replit'
       ORDER BY so.detected_at DESC
       LIMIT $1`,
      [limit]
    );
    const statsResult = await dbQuery(
      `SELECT outcome, COUNT(*)::int AS count FROM signal_outcomes
       WHERE signal_source = 'replit' GROUP BY outcome`
    );
    const stats: Record<string, number> = {};
    for (const row of (statsResult?.rows || [])) {
      stats[row.outcome || "pending"] = row.count;
    }
    res.json({
      signals: result?.rows || [],
      stats,
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
              time_at_target, entry_price, key_level, sr_level
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
      const polygonKey = process.env.POLYGON_API_KEY;
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
       WHERE signal_source = 'replit'
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
      `SELECT d.*, sr.status AS review_status, sr.note AS review_note FROM (
        SELECT DISTINCT ON (ticker, category, strike, option_type) * FROM signal_outcomes
        WHERE signal_source = 'replit'
        ORDER BY ticker, category, strike, option_type, confidence DESC, detected_at DESC
      ) d LEFT JOIN signal_reviews sr ON sr.signal_id = d.id::text
      ORDER BY d.detected_at DESC LIMIT $1`,
      [limit]
    );
    const countResult = await dbQuery(
      `SELECT
        COUNT(*) FILTER (WHERE outcome = 'pending' OR outcome IS NULL) AS pending_count,
        COUNT(*) AS total_count
       FROM signal_outcomes WHERE signal_source = 'replit'`
    );
    const counts = countResult?.rows?.[0] || {};
    res.json({
      signals: result?.rows || [],
      count: result?.rows?.length || 0,
      totalPending: parseInt(counts.pending_count) || 0,
      totalSignals: parseInt(counts.total_count) || 0,
    });
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
      `SELECT * FROM signal_outcomes WHERE outcome = 'pending' ORDER BY created_at ASC LIMIT 100`
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
    await Promise.all(
      pending.map(async (s: any) => {
        const sinceDate = s.detected_at || s.created_at;
        const history = await fetchPriceHistory(s.ticker, sinceDate);
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
      const MIN_HOURS_BEFORE_MISS = 2;
      const canMiss = hoursAlive >= MIN_HOURS_BEFORE_MISS || isExpired;

      let outcome: string | null = null;
      let outcomePrice = history.current;
      const refPrice = signalPrice || entryPrice || 0;

      const MIN_MOVE_PCT = 0.005;

      if (target.low && target.high && refPrice > 0) {
        const targetMakesDirectionalSense = isBullish
          ? target.low > refPrice * 0.999
          : target.high < refPrice * 1.001;
        if (targetMakesDirectionalSense) {
          if (isBullish) {
            const notAlreadyPastTarget = !signalPrice || signalPrice <= target.low * 1.03;
            if (notAlreadyPastTarget && history.highSince >= target.low) {
              outcome = "hit";
              outcomePrice = history.highSince;
            }
          } else {
            const notAlreadyPastTarget = !signalPrice || signalPrice >= target.high * 0.97;
            if (notAlreadyPastTarget && history.lowSince <= target.high) {
              outcome = "hit";
              outcomePrice = history.lowSince;
            }
          }
        }
      }

      if (!outcome && !target.low && !target.high && refPrice > 0) {
        const strikeVal = parseFloat(signal.strike);
        if (!isNaN(strikeVal) && strikeVal > 0) {
          if (isBullish && strikeVal > refPrice && history.highSince >= strikeVal) {
            outcome = "hit";
            outcomePrice = history.highSince;
          } else if (!isBullish && strikeVal < refPrice && history.lowSince <= strikeVal) {
            outcome = "hit";
            outcomePrice = history.lowSince;
          }
        }
      }

      if (!outcome && canMiss && invalidationPrice && refPrice > 0) {
        const INV_BUFFER_PCT = 0.0025;
        const invZone = isBullish
          ? invalidationPrice * (1 - INV_BUFFER_PCT)
          : invalidationPrice * (1 + INV_BUFFER_PCT);
        const invMakesDirectionalSense = isBullish
          ? invalidationPrice < refPrice
          : invalidationPrice > refPrice;
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
            outcome = "missed";
            outcomePrice = isBullish ? history.lowSince : history.highSince;
          } else if (currentlyBreached && didBreachZone && !isLongDated) {
            outcome = "missed";
            outcomePrice = isBullish ? history.lowSince : history.highSince;
          } else if (currentlyBreached && didBreachZone && isLongDated) {
            const breachPct = isBullish
              ? ((invZone - history.current) / invZone) * 100
              : ((history.current - invZone) / invZone) * 100;
            if (breachPct >= 1.0) {
              outcome = "missed";
              outcomePrice = isBullish ? history.lowSince : history.highSince;
            }
          }
        }
      }

      if (!outcome && signal.outcome === "missed" && !isExpired && invalidationPrice && refPrice > 0) {
        const recovered = isBullish
          ? history.current > invalidationPrice
          : history.current < invalidationPrice;
        if (recovered) {
          outcome = "pending_revert";
        }
      }

      const expiryPlusClose = expiryDate ? new Date(expiryDate.getTime() + 20 * 60 * 60 * 1000) : null;
      const isActuallyExpired = expiryPlusClose ? expiryPlusClose < now : false;
      if (!outcome && (isExpired || isActuallyExpired)) {
        if (!isActuallyExpired) {
          // Option hasn't expired yet — don't mark expired/partial_hit
        } else {
          let mfePctCalc: number | null = null;
          if (refPrice > 0 && target.low && target.high) {
            const tgtP = isBullish ? target.low : target.high;
            const denom = Math.abs(tgtP - refPrice);
            if (denom > 0) {
              const favorable = isBullish ? (history.highSince - refPrice) : (refPrice - history.lowSince);
              mfePctCalc = (favorable / denom) * 100;
            }
          }
          const mfePricePct = refPrice > 0
            ? (isBullish ? ((history.highSince - refPrice) / refPrice) * 100 : ((refPrice - history.lowSince) / refPrice) * 100)
            : 0;

          if (mfePctCalc !== null && mfePctCalc >= 50) {
            outcome = "partial_hit";
          } else if (mfePricePct >= 1.0) {
            outcome = "partial_hit";
          } else {
            outcome = "expired";
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
        const updateResult = await dbQuery(
          `UPDATE signal_outcomes SET outcome = $1, resolved_at = $2 WHERE id = $3`,
          [outcome, now.toISOString(), signal.id]
        );

        if (!updateResult) {
          updateErrors++;
          continue;
        }

        if (outcome === "hit") hits++;
        else if (outcome === "partial_hit") partialHits++;
        else if (outcome === "missed") misses++;
        else if (outcome === "expired") expired++;

        await dbQuery(
          `UPDATE user_trades SET signal_outcome = $1, resolved_at = $2 WHERE signal_id = $3`,
          [outcome, now.toISOString(), signal.id]
        );
      }
    }

    const remaining = pending.length - hits - partialHits - misses - expired - updateErrors;
    res.json({ verified: pending.length, hits, partial_hits: partialHits, misses, expired, remaining_pending: remaining, errors: updateErrors > 0 ? updateErrors : undefined });
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
  const polygonKey = process.env["POLYGON_API_KEY"] ?? "";

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
      marketOpen: isMarketHours(),
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

function isMarketHours(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const day = get("weekday");
  if (["Sat", "Sun"].includes(day)) return false;
  const etTime = hour + minute / 60;
  return etTime >= 9.5 && etTime < 16;
}

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
    const tickers = [...new Set([...BASELINE, ...result.rows.map((r: any) => r.ticker).filter((t: string) => t && !t.includes(" ") && t.length <= 5)])];
    priceMonitor.updateSubscriptions(tickers);
    console.log(`[price-monitor] Subscribed to ${tickers.length} tickers: ${tickers.join(", ")}`);
  } catch (e: any) {
    console.error("[price-monitor] Subscription sync error:", e.message);
  }
}

async function realtimeVerifySignals() {

  try {
    const pendingResult = await dbQuery(
      `SELECT * FROM signal_outcomes WHERE outcome = 'pending' ORDER BY created_at ASC LIMIT 100`
    );
    if (!pendingResult || pendingResult.rows.length === 0) return;

    const pending = pendingResult.rows;
    const now = new Date();
    let hits = 0, partialHits = 0, misses = 0, expired = 0;

    const tickers = [...new Set(pending.map((s: any) => s.ticker))];
    const signalPriceMap: Record<string, PriceHistory> = {};

    await Promise.all(
      pending.map(async (s: any) => {
        const sinceDate = s.detected_at || s.created_at;
        const history = await fetchPriceHistory(s.ticker, sinceDate);
        if (history) signalPriceMap[s.id] = history;
      })
    );

    for (const signal of pending) {
      const history = signalPriceMap[signal.id];
      if (!history) continue;
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
      const MIN_HOURS_BEFORE_MISS = 2;
      const canMiss = hoursAlive >= MIN_HOURS_BEFORE_MISS || isExpired;

      let outcome: string | null = null;
      const refPrice2 = signalPrice || entryPrice || 0;

      const MIN_MOVE_PCT2 = 0.005;

      if (target_val.low && target_val.high && refPrice2 > 0) {
        // For calls: target should be above price. Use the LOWER target value as the hit threshold.
        // For puts: target should be below price. Use the HIGHER target value as the hit threshold (closest downside target).
        // But ONLY if the target makes directional sense (above price for calls, below price for puts)
        if (isBullish) {
          // Call: need price to go UP to target. Use lowest target as threshold.
          const callTarget = Math.min(target_val.low, target_val.high);
          const targetAbovePrice = callTarget > refPrice2 * 0.995;
          const notAlreadyPastTarget = !signalPrice || signalPrice <= callTarget * 1.01;
          if (targetAbovePrice && notAlreadyPastTarget && history.highSince >= callTarget) {
            outcome = "hit";
          }
        } else {
          // Put: need price to go DOWN to target. Use highest target as threshold (nearest downside target).
          const putTarget = Math.max(target_val.low, target_val.high);
          const targetBelowPrice = putTarget < refPrice2 * 1.005;
          const notAlreadyPastTarget = !signalPrice || signalPrice >= putTarget * 0.99;
          if (targetBelowPrice && notAlreadyPastTarget && history.lowSince <= putTarget) {
            outcome = "hit";
          }
        }
      }

      // Fallback: no valid targets — require at least 1.5% move in the right direction (not 0.5%)
      const MIN_FALLBACK_PCT = 0.015;
      if (!outcome && refPrice2 > 0 && (!target_val.low || !target_val.high)) {
        if (isBullish && history.highSince >= refPrice2 * (1 + MIN_FALLBACK_PCT)) outcome = "hit";
        else if (!isBullish && history.lowSince <= refPrice2 * (1 - MIN_FALLBACK_PCT)) outcome = "hit";
      }

      if (!outcome && canMiss && invalidationPrice && refPrice2 > 0) {
        const INV_BUFFER_PCT = 0.0025;
        const invZone = isBullish
          ? invalidationPrice * (1 - INV_BUFFER_PCT)
          : invalidationPrice * (1 + INV_BUFFER_PCT);
        const invMakesDirectionalSense = isBullish
          ? invalidationPrice < refPrice2
          : invalidationPrice > refPrice2;
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
            outcome = "missed";
          } else if (currentlyBreached && didBreachZone && !isLongDated) {
            outcome = "missed";
          } else if (currentlyBreached && didBreachZone && isLongDated) {
            const breachPct = isBullish
              ? ((invZone - history.current) / invZone) * 100
              : ((history.current - invZone) / invZone) * 100;
            if (breachPct >= 1.0) {
              outcome = "missed";
            }
          }
        }
      }

      if (!outcome && signal.outcome === "missed" && !isExpired && invalidationPrice && refPrice2 > 0) {
        const recovered = isBullish
          ? history.current > invalidationPrice
          : history.current < invalidationPrice;
        if (recovered) {
          outcome = "pending_revert";
        }
      }

      const expiryPlusClose2 = expiryDate ? new Date(expiryDate.getTime() + 20 * 60 * 60 * 1000) : null;
      const isActuallyExpired2 = expiryPlusClose2 ? expiryPlusClose2 < now : false;
      if (!outcome && (isExpired || isActuallyExpired2)) {
        if (!isActuallyExpired2) {
          // Option hasn't expired yet — don't mark expired/partial_hit
        } else {
          let mfePctCalc2: number | null = null;
          if (refPrice2 > 0 && target_val.low && target_val.high) {
            const tgtP = isBullish ? target_val.low : target_val.high;
            const denom = Math.abs(tgtP - refPrice2);
            if (denom > 0) {
              const favorable = isBullish ? (history.highSince - refPrice2) : (refPrice2 - history.lowSince);
              mfePctCalc2 = (favorable / denom) * 100;
            }
          }
          const mfePricePct2 = refPrice2 > 0
            ? (isBullish ? ((history.highSince - refPrice2) / refPrice2) * 100 : ((refPrice2 - history.lowSince) / refPrice2) * 100)
            : 0;

          if (mfePctCalc2 !== null && mfePctCalc2 >= 50) {
            outcome = "partial_hit";
          } else if (mfePricePct2 >= 1.0) {
            outcome = "partial_hit";
          } else {
            outcome = "expired";
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

      const prevStatus = signal.trade_status || "watching";
      let newStatus = prevStatus;
      const hasNoLevels = (signal.entry_trigger || "").includes("Level data not available");
      if (hasNoLevels) {
        if (outcome === "hit") newStatus = "hit";
        else if (outcome === "partial_hit") newStatus = "partial_hit";
        else if (outcome === "missed") newStatus = "miss";
        else if (outcome === "expired") newStatus = "expired";
        else if (signal.outcome === "missed") newStatus = "miss";
        else if (signal.outcome === "hit" || signal.outcome === "win") newStatus = "hit";
      } else {
        if (prevStatus === "watching" && didReachEntry) {
          newStatus = "active";
        }
        if (outcome === "hit") newStatus = "hit";
        else if (outcome === "partial_hit") newStatus = "partial_hit";
        else if (outcome === "missed") newStatus = "miss";
        else if (outcome === "expired") newStatus = "expired";
      }

      const statusChanged = newStatus !== prevStatus;

      if (shouldUpdateMfp || shouldUpdateMap || didReachEntry !== (signal.entry_price_reached || false) || didBreachInvalidation !== (signal.invalidation_breached || false) || statusChanged) {
        await dbQuery(
          `UPDATE signal_outcomes SET max_favorable_price = $1, mfe_percent = $2, max_adverse_price = $3, entry_price_reached = $4, invalidation_breached = $5, pct_past_invalidation = $6, entry_price = $7, trade_status = $8, status_updated_at = $9${newStatus === "active" && prevStatus === "watching" ? ", entry_hit_at = $9" : ""} WHERE id = $10`,
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
        else if (outcome === "missed") misses++;
        else if (outcome === "expired") expired++;
      }
    }

    if (hits + partialHits + misses + expired > 0) {
      const source = priceMonitor.isConnected() ? "real-time" : "Polygon";
      console.log(`[auto-verify] ${source} | Verified: ${hits} hits, ${partialHits} partial, ${misses} misses, ${expired} expired`);
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

  function adjustVerifyFrequency() {
    if (verifyInterval) clearInterval(verifyInterval);

    if (isMarketHours()) {
      verifyInterval = setInterval(realtimeVerifySignals, 5 * 60 * 1000);
      console.log("[auto-verify] Market hours: verifying every 5 minutes");
    } else {
      verifyInterval = setInterval(realtimeVerifySignals, 30 * 60 * 1000);
      console.log("[auto-verify] After hours: verifying every 30 minutes");
    }
  }

  adjustVerifyFrequency();
  setInterval(adjustVerifyFrequency, 15 * 60 * 1000);

  setTimeout(realtimeVerifySignals, 30 * 1000);
}

setTimeout(startPriceMonitorSystem, 5000);

router.get("/whale/prices/realtime", (_req, res) => {
  const prices = priceMonitor.getAllPrices();
  const data: Record<string, any> = {};
  for (const [ticker, pd] of prices) {
    data[ticker] = {
      price: pd.price,
      high: pd.high,
      low: pd.low,
      volume: pd.volume,
      trades: pd.trades,
      source: pd.source ?? "ws",
      bid: pd.bid,
      ask: pd.ask,
      prevClose: pd.prevClose,
      changePercent: pd.changePercent,
      lastUpdate: new Date(pd.lastUpdate).toISOString(),
      age: Math.round((Date.now() - pd.lastUpdate) / 1000),
    };
  }
  res.json({
    connected: priceMonitor.isConnected(),
    marketOpen: isMarketHours(),
    subscribedTickers: priceMonitor.getSubscribedTickers(),
    tickerCount: priceMonitor.getSubscribedTickers().length,
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
      marketOpen: isMarketHours(),
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
        params: { apiKey: process.env["POLYGON_API_KEY"] },
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
      `SELECT ut.*, so.outcome, so.resolved_at, so.created_at as signal_created_at
       FROM user_trades ut
       LEFT JOIN signal_outcomes so ON ut.signal_id = so.id::text
       WHERE ut.user_id = $1
       ORDER BY ut.taken_at DESC`,
      [userId]
    );
    if (!allTrades) return res.json({ stats: null });

    const trades = allTrades.rows;
    const total = trades.length;
    const resolved = trades.filter((t: any) => t.outcome === "hit" || t.outcome === "missed");
    const hits = resolved.filter((t: any) => t.outcome === "hit").length;
    const misses = resolved.filter((t: any) => t.outcome === "missed").length;
    const pending = trades.filter((t: any) => !t.outcome || t.outcome === "pending").length;
    const winRate = resolved.length > 0 ? Math.round((hits / resolved.length) * 100) : 0;

    let streak = 0;
    for (const t of resolved) {
      if ((t as any).outcome === "hit") streak++;
      else break;
    }

    const byTicker: Record<string, { hits: number; total: number }> = {};
    for (const t of resolved) {
      const tk = (t as any).ticker;
      if (!byTicker[tk]) byTicker[tk] = { hits: 0, total: 0 };
      byTicker[tk].total++;
      if ((t as any).outcome === "hit") byTicker[tk].hits++;
    }

    const byCategory: Record<string, { hits: number; total: number }> = {};
    for (const t of resolved) {
      const cat = (t as any).category || "unknown";
      if (!byCategory[cat]) byCategory[cat] = { hits: 0, total: 0 };
      byCategory[cat].total++;
      if ((t as any).outcome === "hit") byCategory[cat].hits++;
    }

    const sunday = getSunday(new Date());
    const thisWeek = trades.filter((t: any) => new Date(t.taken_at) >= sunday);
    const thisWeekResolved = thisWeek.filter((t: any) => t.outcome === "hit" || t.outcome === "missed");
    const weekHits = thisWeekResolved.filter((t: any) => t.outcome === "hit").length;
    const weekMisses = thisWeekResolved.filter((t: any) => t.outcome === "missed").length;
    const weekPending = thisWeek.filter((t: any) => !t.outcome || t.outcome === "pending").length;
    const weekWinRate = thisWeekResolved.length > 0 ? Math.round((weekHits / thisWeekResolved.length) * 100) : 0;

    const weeklyMap: Record<string, { hits: number; misses: number; pending: number; total: number; partial_hits: number }> = {};
    for (const t of trades) {
      const takenAt = new Date((t as any).taken_at);
      const ws = getTradeWeekStart(takenAt);
      const key = ws.toISOString();
      if (!weeklyMap[key]) weeklyMap[key] = { hits: 0, misses: 0, pending: 0, total: 0, partial_hits: 0 };
      weeklyMap[key].total++;
      const outcome = (t as any).outcome;
      if (outcome === "hit") weeklyMap[key].hits++;
      else if (outcome === "partial_hit") weeklyMap[key].partial_hits++;
      else if (outcome === "missed") weeklyMap[key].misses++;
      else weeklyMap[key].pending++;
    }

    const currentWeekKey = sunday.toISOString();
    if (!weeklyMap[currentWeekKey]) {
      weeklyMap[currentWeekKey] = { hits: 0, misses: 0, pending: 0, total: 0, partial_hits: 0 };
    }

    const weeklyBreakdown = Object.entries(weeklyMap)
      .map(([weekStart, data]) => {
        const ws = new Date(weekStart);
        const we = new Date(ws); we.setDate(we.getDate() + 6);
        const resolved = data.hits + data.partial_hits + data.misses;
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
    `SELECT ticker, outcome, conviction_score, is_biddie_pick
     FROM signal_outcomes
     WHERE signal_source = 'replit'
       AND detected_at >= $1 AND detected_at < $2`,
    [weekStart.toISOString(), queryEnd.toISOString()]
  );

  const rows = signals?.rows || [];
  const total = rows.length;
  const hits = rows.filter((r: any) => r.outcome === "hit").length;
  const partialHits = rows.filter((r: any) => r.outcome === "partial_hit").length;
  const misses = rows.filter((r: any) => r.outcome === "missed").length;
  const expired = rows.filter((r: any) => r.outcome === "expired").length;
  const pending = rows.filter((r: any) => !r.outcome || r.outcome === "pending").length;
  const resolved = hits + partialHits + misses;
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
    else if (outcome === "missed") tickerCounts[tk].misses++;
    else tickerCounts[tk].pending++;
  }
  const topTickers = Object.entries(tickerCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([ticker, data]) => ({ ticker, ...data }));

  const biddiePicks = rows.filter((r: any) => r.is_biddie_pick);
  const biddieResolved = biddiePicks.filter((r: any) => r.outcome === "hit" || r.outcome === "partial_hit" || r.outcome === "missed");
  const biddieHits = biddieResolved.filter((r: any) => r.outcome === "hit" || r.outcome === "partial_hit").length;
  const biddieMisses = biddieResolved.filter((r: any) => r.outcome === "missed").length;
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
