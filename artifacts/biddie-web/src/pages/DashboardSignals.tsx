import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useMarketData, type MarketSignal, type SignalTimeframe } from "@/hooks/useMarketData";
import { Search, Filter, TrendingUp, TrendingDown, Zap, Clock, Target, ShieldX, Crosshair, MapPin, Gauge, Waves, CheckCircle2, Flame } from "lucide-react";
import { Input } from "@/components/ui/input";
import ConvictionScoreRing from "@/components/dashboard/ConvictionScoreRing";

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
  
  // Derive conviction score from confidence (1-10 scale → approximate 0-100)
  let convictionScore = Math.round(confidence * 10);
  if (confidence >= 9) convictionScore = Math.max(convictionScore, 85);
  else if (confidence >= 8) convictionScore = Math.max(convictionScore, 75);
  else if (confidence >= 7) convictionScore = Math.max(convictionScore, 65);

  let convictionLabel = "Low Conviction";
  if (convictionScore >= 90) convictionLabel = "Extreme Conviction";
  else if (convictionScore >= 75) convictionLabel = "Very High Conviction";
  else if (convictionScore >= 60) convictionLabel = "High Conviction";
  else if (convictionScore >= 40) convictionLabel = "Moderate Conviction";

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
    description: record.description || record.reason || `${putCall || ''} flow on ${record.ticker} at ${record.strike || 'N/A'} strike.`,
    timestamp,
    tags,
    strike: record.strike || undefined,
    expiry: record.expiry || undefined,
    premium: record.premium || undefined,
    putCall: putCall as 'call' | 'put' | undefined,
    suggestedTrade: `Buy ${record.ticker} ${record.strike || ''} ${putCall === 'call' ? 'Calls' : 'Puts'}${record.expiry ? ` exp ${record.expiry}` : ''}`,
    targetZone: record.target_zone || record.target || undefined,
    createdAt,
    source: 'live',
    timeframe: classifyTimeframeFromRecord(record),
    category: record.category,
    reason: record.reason,
    entryTrigger: record.entry_trigger,
    invalidation: record.invalidation,
  };
}

function formatTimestamp(isoStr: string): string {
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return 'Today';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return time;
  const day = date.toLocaleDateString('en-US', { weekday: 'short' });
  return `${day} ${time}`;
}

const DashboardSignals = () => {
  const { signals: liveSignals, signalHistory, loading: liveLoading } = useMarketData();
  const [dbSignals, setDbSignals] = useState<MarketSignal[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");

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
    const signalMap = new Map<string, MarketSignal>();

    for (const s of (signalHistory || [])) {
      const key = `${s.ticker}|${s.strike}|${s.expiry}`;
      signalMap.set(key, s);
    }

    for (const s of dbSignals) {
      const key = `${s.ticker}|${s.strike}|${s.expiry}`;
      signalMap.set(key, s);
    }

    for (const s of liveSignals) {
      const key = `${s.ticker}|${s.strike}|${s.expiry}`;
      signalMap.set(key, s);
    }

    const all = Array.from(signalMap.values());
    const hasLive = all.some(s => s.source === 'live');
    return hasLive ? all.filter(s => s.source !== 'example') : all;
  }, [liveSignals, dbSignals, signalHistory]);

  const loading = liveLoading && dbLoading;
  const signals = allSignals;

  const [viewTab, setViewTab] = useState<ViewTab>("algorithm");

  const filtered = useMemo(() => {
    let list = [...signals];

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
  }, [signals, search, filterType]);

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
  const totalCount = signals.filter(s => s.source !== 'example').length;

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">Live Signals</h1>
            <p className="text-xs text-muted-foreground">
              Today's signal log — {totalCount} signals recorded
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
            </div>
          </div>

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
                        <motion.div key={signal.id} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                          <SignalCard signal={signal} />
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
                      <motion.div key={signal.id} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                        <SignalCard signal={signal} />
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
                      <motion.div key={signal.id} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                        <SignalCard signal={signal} />
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

