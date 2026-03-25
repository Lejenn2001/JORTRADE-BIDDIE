import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useMarketData, type MarketSignal, type SignalTimeframe, computeWhaleConviction } from "@/hooks/useMarketData";
import { supabase } from "@/integrations/supabase/client";
import { Search, Filter, TrendingUp, TrendingDown, Zap, Clock, CalendarDays, Target, ShieldX, Crosshair, MapPin, Gauge } from "lucide-react";
import { Input } from "@/components/ui/input";
import SignalLegend from "@/components/dashboard/SignalLegend";
import ConvictionScoreRing from "@/components/dashboard/ConvictionScoreRing";

type FilterType = "all" | "call" | "put";

const SECTION_META: Record<SignalTimeframe, { label: string; icon: React.ReactNode; description: string }> = {
  buy_now: {
    label: "🔥 BUY NOW",
    icon: <Zap className="h-4 w-4" />,
    description: "Highest conviction — act immediately",
  },
  short_term: {
    label: "⚡ 1–3 DAY TRADE",
    icon: <Clock className="h-4 w-4" />,
    description: "Strong setups with short-term expiry",
  },
  swing: {
    label: "📈 SWING",
    icon: <CalendarDays className="h-4 w-4" />,
    description: "Longer-dated positioning plays",
  },
};

const SECTION_ORDER: SignalTimeframe[] = ["buy_now", "short_term", "swing"];

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

  const tags: string[] = [];
  if (record.put_call) tags.push(record.put_call === 'call' ? 'Call Flow' : 'Put Flow');
  if (convictionScore >= 85) tags.push('🔥 ACT NOW');
  else if (convictionScore >= 70) tags.push('⚡ HIGH CONVICTION');

  const createdAt = record.created_at || '';
  const timestamp = createdAt ? formatTimestamp(createdAt) : 'Today';

  return {
    id: record.id,
    ticker: record.ticker,
    type: isBullish ? 'bullish' : 'bearish',
    confidence,
    convictionScore,
    convictionLabel,
    description: record.description || `${record.put_call || ''} flow on ${record.ticker} at ${record.strike || 'N/A'} strike.`,
    timestamp,
    tags,
    strike: record.strike || undefined,
    expiry: record.expiry || undefined,
    premium: record.premium || undefined,
    putCall: record.put_call as 'call' | 'put' | undefined,
    suggestedTrade: `Buy ${record.ticker} ${record.strike || ''} ${record.put_call === 'call' ? 'Calls' : 'Puts'}${record.expiry ? ` exp ${record.expiry}` : ''}`,
    targetZone: record.target_zone || undefined,
    createdAt,
    source: 'live',
    timeframe: classifyTimeframeFromRecord(record),
  };
}

function formatTimestamp(isoStr: string): string {
  const date = new Date(isoStr);
  if (isNaN(date.getTime())) return 'Today';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 12) return `${diffHrs}h ago`;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

