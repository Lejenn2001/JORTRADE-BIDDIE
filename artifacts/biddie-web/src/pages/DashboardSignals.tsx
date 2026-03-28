import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useMarketData, type MarketSignal, type SignalTimeframe } from "@/hooks/useMarketData";
import { useRealtimePrices, type PriceInfo } from "@/hooks/useRealtimePrices";
import { useAuth } from "@/hooks/useAuth";
import { Search, Filter, TrendingUp, TrendingDown, Zap, Clock, Target, ShieldX, Crosshair, MapPin, Gauge, Waves, CheckCircle2, Flame, Check, Plus, XCircle, Radio } from "lucide-react";
import { Input } from "@/components/ui/input";
import ConvictionScoreRing from "@/components/dashboard/ConvictionScoreRing";
import SignalLegend from "@/components/dashboard/SignalLegend";

type FilterType = "all" | "call" | "put";
type ViewTab = "algorithm" | "whale" | "spread";

const ALGO_SECTION_META: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  buy_now: {
    label: "🔥 ACT NOW",
    icon: <Zap className="h-4 w-4 text-emerald-400" />,
    description: "Price confirmed — act immediately",
  },
  short_term: {
    label: "⚡ 1–3 DAY TRADE",
    icon: <Clock className="h-4 w-4 text-emerald-400" />,
    description: "Algorithm-detected setups with short-term expiry",
  },
};


const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, delay: i * 0.1, ease: "easeOut" as const },
  }),
};

