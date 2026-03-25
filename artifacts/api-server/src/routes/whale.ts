import { Router } from "express";
import axios from "axios";
import Anthropic from "@anthropic-ai/sdk";

const router = Router();

const UW_API_KEY = process.env["UNUSUAL_WHALES_API_KEY"] ?? "";
const AI_BASE_URL = process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
const AI_API_KEY = process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? process.env["ANTHROPIC_API_KEY"] ?? "";

const claude = new Anthropic({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY });

async function fetchFlowAlerts(limit = 200) {
  try {
    const res = await axios.get("https://api.unusualwhales.com/api/option-trades/flow-alerts", {
      headers: { Authorization: `Bearer ${UW_API_KEY}` },
      params: { limit },
      timeout: 15000,
    });
    const data = res.data;
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch {
    return [];
  }
}

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

const JORTRADE_SYSTEM = `You are a professional institutional options flow analyst for JORTRADE.

Your job is to identify ONLY HIGH-CONVICTION trade ideas from unusual whale activity.

Analyze the provided whale flow and return ONLY trades with a confidence score of 7, 8, 9, or 10. Ignore all lower-confidence setups.

You may recommend trades on ANY ticker in the data. If a smaller or mid-cap name shows elite-quality flow (massive sweeps, huge vol/OI, stacked aggression), include it.

Prioritize flow that shows strong directional intent:
- repeated sweeps or aggressive orders at the ask
- large premium trades
- volume greater than open interest
- multiple orders at the same strike or expiration
- stacked flow in one direction
- contracts close enough to current price to matter TODAY
- flow near major support/resistance, prior day high/low, VWAP, or breakout levels

Downgrade or ignore:
- far out-of-the-money lotto flow
- very small premium trades
- mixed bullish and bearish activity with no clear bias
- likely hedging or volatility positioning
- illiquid tickers with no real follow-through potential

For each qualifying setup choose the BEST trade structure:
- Buying calls outright — when flow is explosive, sweeps are massive, or 0DTE momentum matters
- Buying puts outright — when bearish flow is aggressive and near-term
- Call debit spread — when bullish but you want defined risk with a near target
- Put debit spread — when bearish with a defined downside target
- Butterfly — when flow clusters tightly at one strike suggesting a pin

Do NOT default to spreads. If the flow screams "buy the call" or "buy the put", say that.

Include BOTH 0DTE opportunities and near-term (1–14 DTE) opportunities when flow supports it.

Return ONLY the TOP HIGH-CONVICTION setups (as many as clear the 7/10 bar).

For each setup provide in this EXACT format:

#[N] [LABEL] — [TICKER] [Call/Put]

Buy the [SPECIFIC TRADE]
Expiration: [DATE] [flag as 0DTE if applicable]
Entry trigger: [specific price action to wait for]
Invalidation: [level that kills the trade]
Why: [2-3 sentences on why this whale flow stands out]
Confidence: [7–10]/10

---

After all setups, provide:

**Bottom line:** [2-3 sentence summary of overall market bias and single best action]

**Names to avoid:** [brief list with one-line reason each]

If no setup clears 7/10, say so explicitly.`;

const SIGNAL_SYSTEM = `You are a real-time options flow trading assistant.

Your job is NOT to summarize flow.
Your job is to determine whether there is a TRADE ENTRY SIGNAL.

Only generate an alert when ALL conditions are met:
- High-conviction whale flow (confidence 7–10)
- Repeated sweeps or large premium directional trades
- Flow aligned with price trend
- Price breaking or holding a key level
- Strike close enough to matter today

If ALL conditions are met, respond in EXACTLY this format for each signal:

ALERT
Ticker: [TICKER]
Direction: Call or Put
Trade: [specific strike and expiration]
Entry: [price level to enter]
Invalidation: [level that kills the trade]
Confidence: [7–10]/10
Reason: [one sentence max]

If conditions are NOT fully met, respond with ONLY:
NO TRADE SIGNAL`;

function detectIntent(message: string): "jortrade" | "signal" | "general" {
  const lower = message.toLowerCase();
  if (
    lower.includes("monday") || lower.includes("tomorrow") ||
    lower.includes("recommend") || lower.includes("best trade") ||
    lower.includes("setup") || lower.includes("entry") ||
    lower.includes("play") || lower.includes("what should") ||
    lower.includes("what do you") || lower.includes("morning") ||
    lower.includes("jortrade")
  ) return "jortrade";
  if (
    lower.includes("signal") || lower.includes("alert") ||
    lower.includes("right now") || lower.includes("now?")
  ) return "signal";
  return "jortrade";
}

router.post("/whale/chat", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const intent = detectIntent(message);
  const now = new Date().toUTCString();
  const alerts = await fetchFlowAlerts(200);
  const enriched = enrichAlerts(alerts);
  const dataStr = JSON.stringify(enriched, null, 2);

  let systemPrompt: string;
  let userContent: string;

  if (intent === "signal") {
    systemPrompt = SIGNAL_SYSTEM;
    userContent = `Live unusual options flow from Unusual Whales — ALL tickers, sorted by premium (${now}):\n\n\`\`\`json\n${dataStr}\n\`\`\`\n\nIs there a trade entry signal right now? Apply your criteria strictly.`;
  } else {
    systemPrompt = JORTRADE_SYSTEM;
    userContent = `User question: "${message}"\n\nHere is today's live unusual options flow from Unusual Whales across ALL tickers, sorted by premium (${now}):\n\n\`\`\`json\n${dataStr}\n\`\`\`\n\nApply the JORTRADE high-conviction framework to answer the user's question. Return ONLY setups scoring 7–10. Be specific with strikes and expirations based on what the whales are actually trading. If answering a "monday morning" or "next session" question, tailor entry triggers and expiration choices accordingly.`;
  }

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = intent === "signal" && analysis.toUpperCase().startsWith("ALERT");

    res.json({ analysis, intent, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

router.get("/whale/signal", async (_req, res) => {
  const now = new Date().toUTCString();
  const alerts = await fetchFlowAlerts(200);
  const enriched = enrichAlerts(alerts);
  const dataStr = JSON.stringify(enriched, null, 2);

  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SIGNAL_SYSTEM,
      messages: [{
        role: "user",
        content: `Live unusual options flow from Unusual Whales — ALL tickers, sorted by premium (${now}):\n\n\`\`\`json\n${dataStr}\n\`\`\`\n\nIs there a trade entry signal right now?`,
      }],
    });

    const analysis = response.content[0].type === "text" ? response.content[0].text : "";
    const isAlert = analysis.toUpperCase().startsWith("ALERT");
    res.json({ analysis, isAlert, timestamp: now });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
});

router.get("/whale/health", (_req, res) => {
  res.json({ ok: true, uwKey: !!UW_API_KEY, claudeKey: !!AI_API_KEY });
});

export default router;