const DashboardSignals = () => {
  const { signals: liveSignals, loading: liveLoading } = useMarketData();
  const [dbSignals, setDbSignals] = useState<MarketSignal[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");

  // Load today's signals from signal_outcomes table
  useEffect(() => {
    const loadTodaySignals = async () => {
      setDbLoading(true);
      try {
        // Get start of today in UTC
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        todayStart.setHours(todayStart.getHours() - 4); // EST offset — capture full trading day

        const { data, error } = await supabase
          .from("signal_outcomes")
          .select("*")
          .eq("signal_source", "replit")
          .gte("created_at", todayStart.toISOString())
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (data && data.length > 0) {
          const mapped = data.map(dbRecordToSignal);
          setDbSignals(mapped);
        }
      } catch (e) {
        console.warn('Failed to load today signals from DB:', e);
      } finally {
        setDbLoading(false);
      }
    };

    loadTodaySignals();
  }, []);

  // Merge: live signals take priority (fresher data), then fill in from DB records
  const allSignals = useMemo(() => {
    const signalMap = new Map<string, MarketSignal>();

    // DB signals first (background)
    for (const s of dbSignals) {
      const key = `${s.ticker}|${s.strike}|${s.expiry}`;
      signalMap.set(key, s);
    }

    // Live signals override DB (they have richer data like entry triggers, key levels)
    for (const s of liveSignals) {
      if (s.source === 'example') continue; // skip Friday examples
      const key = `${s.ticker}|${s.strike}|${s.expiry}`;
      signalMap.set(key, s);
    }

    return Array.from(signalMap.values());
  }, [liveSignals, dbSignals]);

  const loading = liveLoading && dbLoading;
  const signals = allSignals;

  const grouped = useMemo(() => {
    let list = [...signals];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.ticker.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    if (filterType !== "all") {
      list = list.filter((s) => s.putCall === filterType);
    }

    list.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    const groups: Record<SignalTimeframe, MarketSignal[]> = {
      buy_now: [],
      short_term: [],
      swing: [],
    };

    for (const s of list) {
      const tf = s.timeframe || "swing";
      groups[tf].push(s);
    }

    return groups;
  }, [signals, search, filterType]);

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

          <SignalLegend />

          {loading && signals.length === 0 && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 rounded-xl bg-muted/20 animate-pulse h-40" />
              ))}
            </div>
          )}

          {!loading && signals.length === 0 && (
            <div className="glass-panel rounded-xl p-8 text-center">
              <p className="text-muted-foreground text-sm">No signals recorded yet today. Signals will appear here as they come in during market hours.</p>
            </div>
          )}

          {/* Sections */}
          {SECTION_ORDER.map((timeframe) => {
            const meta = SECTION_META[timeframe];
            const sectionSignals = grouped[timeframe];
            if (sectionSignals.length === 0) return null;

            return (
              <div key={timeframe} className="space-y-3">
                {/* Section label */}
                <div className="flex items-center gap-2 px-1">
                  {meta.icon}
                  <span className="font-bold text-xs sm:text-sm text-foreground">{meta.label}</span>
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">— {meta.description}</span>
                  <span className="text-[10px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded-full ml-auto">
                    {sectionSignals.length}
                  </span>
                </div>

                {/* Signal cards */}
                <div className="space-y-3">
                  {sectionSignals.map((signal, i) => (
                    <motion.div
                      key={signal.id}
                      custom={i}
                      initial="hidden"
                      animate="visible"
                      variants={cardVariants}
                    >
                      <SignalCard signal={signal} />
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </main>
      </div>
    </div>
  );
};

function SignalCard({ signal }: { signal: MarketSignal }) {
  const isCall = signal.putCall === "call" || signal.type === "bullish";
  const score = signal.convictionScore ?? Math.round(signal.confidence * 10);

  const glowClass = score >= 85
    ? "shadow-[0_0_15px_-3px_hsl(var(--primary)/0.4)] border-primary/40"
    : score >= 70
    ? "shadow-[0_0_10px_-3px_hsl(var(--primary)/0.25)] border-primary/30"
    : isCall
    ? "border-primary/20"
    : "border-destructive/20";

  return (
    <div className={`rounded-xl border overflow-hidden transition-shadow ${glowClass} ${
      isCall ? "bg-primary/5" : "bg-destructive/5"
    }`}>
      <div className={`px-3 sm:px-4 py-2 flex items-center justify-between ${
        isCall ? "bg-primary/15" : "bg-destructive/15"
      }`}>
        <div className="flex items-center gap-2">
          <Zap className="h-3 w-3 text-accent" />
          <span className="text-[9px] sm:text-[10px] font-bold tracking-widest text-accent uppercase">
            JORTRADE Alert
          </span>
          <span className="text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">Live</span>
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
          {signal.gammaLevelLabel && (
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
          {signal.tags.map((tag) => {
            const isUrgent = tag.includes('ACT NOW') || tag.includes('HIGH CONVICTION');
            return (
              <span
                key={tag}
                className={`text-[9px] sm:text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  isUrgent
                    ? "bg-destructive/20 text-destructive animate-pulse"
                    : "bg-muted/50 text-muted-foreground"
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