function classifyTimeframeFromRecord(record: any): SignalTimeframe {
  const confidence = parseFloat(record.confidence) || 5;
  const score = confidence >= 8.5 ? 85 : confidence >= 7.5 ? 75 : confidence >= 6 ? 60 : 40;
  
  if (score >= 75) return "buy_now";
  
  if (record.expiry) {
    const expDate = new Date(record.expiry);
    if (!isNaN(expDate.getTime())) {
      const now = new Date();
      const dte = Math.max(0, Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      if (dte <= 1) return "buy_now";
      if (dte <= 7) return "short_term";
      return "swing";
    }
  }
  
  if (score >= 60) return "short_term";
  return "swing";
}

function dbRecordToSignal(record: any): MarketSignal {
  const isBullish = record.signal_type === 'bullish';
  const confidence = parseFloat(record.confidence) || 5;
  
  let convictionScore = Math.round(confidence * 10);
  if (confidence >= 9) convictionScore = Math.max(convictionScore, 92);
  else if (confidence >= 8) convictionScore = Math.max(convictionScore, 85);
  else if (confidence >= 7) convictionScore = Math.max(convictionScore, 78);
  else if (confidence >= 6) convictionScore = Math.max(convictionScore, 70);

  let convictionLabel = "Low Conviction";
  if (convictionScore >= 90) convictionLabel = "Extreme Conviction";
  else if (convictionScore >= 80) convictionLabel = "Very High Conviction";
  else if (convictionScore >= 68) convictionLabel = "High Conviction";
  else if (convictionScore >= 50) convictionLabel = "Moderate Conviction";

  const putCall = record.put_call || record.option_type || 'call';
  const tags: string[] = [];
  if (putCall) tags.push(putCall === 'call' ? 'Call Flow' : 'Put Flow');
  if (convictionScore >= 70) tags.push('⚡ HIGH CONVICTION');

  const createdAt = record.detected_at || record.created_at || '';
  const timestamp = createdAt ? formatTimestamp(createdAt) : 'Today';

  return {
    id: record.id,
    ticker: record.ticker,
    type: isBullish ? 'bullish' : 'bearish',
    confidence,
    convictionScore,
    convictionLabel,
    description: (() => {
      let desc = record.description || record.reason || `${putCall || ''} flow on ${record.ticker} at ${record.strike || 'N/A'} strike.`;
      if (record.price_at_signal && !desc.includes('Price at $')) {
        desc += ` Price at $${Number(record.price_at_signal).toFixed(2)}.`;
      }
      return desc;
    })(),
    timestamp,
    tags,
    strike: record.strike || undefined,
    expiry: record.expiry || undefined,
    premium: record.premium || undefined,
    putCall: putCall as 'call' | 'put' | undefined,
    suggestedTrade: record.category === 'spread' && record.spread_details?.legs
      ? `${record.ticker} ${record.spread_details.type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Spread'} — ${record.spread_details.legs}`
      : `Buy ${record.ticker} $${record.strike || ''} ${putCall === 'call' ? 'Call' : 'Put'}${record.expiry ? ` (${record.expiry})` : ''}`,
    targetZone: record.target_zone || record.target || undefined,
    createdAt,
    source: 'live',
    timeframe: classifyTimeframeFromRecord(record),
    category: record.category,
    reason: record.reason,
    aiEvaluated: true,
    priceAtSignal: record.price_at_signal ? Number(record.price_at_signal) : undefined,
    outcome: record.outcome || null,
    tradeStatus: record.trade_status || null,
    mfePercent: record.mfe_percent != null ? Number(record.mfe_percent) : null,
    maxFavorablePrice: record.max_favorable_price != null ? Number(record.max_favorable_price) : null,
    entryTrigger: record.entry_trigger,
    invalidation: record.invalidation,
    keyLevel: record.key_level,
    srLevel: record.sr_level,
    targetNear: record.target_near || (() => {
      const target = record.target_zone || record.target;
      const priceVal = record.price_at_signal ? Number(record.price_at_signal) : 0;
      if (!target || !priceVal) return undefined;
      const tgtMatch = target.match(/\$([0-9]+\.?[0-9]*)/);
      if (!tgtMatch) return undefined;
      const tgtVal = parseFloat(tgtMatch[1]);
      const isBull = putCall === 'call';
      for (const src of [record.sr_level, record.key_level]) {
        if (!src) continue;
        const m = src.match(/\$([0-9]+\.?[0-9]*)/);
        if (!m) continue;
        const lvl = parseFloat(m[1]);
        if (isBull && lvl > priceVal && lvl < tgtVal) return `$${lvl.toFixed(2)}`;
        if (!isBull && lvl < priceVal && lvl > tgtVal) return `$${lvl.toFixed(2)}`;
      }
      if (isBull && priceVal < tgtVal) {
        return `$${(priceVal + (tgtVal - priceVal) * 0.6).toFixed(2)}`;
      }
      if (!isBull && priceVal > tgtVal) {
        return `$${(priceVal - (priceVal - tgtVal) * 0.6).toFixed(2)}`;
      }
      return undefined;
    })(),
    spreadDetails: record.spread_details || null,
  };
}

function formatTimestamp(isoStr: string): string {
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return 'Today';
  const eastern = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const month = eastern.getMonth() + 1;
  const day = eastern.getDate();
  const year = eastern.getFullYear();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
  return `${month}/${day}/${year} ${time}`;
}

const DashboardSignals = () => {
  const { signals: liveSignals, loading: liveLoading } = useMarketData();
  const { getPrice, connected: wsConnected, marketOpen } = useRealtimePrices();
  const { user } = useAuth();
  const [dbSignals, setDbSignals] = useState<MarketSignal[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [showResolved, setShowResolved] = useState(searchParams.get("resolved") === "true");
  const [takenSignalIds, setTakenSignalIds] = useState<Set<string>>(new Set());
  const [takingId, setTakingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/whale/trades?userId=${user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.trades) {
          setTakenSignalIds(new Set(data.trades.map((t: any) => t.signal_id)));
        }
      })
      .catch(() => {});
  }, [user?.id]);

  const handleTakeTrade = useCallback(async (signal: MarketSignal) => {
    if (!user?.id) return;
    const isTaken = takenSignalIds.has(signal.id);
    setTakingId(signal.id);
    try {
      if (isTaken) {
        await fetch(`/api/whale/trades/${signal.id}?userId=${user.id}`, { method: "DELETE" });
        setTakenSignalIds(prev => { const next = new Set(prev); next.delete(signal.id); return next; });
      } else {
        const livePrice = getPrice?.(signal.ticker);
        await fetch("/api/whale/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            signalId: signal.id,
            ticker: signal.ticker,
            direction: signal.type,
            category: signal.category,
            strike: signal.strike,
            expiry: signal.expiry,
            optionType: signal.putCall,
            entryTrigger: signal.entryTrigger,
            target: signal.targetZone,
            invalidation: signal.invalidation,
            convictionScore: signal.convictionScore,
            entryPrice: livePrice?.price || signal.priceAtSignal || null,
          }),
        });
        setTakenSignalIds(prev => new Set(prev).add(signal.id));
      }
    } catch (e) {
      console.error("Failed to toggle trade:", e);
    } finally {
      setTakingId(null);
    }
  }, [user?.id, takenSignalIds]);

  useEffect(() => {
    const loadRecentSignals = async () => {
      setDbLoading(true);
      try {
        const now = new Date();
        const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        todayET.setHours(0, 0, 0, 0);
        const todayStart = new Date(todayET.toISOString().split('T')[0] + 'T04:00:00Z');

        const resp = await fetch('/api/whale/signals/history?limit=100');
        if (!resp.ok) throw new Error('Failed to fetch signal history');
        const result = await resp.json();

        if (result.signals && result.signals.length > 0) {
          const mapped = result.signals.map(dbRecordToSignal);
          setDbSignals(mapped);
        }
      } catch (e) {
        console.warn('Failed to load recent signals from DB:', e);
      } finally {
        setDbLoading(false);
      }
    };

    loadRecentSignals();
  }, []);

  const allSignals = useMemo(() => {
    const dbKeys = new Set(dbSignals.map(s => `${s.ticker}|${s.strike}|${s.putCall}|${s.expiry}`));
    const filteredLive = liveSignals.filter(s => {
      const key = `${s.ticker}|${s.strike}|${s.putCall}|${s.expiry}`;
      return !dbKeys.has(key);
    });
    const all = [...dbSignals, ...filteredLive];
    const seen = new Set<string>();
    const unique: MarketSignal[] = [];
    for (const s of all) {
      if (!seen.has(s.id)) {
        seen.add(s.id);
        unique.push(s);
      }
    }
    return unique;
  }, [liveSignals, dbSignals]);

  const loading = liveLoading && dbLoading;
  const signals = allSignals;

  const [viewTab, setViewTab] = useState<ViewTab>("algorithm");

  const filtered = useMemo(() => {
    let list = [...signals];

    if (!showResolved) {
      list = list.filter((s) => {
        const o = s.outcome;
        return !o || o === "pending";
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.ticker.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    if (filterType !== "all") {
      list = list.filter((s) => s.putCall === filterType);
    }

    list.sort((a, b) => {
      const dateA = a.detectedAtMs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const dateB = b.detectedAtMs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return dateB - dateA;
    });

    return list;
  }, [signals, search, filterType, showResolved]);

  const resolvedCount = useMemo(() => {
    return signals.filter(s => s.outcome && s.outcome !== "pending").length;
  }, [signals]);

  const algorithmSignals = useMemo(() => {
    const algoOnly = filtered.filter(s => s.category === 'algorithm' || (s.category !== 'whale' && s.category !== 'spread'));
    const buyNow = algoOnly.filter(s => s.timeframe === 'buy_now');
    const shortTerm = algoOnly.filter(s => s.timeframe === 'short_term' || s.timeframe === 'swing');
    return { buy_now: buyNow, short_term: shortTerm };
  }, [filtered]);

  const whaleSignals = useMemo(() => {
    return filtered.filter(s => s.category === 'whale');
  }, [filtered]);

  const spreadSignals = useMemo(() => {
    return filtered.filter(s => s.category === 'spread');
  }, [filtered]);

  const algoCount = algorithmSignals.buy_now.length + algorithmSignals.short_term.length;
  const whaleCount = whaleSignals.length;
  const spreadCount = spreadSignals.length;
  const totalCount = signals.length;

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">Decision Engine</h1>
              {wsConnected && (
                <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <Radio className="h-2.5 w-2.5 animate-pulse" />
                  Real-Time
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {showResolved ? `All signals — ${totalCount} total` : `Active signals — ${totalCount - resolvedCount} pending`}
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewTab("algorithm")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                viewTab === "algorithm"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Zap className="h-4 w-4" />
              Algorithm Plays
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                viewTab === "algorithm" ? "bg-emerald-500/30" : "bg-muted/50"
              }`}>{algoCount}</span>
            </button>
            <button
              onClick={() => setViewTab("whale")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                viewTab === "whale"
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                  : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Waves className="h-4 w-4" />
              Whale Activity
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                viewTab === "whale" ? "bg-blue-500/30" : "bg-muted/50"
              }`}>{whaleCount}</span>
            </button>
            <button
              onClick={() => setViewTab("spread")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                viewTab === "spread"
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/40"
                  : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Target className="h-4 w-4" />
              Spreads & Butterflies
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                viewTab === "spread" ? "bg-violet-500/30" : "bg-muted/50"
              }`}>{spreadCount}</span>
            </button>
          </div>

          {/* Filters */}
          <div className="glass-panel rounded-xl p-3 flex flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                placeholder="Search ticker..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent border-none shadow-none focus-visible:ring-0 text-sm h-8"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {(["all", "call", "put"] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterType(f)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    filterType === f
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  {f === "all" ? "All" : f === "call" ? "Calls" : "Puts"}
                </button>
              ))}
              <span className="w-px h-4 bg-border/40 mx-1" />
              <button
                onClick={() => setShowResolved(!showResolved)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                  showResolved
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {showResolved ? "Hide Resolved" : `Show Resolved (${resolvedCount})`}
              </button>
            </div>
          </div>

          <SignalLegend />

          {loading && signals.length === 0 && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/20 animate-pulse h-40" />
              ))}
            </div>
          )}

          {/* Algorithm Plays Tab */}
          {viewTab === "algorithm" && (
            <>
              {algoCount === 0 && !loading && (
                <div className="glass-panel rounded-xl p-8 text-center border border-emerald-500/20">
                  <Zap className="h-8 w-8 text-emerald-400/40 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No algorithm plays detected yet. Signals appear here when price action confirms at key levels during market hours.</p>
                </div>
              )}

              {(["buy_now", "short_term"] as const).map((timeframe) => {
                const meta = ALGO_SECTION_META[timeframe];
                const sectionSignals = algorithmSignals[timeframe];
                if (sectionSignals.length === 0) return null;

                return (
                  <div key={timeframe} className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                      {meta.icon}
                      <span className="font-bold text-xs sm:text-sm text-emerald-400">{meta.label}</span>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">— {meta.description}</span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full ml-auto">
                        {sectionSignals.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {sectionSignals.map((signal, i) => (
                        <motion.div key={`${signal.id}-${i}`} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                          <SignalCard signal={signal} isTaken={takenSignalIds.has(signal.id)} isTaking={takingId === signal.id} onTakeTrade={handleTakeTrade} getPrice={getPrice} />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Whale Plays Tab */}
          {viewTab === "whale" && (
            <>
              {whaleCount === 0 && !loading && (
                <div className="glass-panel rounded-xl p-8 text-center border border-blue-500/20">
                  <Waves className="h-8 w-8 text-blue-400/40 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No whale plays detected yet. These appear when large institutional orders ($250K+ premium) are identified as swing setups.</p>
                </div>
              )}

              {whaleSignals.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Waves className="h-4 w-4 text-blue-400" />
                    <span className="font-bold text-xs sm:text-sm text-blue-400">🐋 WHALE SWINGS</span>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">— Institutional flow — multi-day positioning plays</span>
                    <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full ml-auto">
                      {whaleSignals.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {whaleSignals.map((signal, i) => (
                      <motion.div key={`w-${signal.id}-${i}`} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                        <SignalCard signal={signal} isTaken={takenSignalIds.has(signal.id)} isTaking={takingId === signal.id} onTakeTrade={handleTakeTrade} getPrice={getPrice} />
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Spreads & Butterflies Tab */}
          {viewTab === "spread" && (
            <>
              {spreadCount === 0 && !loading && (
                <div className="glass-panel rounded-xl p-8 text-center border border-violet-500/20">
                  <Target className="h-8 w-8 text-violet-400/40 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No spread or butterfly plays detected yet. These appear when multi-leg strategies (debit spreads, butterflies, iron condors) are identified from flow data.</p>
                </div>
              )}

              {spreadSignals.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-1">
                    <Target className="h-4 w-4 text-violet-400" />
                    <span className="font-bold text-xs sm:text-sm text-violet-400">SPREADS & BUTTERFLIES</span>
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">— Defined risk multi-leg strategies</span>
                    <span className="text-[10px] bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full ml-auto">
                      {spreadSignals.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {spreadSignals.map((signal, i) => (
                      <motion.div key={`s-${signal.id}-${i}`} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                        <SignalCard signal={signal} isTaken={takenSignalIds.has(signal.id)} isTaking={takingId === signal.id} onTakeTrade={handleTakeTrade} getPrice={getPrice} />
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

function SignalCard({ signal, isTaken, isTaking, onTakeTrade, getPrice }: { signal: MarketSignal; isTaken?: boolean; isTaking?: boolean; onTakeTrade?: (s: MarketSignal) => void; getPrice?: (ticker: string) => PriceInfo | null }) {
  const isCall = signal.putCall ? signal.putCall === "call" : signal.type === "bullish";
  const score = signal.convictionScore ?? Math.round(signal.confidence * 10);
  const isWhale = signal.category === "whale";
  const isSpread = signal.category === "spread";

  const isAI = signal.aiEvaluated;

  const glowClass = isAI
    ? "shadow-[0_0_20px_-3px_rgba(16,185,129,0.5)] border-emerald-400/60 ring-1 ring-emerald-400/20"
    : isWhale
    ? score >= 85
      ? "shadow-[0_0_15px_-3px_rgba(59,130,246,0.4)] border-blue-500/40"
      : "shadow-[0_0_10px_-3px_rgba(59,130,246,0.25)] border-blue-500/30"
    : isSpread
    ? score >= 85
      ? "shadow-[0_0_15px_-3px_rgba(139,92,246,0.4)] border-violet-500/40"
      : "shadow-[0_0_10px_-3px_rgba(139,92,246,0.25)] border-violet-500/30"
    : score >= 85
    ? "shadow-[0_0_15px_-3px_hsl(var(--primary)/0.4)] border-primary/40"
    : score >= 70
    ? "shadow-[0_0_10px_-3px_hsl(var(--primary)/0.25)] border-primary/30"
    : isCall
    ? "border-primary/20"
    : "border-destructive/20";

  const isWinner = signal.outcome === "hit" || signal.outcome === "partial_hit" || signal.outcome === "win";
  const isLoser = signal.outcome === "missed" || signal.outcome === "loss";
  const isExpired = signal.outcome === "expired";
  const isPending = isAI && !isWinner && !isLoser && !isExpired;

  return (
    <div className={`rounded-xl border overflow-hidden transition-shadow relative ${glowClass} ${
      isWinner ? "bg-emerald-500/8" : isLoser ? "bg-red-500/8" : isExpired ? "bg-zinc-500/8" : isWhale ? "bg-blue-500/5" : isSpread ? "bg-violet-500/5" : isCall ? "bg-primary/5" : "bg-destructive/5"
    }`}>
      {/* Price Confirmed Banner */}
      {signal.priceConfirmed && (
        <div className="px-3 sm:px-4 py-1.5 bg-emerald-500/20 border-b border-emerald-500/30 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[10px] font-bold tracking-wider text-emerald-400 uppercase">Price Action Confirmed</span>
          {signal.gammaZone && signal.gammaZone !== 'neutral' && (
            <>
              <Flame className="h-3.5 w-3.5 text-orange-400 animate-pulse" />
              <span className="text-[10px] font-bold tracking-wider text-orange-400 uppercase">ACT NOW</span>
            </>
          )}
        </div>
      )}

      <div className={`px-3 sm:px-4 py-2 flex items-center justify-between ${
        isWhale ? "bg-blue-500/15" : isSpread ? "bg-violet-500/15" : isCall ? "bg-primary/15" : "bg-destructive/15"
      }`}>
        <div className="flex items-center gap-2">
          {isWhale ? (
            <Waves className="h-3 w-3 text-blue-400" />
          ) : isSpread ? (
            <Target className="h-3 w-3 text-violet-400" />
          ) : (
            <Zap className="h-3 w-3 text-accent" />
          )}
          <span className={`text-[11px] sm:text-xs font-bold tracking-widest uppercase ${
            isWhale ? "text-blue-400" : isSpread ? "text-violet-400" : "text-accent"
          }`}>
            {isWhale ? "Whale Play" : isSpread ? "Spread Play" : "Algorithm Play"}
          </span>
          {signal.timeframe === "buy_now" || signal.timeframe === "short_term" ? (
            <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider">Day Trade</span>
          ) : signal.timeframe === "swing" ? (
            <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing Trade</span>
          ) : null}
          {signal.source === "live" ? (
            <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">Live</span>
          ) : null}
          {isAI && (
            <span className="text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/30 text-emerald-300 uppercase tracking-wider animate-pulse border border-emerald-400/30">Biddie AI Pick</span>
          )}
        </div>
        <span className="text-[9px] sm:text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {signal.timestamp}
        </span>
      </div>

      <div className="px-3 sm:px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCall ? (
              <TrendingUp className="h-4 w-4 text-primary" />
            ) : (
              <TrendingDown className="h-4 w-4 text-destructive" />
            )}
            <span className="font-bold text-sm sm:text-base text-foreground">{signal.ticker}</span>
            {(() => {
              const priceInfo = getPrice?.(signal.ticker);
              if (!priceInfo) return null;
              return (
                <span className="flex items-center gap-1 text-xs font-mono">
                  <Radio className="h-2.5 w-2.5 text-emerald-400 animate-pulse" />
                  <span className="text-foreground font-semibold">${priceInfo.price.toFixed(2)}</span>
                </span>
              );
            })()}
            <span className={`text-[9px] sm:text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
              isCall ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
            }`}>
              {signal.putCall === "call" ? "CALL" : "PUT"}
            </span>
            {(() => {
              let ts = signal.tradeStatus || "watching";
              if (ts === "watching") {
                if (signal.outcome === "hit") ts = "hit";
                else if (signal.outcome === "partial_hit") ts = "partial_hit";
                else if (isLoser) ts = "miss";
                else if (signal.outcome === "expired") ts = "expired";
              }
              const statusInfo: Record<string, { label: string; desc: string; color: string; icon: React.ReactNode }> = {
                hit: { label: "HIT", desc: "Price reached the target zone", color: "text-emerald-400 bg-emerald-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                partial_hit: { label: "PARTIAL HIT", desc: "Significant move in right direction but didn't reach full target", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                miss: { label: "MISS", desc: "Price breached invalidation level", color: "text-red-400 bg-red-400/15", icon: <XCircle className="h-3 w-3" /> },
                expired: { label: "EXPIRED", desc: "Time ran out — minimal move in either direction", color: "text-zinc-400 bg-zinc-400/15", icon: <Clock className="h-3 w-3" /> },
                active: { label: "ACTIVE", desc: "Entry level reached — trade is live", color: "text-cyan-400 bg-cyan-400/15 animate-pulse", icon: <Zap className="h-3 w-3" /> },
                watching: { label: "WATCHING", desc: "Waiting for price to reach entry level", color: "text-yellow-400 bg-yellow-400/15", icon: <Clock className="h-3 w-3" /> },
              };
              const info = statusInfo[ts] || statusInfo.watching;
              return (
                <span className="relative group">
                  <span className={`flex items-center gap-0.5 text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-help ${info.color}`}>
                    {info.icon} {info.label}
                  </span>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                    {info.desc}
                  </span>
                </span>
              );
            })()}
            {signal.mfePercent != null && (
              <span className="relative group">
                <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-full cursor-help ${
                  signal.mfePercent >= 100 ? "bg-emerald-400/15 text-emerald-400" :
                  signal.mfePercent >= 50 ? "bg-blue-400/15 text-blue-400" :
                  signal.mfePercent > 0 ? "bg-yellow-400/15 text-yellow-400" :
                  "bg-red-400/15 text-red-400"
                }`}>
                  MFE {signal.mfePercent.toFixed(0)}%
                </span>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                  {signal.mfePercent >= 100 ? "Max Favorable Excursion — price fully reached target zone" :
                   signal.mfePercent >= 50 ? "Max Favorable Excursion — price moved halfway to target" :
                   signal.mfePercent > 0 ? "Max Favorable Excursion — price moved slightly toward target" :
                   "Max Favorable Excursion — price moved against the trade"}
                  {signal.maxFavorablePrice ? ` (best: $${signal.maxFavorablePrice.toFixed(2)})` : ""}
                </span>
              </span>
            )}
          </div>
          <ConvictionScoreRing score={score} label={signal.convictionLabel ?? ""} />
        </div>

        <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
          {(() => {
            const desc = signal.description || "";
            const priceMatch = desc.match(/Price at \$[\d,.]+/);
            if (!priceMatch) return desc;
            const idx = desc.indexOf(priceMatch[0]);
            return (
              <>
                {desc.slice(0, idx)}
                <span className="font-bold text-amber-400">{priceMatch[0]}</span>
                {desc.slice(idx + priceMatch[0].length)}
              </>
            );
          })()}
        </p>

        <div className="relative grid grid-cols-1 gap-1.5 text-[11px] sm:text-xs">
          {signal.suggestedTrade && (
            <div className="flex items-start gap-2 bg-muted/30 rounded-lg px-2.5 py-1.5">
              <Target className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Trade: </span>
                <span className="text-foreground font-semibold">{signal.suggestedTrade}</span>
              </div>
            </div>
          )}
          {signal.entryTrigger && (
            <div className="flex items-start gap-2 bg-muted/30 rounded-lg px-2.5 py-1.5">
              <TrendingUp className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Entry: </span>
                <span className="text-foreground font-semibold">{signal.entryTrigger}</span>
              </div>
            </div>
          )}
          {signal.targetZone && (
            <div className="flex items-start gap-2 bg-primary/10 rounded-lg px-2.5 py-1.5">
              <MapPin className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0 flex items-center gap-1.5">
                <span className="text-muted-foreground">Target: </span>
                {(() => {
                  const tn = signal.targetNear;
                  const tz = signal.targetZone;
                  if (!tn || tn === tz) return <span className="text-primary font-semibold">{tz}</span>;
                  const first = tz;
                  const second = tn;
                  const firstLabel = "Strike target";
                  const secondLabel = "Extended target";
                  return (
                    <>
                      <span className="text-primary font-semibold">{first} – {second}</span>
                      <span className="relative group">
                        <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-primary/20 text-primary text-[8px] font-bold cursor-help">i</span>
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                          {first}: {firstLabel} · {second}: {secondLabel}
                        </span>
                      </span>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
          {signal.invalidation && (
            <div className="flex items-start gap-2 bg-destructive/10 rounded-lg px-2.5 py-1.5">
              <ShieldX className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Invalidation: </span>
                <span className="text-destructive font-semibold">{signal.invalidation}</span>
              </div>
            </div>
          )}
          {signal.keyLevel && (
            <div className="flex items-start gap-2 bg-primary/10 rounded-lg px-2.5 py-1.5">
              <Crosshair className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Key level: </span>
                <span className="text-primary font-semibold">{signal.keyLevel}</span>
              </div>
            </div>
          )}
          {(signal.srLevel || signal.gammaLevelLabel) && (
            <div className="flex items-start gap-2 bg-accent/10 rounded-lg px-2.5 py-1.5">
              <Gauge className="h-3 w-3 text-accent mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">S/R: </span>
                <span className="text-accent font-semibold">{signal.srLevel || signal.gammaLevelLabel}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {signal.tags.filter((tag) => {
            const upper = tag.toUpperCase();
            if (upper.includes('ACT NOW') && !(signal.priceConfirmed && signal.gammaZone && signal.gammaZone !== 'neutral')) return false;
            return true;
          }).map((tag) => {
            const tagUpper = tag.toUpperCase();
            const isUrgent = tagUpper.includes('ACT NOW') || tagUpper.includes('HIGH CONVICTION');
            const isPriceConfirmed = tagUpper.includes('PRICE CONFIRMED');
            const isGamma = tagUpper.includes('GAMMA');
            const isWhaleTag = tagUpper.includes('WHALE');
            let tagStyle = "bg-muted/50 text-muted-foreground";
            if (isPriceConfirmed) tagStyle = "bg-emerald-500/20 text-emerald-400 animate-pulse";
            else if (isWhaleTag) tagStyle = "bg-blue-500/20 text-blue-400";
            else if (isUrgent) tagStyle = "bg-destructive/20 text-destructive animate-pulse";
            else if (isGamma) tagStyle = "bg-orange-500/20 text-orange-400";
            return (
              <span
                key={tag}
                className={`text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  tagStyle
                }`}
              >
                {tag}
              </span>
            );
          })}
          {signal.expiry && (
            <span className="text-[9px] sm:text-[10px] bg-muted/40 text-muted-foreground px-2 py-0.5 rounded-full font-medium">
              Exp: {signal.expiry}
            </span>
          )}
        </div>

        {onTakeTrade && (
          <div className="pt-2 mt-2 border-t border-white/5">
            <button
              onClick={() => onTakeTrade(signal)}
              disabled={isTaking}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                isTaken
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30"
                  : "bg-white/5 text-muted-foreground border border-white/10 hover:bg-primary/10 hover:text-primary hover:border-primary/30"
              } disabled:opacity-50`}
            >
              {isTaking ? (
                <span className="animate-pulse">...</span>
              ) : isTaken ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Trade Taken</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  <span>I Took This Trade</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardSignals;
