import { Router } from "express";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const UW_BASE = "https://api.unusualwhales.com";
const UW_HEADERS = () => ({ Authorization: `Bearer ${process.env["UNUSUAL_WHALES_API_KEY"] ?? ""}` });
const AI_BASE_URL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
const AI_API_KEY = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";

const claude = new Anthropic({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

const SUPABASE_URL = process.env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_KEY = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Data Fetchers ──────────────────────────────────────────────────────────────

async function fetchFlowAlerts(limit = 200) {
  try {
    const res = await axios.get(`${UW_BASE}/api/option-trades/flow-alerts`, {
      headers: UW_HEADERS(), params: { limit }, timeout: 15000,
    });
    const d = res.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  } catch { return []; }
}

async function fetchDarkpool(ticker: string, limit = 40) {
  try {
    const res = await axios.get(`${UW_BASE}/api/darkpool/${ticker.toUpperCase()}`, {
      headers: UW_HEADERS(), params: { limit }, timeout: 15000,
    });
    const d = res.data;
    return Array.isArray(d) ? d : (d?.data ?? []);
  } catch { return []; }
}

async function fetchKeyLevels(ticker: string, uwPrice?: number | null) {
  try {
    const YF = "https://query1.finance.yahoo.com/v8/finance/chart";
    const headers = { "User-Agent": "Mozilla/5.0" };

    // Fetch last 2 days of daily bars for prior day OHLC
    const daily = await axios.get(`${YF}/${ticker}`, {
      headers, params: { interval: "1d", range: "5d" }, timeout: 10000,
    });
    const dailyResult = daily.data?.chart?.result?.[0];
    const dailyQuote = dailyResult?.indicators?.quote?.[0];
    const dailyTs = dailyResult?.timestamp ?? [];
    const dailyLen = dailyTs.length;

    const prevClose  = dailyQuote?.close?.[dailyLen - 2] ?? null;
    const prevHigh   = dailyQuote?.high?.[dailyLen - 2] ?? null;
    const prevLow    = dailyQuote?.low?.[dailyLen - 2] ?? null;
    const prevOpen   = dailyQuote?.open?.[dailyLen - 2] ?? null;
    const todayOpen  = dailyQuote?.open?.[dailyLen - 1] ?? null;
    const todayHigh  = dailyQuote?.high?.[dailyLen - 1] ?? null;
    const todayLow   = dailyQuote?.low?.[dailyLen - 1] ?? null;

    // Fetch intraday 5-min bars for VWAP calculation
    const intraday = await axios.get(`${YF}/${ticker}`, {
      headers, params: { interval: "5m", range: "1d" }, timeout: 10000,
    });
    const intResult = intraday.data?.chart?.result?.[0];
    const intQuote  = intResult?.indicators?.quote?.[0];
    const intLen    = (intResult?.timestamp ?? []).length;

    let vwap: number | null = null;
    if (intQuote && intLen > 0) {
      let cumTPV = 0, cumVol = 0;
      for (let i = 0; i < intLen; i++) {
        const h = intQuote.high?.[i] ?? 0;
        const l = intQuote.low?.[i] ?? 0;
        const c = intQuote.close?.[i] ?? 0;
        const v = intQuote.volume?.[i] ?? 0;
        if (h && l && c && v) {
          cumTPV += ((h + l + c) / 3) * v;
          cumVol += v;
        }
      }
      vwap = cumVol > 0 ? Math.round((cumTPV / cumVol) * 100) / 100 : null;
    }

    // Use Unusual Whales real-time price if available, otherwise fall back to Yahoo
    let currentPrice: number | null = uwPrice ? Math.round(uwPrice * 100) / 100 : null;
    if (!currentPrice) {
      const meta = intResult?.meta ?? dailyResult?.meta ?? {};
      const preMarket  = meta.preMarketPrice   ?? null;
      const postMarket = meta.postMarketPrice  ?? null;
      const regMarket  = meta.regularMarketPrice ?? null;
      const preTs  = meta.preMarketTime   ?? 0;
      const postTs = meta.postMarketTime  ?? 0;
      const regTs  = meta.regularMarketTime ?? 0;
      currentPrice = regMarket;
      if (preMarket && preTs > regTs) currentPrice = preMarket;
      if (postMarket && postTs > regTs && postTs > preTs) currentPrice = postMarket;
      if (!currentPrice) currentPrice = intQuote?.close?.[intLen - 1] ?? prevClose;
      if (currentPrice) currentPrice = Math.round(currentPrice * 100) / 100;
    }

    // Pivot points from prior day
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
    const YF = "https://query1.finance.yahoo.com/v8/finance/chart";
    const res = await axios.get(`${YF}/${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      params: { interval, range: "1d" },
      timeout: 10000,
    });
    const result = res.data?.chart?.result?.[0];
    if (!result) return [];
    const quote = result.indicators?.quote?.[0];
    const timestamps = result.timestamp ?? [];
    const bars: CandleBar[] = [];
    for (let i = Math.max(0, timestamps.length - count); i < timestamps.length; i++) {
      const o = quote?.open?.[i];
      const h = quote?.high?.[i];
      const l = quote?.low?.[i];
      const c = quote?.close?.[i];
      const v = quote?.volume?.[i];
      if (o && h && l && c) {
        bars.push({ open: o, high: h, low: l, close: c, volume: v ?? 0, timestamp: timestamps[i] });
      }
    }
    return bars;
  } catch { return []; }
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
  const optionType = signal.option_type || (signal.direction === "bullish" ? "call" : "put");
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
    if (!entry && vwap) entry = `Rejection below VWAP ($${vwap}) or break below $${pdl || s1 || (currentPrice ? Math.round((currentPrice * 0.99) * 100) / 100 : "N/A")}`;
    if (!target && s1) target = `$${s1}${s2 ? ` — $${s2}` : ""}`;
    if (!invalidation && pdh) invalidation = `$${pdh} (prior day high)`;
    else if (!invalidation && vwap) invalidation = `$${vwap} (VWAP reclaim)`;
  } else {
    if (!entry && vwap) entry = `Hold above VWAP ($${vwap}) or break above $${pdh || r1 || (currentPrice ? Math.round((currentPrice * 1.01) * 100) / 100 : "N/A")}`;
    if (!target && r1) target = `$${r1}${r2 ? ` — $${r2}` : ""}`;
    if (!invalidation && pdl) invalidation = `$${pdl} (prior day low)`;
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
        has_floor: x.has_floor,
        trade_count: x.trade_count,
        iv: x.iv_end,
        next_earnings: x.next_earnings_date,
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

YOUR PERSONALITY:
- Seasoned but relatable and cool — you know your stuff but you're not stiff about it
- Talk like a trader who's been in the game for years and is genuinely trying to help
- Casual and confident, not corporate. Think "your homie who happens to be really good at reading flow"
- Use natural language — contractions, short sentences, real talk
- Reference actual numbers from the data (premium, vol/OI, strike, aggression %)
- Never generic — always specific to what the data actually shows
- Call out what matters and what doesn't — don't waste people's time
- You understand how traders actually talk — casual, slang, shorthand — and you respond naturally without asking for clarification
- Only highlight near-term plays (0DTE to ~2 weeks out). If something has a far-out expiration, it's not urgent and you should note that

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

ALWAYS:
- Cite specific numbers from the data
- Mention timestamps when relevant
- Flag expired or irrelevant data and ignore it
- If data is limited or market is closed, say so and explain what you can still determine
- NEVER end a response with a question. Give the full analysis and stop. The user did not ask for a conversation — they asked for a read on the trade. Deliver it and done.
- NEVER ask "what's your P&L", "where is the stock trading", "what's your expiration" — you have the live price data and the user already told you their position. Use it.`;

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

  // Build the next 7 calendar days with their day-of-week labels
  const todayDate = new Date(todayYear, todayMon, todayDay);
  const upcoming: string[] = [];
  for (let i = 1; i <= 7; i++) {
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

  return [
    `TODAY: ${todayDow}, ${MONTH_NAMES[todayMon]} ${todayDay}, ${todayYear} — ${timeStr}`,
    `TODAY'S DATE IN M/D FORMAT: ${todayMon + 1}/${todayDay}/${todayYear}`,
    `UPCOMING DATES (use these exact day-of-week labels — do not calculate yourself):`,
    ...upcoming.map((l) => `  ${l}`),
    `NEXT TRADING DAYS IN ORDER: ${tradingDays.join(", ")}`,
    `IMPORTANT: When referencing any expiration date, look it up in the list above and use the exact day-of-week shown. Never guess.`,
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
  const { message, history } = req.body as {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
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

  const [flowAlerts, sectorData, econData] = await Promise.all([
    fetchFlowAlerts(200),
    needs.market ? fetchSectorEtfs() : Promise.resolve([]),
    needs.market ? fetchEconomicCalendar() : Promise.resolve([]),
  ]);

  const enriched = enrichAlerts(flowAlerts);

  // Extract real-time prices from UW flow data for each ticker
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

  const currentUserMessage = `User message: "${message}"

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
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: BIDDIE_SYSTEM,
      messages: [
        ...priorMessages,
        { role: "user", content: currentUserMessage },
      ],
    });

    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = analysis.toUpperCase().includes("ALERT\n") || analysis.match(/^ALERT$/m) !== null;

    res.json({ analysis, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

// ── Community Chat Endpoint ──────────────────────────────────────────────────────

const COMMUNITY_SYSTEM = `You are Biddie AI in the JORTRADE community chat room. You're a seasoned but relatable and cool trading buddy.

CRITICAL RULES:
1. ONLY answer what the user ACTUALLY asked. Do NOT volunteer extra info.
2. If someone says "thanks", "appreciate it", "bet", "cool" — just give a short hype reply like "You got it fam 💪" or "Go get that bread! 🍞" or "That's what I'm here for 🤝". ONE sentence max.
3. If someone asks a casual question (time, how are you, what's up) — answer ONLY that question in 1-2 sentences. Do NOT add trading info.
4. ONLY talk about market data, flow, or tickers if the user SPECIFICALLY asks about trading, stocks, options, or the market.
5. Keep it SHORT. Community chat = quick, casual energy. 1-3 sentences unless they ask for a detailed breakdown.
6. Match the user's energy — if they're casual, be casual. If they ask a real trading question, give a focused answer.
7. You ALWAYS have live flow data when market data is provided below. NEVER say "I don't have data" and NEVER tell users to check other sites/scanners/tools. USE the data you're given to answer.
8. If the user asks about tomorrow's moves, premarket, news, or what could happen — analyze the current flow data for high-conviction setups and tell them what the flow is pointing to. Treat "news" or "premarket" questions as requests for flow-based analysis.
9. NEVER refer to Benzinga, Briefing, Market Chameleon, Finviz, or any other external tool. You ARE the tool. You have the data.`;

router.post("/whale/community-chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const now = getNowEastern();
  const needs = detectNeeds(message);
  const lower = message.toLowerCase();
  const tradingWords = [
    "move", "play", "trade", "option", "call", "put", "spread", "flow",
    "stock", "ticker", "price", "bull", "bear", "setup", "entry", "exit",
    "strike", "expir", "premium", "sweep", "whale", "volume", "tomorrow",
    "today", "overnight", "premarket", "pre-market", "after hours", "gap", "breakout",
    "breakdown", "momentum", "swing", "scalp", "day trade", "earnings",
    "catalyst", "squeeze", "short", "long", "buy", "sell", "profit",
    "target", "support", "resistance", "vwap", "level", "chart",
    "signal", "alert", "unusual", "dark pool", "sector", "market",
    "cheap", "expensive", "otm", "itm", "delta", "gamma", "theta",
    "iv", "implied", "contract", "hedge", "risk", "reward",
    "news", "headline", "open", "close", "watch", "outlook", "analysis",
    "position", "portfolio", "holding", "profit", "loss",
  ];
  const isTradingQ = needs.tickers.length > 0 || needs.market || needs.signal || needs.darkpool || tradingWords.some(w => lower.includes(w));

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

  const chatInstruction = `User says: ${message}${dataStr}`;

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: COMMUNITY_SYSTEM,
      messages: [{ role: "user", content: chatInstruction }],
    });

    const content = response.content[0].type === "text" ? response.content[0].text : "";
    let posted = false;
    if (content && content.trim().length > 0) {
      const { error: insertError } = await supabase
        .from("chat_messages")
        .insert({ user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content: content.trim() } as any);
      if (insertError) {
        console.error("Failed to insert Biddie community response:", insertError.message);
      } else {
        posted = true;
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

    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = analysis.toUpperCase().startsWith("ALERT") || analysis.toUpperCase().includes("#1");
    res.json({ analysis, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

router.get("/whale/signals", async (_req, res) => {
  const now = getNowEastern();

  const allAlerts = await fetchFlowAlerts(200);
  const enriched = enrichAlerts(allAlerts);

  // Pre-filter: only alerts worth scoring
  const today = new Date().toISOString().split("T")[0];
  const candidates = enriched.filter((a) => {
    if (!a.ticker || !a.expiry) return false;
    if (a.expiry < today) return false;                      // skip expired
    if (a.total_premium < 100_000) return false;             // min $100K premium
    if (a.ask_aggression_pct < 40) return false;             // must be ask-leaning
    return true;
  }).slice(0, 30);

  // Extract real-time prices from UW flow data
  const uwPricesMap: Record<string, number> = {};
  for (const alert of enriched) {
    const t = (alert.ticker ?? "").toUpperCase();
    const p = parseFloat(alert.underlying_price);
    if (t && p > 0 && !uwPricesMap[t]) uwPricesMap[t] = p;
  }

  // Get unique tickers and fetch key levels in parallel
  const uniqueTickers = [...new Set(candidates.map((a) => a.ticker as string))].slice(0, 10);
  const levelResults = await Promise.all(uniqueTickers.map((t) => fetchKeyLevels(t, uwPricesMap[t.toUpperCase()] ?? null)));
  const keyLevels: Record<string, any> = {};
  uniqueTickers.forEach((t, i) => { if (levelResults[i]) keyLevels[t] = levelResults[i]; });

  // Fetch recent candles for price action confirmation
  const candleResults = await Promise.all(uniqueTickers.map((t) => fetchRecentCandles(t, "1m", 10)));
  const candleMap: Record<string, CandleBar[]> = {};
  uniqueTickers.forEach((t, i) => { candleMap[t] = candleResults[i]; });

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

  const dataStr = JSON.stringify({ fetched_at: now, candidates, key_levels: keyLevels, price_confirmations: priceConfirmations }, null, 2);

  const SIGNAL_JSON_SYSTEM = `You are a professional options flow analyst. You will be given pre-filtered high-aggression options flow, real-time key levels (VWAP, pivot points, prior day high/low), price action confirmation data, and gamma zone analysis.

Analyze each candidate and return ONLY high-conviction signals (confidence 7-10).

Respond with ONLY a valid JSON array. No explanation, no markdown, no code fences. Just the raw JSON array.

Each signal object must have exactly these fields:
{
  "ticker": "string",
  "direction": "bullish" or "bearish",
  "option_type": "call" or "put",
  "category": "algorithm" or "whale" or "spread",
  "trade": "short human-readable trade description e.g. Buy NVDA $145 Call",
  "strike": number,
  "expiry": "string e.g. March 27, 2026",
  "premium": number (in dollars),
  "ask_aggression_pct": number,
  "vol_oi_ratio": number,
  "has_sweep": boolean,
  "current_price": number or null,
  "vwap": number or null,
  "prior_day_high": number or null,
  "prior_day_low": number or null,
  "pivot": number or null,
  "r1": number or null,
  "s1": number or null,
  "entry_trigger": "specific price level and condition based on VWAP/prior day levels",
  "key_level": "the single most important level to watch e.g. VWAP at $143.20",
  "target": "specific price target, use R1/R2 for calls, S1/S2 for puts",
  "invalidation": "specific price level that kills the trade, reference actual key levels",
  "reason": "2-3 sentences: what makes this flow stand out + how price relates to key levels + gamma zone context",
  "confidence": number between 7 and 10,
  "tags": array of strings from: ["Sweep", "Call Flow", "Put Flow", "High Volume", "ATM", "Repeat Hits", "Floor Trade", "0DTE", "Price Confirmed", "Negative Gamma", "Positive Gamma", "Debit Spread", "Butterfly", "Iron Condor"],
  "price_confirmed": boolean,
  "price_pattern": "string describing the price action pattern or null",
  "gamma_zone": "positive" or "negative" or "neutral",
  "gamma_description": "string explaining gamma exposure at this level",
  "recommended_action": "specific trade recommendation e.g. Buy SPY $570 Put expiring March 28",
  "recommended_expiry": "suggested expiration based on timeframe",
  "recommended_strike": "suggested strike price with reasoning",
  "spread_details": "null for single-leg, or object with { type: 'debit_spread'|'butterfly', legs: 'description of legs', max_profit: number|null, max_loss: number|null, probability: number|null } for multi-leg strategies"
}

CATEGORY RULES:
- "algorithm": Single-leg plays detected by price action + gamma analysis. Intraday entries. These are directional bets confirmed by technical levels.
- "whale": Large institutional single-leg flow ($250K+ premium). Sweeps, blocks, floor trades. Swing positioning.
- "spread": Multi-leg strategies — debit spreads and butterflies ONLY. Look for MULTIPLE flow alerts on the SAME ticker + SAME expiry at DIFFERENT strikes that suggest a defined-risk strategy. Also identify when flow data explicitly shows spread or multi-leg activity. Provide spread_details for these.

SPREAD/BUTTERFLY DETECTION:
- If you see call flow at 2+ different strikes on the same ticker/expiry, consider if it's a debit spread (buy lower, sell higher for calls)
- If you see 3 strikes with the middle having 2x volume, it's likely a butterfly
- Sweeps at adjacent strikes on the same ticker = probable debit spread
- Include estimated max profit/loss and probability when identifiable
- Tag spreads with "Debit Spread" or "Butterfly" as appropriate

CRITICAL RULES for accuracy:
- entry_trigger MUST reference actual VWAP, prior day high/low, or pivot levels from the data
- target MUST use R1/R2 for bullish or S1/S2 for bearish from pivot points
- invalidation MUST reference a real level from the key_levels data (prior day low for calls, prior day high for puts, or VWAP)
- If VWAP or key levels are null (pre-market/weekend), use prior day high/low and round-number levels
- strike must be tradeable — close enough to current price to matter (within 10% for near-term)
- PRICE CONFIRMATION: If price_confirmation data shows confirmed=true, ADD "Price Confirmed" to tags and boost confidence by 1 point (max 10). These are the highest conviction signals.
- GAMMA ZONES: If gamma_zone is "negative", ADD "Negative Gamma" to tags — moves will be amplified. If "positive", ADD "Positive Gamma" — expect mean-reversion.
- ACT NOW FOR SPREADS: Spread/butterfly signals should ALSO get "🔥 ACT NOW" tag when gamma conditions are favorable:
  - Debit spreads in NEGATIVE gamma zone = ACT NOW (directional move will be amplified through spread strikes)
  - Butterflies in POSITIVE gamma zone = ACT NOW (pinning action benefits max profit zone)
  - When a spread gets ACT NOW, set confidence to 9+ and timeframe to "buy_now" or "short_term"
  - Only identify DEBIT SPREADS and BUTTERFLIES as spread category signals. Do NOT generate iron condors or credit spreads.
- TRADE RECOMMENDATIONS: For each signal, recommend the specific option to buy:
  - For "Act Now" signals (confidence 9-10): suggest 0-2 DTE, ATM or 1 strike OTM
  - For short-term signals (confidence 8): suggest 3-7 DTE, ATM
  - For swing signals (confidence 7): suggest 2-4 weeks out, slightly OTM
- confidence 9-10: sweep + 80%+ ask aggression + 10x+ vol/OI + near ATM + (bonus: price confirmed)
- confidence 8: sweep OR 80%+ aggression + solid premium + clear direction
- confidence 7: good flow but one condition weaker
- If no signals qualify, return an empty array []`;

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SIGNAL_JSON_SYSTEM,
      messages: [{
        role: "user",
        content: `Analyze this flow data and key levels. Return ONLY the JSON array of qualifying signals:\n\n${dataStr}`,
      }],
    });

    let raw = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
    // Strip any accidental markdown fences
    raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

    let signals: any[] = [];
    try {
      signals = JSON.parse(raw);
      if (!Array.isArray(signals)) signals = [];
    } catch {
      signals = [];
    }

    // Hydrate signals with authoritative computed data (override AI-generated values)
    for (const sig of signals) {
      const ticker = sig.ticker as string;
      const strike = parseFloat(String(sig.strike)) || 0;
      const optType = sig.option_type || (sig.direction === "bullish" ? "call" : "put");
      const key = `${ticker}-${strike}-${optType}`;
      const computed = priceConfirmations[key];
      if (computed) {
        sig.price_confirmed = computed.confirmed;
        sig.price_pattern = computed.pattern;
        sig.gamma_zone = computed.gamma_zone;
        sig.gamma_description = computed.gamma_description;
        if (computed.trade_recommendation) {
          sig.recommended_action = computed.trade_recommendation.action;
          sig.recommended_expiry = computed.trade_recommendation.expiry;
          sig.recommended_strike = computed.trade_recommendation.entry_trigger;
        }
        // Ensure tags include computed tags
        if (!Array.isArray(sig.tags)) sig.tags = [];
        if (computed.confirmed && !sig.tags.includes("Price Confirmed")) sig.tags.push("Price Confirmed");
        if (computed.gamma_zone === "negative" && !sig.tags.includes("Negative Gamma")) sig.tags.push("Negative Gamma");
        if (computed.gamma_zone === "positive" && !sig.tags.includes("Positive Gamma")) sig.tags.push("Positive Gamma");
        // Boost confidence for price-confirmed signals
        if (computed.confirmed && typeof sig.confidence === "number") {
          sig.confidence = Math.min(10, sig.confidence + 1);
        }
      }
    }

    res.json({ signals, count: signals.length, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error", signals: [], count: 0 });
  }
});

interface PriceHistory {
  current: number;
  highSince: number;
  lowSince: number;
}

async function fetchPriceHistory(ticker: string, sinceDate: string): Promise<PriceHistory | null> {
  try {
    const YF = "https://query1.finance.yahoo.com/v8/finance/chart";
    const since = new Date(sinceDate);
    const daysDiff = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const range = daysDiff <= 5 ? "5d" : daysDiff <= 30 ? "1mo" : "3mo";

    const res = await axios.get(`${YF}/${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      params: { interval: "1d", range },
      timeout: 10000,
    });
    const result = res.data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta ?? {};
    const quote = result.indicators?.quote?.[0];
    const timestamps = result.timestamp ?? [];

    const sinceTs = since.getTime() / 1000;
    let highSince = -Infinity;
    let lowSince = Infinity;
    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= sinceTs) {
        const h = quote?.high?.[i];
        const l = quote?.low?.[i];
        if (h && h > highSince) highSince = h;
        if (l && l < lowSince) lowSince = l;
      }
    }

    const preMarket = meta.preMarketPrice ?? null;
    const postMarket = meta.postMarketPrice ?? null;
    const regMarket = meta.regularMarketPrice ?? null;
    const preTs = meta.preMarketTime ?? 0;
    const postTs = meta.postMarketTime ?? 0;
    const regTs = meta.regularMarketTime ?? 0;
    let current: number | null = regMarket;
    if (preMarket && preTs > regTs) current = preMarket;
    if (postMarket && postTs > regTs && postTs > preTs) current = postMarket;
    if (!current) {
      const len = timestamps.length;
      current = quote?.close?.[len - 1] ?? null;
    }
    if (!current) return null;

    if (highSince === -Infinity) highSince = current;
    if (lowSince === Infinity) lowSince = current;

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
  const nums = target.match(/\d+\.?\d*/g);
  if (!nums || nums.length === 0) return { low: null, high: null };
  const values = nums.map(Number).filter(n => !isNaN(n) && n > 0);
  if (values.length === 0) return { low: null, high: null };
  if (values.length === 1) return { low: values[0], high: values[0] };
  return { low: Math.min(...values), high: Math.max(...values) };
}

router.post("/whale/verify-signals", async (_req, res) => {
  try {
    const { data: pending, error: fetchErr } = await supabase
      .from("signal_outcomes")
      .select("*")
      .eq("outcome", "pending")
      .order("created_at", { ascending: false })
      .limit(50);

    if (fetchErr) {
      res.status(500).json({ error: "Failed to fetch pending signals" });
      return;
    }

    if (!pending || pending.length === 0) {
      res.json({ verified: 0, hits: 0, misses: 0, expired: 0, remaining_pending: 0 });
      return;
    }

    const tickers = [...new Set(pending.map((s: any) => s.ticker))];
    const priceMap: Record<string, PriceHistory> = {};
    await Promise.all(
      tickers.map(async (t) => {
        const oldest = pending
          .filter((s: any) => s.ticker === t)
          .reduce((min: string, s: any) => s.created_at < min ? s.created_at : min, pending[0].created_at);
        const history = await fetchPriceHistory(t, oldest);
        if (history) priceMap[t] = history;
      })
    );

    let hits = 0, misses = 0, expired = 0, updateErrors = 0;
    const now = new Date();

    for (const signal of pending) {
      const history = priceMap[signal.ticker];
      if (!history) continue;

      const target = parseTargetRange(signal.target_zone);
      const isBullish = signal.signal_type === "bullish";

      const expiryDate = signal.expiry ? new Date(signal.expiry) : null;
      const isExpired = expiryDate && expiryDate < now;

      let outcome: string | null = null;
      let outcomePrice = history.current;

      if (target.low && target.high) {
        if (isBullish) {
          if (history.highSince >= target.low) {
            outcome = "hit";
            outcomePrice = history.highSince;
          } else if (isExpired) {
            outcome = "missed";
          }
        } else {
          if (history.lowSince <= target.high) {
            outcome = "hit";
            outcomePrice = history.lowSince;
          } else if (isExpired) {
            outcome = "missed";
          }
        }
      }

      if (!outcome && isExpired) {
        outcome = "expired";
      }

      if (outcome) {
        const { error: updateErr } = await supabase
          .from("signal_outcomes")
          .update({
            outcome,
            outcome_price: outcomePrice,
            resolved_at: now.toISOString(),
          })
          .eq("id", signal.id);

        if (updateErr) {
          updateErrors++;
          continue;
        }

        if (outcome === "hit") hits++;
        else if (outcome === "missed") misses++;
        else if (outcome === "expired") expired++;
      }
    }

    const remaining = pending.length - hits - misses - expired - updateErrors;
    res.json({ verified: pending.length, hits, misses, expired, remaining_pending: remaining, errors: updateErrors > 0 ? updateErrors : undefined });
  } catch (err: any) {
    console.error("Verify signals error:", err);
    res.status(500).json({ error: err.message ?? "Verification failed" });
  }
});

// ── Morning Outlook ──────────────────────────────────────────────────────────

const MORNING_OUTLOOK_SYSTEM = `You are Biddie AI dropping the morning outlook for the JORTRADE trading community.

YOUR VIBE: You're a seasoned trader who's chill but sharp. Think "cool older brother who trades for a living." You're not trying to impress anyone — you just call it like you see it. Casual, confident, relatable. Use natural language, contractions, real talk.

YOUR JOB: Give the crew a quick pre-market read. What's moving, what matters, what to watch. Keep it tight — this is a morning briefing, not an essay.

FORMAT:
Start with a casual greeting that references the day/vibe (Monday energy, midweek grind, Friday vibes, etc.)

Then cover:
1. **Market Mood** — 2-3 sentences on overnight futures, any big macro news, general direction
2. **Big Movers** — Only the 2-3 tickers with the most notable pre-market flow or news. Include the actual numbers (premium, direction, strike if relevant)
3. **Watch List** — 1-2 tickers that could pop off today based on the flow data. Quick "why" for each
4. **Bottom Line** — One sentence on overall bias for the day

RULES:
- ONLY near-term plays. Nothing expiring more than 2 weeks out unless it's massive institutional flow
- Only mention things that actually need attention RIGHT NOW
- If the market is quiet, say so. Don't manufacture excitement
- Keep the whole thing under 250 words
- No sign-off, no "let's get it" — just end with the bottom line
- Reference actual data numbers, not vibes`;

router.post("/whale/morning-outlook", async (_req, res) => {
  try {
    const now = getNowEastern();
    const dateContext = getEasternDateContext();

    const [flowAlerts, sectorData, econData] = await Promise.all([
      fetchFlowAlerts(200),
      fetchSectorEtfs(),
      fetchEconomicCalendar(),
    ]);

    const enriched = enrichAlerts(flowAlerts);

    const uwPrices: Record<string, number> = {};
    for (const alert of enriched) {
      const t = (alert.ticker ?? "").toUpperCase();
      const p = parseFloat(alert.underlying_price);
      if (t && p > 0 && !uwPrices[t]) uwPrices[t] = p;
    }

    const keyTickers = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA"];
    const keyLevelsResults = await Promise.all(
      keyTickers.map((t) => fetchKeyLevels(t, uwPrices[t] ?? null))
    );
    const keyLevels: Record<string, any> = {};
    keyTickers.forEach((t, i) => {
      if (keyLevelsResults[i]) keyLevels[t] = keyLevelsResults[i];
    });

    const context = {
      fetched_at: now,
      key_levels: keyLevels,
      top_flow: enriched.slice(0, 50),
      sector_etfs: sectorData,
      economic_calendar: (econData as any[]).slice(0, 10),
    };

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: MORNING_OUTLOOK_SYSTEM,
      messages: [{
        role: "user",
        content: `Generate the morning outlook for today.

--- CURRENT DATE & TRADING CALENDAR ---
${dateContext}

--- LIVE MARKET DATA (fetched ${now}) ---
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Drop the morning outlook. Keep it real.`,
      }],
    });

    const outlook = response.content[0].type === "text" ? response.content[0].text : "";
    res.json({ outlook, timestamp: now });
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

const FLOW_WATCH_SYSTEM = `You are Biddie AI — a seasoned options flow analyst watching the tape for the JORTRADE trading community.

You've been scanning the flow and just spotted something worth calling out. Your job is to decide IF this is actually worth posting about, and if so, drop a quick take.

YOUR VIBE: Seasoned trader, chill but sharp. You don't spam the chat — when you speak up, people listen because you only talk when it matters. Casual, confident, real talk.

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

FORMAT (keep it SHORT — 2-4 sentences max):
- What you're seeing (ticker, direction, premium, strike, expiry)
- Why it matters (unusual size, sweep pattern, against the trend, etc.)
- One actionable takeaway (watch for X, this confirms Y, be careful of Z)

RULES:
- Under 100 words. This is a quick heads-up, not an essay
- Only near-term plays (0DTE to ~2 weeks)
- Reference actual numbers — premium, vol/OI, aggression %
- Don't repeat yourself — each post should be new information
- If nothing is worth posting about, respond with exactly: NOTHING_NOTABLE`;

function startFlowMonitor() {
  if (flowMonitorStarted) return;
  flowMonitorStarted = true;

  // Morning outlook at ~8:20 ET
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
    if (hour !== 8 || minute < 15 || minute > 30) return;

    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("user_id", BIDDIE_USER_ID)
      .gte("created_at", `${today}T00:00:00Z`)
      .limit(1);
    if (existing && existing.length > 0) return;

    try {
      const [flowAlerts, sectorData, econData] = await Promise.all([
        fetchFlowAlerts(200), fetchSectorEtfs(), fetchEconomicCalendar(),
      ]);
      const enriched = enrichAlerts(flowAlerts);
      const uwPrices: Record<string, number> = {};
      for (const a of enriched) {
        const t = (a.ticker ?? "").toUpperCase();
        const p = parseFloat(a.underlying_price);
        if (t && p > 0 && !uwPrices[t]) uwPrices[t] = p;
      }
      const keyTickers = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA"];
      const kl = await Promise.all(keyTickers.map((t) => fetchKeyLevels(t, uwPrices[t] ?? null)));
      const keyLevels: Record<string, any> = {};
      keyTickers.forEach((t, i) => { if (kl[i]) keyLevels[t] = kl[i]; });

      const now = getNowEastern();
      const response = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: MORNING_OUTLOOK_SYSTEM,
        messages: [{ role: "user", content: `Drop the morning outlook. Keep it real.\n\n--- CURRENT DATE & TRADING CALENDAR ---\n${getEasternDateContext()}\n\n--- LIVE MARKET DATA (fetched ${now}) ---\n\`\`\`json\n${JSON.stringify({ fetched_at: now, key_levels: keyLevels, top_flow: enriched.slice(0, 50), sector_etfs: sectorData, economic_calendar: (econData as any[]).slice(0, 10) }, null, 2)}\n\`\`\`` }],
      });
      const content = response.content[0].type === "text" ? response.content[0].text : "";
      await supabase.from("chat_messages").insert({ user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content });
      lastBiddiePost = Date.now();
      console.log(`[Biddie morning] Posted at ${now}`);
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
      const flowAlerts = await fetchFlowAlerts(100);
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
        if (a.total_premium >= 500000 && a.ask_aggression_pct >= 70) return true;
        if (a.has_sweep && a.total_premium >= 300000 && a.vol_oi_ratio >= 5) return true;
        if (a.vol_oi_ratio >= 10 && a.total_premium >= 200000) return true;
        return false;
      });

      if (notable.length === 0) return;

      const now = getNowEastern();
      const topFlow = notable.slice(0, 5);
      const context = JSON.stringify({ fetched_at: now, notable_flow: topFlow, all_recent: enriched.slice(0, 30) }, null, 2);

      const response = await claude.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: FLOW_WATCH_SYSTEM,
        messages: [{ role: "user", content: `New flow just came in. Is this worth calling out?\n\n--- CURRENT TIME ---\n${now}\n\n--- NOTABLE FLOW ---\n\`\`\`json\n${context}\n\`\`\`\n\nIf it's worth posting about, drop a quick take. If not, respond with exactly: NOTHING_NOTABLE` }],
      });

      const content = response.content[0].type === "text" ? response.content[0].text : "";

      if (content.includes("NOTHING_NOTABLE") || content.trim().length < 20) return;

      await supabase.from("chat_messages").insert({ user_id: BIDDIE_USER_ID, user_name: "Biddie AI", content });
      lastBiddiePost = Date.now();
      console.log(`[Biddie flow alert] Posted at ${now}`);
    } catch (err) { console.error("[Biddie flow monitor] Failed:", err); }
  }, 5 * 60 * 1000);
}

startFlowMonitor();

router.get("/whale/health", (_req, res) => {
  res.json({
    ok: true,
    uwKey: !!process.env["UNUSUAL_WHALES_API_KEY"],
    claudeKey: !!AI_API_KEY,
  });
});

export default router;
