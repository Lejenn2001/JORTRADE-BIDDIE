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
  srLevel?: string;
  targetZone?: string;
  targetNear?: string;
  createdAt?: string;
  detectedAtMs?: number;
  timeframe?: SignalTimeframe;
  source?: "live";
  priceConfirmed?: boolean;
  pricePattern?: string | null;
  gammaZone?: "positive" | "negative" | "neutral";
  gammaDescription?: string;
  recommendedAction?: string;
  recommendedExpiry?: string;
  recommendedStrike?: string;
  category?: SignalCategory;
  aiEvaluated?: boolean;
  priceAtSignal?: number;
  outcome?: "hit" | "win" | "missed" | "loss" | "pending" | null;
  mfePercent?: number | null;
  maxFavorablePrice?: number | null;
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
const HISTORY_KEY = 'jortrade-signals-history';
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes — signals update frequently during market hours
const HISTORY_TTL = 16 * 60 * 60 * 1000; // 16 hours — clears overnight so yesterday's signals don't persist
const MAX_HISTORY = 200;

function signalUniqueKey(s: MarketSignal): string {
  return `${s.ticker}|${s.strike}|${s.expiry}|${s.putCall}|${s.category || ''}`;
}

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

function loadSignalHistory(): MarketSignal[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const { signals, timestamps } = JSON.parse(raw);
    if (!Array.isArray(signals)) return [];
    const now = Date.now();
    return signals.filter((_s: MarketSignal, i: number) => {
      const addedAt = timestamps?.[i] ?? 0;
      return now - addedAt < HISTORY_TTL;
    });
  } catch { return []; }
}

function saveSignalHistory(signals: MarketSignal[], timestamps: number[]) {
  try {
    const trimmed = signals.slice(0, MAX_HISTORY);
    const trimmedTs = timestamps.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ signals: trimmed, timestamps: trimmedTs }));
  } catch {}
}

function mergeIntoHistory(newSignals: MarketSignal[]): MarketSignal[] {
  const existing = loadSignalHistory();
  const existingKeys = new Set(existing.map(signalUniqueKey));
  const now = Date.now();

  const rawHistory = localStorage.getItem(HISTORY_KEY);
  let existingTimestamps: number[] = [];
  try {
    if (rawHistory) existingTimestamps = JSON.parse(rawHistory).timestamps || [];
  } catch {}

  const freshSignals: MarketSignal[] = [];
  const freshTimestamps: number[] = [];
  for (const s of newSignals) {
    const key = signalUniqueKey(s);
    if (!existingKeys.has(key)) {
      freshSignals.push(s);
      freshTimestamps.push(now);
      existingKeys.add(key);
    }
  }

  const merged = [...freshSignals, ...existing];
  const mergedTs = [...freshTimestamps, ...existingTimestamps];
  saveSignalHistory(merged, mergedTs);
  return merged;
}

