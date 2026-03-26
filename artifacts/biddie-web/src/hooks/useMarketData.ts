import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface FlowAlert {
  ticker: string;
  type: string;
  premium: string;
  strike: string;
  expiry: string;
  sentiment: "bullish" | "bearish";
  time: string;
  explanation?: string;
  convictionScore?: number;
  convictionLabel?: string;
  gammaLevelLabel?: string;
}

export type SignalTimeframe = "buy_now" | "short_term" | "swing";

export type SignalCategory = "algorithm" | "whale" | "spread";

export interface MarketSignal {
  id: string;
  ticker: string;
  type: "bullish" | "bearish" | "neutral";
  confidence: number;
  convictionScore?: number;
  convictionLabel?: string;
  gammaLevelLabel?: string;
  description: string;
  timestamp: string;
  tags: string[];
  strike?: string;
  expiry?: string;
  premium?: string;
  putCall?: "call" | "put";
  suggestedTrade?: string;
  entryTrigger?: string;
  invalidation?: string;
  keyLevel?: string;
  targetZone?: string;
  createdAt?: string;
  timeframe?: SignalTimeframe;
  source?: "live" | "example";
  priceConfirmed?: boolean;
  pricePattern?: string | null;
  gammaZone?: "positive" | "negative" | "neutral";
  gammaDescription?: string;
  recommendedAction?: string;
  recommendedExpiry?: string;
  recommendedStrike?: string;
  category?: SignalCategory;
  spreadDetails?: {
    type: string;
    legs: string;
    max_profit: number | null;
    max_loss: number | null;
    probability: number | null;
  } | null;
}

export interface TickerData {
  overview: any;
  volume: any;
}

// ─── JORTRADE Whale Conviction Scoring Model (0–100) ───

const INDEX_HEAVY_TICKERS = new Set(['SPY', 'QQQ', 'TSLA', 'NVDA', 'SPX', 'NDX', 'AAPL', 'AMZN', 'META', 'MSFT', 'GOOGL']);

interface WhaleScoreInput {
  premium: number;           // total premium in dollars
  alertRule: string;         // Sweep, Block, Repeated Hits, Flow
  dte: number;               // days to expiry
  moneynessPct: number;      // abs % OTM (0 = ATM, 0.05 = 5% OTM), -1 if unknown
  volume: number;
  openInterest: number;
  tradeCount: number;        // proxy for stacking
  ticker: string;
  strike: number;            // actual strike price
  stockPrice?: number;       // current stock price
  keyLevels?: number[];      // high-OI gamma S/R levels for this ticker
  isSpread?: boolean;        // detected spread
  isDeepItm?: boolean;       // deep ITM likely hedge
}

export interface WhaleScoreResult {
  score: number;
  label: string;
  gammaLevelLabel?: string; // e.g. "At $145 gamma level" or "Near $570 S/R"
  breakdown: {
    size: number;
    aggression: number;
    urgency: number;
    strikeQuality: number;
    newPositioning: number;
    stacking: number;
    levelAlignment: number;
    penalties: number;
  };
}

