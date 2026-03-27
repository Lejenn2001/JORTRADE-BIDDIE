import { Router } from "express";
import axios from "axios";
import { priceMonitor } from "../lib/priceMonitor";

const router = Router();

const POLYGON_KEY = () => process.env["POLYGON_API_KEY"] ?? "";

const DEFAULT_WATCHLIST = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD", "SPY", "QQQ",
  "NFLX", "COIN", "MARA", "RIOT", "PLTR", "SOFI", "NIO", "BABA", "BA", "DIS",
  "JPM", "GS", "V", "MA", "XOM", "CVX", "GLD", "SLV", "TLT", "IWM",
  "MRVL", "MU", "INTC", "AVGO", "CRM", "SNOW", "NET", "DKNG", "UBER", "ABNB",
];

const customTickers = new Set<string>();
const MAX_CUSTOM_TICKERS = 30;

function getFullWatchlist(): string[] {
  return [...new Set([...DEFAULT_WATCHLIST, ...customTickers])];
}

interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SqueezeResult {
  ticker: string;
  squeezeActive: boolean;
  squeezeLength: number;
  bbWidth: number;
  kcWidth: number;
  atr: number;
  currentPrice: number;
  volume20dAvg: number;
  currentVolume: number;
  volumeRatio: number;
  consolidationDays: number;
  rangeHighLow: [number, number];
  breakoutDirection: "bullish" | "bearish" | "none";
  breakoutTriggered: boolean;
  breakoutPrice: number | null;
  resistanceLevel: number | null;
  supportLevel: number | null;
  score: number;
  reason: string;
  targetPrice: number | null;
  proximityPct: number | null;
  imminenceLabel: string | null;
  imminenceScore: number;
}

async function fetchDailyCandles(ticker: string, days: number = 60): Promise<CandleData[]> {
  try {
    const YF = "https://query1.finance.yahoo.com/v8/finance/chart";
    const res = await axios.get(`${YF}/${ticker}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      params: { interval: "1d", range: `${days}d` },
      timeout: 10000,
    });
    const result = res.data?.chart?.result?.[0];
    if (!result) return [];
    const quote = result.indicators?.quote?.[0];
    const timestamps = result.timestamp ?? [];
    const candles: CandleData[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote?.open?.[i];
      const h = quote?.high?.[i];
      const l = quote?.low?.[i];
      const c = quote?.close?.[i];
      const v = quote?.volume?.[i];
      if (o && h && l && c) {
        candles.push({ timestamp: timestamps[i], open: o, high: h, low: l, close: c, volume: v ?? 0 });
      }
    }
    return candles;
  } catch {
    return [];
  }
}

async function fetchPolygonQuote(ticker: string): Promise<{ price: number; prevClose: number; volume: number } | null> {
  try {
    const key = POLYGON_KEY();
    if (!key) return null;
    const res = await axios.get(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`,
      { params: { apiKey: key }, timeout: 5000 }
    );
    const t = res.data?.ticker;
    if (!t) return null;
    const price = t.lastTrade?.p || t.day?.c || 0;
    if (price <= 0) return null;
    return {
      price,
      prevClose: t.prevDay?.c || 0,
      volume: t.day?.v || 0,
    };
  } catch {
    return null;
  }
}

function calcSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  for (let i = 0; i < values.length; i++) {
    if (i === 0) { result.push(values[0]); continue; }
    if (i < period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += values[j];
      result.push(sum / (i + 1));
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      result.push(sum / period);
      continue;
    }
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcATR(candles: CandleData[], period: number): number[] {
  const trueRanges: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trueRanges.push(candles[i].high - candles[i].low);
    } else {
      const prevClose = candles[i - 1].close;
      trueRanges.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose)
      ));
    }
  }
  return calcEMA(trueRanges, period);
}

function calcStdDev(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
    result.push(Math.sqrt(variance / period));
  }
  return result;
}

