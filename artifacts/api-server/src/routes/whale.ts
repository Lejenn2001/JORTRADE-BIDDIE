import { Router } from "express";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const UW_BASE = "https://api.unusualwhales.com";
const UW_HEADERS = () => ({ Authorization: `Bearer ${process.env["UNUSUAL_WHALES_API_KEY"] ?? ""}` });
const AI_BASE_URL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
const AI_API_KEY = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";

const claude = new Anthropic({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

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

async function fetchKeyLevels(ticker: string) {
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

    const currentPrice = intQuote?.close?.[intLen - 1] ?? prevClose;

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
  const tickerPattern = /\b([A-Z]{1,5})\b/g;
  const words = message.toUpperCase().match(tickerPattern) ?? [];
  const extras = words.filter((w) => w.length >= 2 && !found.includes(w) &&
    !["THE", "AND", "FOR", "BUY", "PUT", "CALL", "GET", "NOW", "WHY", "HOW",
      "ANY", "ALL", "TOP", "USE", "RUN", "CAN", "ARE", "NOT", "BUT", "YES",
      "NO", "IS", "IN", "ON", "AT", "OF", "TO", "DO", "AM", "PM", "EST",
      "UTC", "DTE", "OTM", "ITM", "ATM", "OI", "IV", "VOL", "AI", "US"].includes(w));
  return [...new Set([...found, ...extras])];
}

function detectNeeds(message: string) {
  const lower = message.toLowerCase();
  return {
    darkpool: lower.includes("dark pool") || lower.includes("darkpool") || lower.includes("block") || lower.includes("dp "),
    market: lower.includes("market") || lower.includes("sector") || lower.includes("macro") || lower.includes("economy"),
    signal: lower.includes("signal") || lower.includes("right now") || lower.includes("alert"),
    tickers: extractTickers(message),
  };
}

// ── System Prompt ───────────────────────────────────────────────────────────────

const BIDDIE_SYSTEM = `You are Biddie AI — a professional institutional options flow analyst with real-time access to live whale data from Unusual Whales.

You can answer ANY question about the market, any ticker, any options flow, dark pool activity, sector moves, upcoming catalysts, trade setups, and more.

You have access to live data that has been fetched and provided to you with each question. Use it to give specific, data-backed answers.

YOUR PERSONALITY:
- Direct, confident, professional — like a seasoned desk trader
- Reference actual numbers from the data (premium, vol/OI, strike, aggression %)
- Never generic — always specific to what the data actually shows
- Call out what matters and what doesn't

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

WHEN ASKED ABOUT A SPECIFIC TICKER:
Pull that ticker's data from the flow and darkpool sections. Report:
- What options flow exists for that ticker (calls vs puts, strikes, premium, aggression)
- Dark pool prints if available
- Overall bias and whether it's worth trading
- Specific setup if conviction is high enough

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
- If data is limited or market is closed, say so and explain what you can still determine`;

// ── Main Chat Endpoint ──────────────────────────────────────────────────────────

router.post("/whale/chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const now = new Date().toUTCString();
  const needs = detectNeeds(message);

  const tickersToFetch = needs.tickers.slice(0, 4);

  // Always fetch key levels for any tickers mentioned, plus SPY/QQQ as baseline
  const baselineTickers = ["SPY", "QQQ"];
  const allLevelTickers = [...new Set([...tickersToFetch, ...baselineTickers])].slice(0, 6);

  const [flowAlerts, sectorData, econData, ...parallelResults] = await Promise.all([
    fetchFlowAlerts(200),
    needs.market ? fetchSectorEtfs() : Promise.resolve([]),
    needs.market ? fetchEconomicCalendar() : Promise.resolve([]),
    // Key levels for all relevant tickers
    ...allLevelTickers.map((t) => fetchKeyLevels(t)),
    // Darkpool for mentioned tickers
    ...tickersToFetch.map((t) => fetchDarkpool(t, 30)),
  ]);

  const keyLevelsResults = parallelResults.slice(0, allLevelTickers.length);
  const darkpoolResults  = parallelResults.slice(allLevelTickers.length);

  const enriched = enrichAlerts(flowAlerts);

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

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: BIDDIE_SYSTEM,
      messages: [{
        role: "user",
        content: `User question: "${message}"\n\nLive market data from Unusual Whales (${now}):\n\n\`\`\`json\n${dataStr}\n\`\`\`\n\nAnswer the user's question using this live data. Be specific. Reference actual numbers.`,
      }],
    });

    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = analysis.toUpperCase().includes("ALERT\n") || analysis.match(/^ALERT$/m) !== null;

    res.json({ analysis, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

// ── Quick Signal Check ──────────────────────────────────────────────────────────

router.get("/whale/signal", async (_req, res) => {
  const now = new Date().toUTCString();
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

router.get("/whale/health", (_req, res) => {
  res.json({
    ok: true,
    uwKey: !!process.env["UNUSUAL_WHALES_API_KEY"],
    claudeKey: !!AI_API_KEY,
  });
});

export default router;