export function computeWhaleConviction(input: WhaleScoreInput): WhaleScoreResult {
  const { premium, alertRule, dte, moneynessPct, volume, openInterest, tradeCount, ticker, strike, stockPrice, keyLevels, isSpread, isDeepItm } = input;

  // 1) Size (0–20)
  let size = 0;
  if (premium >= 5_000_000) size = 20;
  else if (premium >= 3_000_000) size = 16;
  else if (premium >= 1_000_000) size = 12;
  else if (premium >= 500_000) size = 8;
  else if (premium >= 250_000) size = 4;

  if (INDEX_HEAVY_TICKERS.has(ticker) && premium < 2_000_000) {
    size = Math.round(size * 0.8);
  }

  // 2) Aggression (0–15)
  const rule = (alertRule || '').toLowerCase();
  let aggression = 2; // default mid
  if (rule.includes('sweep')) aggression = 15;
  else if (rule.includes('repeated')) aggression = 11;
  else if (rule.includes('block')) aggression = 8;

  // 3) Urgency / DTE (0–15)
  let urgency = 2;
  if (dte <= 2) urgency = 15;
  else if (dte <= 7) urgency = 13;
  else if (dte <= 14) urgency = 10;
  else if (dte <= 30) urgency = 7;
  else if (dte <= 60) urgency = 4;

  // 4) Strike Quality (0–10)
  let strikeQuality = 5; // default neutral when moneyness unknown
  if (moneynessPct >= 0) {
    if (moneynessPct <= 0.03) strikeQuality = 10;
    else if (moneynessPct <= 0.07) strikeQuality = 7;
    else if (moneynessPct <= 0.12) strikeQuality = 4;
    else strikeQuality = 1;
  }

  // 5) New Positioning via vol/OI (0–15)
  const oi = Math.max(openInterest, 1);
  const ratio = volume / oi;
  let newPositioning = 3;
  if (ratio >= 5) newPositioning = 15;
  else if (ratio >= 2) newPositioning = 11;
  else if (ratio >= 1) newPositioning = 7;

  // 6) Stacking (0–10) — using trade_count as proxy
  let stacking = 2;
  if (tradeCount >= 5) stacking = 10;
  else if (tradeCount >= 3) stacking = 8;
  else if (tradeCount >= 2) stacking = 5;

  // 7) Level + Trend Alignment (0–15) — uses gamma S/R levels from options OI
  let levelAlignment = 2; // default: random location
  let gammaLevelLabel: string | undefined;
  
  if (keyLevels && keyLevels.length > 0 && strike > 0) {
    // Find nearest high-OI gamma level
    let nearestLevel = keyLevels[0];
    let nearestDist = Infinity;
    for (const kl of keyLevels) {
      const dist = Math.abs(strike - kl) / Math.max(strike, 1);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestLevel = kl;
      }
    }
    
    if (nearestDist <= 0.005) {
      levelAlignment = 9;
      gammaLevelLabel = `At $${nearestLevel} gamma level`;
    } else if (nearestDist <= 0.02) {
      levelAlignment = 5;
      gammaLevelLabel = `Near $${nearestLevel} S/R level`;
    } else if (nearestDist <= 0.05) {
      levelAlignment = 3;
      gammaLevelLabel = `Near $${nearestLevel} gamma zone`;
    }
    
    // Bonus: stock price also near the strike at a key level = trend aligned
    if (stockPrice && stockPrice > 0 && levelAlignment >= 5) {
      const priceDist = Math.abs(stockPrice - strike) / stockPrice;
      if (priceDist <= 0.03) {
        levelAlignment = Math.min(15, levelAlignment + 3);
        gammaLevelLabel = gammaLevelLabel ? `${gammaLevelLabel} — price converging` : `Price at $${nearestLevel} gamma level`;
      }
    }
  } else if (strike > 0) {
    const isRoundNumber = strike % 10 === 0 || (strike >= 100 && strike % 25 === 0);
    if (isRoundNumber) {
      levelAlignment = 3;
      gammaLevelLabel = `$${strike} psychological level`;
    }
  }

  // 8) Penalties (subtract 0–20)
  let penalties = 0;
  if (isSpread) penalties += 10;
  if (isDeepItm) penalties += 8;
  if (moneynessPct > 0.12) penalties += 6; // far OTM lottery
  if (dte > 60 && aggression <= 4) penalties += 4; // long-dated no urgency
  if (tradeCount <= 1 && !rule.includes('sweep')) penalties += 5; // single block no follow-through

  const raw = size + aggression + urgency + strikeQuality + newPositioning + stacking + levelAlignment - penalties;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let label = "Low Conviction";
  if (score >= 90) label = "Extreme Conviction";
  else if (score >= 75) label = "Very High Conviction";
  else if (score >= 60) label = "High Conviction";
  else if (score >= 40) label = "Moderate Conviction";

  return {
    score,
    label,
    gammaLevelLabel,
    breakdown: { size, aggression, urgency, strikeQuality, newPositioning, stacking, levelAlignment, penalties },
  };
}