function SignalCard({ signal }: { signal: MarketSignal }) {
  const isCall = signal.putCall === "call" || signal.type === "bullish";
  const score = signal.convictionScore ?? Math.round(signal.confidence * 10);
  const isWhale = signal.category === "whale";
  const isSpread = signal.category === "spread";

  const glowClass = isWhale
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

  return (
    <div className={`rounded-xl border overflow-hidden transition-shadow ${glowClass} ${
      isWhale ? "bg-blue-500/5" : isSpread ? "bg-violet-500/5" : isCall ? "bg-primary/5" : "bg-destructive/5"
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
          <span className={`text-[9px] sm:text-[10px] font-bold tracking-widest uppercase ${
            isWhale ? "text-blue-400" : isSpread ? "text-violet-400" : "text-accent"
          }`}>
            {isWhale ? "Whale Play" : isSpread ? "Spread Play" : "Algorithm Play"}
          </span>
          {signal.timeframe === "buy_now" || signal.timeframe === "short_term" ? (
            <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider">Day Trade</span>
          ) : signal.timeframe === "swing" ? (
            <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing Trade</span>
          ) : null}
          {signal.source === "live" ? (
            <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">Live</span>
          ) : signal.source === "example" ? (
            <span className="text-[8px] sm:text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground uppercase tracking-wider">Example</span>
          ) : null}
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
            <span className={`text-[9px] sm:text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
              isCall ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
            }`}>
              {signal.putCall === "call" ? "CALL" : "PUT"}
            </span>
            {signal.premium && (
              <span className="text-[10px] sm:text-xs text-accent font-semibold">{signal.premium}</span>
            )}
          </div>
          <ConvictionScoreRing score={score} label={signal.convictionLabel ?? ""} />
        </div>

        <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
          {signal.description}
        </p>

        <div className="grid grid-cols-1 gap-1.5 text-[11px] sm:text-xs">
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
          {signal.pricePattern && (
            <div className="flex items-start gap-2 bg-emerald-500/10 rounded-lg px-2.5 py-1.5">
              <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Price pattern: </span>
                <span className="text-emerald-400 font-semibold">{signal.pricePattern}</span>
              </div>
            </div>
          )}
          {signal.spreadDetails && (
            <div className="flex items-start gap-2 bg-violet-500/10 rounded-lg px-2.5 py-1.5">
              <Target className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Strategy: </span>
                <span className="text-violet-400 font-semibold">{signal.spreadDetails.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                {signal.spreadDetails.legs && (
                  <span className="text-muted-foreground text-[10px] block mt-0.5">{signal.spreadDetails.legs}</span>
                )}
                {(signal.spreadDetails.max_profit || signal.spreadDetails.max_loss) && (
                  <span className="text-[10px] text-muted-foreground block mt-0.5">
                    {signal.spreadDetails.max_profit != null && `Max Profit: $${signal.spreadDetails.max_profit}`}
                    {signal.spreadDetails.max_profit != null && signal.spreadDetails.max_loss != null && ' | '}
                    {signal.spreadDetails.max_loss != null && `Max Loss: $${signal.spreadDetails.max_loss}`}
                  </span>
                )}
              </div>
            </div>
          )}
          {signal.gammaZone && signal.gammaZone !== 'neutral' && (
            <div className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 ${
              signal.gammaZone === 'negative' ? 'bg-orange-500/10' : 'bg-blue-500/10'
            }`}>
              <Gauge className={`h-3 w-3 mt-0.5 shrink-0 ${
                signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
              }`} />
              <div className="min-w-0">
                <span className="text-muted-foreground">Gamma: </span>
                <span className={`font-semibold ${
                  signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                }`}>{signal.gammaDescription}</span>
              </div>
            </div>
          )}
          {signal.targetZone && (
            <div className="flex items-start gap-2 bg-primary/10 rounded-lg px-2.5 py-1.5">
              <MapPin className="h-3 w-3 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">Target: </span>
                <span className="text-primary font-semibold">{signal.targetZone}</span>
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
          {signal.gammaLevelLabel && (!signal.gammaZone || signal.gammaZone === 'neutral') && (
            <div className="flex items-start gap-2 bg-accent/10 rounded-lg px-2.5 py-1.5">
              <Gauge className="h-3 w-3 text-accent mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-muted-foreground">S/R: </span>
                <span className="text-accent font-semibold">{signal.gammaLevelLabel}</span>
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
      </div>
    </div>
  );
}

export default DashboardSignals;