function detectSqueeze(candles: CandleData[]): {
  squeezeActive: boolean;
  squeezeLength: number;
  bbWidth: number;
  kcWidth: number;
} {
  if (candles.length < 21) return { squeezeActive: false, squeezeLength: 0, bbWidth: 0, kcWidth: 0 };

  const closes = candles.map(c => c.close);
  const sma20 = calcSMA(closes, 20);
  const stdDev20 = calcStdDev(closes, 20);
  const ema20 = calcEMA(closes, 20);
  const atr20 = calcATR(candles, 20);

  let squeezeLength = 0;
  const last = candles.length - 1;

  for (let i = last; i >= 20; i--) {
    const bbUpper = sma20[i] + 2 * stdDev20[i];
    const bbLower = sma20[i] - 2 * stdDev20[i];
    const kcUpper = ema20[i] + 1.5 * atr20[i];
    const kcLower = ema20[i] - 1.5 * atr20[i];

    if (bbUpper < kcUpper && bbLower > kcLower) {
      squeezeLength++;
    } else {
      break;
    }
  }

  const bbW = sma20[last] > 0 ? (2 * stdDev20[last]) / sma20[last] : 0;
  const kcW = ema20[last] > 0 ? (2 * 1.5 * atr20[last]) / ema20[last] : 0;

  return {
    squeezeActive: squeezeLength >= 3,
    squeezeLength,
    bbWidth: Math.round(bbW * 10000) / 10000,
    kcWidth: Math.round(kcW * 10000) / 10000,
  };
}

function detectConsolidation(candles: CandleData[]): {
  consolidationDays: number;
  rangeHigh: number;
  rangeLow: number;
  resistanceLevel: number;
  supportLevel: number;
} {
  if (candles.length < 5) return { consolidationDays: 0, rangeHigh: 0, rangeLow: 0, resistanceLevel: 0, supportLevel: 0 };

  const last = candles.length - 1;
  const recentPrice = candles[last].close;
  const threshold = recentPrice * 0.03;

  let consolidationDays = 0;
  let rangeHigh = candles[last].high;
  let rangeLow = candles[last].low;

  for (let i = last; i >= 1; i--) {
    const dayHigh = candles[i].high;
    const dayLow = candles[i].low;

    const testHigh = Math.max(rangeHigh, dayHigh);
    const testLow = Math.min(rangeLow, dayLow);

    if (testHigh - testLow <= threshold) {
      rangeHigh = testHigh;
      rangeLow = testLow;
      consolidationDays++;
    } else {
      break;
    }
  }

  if (!Number.isFinite(rangeHigh)) rangeHigh = candles[last].high;
  if (!Number.isFinite(rangeLow)) rangeLow = candles[last].low;

  let resistanceLevel = rangeHigh;
  let supportLevel = rangeLow;

  const highs = candles.slice(-20).map(c => c.high);
  const highCounts = new Map<number, number>();
  for (const h of highs) {
    const rounded = Math.round(h * 4) / 4;
    highCounts.set(rounded, (highCounts.get(rounded) || 0) + 1);
  }
  let maxCount = 0;
  for (const [level, count] of highCounts) {
    if (count > maxCount && level >= recentPrice * 0.995) {
      maxCount = count;
      resistanceLevel = level;
    }
  }

  return { consolidationDays, rangeHigh, rangeLow, resistanceLevel, supportLevel };
}

function detectBreakout(candles: CandleData[], resistanceLevel: number, supportLevel: number): {
  breakoutTriggered: boolean;
  breakoutDirection: "bullish" | "bearish" | "none";
  breakoutPrice: number | null;
} {
  if (candles.length < 3) return { breakoutTriggered: false, breakoutDirection: "none", breakoutPrice: null };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const vol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles.length);

  if (last.close > resistanceLevel && last.volume > vol20 * 1.5 && prev.close <= resistanceLevel) {
    return { breakoutTriggered: true, breakoutDirection: "bullish", breakoutPrice: last.close };
  }

  if (last.close < supportLevel && last.volume > vol20 * 1.5 && prev.close >= supportLevel) {
    return { breakoutTriggered: true, breakoutDirection: "bearish", breakoutPrice: last.close };
  }

  return { breakoutTriggered: false, breakoutDirection: "none", breakoutPrice: null };
}