function computeDte(expiryStr: string | null | undefined): number {
  if (!expiryStr || expiryStr === 'N/A' || expiryStr === '—') return 30; // default moderate
  const expDate = new Date(expiryStr);
  if (isNaN(expDate.getTime())) return 30;
  const now = new Date();
  return Math.max(0, Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function computeMoneyness(strike: number, stockPrice: number | null | undefined): number {
  if (!stockPrice || stockPrice <= 0 || strike <= 0) return -1; // unknown
  return Math.abs(strike - stockPrice) / stockPrice;
}

// ─── End scoring model ───

// High-conviction example signals based on recent whale activity
const exampleSignals: MarketSignal[] = [
  {
    id: "ex-1",
    ticker: "NVDA",
    type: "bullish",
    confidence: 9.4,
    convictionScore: 92,
    convictionLabel: "Extreme Conviction",
    description: "SR Tag + 2 Green Bars confirmed at $141.50 support. Price bounced off VWAP with increasing volume. Call sweep activity over $2.8M in premium on the $145 calls. Negative gamma zone — moves will accelerate through this level.",
    timestamp: "Fri 3:42 PM",
    tags: ["Call Flow", "Sweep", "✅ PRICE CONFIRMED", "⚡ NEG GAMMA", "🔥 ACT NOW"],
    strike: "$145",
    expiry: "March 27, 2026",
    premium: "$2.8M",
    putCall: "call",
    suggestedTrade: "Buy NVDA $145 Calls expiring March 27",
    entryTrigger: "Break above $143.50 with volume confirmation",
    invalidation: "$138.00",
    keyLevel: "$141.50",
    targetZone: "$148.00 – $152.00",
    timeframe: "buy_now",
    source: "example",
    category: "algorithm",
    priceConfirmed: true,
    pricePattern: "Support Bounce + 2 Green Bars at $141.50 (higher low, higher high — confirmed)",
    gammaZone: "negative",
    gammaDescription: "Negative gamma zone — moves are amplified near this strike",
  },
  {
    id: "ex-2",
    ticker: "TSLA",
    type: "bearish",
    confidence: 9.1,
    convictionScore: 78,
    convictionLabel: "Very High Conviction",
    description: "SR Tag + 2 Red Bars confirmed at $260 resistance. Price rejected from prior day high with 6 consecutive put sweeps. Positive gamma zone — expect pinning near this level before a break lower.",
    timestamp: "Fri 2:58 PM",
    tags: ["Put Flow", "Sweep", "✅ PRICE CONFIRMED", "🧲 POS GAMMA", "⚡ HIGH CONVICTION"],
    strike: "$250",
    expiry: "March 27, 2026",
    premium: "$1.9M",
    putCall: "put",
    suggestedTrade: "Buy TSLA $250 Puts expiring March 27",
    entryTrigger: "Rejection at $258 – $260 resistance zone",
    invalidation: "$265.00",
    keyLevel: "$255.00",
    targetZone: "$242.00 – $245.00",
    timeframe: "short_term",
    source: "example",
    category: "algorithm",
    priceConfirmed: true,
    pricePattern: "SR Tag + 2 Red Bars at $260.00 (lower high, lower low — confirmed)",
    gammaZone: "positive",
    gammaDescription: "Positive gamma zone — expect mean-reversion and pinning",
  },
  {
    id: "ex-3",
    ticker: "AAPL",
    type: "bullish",
    confidence: 9.6,
    convictionScore: 85,
    convictionLabel: "Very High Conviction",
    description: "Whale alert: single-block $3.1M call order on AAPL $215 strike. Unusual volume spike with 5.8x average call volume. Institutional smart money positioning for a multi-day move higher.",
    timestamp: "Fri 1:15 PM",
    tags: ["Call Flow", "Block", "🐋 WHALE PLAY", "🔥 ACT NOW"],
    strike: "$215",
    expiry: "April 10, 2026",
    premium: "$3.1M",
    putCall: "call",
    suggestedTrade: "Buy AAPL $215 Calls expiring April 10",
    entryTrigger: "Hold above $212 support with increasing bid volume",
    invalidation: "$208.00",
    keyLevel: "$213.00",
    targetZone: "$218.00 – $222.00",
    timeframe: "swing",
    source: "example",
    category: "whale",
  },
  {
    id: "ex-4",
    ticker: "SPY",
    type: "bearish",
    confidence: 9.8,
    convictionScore: 88,
    convictionLabel: "Very High Conviction",
    description: "Algorithm confirmed: price rejected R1 pivot at $573.50 with 2 consecutive red bars. Extreme put sweep cluster — $4.5M in $570 puts. 9 sweeps in under 20 minutes. Negative gamma amplifying the move lower.",
    timestamp: "Fri 12:30 PM",
    tags: ["Put Flow", "Sweep", "✅ PRICE CONFIRMED", "⚡ NEG GAMMA", "🔥 ACT NOW"],
    strike: "$570",
    expiry: "March 27, 2026",
    premium: "$4.5M",
    putCall: "put",
    suggestedTrade: "Buy SPY $570 Puts expiring March 27",
    entryTrigger: "Break below $572 with VIX expansion",
    invalidation: "$578.00",
    keyLevel: "$573.50",
    targetZone: "$564.00 – $567.00",
    timeframe: "buy_now",
    source: "example",
    category: "algorithm",
    priceConfirmed: true,
    pricePattern: "SR Tag + 2 Red Bars at $573.50 (lower high — likely reversal)",
    gammaZone: "negative",
    gammaDescription: "Negative gamma zone — price will accelerate through this level",
  },
  {
    id: "ex-5",
    ticker: "PLTR",
    type: "bullish",
    confidence: 9.2,
    convictionScore: 72,
    convictionLabel: "High Conviction",
    description: "Whale positioning: $1.4M in repeat call sweeps on PLTR at $120 strike across 4 sweeps. Smart money building positions ahead of earnings. Open interest growing rapidly — institutional accumulation for a swing higher.",
    timestamp: "Fri 11:45 AM",
    tags: ["Call Flow", "Sweep", "🐋 WHALE PLAY", "⚡ HIGH CONVICTION"],
    strike: "$120",
    expiry: "April 17, 2026",
    premium: "$1.4M",
    putCall: "call",
    suggestedTrade: "Buy PLTR $120 Calls expiring April 17",
    entryTrigger: "Break above $118 with volume surge",
    invalidation: "$114.00",
    keyLevel: "$117.50",
    targetZone: "$123.00 – $126.00",
    timeframe: "swing",
    source: "example",
    category: "whale",
  },
  {
    id: "ex-6",
    ticker: "AMD",
    type: "bearish",
    confidence: 10.0,
    convictionScore: 95,
    convictionLabel: "Extreme Conviction",
    description: "Whale alert: $5.2M in AMD $110 put sweeps. 12 consecutive sweeps at the ask in 15 minutes. Dark pool short volume at 62% — highest in 30 days. Massive institutional conviction for a multi-day move lower.",
    timestamp: "Fri 10:22 AM",
    tags: ["Put Flow", "Sweep", "🐋 WHALE PLAY", "🔥 ACT NOW"],
    strike: "$110",
    expiry: "April 3, 2026",
    premium: "$5.2M",
    putCall: "put",
    suggestedTrade: "Buy AMD $110 Puts expiring April 3",
    entryTrigger: "Breakdown below $112 support",
    invalidation: "$116.50",
    keyLevel: "$112.00",
    targetZone: "$105.00 – $107.00",
    timeframe: "swing",
    source: "example",
    category: "whale",
  },
  {
    id: "ex-7",
    ticker: "META",
    type: "bullish",
    confidence: 9.5,
    convictionScore: 90,
    convictionLabel: "Extreme Conviction",
    description: "Debit call spread detected: buy $580/$600 call spread on META expiring April 3. Simultaneous sweeps at both strikes — $1.2M on $580 calls, $800K sold on $600 calls. Defined risk bullish bet with 3:1 reward ratio.",
    timestamp: "Fri 2:15 PM",
    tags: ["Call Flow", "Sweep", "Debit Spread", "✅ PRICE CONFIRMED", "⚡ NEG GAMMA", "🔥 ACT NOW"],
    strike: "$580/$600",
    expiry: "March 27, 2026",
    premium: "$400K net debit",
    putCall: "call",
    suggestedTrade: "Buy META $580/$600 Call Debit Spread expiring March 27",
    entryTrigger: "Hold above $575 support with momentum confirmation",
    invalidation: "$570.00",
    keyLevel: "$578.00",
    targetZone: "$595.00 – $600.00",
    timeframe: "buy_now",
    source: "example",
    category: "spread",
    priceConfirmed: true,
    pricePattern: "SR Tag + 2 Green Bars at $578.00 (higher low confirmed — breakout setup)",
    gammaZone: "negative",
    gammaDescription: "Negative gamma zone — directional move will amplify through both spread strikes",
    spreadDetails: {
      type: "debit_spread",
      legs: "Buy $580 Call / Sell $600 Call",
      max_profit: 1600,
      max_loss: 400,
      probability: 65,
    },
  },
  {
    id: "ex-8",
    ticker: "AMZN",
    type: "bullish",
    confidence: 9.4,
    convictionScore: 91,
    convictionLabel: "Extreme Conviction",
    description: "Butterfly spread identified on AMZN: buy 1x $200 call, sell 2x $210 calls, buy 1x $220 call. Expiring April 10. $180K net debit for a $1.8M max profit if AMZN pins near $210. Low-risk, high-reward structure.",
    timestamp: "Fri 11:30 AM",
    tags: ["Call Flow", "Butterfly", "✅ PRICE CONFIRMED", "🧲 POS GAMMA", "🔥 ACT NOW"],
    strike: "$200/$210/$220",
    expiry: "March 27, 2026",
    premium: "$180K net debit",
    putCall: "call",
    suggestedTrade: "Buy AMZN $200/$210/$220 Call Butterfly expiring March 27",
    entryTrigger: "AMZN pinning near $210 with decreasing volatility",
    invalidation: "$195.00",
    keyLevel: "$210.00",
    targetZone: "$208.00 – $212.00 (max profit zone)",
    timeframe: "buy_now",
    source: "example",
    category: "spread",
    priceConfirmed: true,
    pricePattern: "Price consolidating at $210 strike — positive gamma pinning action confirmed",
    gammaZone: "positive",
    gammaDescription: "Positive gamma zone — pinning action near $210 maximizes butterfly profit",
    spreadDetails: {
      type: "butterfly",
      legs: "Buy 1x $200C / Sell 2x $210C / Buy 1x $220C",
      max_profit: 1800,
      max_loss: 180,
      probability: 35,
    },
  },
  {
    id: "ex-9",
    ticker: "GOOGL",
    type: "bearish",
    confidence: 9.2,
    convictionScore: 85,
    convictionLabel: "Very High Conviction",
    description: "Iron condor flow detected on GOOGL: sell $175/$180 call spread, sell $160/$155 put spread. Collecting $320K in premium with defined risk. Expecting GOOGL to stay range-bound between $160 – $175 through expiry.",
    timestamp: "Fri 10:45 AM",
    tags: ["Put Flow", "Call Flow", "Iron Condor", "✅ PRICE CONFIRMED", "🧲 POS GAMMA", "🔥 ACT NOW"],
    strike: "$155/$160/$175/$180",
    expiry: "March 28, 2026",
    premium: "$320K credit",
    putCall: "put",
    suggestedTrade: "Sell GOOGL $155/$160/$175/$180 Iron Condor expiring March 28",
    entryTrigger: "GOOGL range-bound in $162 – $173, VIX elevated for rich premium",
    invalidation: "$178.00 or $157.00",
    keyLevel: "$167.50 (center of range)",
    targetZone: "$160.00 – $175.00 (profit zone)",
    timeframe: "short_term",
    source: "example",
    category: "spread",
    priceConfirmed: true,
    pricePattern: "Price mean-reverting within $160 – $175 range — positive gamma keeping price contained",
    gammaZone: "positive",
    gammaDescription: "Positive gamma zone — mean-reversion keeps price in iron condor profit range",
    spreadDetails: {
      type: "iron_condor",
      legs: "Sell $175C / Buy $180C / Sell $160P / Buy $155P",
      max_profit: 320,
      max_loss: 180,
      probability: 72,
    },
  },
];

function classifyTimeframe(signal: { convictionScore?: number; confidence: number; expiry?: string }): SignalTimeframe {
  const score = signal.convictionScore ?? 0;
  
  if (score >= 75) return "buy_now";
  
  if (signal.expiry) {
    const dte = computeDte(signal.expiry);
    if (dte <= 1) return "buy_now";
    if (dte <= 7) return "short_term";
    return "swing";
  }
  
  if (score >= 60) return "short_term";
  return "swing";
}

const CACHE_KEY = 'jortrade-signals-cache';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadCachedSignals(): MarketSignal[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { signals, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return signals;
  } catch { return null; }
}

function saveCachedSignals(signals: MarketSignal[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ signals, timestamp: Date.now() }));
  } catch {}
}