export function useMarketData() {
  const [signals, setSignals] = useState<MarketSignal[]>(() => {
    const cached = loadCachedSignals();
    return cached || [];
  });
  const [whaleAlerts, setWhaleAlerts] = useState<FlowAlert[]>([]);
  const [marketOverview, setMarketOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const REPLIT_SIGNALS_API = '/api/whale/signals';

  const fetchFlowAlerts = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      const res = await fetch(REPLIT_SIGNALS_API, { signal: controller.signal });
      clearTimeout(timeoutId);
      console.log('[JORTRADE] API response status:', res.status);
      if (res.ok) {
        const data = await res.json();
        console.log('[JORTRADE] API data:', { count: data?.count, loading: data?.loading, signalCount: data?.signals?.length });
        if (data?.loading) {
          console.log('[JORTRADE] Server warming up, will retry in 5s...');
          setTimeout(() => fetchFlowAlerts(), 5000);
          return;
        }
        const replitSignals = data?.signals || [];
        console.log('[JORTRADE] Raw signals from API:', replitSignals.length, replitSignals.map((s: any) => s.ticker).join(','));
        if (replitSignals.length > 0) {
          const mapped: MarketSignal[] = [];
          for (let i = 0; i < replitSignals.length; i++) {
           try {
            const s = replitSignals[i];
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

            if (isPriceConfirmed && gammaZone !== 'neutral' && hybridScore >= 85) tags.push('🔥 ACT NOW');
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

            const signal = {
              id: `replit-${s.ticker}-${s.strike || 'na'}-${s.expiry || 'na'}-${category}`,
              ticker: s.ticker,
              type: isBullish ? 'bullish' as const : 'bearish' as const,
              confidence: s.confidence,
              convictionScore: hybridScore,
              convictionLabel: hybridLabel,
              gammaLevelLabel: gammaLabel || s.gamma_description,
              description: s.reason || `${s.option_type} flow on ${s.ticker} at $${s.strike} strike. Premium: $${formatPremium(s.premium)}.`,
              timestamp: (() => {
                if (s.detected_at) {
                  const etMatch = String(s.detected_at).match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
                  if (etMatch) return `${etMatch[1]} ${etMatch[2].toUpperCase()} ET`;
                }
                return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET';
              })(),
              tags,
              strike: `$${s.strike}`,
              expiry: s.expiry,
              premium: `$${formatPremium(s.premium)}`,
              putCall: s.option_type as 'call' | 'put',
              suggestedTrade: s.category === "spread"
                ? (s.recommended_action || s.trade)
                : `Buy ${s.ticker} $${s.strike} ${s.option_type === "call" ? "Call" : "Put"}`,
              entryTrigger: s.entry_trigger,
              invalidation: s.invalidation,
              keyLevel: s.key_level,
              srLevel: s.sr_level,
              targetZone: s.target,
              targetNear: s.target_near || "",
              source: "live",
              timeframe,
              detectedAtMs: Date.now(),
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
            mapped.push(signal);
           } catch (mapErr) {
            const s = replitSignals[i];
            console.error(`[JORTRADE] Signal mapping error for ${s?.ticker}:`, mapErr);
            mapped.push({
              id: `replit-${s?.ticker || 'unknown'}-${s?.strike || 'na'}-${s?.expiry || 'na'}-${s?.category || 'signal'}`,
              ticker: s?.ticker || 'Unknown',
              type: s?.direction === 'bullish' ? 'bullish' as const : 'bearish' as const,
              confidence: s?.confidence || 5,
              convictionScore: (s?.confidence || 5) * 10,
              convictionLabel: 'Moderate Conviction',
              description: s?.reason || `${s?.option_type} flow on ${s?.ticker}`,
              timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              tags: s?.tags || [],
              strike: s?.strike ? `$${s.strike}` : undefined,
              expiry: s?.expiry,
              premium: s?.premium ? `$${s.premium.toLocaleString?.() || s.premium}` : undefined,
              putCall: s?.option_type as 'call' | 'put',
              suggestedTrade: s?.category === "spread"
                ? (s?.trade || s?.recommended_action)
                : `Buy ${s?.ticker} $${s?.strike} ${s?.option_type === "call" ? "Call" : "Put"}`,
              source: 'live',
              detectedAtMs: Date.now(),
              category: s?.category || 'algorithm',
              spreadDetails: s?.spread_details || null,
            } as MarketSignal);
           }
          }

          mergeIntoHistory(mapped);

          console.log('[JORTRADE] Mapped signals:', mapped.length, 'categories:', mapped.map(s => `${s.ticker}:${s.category}:${s.convictionScore}`).join(', '));
          setSignals(mapped);
          saveCachedSignals(mapped);

          return;
        }
      }
    } catch (e: any) {
      console.error('[JORTRADE] API fetch failed:', e?.name, e?.message);
      if (e?.name === 'AbortError') {
        console.error('[JORTRADE] Request timed out after 45s — server may be warming up');
      }
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
          const urgencyTag = scoreResult.score >= 60 ? '⚡ HIGH CONVICTION' : null;
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
            timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET',
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

      mergeIntoHistory(liveDeduped);

      if (liveDeduped.length > 0) {
        setSignals(liveDeduped);
        saveCachedSignals(liveDeduped);
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

  const signalHistory = loadSignalHistory();

  return { signals, signalHistory, whaleAlerts, marketOverview, loading, error, fetchTickerData, refresh: fetchFlowAlerts };
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
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 'Live';

  const now = new Date();
  const isToday_ = then.toDateString() === now.toDateString();
  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday_) return time;

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