async function scanTicker(ticker: string): Promise<SqueezeResult | null> {
  const candles = await fetchDailyCandles(ticker, 60);
  if (candles.length < 21) return null;

  const lastCandle = candles[candles.length - 1];
  let quote = await fetchPolygonQuote(ticker);
  if (!quote) {
    quote = {
      price: lastCandle.close,
      prevClose: candles.length >= 2 ? candles[candles.length - 2].close : lastCandle.close,
      volume: lastCandle.volume,
    };
  }

  const squeeze = detectSqueeze(candles);
  const consolidation = detectConsolidation(candles);
  const breakout = detectBreakout(candles, consolidation.resistanceLevel, consolidation.supportLevel);

  const atrValues = calcATR(candles, 14);
  const atr = atrValues[atrValues.length - 1] || 0;

  const vol20Avg = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / Math.min(20, candles.length);
  const currentVol = quote.volume || candles[candles.length - 1].volume;
  const volumeRatio = vol20Avg > 0 ? currentVol / vol20Avg : 0;

  let score = 0;
  const reasons: string[] = [];

  if (squeeze.squeezeActive) {
    score += 25 + Math.min(squeeze.squeezeLength * 3, 15);
    reasons.push(`Squeeze active (${squeeze.squeezeLength} bars)`);
  } else if (squeeze.bbWidth > 0 && squeeze.kcWidth > 0 && squeeze.bbWidth / squeeze.kcWidth < 1.2) {
    score += 15;
    reasons.push(`Near squeeze (BB/KC ratio ${(squeeze.bbWidth / squeeze.kcWidth).toFixed(2)})`);
  }

  if (consolidation.consolidationDays >= 3) {
    score += 15 + Math.min(consolidation.consolidationDays * 2, 10);
    reasons.push(`Consolidating ${consolidation.consolidationDays} days`);
  } else if (consolidation.consolidationDays >= 2) {
    score += 10;
    reasons.push(`Tight range ${consolidation.consolidationDays} days`);
  }

  if (volumeRatio >= 2.0) {
    score += 20;
    reasons.push(`Volume spike ${volumeRatio.toFixed(1)}x avg`);
  } else if (volumeRatio >= 1.3) {
    score += 10;
    reasons.push(`Elevated volume ${volumeRatio.toFixed(1)}x avg`);
  }

  if (breakout.breakoutTriggered) {
    score += 30;
    reasons.push(`Breakout ${breakout.breakoutDirection} at $${breakout.breakoutPrice?.toFixed(2)}`);
  }

  const rangePct = quote.price > 0 ? ((consolidation.rangeHigh - consolidation.rangeLow) / quote.price) * 100 : 0;
  if (rangePct > 0 && rangePct < 3 && consolidation.consolidationDays >= 2) {
    score += 10;
    reasons.push(`Tight ${rangePct.toFixed(1)}% range`);
  }

  if (score < 25) return null;

  const distToResistance = consolidation.resistanceLevel > 0
    ? ((consolidation.resistanceLevel - quote.price) / quote.price) * 100 : 99;
  const distToSupport = consolidation.supportLevel > 0
    ? ((quote.price - consolidation.supportLevel) / quote.price) * 100 : 99;
  const closerDist = Math.min(Math.abs(distToResistance), Math.abs(distToSupport));
  const closerDir = Math.abs(distToResistance) <= Math.abs(distToSupport) ? "bullish" : "bearish";

  let targetPrice: number | null = null;
  if (breakout.breakoutTriggered) {
    targetPrice = breakout.breakoutDirection === "bullish"
      ? Math.round((consolidation.resistanceLevel + atr) * 100) / 100
      : Math.round((consolidation.supportLevel - atr) * 100) / 100;
  } else if (closerDir === "bullish" && consolidation.resistanceLevel > 0) {
    targetPrice = Math.round((consolidation.resistanceLevel + atr) * 100) / 100;
  } else if (consolidation.supportLevel > 0) {
    targetPrice = Math.round((consolidation.supportLevel - atr) * 100) / 100;
  }

  let imminenceScore = 0;
  if (closerDist <= 0.2) imminenceScore += 40;
  else if (closerDist <= 0.5) imminenceScore += 30;
  else if (closerDist <= 1.0) imminenceScore += 20;
  else if (closerDist <= 1.5) imminenceScore += 10;

  if (squeeze.squeezeActive) {
    imminenceScore += Math.min(squeeze.squeezeLength * 4, 25);
  } else if (squeeze.bbWidth > 0 && squeeze.kcWidth > 0 && squeeze.bbWidth / squeeze.kcWidth < 1.1) {
    imminenceScore += 15;
  }

  if (volumeRatio >= 2.0) imminenceScore += 20;
  else if (volumeRatio >= 1.5) imminenceScore += 15;
  else if (volumeRatio >= 1.2) imminenceScore += 5;

  if (consolidation.consolidationDays >= 5) imminenceScore += 15;
  else if (consolidation.consolidationDays >= 3) imminenceScore += 10;

  let imminenceLabel: string | null = null;
  if (breakout.breakoutTriggered) {
    imminenceLabel = "BREAKOUT ACTIVE";
  } else if (imminenceScore >= 80) {
    imminenceLabel = "BREAKOUT IMMINENT";
  } else if (imminenceScore >= 60) {
    imminenceLabel = "LIKELY WITHIN 15 MIN";
  } else if (imminenceScore >= 45) {
    imminenceLabel = "LIKELY WITHIN 1 HOUR";
  } else if (imminenceScore >= 30) {
    imminenceLabel = "BUILDING PRESSURE";
  }

  return {
    ticker,
    squeezeActive: squeeze.squeezeActive,
    squeezeLength: squeeze.squeezeLength,
    bbWidth: squeeze.bbWidth,
    kcWidth: squeeze.kcWidth,
    atr: Math.round(atr * 100) / 100,
    currentPrice: quote.price,
    volume20dAvg: Math.round(vol20Avg),
    currentVolume: currentVol,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    consolidationDays: consolidation.consolidationDays,
    rangeHighLow: [consolidation.rangeHigh, consolidation.rangeLow],
    breakoutDirection: breakout.breakoutDirection,
    breakoutTriggered: breakout.breakoutTriggered,
    breakoutPrice: breakout.breakoutPrice,
    resistanceLevel: consolidation.resistanceLevel,
    supportLevel: consolidation.supportLevel,
    score,
    reason: reasons.join(". "),
    targetPrice,
    proximityPct: Math.round(closerDist * 100) / 100,
    imminenceLabel,
    imminenceScore,
  };
}