export function useMarketData() {
  const [signals, setSignals] = useState<MarketSignal[]>(() => {
    const cached = loadCachedSignals();
    return cached || exampleSignals;
  });
  const [whaleAlerts, setWhaleAlerts] = useState<FlowAlert[]>([]);
  const [marketOverview, setMarketOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const REPLIT_SIGNALS_API = '/api/whale/signals';

  const fetchFlowAlerts = useCallback(async () => {
    try {
      // Try Replit signals API first
      const res = await fetch(REPLIT_SIGNALS_API);
      if (res.ok) {
        const data = await res.json();
        const replitSignals = data?.signals || [];
        if (replitSignals.length > 0) {
          const mapped: MarketSignal[] = replitSignals.map((s: any, i: number) => {
            const isBullish = s.direction === 'bullish';
            const tags = [...(s.tags || [])];
            if (s.has_sweep && !tags.includes('Sweep')) tags.push('Sweep');

            // Full whale scoring model using all available Replit API data
            const strikeNum = parseFloat(String(s.strike)) || 0;
            const premiumNum = typeof s.premium === 'number' ? s.premium : parseFloat(String(s.premium)) || 0;
            const volOiRatio = parseFloat(String(s.vol_oi_ratio)) || 0;
            const currentPrice = parseFloat(String(s.current_price)) || 0;

            // Derive volume/OI from vol_oi_ratio for scoring
            // Use a synthetic OI of 100 so volume = ratio * 100 preserves the ratio
            const syntheticOI = volOiRatio > 0 ? 100 : 0;
            const syntheticVolume = Math.round(volOiRatio * 100);

            // Map ask_aggression_pct to alert rule: 95%+ = sweep-level aggression
            const askAgg = parseFloat(String(s.ask_aggression_pct)) || 0;
            const inferredRule = s.has_sweep ? 'sweep' 
              : askAgg >= 95 ? 'sweep'  // 95%+ ask aggression = sweep-equivalent
              : askAgg >= 70 ? 'repeated'
              : 'flow';

            const scoreResult = computeWhaleConviction({
              premium: premiumNum,
              alertRule: inferredRule,
              dte: computeDte(s.expiry),
              moneynessPct: computeMoneyness(strikeNum, currentPrice || null),
              volume: syntheticVolume,
              openInterest: syntheticOI,
              tradeCount: s.trade_count || 1,
              ticker: s.ticker,
              strike: strikeNum,
              stockPrice: currentPrice || undefined,
              keyLevels: undefined, // Replit doesn't provide gamma levels
              isSpread: false,
              isDeepItm: false,
            });

            let hybridScore = scoreResult.score;
            let gammaLabel = scoreResult.gammaLevelLabel;

            // Boost score using Replit's Claude confidence (1-10 scale)
            // If Replit confidence is high (8+) but whale model scored low due to
            // per-contract premium format, blend them to avoid underscoring
            const replitConfidence = parseFloat(String(s.confidence)) || 5;
            if (replitConfidence >= 8) {
              // Map confidence 8-10 → target floor 70-90
              const confidenceFloor = Math.round((replitConfidence - 8) * 10 + 70);
              if (hybridScore < confidenceFloor) {
                // Blend: weighted average favoring higher score
                hybridScore = Math.round(hybridScore * 0.3 + confidenceFloor * 0.7);
              }
            } else if (replitConfidence >= 7) {
              const confidenceFloor = 60;
              if (hybridScore < confidenceFloor) {
                hybridScore = Math.round(hybridScore * 0.4 + confidenceFloor * 0.6);
              }
            }

            // Re-derive label after boost
            let hybridLabel = "Low Conviction";
            if (hybridScore >= 90) hybridLabel = "Extreme Conviction";
            else if (hybridScore >= 75) hybridLabel = "Very High Conviction";
            else if (hybridScore >= 60) hybridLabel = "High Conviction";
            else if (hybridScore >= 40) hybridLabel = "Moderate Conviction";

            // Key level from Claude analysis
            if (s.key_level && !gammaLabel) {
              gammaLabel = `Near ${s.key_level} level`;
            }

            // Remove raw backend tags before adding styled versions
            const rawTagsToRemove = ['Price Confirmed', 'Negative Gamma', 'Positive Gamma'];
            for (const raw of rawTagsToRemove) {
              const idx = tags.indexOf(raw);
              if (idx !== -1) tags.splice(idx, 1);
            }

            // Price confirmation boost
            const isPriceConfirmed = s.price_confirmed === true;
            if (isPriceConfirmed) {
              hybridScore = Math.min(100, hybridScore + 10);
              tags.push('✅ PRICE CONFIRMED');
            }

            // Gamma zone tags
            const gammaZone = s.gamma_zone || 'neutral';
            if (gammaZone === 'negative') {
              tags.push('⚡ NEG GAMMA');
            } else if (gammaZone === 'positive') {
              tags.push('🧲 POS GAMMA');
            }

            // Re-derive label after all boosts
            if (hybridScore >= 90) hybridLabel = "Extreme Conviction";
            else if (hybridScore >= 75) hybridLabel = "Very High Conviction";
            else if (hybridScore >= 60) hybridLabel = "High Conviction";
            else if (hybridScore >= 40) hybridLabel = "Moderate Conviction";

            // Use scored tags
            if (isPriceConfirmed && hybridScore >= 85) tags.push('🔥 ACT NOW');
            else if (hybridScore >= 85) tags.push('🔥 ACT NOW');
            else if (hybridScore >= 70) tags.push('⚡ HIGH CONVICTION');

            const timeframe = classifyTimeframe({ convictionScore: hybridScore, confidence: s.confidence, expiry: s.expiry });

            // Use API-provided category if available, otherwise classify locally
            let category: SignalCategory;
            if (s.category === 'spread' || s.category === 'whale' || s.category === 'algorithm') {
              category = s.category;
            } else {
              const whalePremium = parseFloat(String(s.premium)) || 0;
              const isWhalePlay = whalePremium >= 250000 && (s.has_sweep || inferredRule === 'sweep') && hybridScore >= 75;
              category = isWhalePlay && !isPriceConfirmed ? 'whale' : 'algorithm';
            }

            return {
              id: `replit-${s.ticker}-${i}`,
              ticker: s.ticker,
              type: isBullish ? 'bullish' as const : 'bearish' as const,
              confidence: s.confidence,
              convictionScore: hybridScore,
              convictionLabel: hybridLabel,
              gammaLevelLabel: gammaLabel || s.gamma_description,
              description: s.reason || `${s.option_type} flow on ${s.ticker} at $${s.strike} strike. Premium: $${formatPremium(s.premium)}.`,
              timestamp: data.timestamp || 'Live',
              tags,
              strike: `$${s.strike}`,
              expiry: s.expiry,
              premium: `$${formatPremium(s.premium)}`,
              putCall: s.option_type as 'call' | 'put',
              suggestedTrade: s.recommended_action || s.trade,
              entryTrigger: s.entry_trigger,
              invalidation: s.invalidation,
              keyLevel: s.key_level,
              targetZone: s.target,
              source: "live",
              timeframe,
              priceConfirmed: isPriceConfirmed,
              pricePattern: s.price_pattern || null,
              gammaZone: gammaZone as 'positive' | 'negative' | 'neutral',
              gammaDescription: s.gamma_description,
              recommendedAction: s.recommended_action,
              recommendedExpiry: s.recommended_expiry,
              recommendedStrike: s.recommended_strike,
              category,
              spreadDetails: s.spread_details || null,
            } as MarketSignal;
          });

          // Merge live signals (first) with examples (after), deduplicating by ticker
          const liveTickers = new Set(mapped.map(s => s.ticker));
          const filteredExamples = exampleSignals.filter(s => !liveTickers.has(s.ticker));
          setSignals([...mapped, ...filteredExamples]);
          saveCachedSignals(mapped);

          // Log Replit signals to signal_outcomes for accuracy tracking
          try {
            const signalsToLog = replitSignals.map((s: any) => ({
              ticker: s.ticker,
              signal_type: s.direction === 'bullish' ? 'bullish' : 'bearish',
              put_call: s.option_type || null,
              confidence: s.confidence,
              strike: s.strike ? `$${s.strike}` : null,
              expiry: s.expiry || null,
              premium: s.premium ? `$${formatPremium(s.premium)}` : null,
              target_zone: s.target || null,
              description: s.reason || null,
              outcome: 'pending',
              signal_source: 'replit',
            }));

            // Check for existing signals to avoid duplicates
            const tickers = [...new Set(signalsToLog.map((s: any) => s.ticker))];
            const { data: existing } = await supabase
              .from("signal_outcomes" as any)
              .select("ticker,strike,expiry,signal_source")
              .in("ticker", tickers)
              .in("signal_source", ["replit", "dashboard"])
              .eq("outcome", "pending");

            const existingKeys = new Set((existing || []).map((e: any) => `${e.ticker}|${e.strike}|${e.expiry}`));
            const fresh = signalsToLog.filter((s: any) => !existingKeys.has(`${s.ticker}|${s.strike}|${s.expiry}`));

            if (fresh.length > 0) {
              await supabase.from("signal_outcomes" as any).insert(fresh);
            }
          } catch (logErr) {
            console.warn('Failed to log Replit signals for tracking:', logErr);
          }

          return;
        }
      }
    } catch (e) {
      console.warn('Replit signals API failed, falling back to edge function:', e);
    }

    // Fallback to existing edge function
    try {
      const { data, error } = await supabase.functions.invoke('market-data', {
        body: { action: 'flow' },
      });
      if (error) throw error;

      const alerts = data?.data || [];
      const keyLevelsMap: Record<string, number[]> = data?.key_levels || {};
      
      if (alerts.length === 0) return;

      type SignalWithMeta = MarketSignal & { _totalPremium: number };
      const allSignals: SignalWithMeta[] = alerts
        .filter((alert: any) => {
          const volOi = alert.volume_oi_ratio ? parseFloat(alert.volume_oi_ratio) : 0;
          const totalPremium = parseFloat(alert.total_premium || alert.premium || '0');
          const tradeCount = alert.trade_count || 0;
          const strike = alert.strike ? parseFloat(String(alert.strike).replace(/[^0-9.]/g, '')) : NaN;
          return volOi >= 5 && totalPremium >= 25000 && tradeCount >= 5 && !isNaN(strike) && strike > 0;
        })
        .map((alert: any, i: number) => {
          const putCall = alert.type === 'call' ? 'call' : 'put';
          const isBullish = putCall === 'call';
          const ticker = alert.ticker || alert.underlying_symbol || 'N/A';
          const rawStrike = parseFloat(String(alert.strike).replace(/[^0-9.]/g, ''));
          const strikeLabel = String(rawStrike);
          const totalPremium = parseFloat(alert.total_premium || alert.premium || '0');
          const premium = formatPremium(totalPremium);
          const expiry = alert.expiry || alert.expires || 'N/A';
          const flowType = alert.alert_rule?.includes('Sweep') ? 'Sweep' : 
                           alert.alert_rule?.includes('Block') ? 'Block' : 
                           alert.alert_rule?.includes('Repeated') ? 'Repeated Hits' : 'Flow';
          const volOiRatio = alert.volume_oi_ratio ? parseFloat(alert.volume_oi_ratio) : 0;
          const tradeCount = alert.trade_count || 0;
          const stockPrice = parseFloat(alert.stock_price || alert.underlying_price || '0') || null;

          const dte = computeDte(expiry !== 'N/A' ? expiry : null);
          const moneynessPct = computeMoneyness(rawStrike, stockPrice);
          const scoreResult = computeWhaleConviction({
            premium: totalPremium,
            alertRule: alert.alert_rule || flowType,
            dte,
            moneynessPct,
            volume: alert.volume || 0,
            openInterest: alert.open_interest || 0,
            tradeCount,
            ticker,
            strike: rawStrike,
            stockPrice: stockPrice || undefined,
            keyLevels: keyLevelsMap[ticker],
          });

          const confidence = Math.min(10, parseFloat((scoreResult.score / 10).toFixed(1)));
          const urgencyTag = scoreResult.score >= 75 ? '🔥 ACT NOW' : scoreResult.score >= 60 ? '⚡ HIGH CONVICTION' : null;
          const tags = [
            putCall === 'call' ? 'Call Flow' : 'Put Flow',
            flowType,
            ...(urgencyTag ? [urgencyTag] : []),
          ].filter(Boolean);

          return {
            id: alert.id || String(i),
            ticker,
            type: isBullish ? 'bullish' as const : 'bearish' as const,
            confidence,
            convictionScore: scoreResult.score,
            convictionLabel: scoreResult.label,
            gammaLevelLabel: scoreResult.gammaLevelLabel,
            _totalPremium: totalPremium,
            description: `${tradeCount} ${putCall} trades detected on ${ticker} at $${strikeLabel} strike. Total premium: $${premium}. Volume/OI ratio: ${volOiRatio ? volOiRatio.toFixed(1) + 'x' : 'N/A'}. Conviction: ${scoreResult.score}/100 (${scoreResult.label}).`,
            timestamp: alert.created_at ? timeAgo(alert.created_at) : 'just now',
            createdAt: alert.created_at || '',
            tags,
            strike: `$${strikeLabel}`,
            expiry: expiry && expiry !== 'N/A' ? expiry : undefined,
            premium: `$${premium}`,
            putCall: putCall as 'call' | 'put',
            suggestedTrade: `Buy ${ticker} $${strikeLabel} ${putCall === 'call' ? 'Calls' : 'Puts'}${expiry && expiry !== 'N/A' ? ` expiring ${expiry}` : ''}`,
            entryTrigger: isBullish ? `Break above $${strikeLabel} with volume` : `Break below $${strikeLabel} with volume`,
            invalidation: `$${(rawStrike * (isBullish ? 0.97 : 1.03)).toFixed(2)}`,
            keyLevel: `$${(rawStrike * (isBullish ? 0.99 : 1.01)).toFixed(2)}`,
            targetZone: isBullish 
              ? `$${(rawStrike * 1.02).toFixed(2)} – $${(rawStrike * 1.05).toFixed(2)}`
              : `$${(rawStrike * 0.95).toFixed(2)} – $${(rawStrike * 0.98).toFixed(2)}`,
          } as SignalWithMeta;
        });

      const tickerMap = new Map<string, (typeof allSignals)[0]>();
      for (const signal of allSignals) {
        const existing = tickerMap.get(signal.ticker);
        if (!existing || signal._totalPremium > existing._totalPremium) {
          tickerMap.set(signal.ticker, signal);
        }
      }

      const liveDeduped: MarketSignal[] = Array.from(tickerMap.values())
        .filter(s => s.convictionScore !== undefined ? s.convictionScore >= 80 : s.confidence >= 8)
        .sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        })
        .map(({ _totalPremium, ...signal }) => ({
          ...signal,
          timeframe: classifyTimeframe(signal),
        }));

      const liveTickers = new Set(liveDeduped.map(s => s.ticker));
      const fillerSignals = exampleSignals.filter(s => !liveTickers.has(s.ticker) && (s.convictionScore !== undefined ? s.convictionScore >= 80 : s.confidence >= 8));
      const merged = [...liveDeduped, ...fillerSignals];

      if (merged.length > 0) {
        setSignals(merged);
        saveCachedSignals(merged);
      }
    } catch (e) {
      console.error('Failed to fetch flow alerts:', e);
    }
  }, []);

  const fetchWhaleAlerts = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('market-data', {
        body: { action: 'whale-alerts' },
      });
      if (error) throw error;

      const alerts = data?.data || [];
      const keyLevelsMap: Record<string, number[]> = data?.key_levels || {};
      if (alerts.length === 0) return;

      const newWhaleAlerts: FlowAlert[] = alerts
        .filter((alert: any) => {
          const strike = alert.strike ? parseFloat(String(alert.strike).replace(/[^0-9.]/g, '')) : NaN;
          return !isNaN(strike) && strike > 0;
        })
        .map((alert: any) => {
          const putCall = alert.type === 'call' ? 'Call' : 'Put';
          const flowPattern = alert.alert_rule?.includes('Sweep') ? 'Sweep'
            : alert.alert_rule?.includes('Block') ? 'Block'
            : alert.alert_rule?.includes('Repeated') ? 'Repeated Hits' : 'Flow';
          const ticker = alert.ticker || alert.underlying_symbol || 'N/A';
          const rawStrike = parseFloat(String(alert.strike).replace(/[^0-9.]/g, ''));
          const totalPremium = parseFloat(alert.total_premium || alert.premium || '0');
          const premium = formatPremium(totalPremium);
          const isBullish = alert.type === 'call';
          const expiry = alert.expiry || alert.expires || '—';
          const stockPrice = parseFloat(alert.stock_price || alert.underlying_price || '0') || null;

          const dte = computeDte(expiry !== '—' ? expiry : null);
          const moneynessPct = computeMoneyness(rawStrike, stockPrice);
          const scoreResult = computeWhaleConviction({
            premium: totalPremium,
            alertRule: alert.alert_rule || flowPattern,
            dte,
            moneynessPct,
            volume: alert.volume || 0,
            openInterest: alert.open_interest || 0,
            tradeCount: alert.trade_count || 1,
            ticker,
            strike: rawStrike,
            stockPrice: stockPrice || undefined,
            keyLevels: keyLevelsMap[ticker],
          });

          return {
            ticker,
            type: `${putCall} ${flowPattern}`,
            premium: `$${premium}`,
            strike: `$${rawStrike}`,
            expiry,
            sentiment: isBullish ? 'bullish' as const : 'bearish' as const,
            time: alert.created_at ? timeAgo(alert.created_at) : 'just now',
            convictionScore: scoreResult.score,
            convictionLabel: scoreResult.label,
            gammaLevelLabel: scoreResult.gammaLevelLabel,
            explanation: `${alert.trade_count || 'Multiple'} ${putCall.toLowerCase()} ${flowPattern.toLowerCase()}${alert.trade_count > 1 ? 's' : ''} detected on ${ticker} at $${rawStrike} strike with $${premium} total premium. ${alert.volume_oi_ratio ? `Volume/OI ratio is ${parseFloat(alert.volume_oi_ratio).toFixed(1)}x — ` : ''}${isBullish ? 'Bullish' : 'Bearish'} institutional positioning. Conviction: ${scoreResult.score}/100 (${scoreResult.label}).`,
          };
        });

      // Deduplicate: keep highest conviction per ticker
      const tickerMap = new Map<string, FlowAlert>();
      for (const alert of newWhaleAlerts) {
        const existing = tickerMap.get(alert.ticker);
        if (!existing || (alert.convictionScore || 0) > (existing.convictionScore || 0)) {
          tickerMap.set(alert.ticker, alert);
        }
      }

      const deduped = Array.from(tickerMap.values())
        .sort((a, b) => (b.convictionScore || 0) - (a.convictionScore || 0))
        .slice(0, 8);

      if (deduped.length > 0) setWhaleAlerts(deduped);
    } catch (e) {
      console.error('Failed to fetch whale alerts:', e);
    }
  }, []);

  const fetchMarketOverview = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('market-data', {
        body: { action: 'market' },
      });
      if (error) throw error;
      if (data?.data) setMarketOverview(data.data);
    } catch (e) {
      console.error('Failed to fetch market overview:', e);
    }
  }, []);

  const fetchTickerData = useCallback(async (ticker: string): Promise<TickerData | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('market-data', {
        body: { action: 'ticker', ticker },
      });
      if (error) throw error;
      return data;
    } catch (e) {
      console.error(`Failed to fetch ticker ${ticker}:`, e);
      return null;
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Sequential to avoid exceeding UW API concurrency limit (max 3)
        await fetchFlowAlerts();
        await fetchWhaleAlerts();
        await fetchMarketOverview();
      } catch (e) {
        setError('Failed to load market data');
      } finally {
        setLoading(false);
      }
    };

    load();

    const shouldPoll = (): boolean => {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
      });
      const parts = fmt.formatToParts(now);
      const get = (t: string) => parts.find(p => p.type === t)?.value || "";
      const weekday = get("weekday");
      const hour = parseInt(get("hour")) % 24;
      const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      return weekdays.includes(weekday) && hour >= 4 && hour < 20;
    };

    // Sequential polling to respect concurrency limits
    const interval = setInterval(async () => {
      if (shouldPoll()) {
        await fetchFlowAlerts();
        await fetchWhaleAlerts();
        await fetchMarketOverview();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchFlowAlerts, fetchWhaleAlerts, fetchMarketOverview]);

  return { signals, whaleAlerts, marketOverview, loading, error, fetchTickerData, refresh: fetchFlowAlerts };
}

function formatPremium(value: any): string {
  if (!value) return '0';
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toFixed(0);
}

function parsePremium(str: string): number {
  const clean = str.replace(/[$,]/g, '');
  if (clean.endsWith('M')) return parseFloat(clean) * 1_000_000;
  if (clean.endsWith('K')) return parseFloat(clean) * 1_000;
  return parseFloat(clean) || 0;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now.getTime() - then.getTime();
  const mins = Math.floor(diffMs / 60000);

  if (isToday(dateStr)) {
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[then.getDay()];
  const h = then.getHours();
  const m = then.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${day} ${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function isToday(dateStr?: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  const d = new Date(dateStr);
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}