let cachedResults: SqueezeResult[] = [];
let lastScanTime = 0;
const SCAN_INTERVAL = 5 * 60 * 1000;

async function runFullScan(): Promise<SqueezeResult[]> {
  const now = Date.now();
  if (cachedResults.length > 0 && now - lastScanTime < SCAN_INTERVAL) {
    return cachedResults;
  }

  const WATCHLIST = getFullWatchlist();
  console.log(`[breakout] Starting scan of ${WATCHLIST.length} tickers...`);
  const t0 = Date.now();
  const results: SqueezeResult[] = [];

  const batchSize = 5;
  for (let i = 0; i < WATCHLIST.length; i += batchSize) {
    const batch = WATCHLIST.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(t => scanTicker(t)));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    if (i + batchSize < WATCHLIST.length) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  results.sort((a, b) => b.score - a.score);
  cachedResults = results;
  lastScanTime = Date.now();
  console.log(`[breakout] Scan complete: ${Date.now() - t0}ms, ${results.length} setups found`);
  return results;
}

router.get("/breakout/scan/:ticker", async (req, res) => {
  try {
    const result = await scanTicker(req.params.ticker.toUpperCase());
    if (!result) {
      res.json({ ticker: req.params.ticker.toUpperCase(), setup: null, message: "No setup detected" });
      return;
    }
    res.json({ ticker: result.ticker, setup: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/breakout/watchlist", (_req, res) => {
  res.json({
    watchlist: getFullWatchlist(),
    defaultCount: DEFAULT_WATCHLIST.length,
    customTickers: [...customTickers],
    maxCustom: MAX_CUSTOM_TICKERS,
  });
});

router.post("/breakout/watchlist/add", (req, res) => {
  const { ticker } = req.body;
  if (!ticker || typeof ticker !== "string") {
    res.status(400).json({ error: "Ticker is required" });
    return;
  }
  const symbol = ticker.toUpperCase().trim().replace(/[^A-Z]/g, "");
  if (!symbol || symbol.length > 5) {
    res.status(400).json({ error: "Invalid ticker symbol" });
    return;
  }
  if (DEFAULT_WATCHLIST.includes(symbol)) {
    res.json({ message: `${symbol} is already in the default watchlist`, ticker: symbol, added: false });
    return;
  }
  if (customTickers.has(symbol)) {
    res.json({ message: `${symbol} is already being watched`, ticker: symbol, added: false });
    return;
  }
  if (customTickers.size >= MAX_CUSTOM_TICKERS) {
    res.status(400).json({ error: `Maximum ${MAX_CUSTOM_TICKERS} custom tickers allowed. Remove one first.` });
    return;
  }
  customTickers.add(symbol);
  lastScanTime = 0;
  console.log(`[breakout] Custom ticker added: ${symbol} (${customTickers.size} custom total)`);
  res.json({ message: `${symbol} added to watchlist`, ticker: symbol, added: true, customCount: customTickers.size });
});

router.post("/breakout/watchlist/remove", (req, res) => {
  const { ticker } = req.body;
  if (!ticker || typeof ticker !== "string") {
    res.status(400).json({ error: "Ticker is required" });
    return;
  }
  const symbol = ticker.toUpperCase().trim().replace(/[^A-Z]/g, "");
  if (!symbol || symbol.length > 5) {
    res.status(400).json({ error: "Invalid ticker symbol" });
    return;
  }
  if (DEFAULT_WATCHLIST.includes(symbol)) {
    res.status(400).json({ error: `${symbol} is a default ticker and cannot be removed` });
    return;
  }
  const removed = customTickers.delete(symbol);
  if (removed) {
    cachedResults = cachedResults.filter(r => r.ticker !== symbol);
    syncBreakoutSubscriptions();
  }
  res.json({ message: removed ? `${symbol} removed` : `${symbol} was not in custom list`, ticker: symbol, removed });
});

interface BreakoutAlert {
  id: string;
  ticker: string;
  direction: "bullish" | "bearish";
  breakoutPrice: number;
  resistanceLevel: number;
  supportLevel: number;
  suggestedStrike: number;
  suggestedTrade: string;
  targetPrice: number;
  score: number;
  squeezeLength: number;
  triggeredAt: string;
  expiresAt: number;
  volumeConfirmation: {
    sessionVolumeRatio: number;
    burstVolumeRatio: number;
    institutionalConfirmed: boolean;
  };
}

const breakoutAlerts: BreakoutAlert[] = [];
const MAX_ALERTS = 50;
const ALERT_TTL = 4 * 60 * 60 * 1000;
const alertCooldowns = new Map<string, number>();
const COOLDOWN_MS = 15 * 60 * 1000;

interface VolumeBucket {
  timestamp: number;
  volume: number;
}

const volumeBuckets = new Map<string, VolumeBucket[]>();
const BUCKET_SIZE_MS = 5_000;
const RECENT_WINDOW_MS = 60_000;
const HISTORY_WINDOW_MS = 10 * 60_000;

function trackVolumeBurst(ticker: string, tradeVolume: number) {
  const now = Date.now();
  const bucketTime = Math.floor(now / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;

  let buckets = volumeBuckets.get(ticker);
  if (!buckets) {
    buckets = [];
    volumeBuckets.set(ticker, buckets);
  }

  const lastBucket = buckets.length > 0 ? buckets[buckets.length - 1] : null;
  if (lastBucket && lastBucket.timestamp === bucketTime) {
    lastBucket.volume += tradeVolume;
  } else {
    buckets.push({ timestamp: bucketTime, volume: tradeVolume });
  }

  const cutoff = now - HISTORY_WINDOW_MS;
  while (buckets.length > 0 && buckets[0].timestamp < cutoff) {
    buckets.shift();
  }
}

function getVolumeBurstRatio(ticker: string): number {
  const buckets = volumeBuckets.get(ticker);
  if (!buckets || buckets.length < 3) return 0;

  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_MS;
  const olderCutoff = now - HISTORY_WINDOW_MS;

  let recentVol = 0;
  let olderVol = 0;
  let olderBucketCount = 0;
  let recentBucketCount = 0;

  for (const b of buckets) {
    if (b.timestamp >= recentCutoff) {
      recentVol += b.volume;
      recentBucketCount++;
    } else if (b.timestamp >= olderCutoff) {
      olderVol += b.volume;
      olderBucketCount++;
    }
  }

  if (olderBucketCount === 0 || olderVol === 0) return 0;

  const olderAvgPerMinute = olderVol / (olderBucketCount * BUCKET_SIZE_MS / 60_000);
  const recentPerMinute = recentVol / (RECENT_WINDOW_MS / 60_000);

  if (olderAvgPerMinute === 0) return 0;
  return recentPerMinute / olderAvgPerMinute;
}

function getSessionVolumeRatio(ticker: string, setup: SqueezeResult): number {
  const priceData = priceMonitor.getPrice(ticker);
  if (!priceData || setup.volume20dAvg === 0) return 0;

  const now = new Date();
  const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const minutesSinceOpen = (eastern.getHours() - 9) * 60 + (eastern.getMinutes() - 30);

  if (minutesSinceOpen <= 0 || minutesSinceOpen > 390) return 0;

  const expectedVolumeFraction = minutesSinceOpen / 390;
  const expectedVolumeNow = setup.volume20dAvg * expectedVolumeFraction;

  if (expectedVolumeNow === 0) return 0;
  return priceData.volume / expectedVolumeNow;
}

function roundToStrike(price: number): number {
  if (price >= 500) return Math.round(price / 5) * 5;
  if (price >= 100) return Math.round(price);
  if (price >= 20) return Math.round(price * 2) / 2;
  return Math.round(price);
}

function generateBreakoutAlert(ticker: string, livePrice: number, setup: SqueezeResult, direction: "bullish" | "bearish", volConfirmation: { sessionVolumeRatio: number; burstVolumeRatio: number; institutionalConfirmed: boolean }) {
  const now = Date.now();
  const lastAlert = alertCooldowns.get(`${ticker}-${direction}`);
  if (lastAlert && now - lastAlert < COOLDOWN_MS) return;

  const strike = roundToStrike(direction === "bullish" ? setup.resistanceLevel! : setup.supportLevel!);
  const tradeType = direction === "bullish" ? "CALL" : "PUT";
  const target = direction === "bullish"
    ? Math.round((setup.resistanceLevel! + setup.atr) * 100) / 100
    : Math.round((setup.supportLevel! - setup.atr) * 100) / 100;

  const alert: BreakoutAlert = {
    id: `bo-${ticker}-${direction}-${now}`,
    ticker,
    direction,
    breakoutPrice: Math.round(livePrice * 100) / 100,
    resistanceLevel: setup.resistanceLevel!,
    supportLevel: setup.supportLevel!,
    suggestedStrike: strike,
    suggestedTrade: `${ticker} $${strike} ${tradeType}`,
    targetPrice: target,
    score: setup.score,
    squeezeLength: setup.squeezeLength,
    triggeredAt: new Date().toISOString(),
    expiresAt: now + ALERT_TTL,
    volumeConfirmation: volConfirmation,
  };

  breakoutAlerts.unshift(alert);
  if (breakoutAlerts.length > MAX_ALERTS) breakoutAlerts.length = MAX_ALERTS;
  alertCooldowns.set(`${ticker}-${direction}`, now);

  const instLabel = volConfirmation.institutionalConfirmed ? "INSTITUTIONAL" : "RETAIL";
  console.log(`[breakout-alert] ${alert.suggestedTrade} @ $${alert.breakoutPrice} | Session Vol: ${volConfirmation.sessionVolumeRatio.toFixed(1)}x | Burst: ${volConfirmation.burstVolumeRatio.toFixed(1)}x | ${instLabel}`);
}

function setupBreakoutMonitor() {
  priceMonitor.onPrice((ticker, data, tradeVolume) => {
    if (cachedResults.length === 0) return;

    trackVolumeBurst(ticker, tradeVolume || 0);

    const setup = cachedResults.find(s => s.ticker === ticker);
    if (!setup || !setup.resistanceLevel || !setup.supportLevel) return;
    if (setup.score < 40) return;

    const price = data.price;
    const resistanceBuffer = setup.resistanceLevel * 1.002;
    const supportBuffer = setup.supportLevel * 0.998;

    const priceBreakingUp = price >= resistanceBuffer && setup.currentPrice < setup.resistanceLevel;
    const priceBreakingDown = price <= supportBuffer && setup.currentPrice > setup.supportLevel;

    if (!priceBreakingUp && !priceBreakingDown) return;

    const sessionVolumeRatio = getSessionVolumeRatio(ticker, setup);
    const burstVolumeRatio = getVolumeBurstRatio(ticker);
    const institutionalConfirmed = sessionVolumeRatio >= 1.5 && burstVolumeRatio >= 3.0;

    if (sessionVolumeRatio < 1.5) {
      return;
    }

    if (burstVolumeRatio < 3.0) {
      return;
    }

    const direction: "bullish" | "bearish" = priceBreakingUp ? "bullish" : "bearish";

    generateBreakoutAlert(ticker, price, setup, direction, {
      sessionVolumeRatio: Math.round(sessionVolumeRatio * 100) / 100,
      burstVolumeRatio: Math.round(burstVolumeRatio * 100) / 100,
      institutionalConfirmed,
    });
  });

  console.log("[breakout-alert] Real-time breakout monitor active (volume-confirmed only)");
}

const BASE_TICKERS = new Set(["GLD", "QQQ", "SPY", "IWM"]);

function syncBreakoutSubscriptions() {
  if (cachedResults.length === 0) return;
  const setupTickers = cachedResults.map(s => s.ticker);
  const allNeeded = [...new Set([...setupTickers, ...BASE_TICKERS])];
  priceMonitor.updateSubscriptions(allNeeded);
  console.log(`[breakout-alert] Synced subscriptions: ${allNeeded.length} tickers`);
}

setupBreakoutMonitor();

router.get("/breakout/alerts", (_req, res) => {
  if (cachedResults.length === 0 && Date.now() - lastScanTime > SCAN_INTERVAL) {
    runFullScan().then(() => syncBreakoutSubscriptions()).catch(() => {});
  }
  const now = Date.now();
  const active = breakoutAlerts.filter(a => a.expiresAt > now);
  res.json({
    count: active.length,
    alerts: active,
    monitoring: {
      subscribedTickers: priceMonitor.getSubscribedTickers().length,
      setupsWatched: cachedResults.length,
      wsConnected: priceMonitor.isConnected(),
    },
  });
});

router.get("/breakout/scan", async (_req, res) => {
  try {
    const results = await runFullScan();
    syncBreakoutSubscriptions();
    res.json({
      count: results.length,
      lastScan: new Date(lastScanTime).toISOString(),
      tickersScanned: getFullWatchlist().length,
      setups: results,
    });
  } catch (err: any) {
    console.error("[breakout] Scan error:", err.message);
    res.status(500).json({ error: "Scan failed" });
  }
});

export default router;
