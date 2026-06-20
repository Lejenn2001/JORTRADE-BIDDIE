import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useMarketData, type MarketSignal, type SignalTimeframe } from "@/hooks/useMarketData";
import { useRealtimePrices, type PriceInfo } from "@/hooks/useRealtimePrices";
import { useAuth } from "@/hooks/useAuth";
import { Search, Filter, TrendingUp, TrendingDown, Zap, Clock, Target, ShieldX, Crosshair, MapPin, Gauge, Waves, CheckCircle2, Flame, Check, Plus, XCircle, Radio, Bell, AlertTriangle, ThumbsUp, ThumbsDown, MessageSquare, Send, Sparkles, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import ConvictionScoreRing from "@/components/dashboard/ConvictionScoreRing";
import SignalLegend from "@/components/dashboard/SignalLegend";
import SignalErrorBoundary from "@/components/dashboard/SignalErrorBoundary";
import { compactDescription, simplifySignalDescription } from "@/lib/simplifyDescription";

type FilterType = "all" | "call" | "put";
type ViewTab = "algorithm" | "whale" | "spread";

const ordinalSuffix = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const formatExpiryShort = (e?: string) => {
  if (!e) return "";
  const d = new Date(e);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  }
  return e;
};

const formatPremium = (raw?: string) => {
  if (!raw) return "";
  const s = String(raw).trim();
  if (/[KMB]\s*$/i.test(s.replace(/premium/gi, "").trim())) {
    return s.startsWith("$") ? s : `$${s}`;
  }
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return s.startsWith("$") ? s : `$${s}`;
  const abbr =
    n >= 1e9 ? `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B` :
    n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M` :
    n >= 1e3 ? `${Math.round(n / 1e3)}K` :
    `${n}`;
  return `$${abbr}`;
};

const ALGO_SECTION_META = {
  buy_now: {
    label: "🔥 ACTIVE",
    iconComponent: Zap,
    iconClass: "h-4 w-4 text-emerald-400",
    description: "Price action confirmed — moving now",
  },
  short_term: {
    label: "⚡ 1–3 DAY FLOW",
    iconComponent: Clock,
    iconClass: "h-4 w-4 text-emerald-400",
    description: "Algorithm-detected setups with short-term expiry",
  },
} as const;


const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, delay: i * 0.1, ease: "easeOut" as const },
  }),
};

function classifyTimeframeFromRecord(record: any): SignalTimeframe {
  if (record.expiry) {
    const expDate = new Date(record.expiry);
    if (!isNaN(expDate.getTime())) {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const expStr = expDate.toISOString().split("T")[0];
      if (expStr === todayStr) return "buy_now";
      const dte = Math.max(0, Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      if (dte <= 7) return "short_term";
      return "swing";
    }
  }
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
  if (Array.isArray(record.tags)) {
    for (const t of record.tags) {
      if (!tags.includes(t)) tags.push(t);
    }
  }

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
      : `${record.ticker} $${record.strike || ''} ${putCall === 'call' ? 'Calls' : 'Puts'}${record.expiry ? ` (${record.expiry})` : ''}`,
    targetZone: record.target_zone || record.target || undefined,
    createdAt,
    source: 'live',
    timeframe: classifyTimeframeFromRecord(record),
    category: record.category,
    reason: record.reason,
    executionVerdict: record.executionVerdict,
    aiEvaluated: !!record.is_biddie_pick,
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
    reviewStatus: record.review_status || null,
    reviewNote: record.review_note || null,
    gammaZone: record.gamma_zone || undefined,
    gammaDescription: record.gamma_description || undefined,
    reinforcementCount: record.reinforcement_count != null ? Number(record.reinforcement_count) : 1,
    lastReinforcedAt: record.last_reinforced_at || null,
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

function extractFirstPrice(text: unknown): number | null {
  if (text == null) return null;
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  const s = String(text);
  const m = s.match(/\$\s*(\d+(?:\.\d+)?)/) || s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

const DashboardSignals = () => {
  const { signals: liveSignals, loading: liveLoading } = useMarketData();
  const { getPrice, connected: wsConnected, marketOpen } = useRealtimePrices();
  const { user, isAdmin } = useAuth();
  const [dbSignals, setDbSignals] = useState<MarketSignal[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [showResolved, setShowResolved] = useState(searchParams.get("resolved") === "true");
  const [, setResolvedTick] = useState(0);
  const [alertSignal, setAlertSignal] = useState<MarketSignal | null>(null);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">("above");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertTickers, setAlertTickers] = useState<Set<string>>(new Set());
  const [viewTab, setViewTab] = useState<ViewTab>("algorithm");
  const [calendarStats, setCalendarStats] = useState<{ total: number; wins: number; losses: number; pending: number; expired: number; winRate: number; wrongCount: number } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/alerts?userId=${user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.alerts) {
          setAlertTickers(new Set(data.alerts.filter((a: any) => a.active).map((a: any) => a.ticker)));
        }
      })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/whale/signals/calendar?limit=1000")
      .then(r => r.json())
      .then(data => {
        if (!data.signals) return;
        const sigs = data.signals as any[];
        const core = sigs.filter((s: any) => s.review_status !== "wrong");
        const wrongCount = sigs.length - core.length;
        const resolved = core.filter((s: any) => s.outcome === "hit" || s.outcome === "partial_hit" || s.outcome === "missed" || s.outcome === "near_miss");
        const wins = resolved.filter((s: any) => s.outcome === "hit" || s.outcome === "partial_hit").length;
        const losses = resolved.length - wins;
        const expired = core.filter((s: any) => s.outcome === "expired").length;
        const pending = core.filter((s: any) => !s.outcome || s.outcome === "pending").length;
        const winRate = resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : 0;
        setCalendarStats({ total: core.length, wins, losses, pending, expired, winRate, wrongCount });
      })
      .catch(() => {});
  }, [isAdmin]);

  const handleOpenAlert = useCallback((signal: MarketSignal) => {
    const livePrice = getPrice?.(signal.ticker);
    const entryText = signal.entryTrigger || "";
    const priceMatch = entryText.match(/\$[\d,.]+/);
    const defaultPrice = priceMatch
      ? priceMatch[0].replace(/[$,]/g, "")
      : livePrice?.price?.toFixed(2) || signal.priceAtSignal?.toFixed(2) || "";
    setAlertPrice(defaultPrice);
    const isCall = signal.putCall ? signal.putCall === "call" : signal.type === "bullish";
    setAlertCondition(isCall ? "above" : "below");
    setAlertSignal(signal);
  }, [getPrice]);

  const handleSaveAlert = useCallback(async () => {
    if (!user?.id || !alertSignal || !alertPrice) return;
    setAlertSaving(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          ticker: alertSignal.ticker,
          targetPrice: parseFloat(alertPrice),
          condition: alertCondition,
          signalId: alertSignal.id,
          label: alertSignal.entryTrigger || `${alertSignal.putCall?.toUpperCase()} signal`,
        }),
      });
      if (res.ok) {
        toast({ title: `🔔 Alert set for ${alertSignal.ticker}`, description: `${alertCondition === "above" ? "Above" : "Below"} $${parseFloat(alertPrice).toFixed(2)}` });
        setAlertTickers(prev => new Set(prev).add(alertSignal.ticker));
        setAlertSignal(null);
        window.dispatchEvent(new CustomEvent("open-alerts-panel"));
      }
    } catch {
      toast({ title: "Failed to set alert", variant: "destructive" });
    } finally {
      setAlertSaving(false);
    }
  }, [user?.id, alertSignal, alertPrice, alertCondition, toast]);

  useEffect(() => {
    const loadRecentSignals = async () => {
      setDbLoading(true);
      try {
        const now = new Date();
        const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        todayET.setHours(0, 0, 0, 0);
        const todayStart = new Date(todayET.toISOString().split('T')[0] + 'T04:00:00Z');

        const resp = await fetch('/api/whale/signals/history?limit=300');
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
    const normStrike = (strike?: string) => {
      if (!strike) return '';
      return String(strike).replace(/[$,]/g, '').replace(/\.00$/, '').trim();
    };
    const dbKeys = new Set(dbSignals.map(s => `${s.ticker}|${normStrike(s.strike)}|${s.putCall}|${s.expiry}`));
    const filteredLive = liveSignals.filter(s => {
      const key = `${s.ticker}|${normStrike(s.strike)}|${s.putCall}|${s.expiry}`;
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
  const signals = useMemo(() => {
    if (isAdmin) return allSignals;
    return allSignals.filter(s => s.reviewStatus !== "wrong");
  }, [allSignals, isAdmin]);

  useEffect(() => {
    if (showResolved) return;
    const hasRecentlyResolved = signals.some(s => {
      if (!s.outcome || s.outcome === "pending" || !s.resolvedAt) return false;
      return Date.now() - new Date(s.resolvedAt).getTime() < 300_000;
    });
    if (!hasRecentlyResolved) return;
    const interval = setInterval(() => setResolvedTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, [signals, showResolved]);

  const handleReviewChange = useCallback((signalId: string, status: "correct" | "wrong" | null) => {
    setDbSignals(prev => prev.map(s => s.id === signalId ? { ...s, reviewStatus: status } : s));
  }, []);

  useEffect(() => {
    const highlightId = searchParams.get("highlight");
    if (!highlightId || signals.length === 0) return;

    const target = signals.find((s: any) => s.id === highlightId);
    if (target) {
      const cat = (target as any).category || "algorithm";
      const ticker = (target as any).ticker || "";
      if (cat === "whale") setViewTab("whale");
      else if (cat === "spread") setViewTab("spread");
      else setViewTab("algorithm");
    }

    const timer = setTimeout(() => {
      const el = document.getElementById(`signal-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary/50", "rounded-xl");
        setTimeout(() => el.classList.remove("ring-2", "ring-primary/50", "rounded-xl"), 3000);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [searchParams, signals]);

  const filtered = useMemo(() => {
    let list = [...signals];

    if (showResolved) {
      list = list.filter((s) => {
        const o = s.outcome;
        if (o && o !== "pending") return true;
        const isExpired = s.expiry ? new Date(s.expiry) < new Date() : false;
        return isExpired;
      });
    } else {
      list = list.filter((s) => {
        const o = s.outcome;
        if (o && o !== "pending") return false;
        const isExpired = s.expiry ? new Date(s.expiry) < new Date() : false;
        return !isExpired;
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
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
            <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 800 200" preserveAspectRatio="none">
              {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
                const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45];
                const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85];
                const green = i % 3 !== 0;
                return (
                  <g key={i}>
                    <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#34d399" : "#06b6d4"} strokeWidth="1" />
                    <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#34d399" : "#06b6d4"} rx="1" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/15 via-transparent to-cyan-900/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

            <div className="relative px-6 py-7 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-500" />
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                      DECISION ENGINE
                    </h1>
                    {wsConnected && (
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        <Radio className="h-2.5 w-2.5 animate-pulse" />
                        Real-Time
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-400/80 font-semibold mt-0.5">
                    Filtered · Scored · Actionable
                  </p>
                </div>
              </div>
            </div>
          </div>


          {/* Tab Switcher */}
          <div className="flex items-center gap-2">
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
            <span className="ml-auto text-xs text-muted-foreground font-semibold">
              Total: <span className="text-foreground">{totalCount}</span>
            </span>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search ticker (SPY, TSLA, QQQ...)"
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
              className="pl-9 pr-9 h-10 bg-muted/30 border-border/40 text-sm font-semibold tracking-wider placeholder:text-muted-foreground/50 placeholder:font-normal placeholder:tracking-normal focus-visible:ring-emerald-500/40"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="glass-panel rounded-xl p-3 flex flex-col sm:flex-row gap-2">
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
                      <meta.iconComponent className={meta.iconClass} />
                      <span className="font-bold text-xs sm:text-sm text-emerald-400">{meta.label}</span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full ml-auto">
                        {sectionSignals.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {sectionSignals.map((signal, i) => (
                        <motion.div key={`${signal.id}-${i}`} id={`signal-${signal.id}`} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                          <SignalErrorBoundary>
                            <SignalCard signal={signal} getPrice={getPrice} onSetAlert={handleOpenAlert} hasAlert={alertTickers.has(signal.ticker)} isAdmin={isAdmin} userId={user?.id} onReviewChange={handleReviewChange} />
                          </SignalErrorBoundary>
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
                    <span className="font-bold text-xs sm:text-sm text-blue-400">🐋 WHALE PLAYS</span>
                    <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full ml-auto">
                      {whaleSignals.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {whaleSignals.map((signal, i) => (
                      <motion.div key={`w-${signal.id}-${i}`} id={`signal-${signal.id}`} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                        <SignalErrorBoundary>
                          <SignalCard signal={signal} getPrice={getPrice} onSetAlert={handleOpenAlert} hasAlert={alertTickers.has(signal.ticker)} isAdmin={isAdmin} userId={user?.id} onReviewChange={handleReviewChange} />
                        </SignalErrorBoundary>
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
                      <motion.div key={`s-${signal.id}-${i}`} id={`signal-${signal.id}`} custom={i} initial="hidden" animate="visible" variants={cardVariants}>
                        <SignalErrorBoundary>
                          <SignalCard signal={signal} getPrice={getPrice} onSetAlert={handleOpenAlert} hasAlert={alertTickers.has(signal.ticker)} isAdmin={isAdmin} userId={user?.id} onReviewChange={handleReviewChange} />
                        </SignalErrorBoundary>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

        </main>

        <AnimatePresence>
          {alertSignal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
              onClick={() => setAlertSignal(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-panel rounded-xl border border-border/50 shadow-2xl w-full max-w-sm p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-amber-400" />
                    <h3 className="text-sm font-bold text-foreground">Set Price Alert</h3>
                  </div>
                  <button onClick={() => setAlertSignal(null)} className="p-1 hover:bg-muted/50 rounded">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{alertSignal.ticker}</span>
                    <span className={`inline-flex items-center h-5 text-[10px] font-bold uppercase px-2 rounded-full ${
                      alertSignal.putCall === "call" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
                    }`}>
                      {alertSignal.putCall === "call" ? "CALL" : "PUT"}
                    </span>
                    {(() => {
                      const lp = getPrice?.(alertSignal.ticker);
                      return lp ? <span className="text-xs text-muted-foreground">Current: ${lp.price.toFixed(2)}</span> : null;
                    })()}
                  </div>

                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Alert when price goes</label>
                    <div className="flex gap-1.5 mt-1">
                      <button
                        onClick={() => setAlertCondition("above")}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          alertCondition === "above" ? "bg-primary/20 text-primary border border-primary/30" : "bg-muted/30 text-muted-foreground border border-border/30"
                        }`}
                      >
                        ↗ Above
                      </button>
                      <button
                        onClick={() => setAlertCondition("below")}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          alertCondition === "below" ? "bg-destructive/20 text-destructive border border-destructive/30" : "bg-muted/30 text-muted-foreground border border-border/30"
                        }`}
                      >
                        ↘ Below
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Target Price</label>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={alertPrice}
                        onChange={(e) => setAlertPrice(e.target.value)}
                        className="bg-muted/30 border-border/30 text-sm h-9"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSaveAlert}
                  disabled={alertSaving || !alertPrice}
                  className="w-full py-2.5 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                >
                  {alertSaving ? "Setting..." : `Set Alert — ${alertCondition === "above" ? "Above" : "Below"} $${alertPrice || "0.00"}`}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

function AdminReviewPanel({ signalId, userId, onReviewChange, signalMeta }: { signalId: string; userId: string; onReviewChange?: (status: "correct" | "wrong" | null) => void; signalMeta?: any }) {
  const [status, setStatus] = useState<"correct" | "wrong" | "pending" | null>(null);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/whale/admin/signal-reviews", { headers: { "x-user-id": userId } })
      .then(r => r.json())
      .then(data => {
        if (data.reviews && data.reviews[signalId]) {
          setStatus(data.reviews[signalId].status as any);
          setSavedNote(data.reviews[signalId].note || "");
          setNote(data.reviews[signalId].note || "");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [signalId, userId]);

  const save = async (newStatus: "correct" | "wrong" | "pending") => {
    setSaving(true);
    try {
      await fetch("/api/whale/admin/signal-review", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ signalId, status: newStatus, note: note || undefined, signalMeta: signalMeta || undefined }),
      });
      const resolved = newStatus === "pending" ? null : newStatus;
      setStatus(resolved);
      setSavedNote(note);
      onReviewChange?.(resolved as any);
    } catch {}
    setSaving(false);
  };

  if (!loaded) return null;

  return (
    <div className="pt-2 mt-2 border-t border-white/10">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-medium">Review:</span>
        <button
          onClick={() => save(status === "correct" ? "pending" : "correct")}
          disabled={saving}
          className={`p-1 rounded transition-colors ${status === "correct" ? "bg-emerald-500/20 text-emerald-400" : "text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10"}`}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => save(status === "wrong" ? "pending" : "wrong")}
          disabled={saving}
          className={`p-1 rounded transition-colors ${status === "wrong" ? "bg-red-500/20 text-red-400" : "text-muted-foreground hover:text-red-400 hover:bg-red-500/10"}`}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setShowNote(!showNote)}
          className={`p-1 rounded transition-colors ${showNote || savedNote ? "bg-blue-500/20 text-blue-400" : "text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10"}`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
        {status && (
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${status === "correct" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
            {status}
          </span>
        )}
        {saving && <span className="text-[9px] text-muted-foreground animate-pulse">saving...</span>}
      </div>
      {showNote && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note..."
            className="flex-1 text-[11px] bg-muted/30 border border-white/10 rounded-md px-2 py-1 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/40"
            onKeyDown={(e) => { if (e.key === "Enter" && status) save(status); }}
          />
          <button
            onClick={() => { if (status) save(status); else save("correct"); }}
            disabled={saving}
            className="p-1 rounded text-primary hover:bg-primary/10 transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

const EXECUTION_UNIVERSE = new Set(["SPY", "QQQ", "IWM", "SPX", "SPXW"]);

function SignalCard({ signal, getPrice, onSetAlert, hasAlert, isAdmin, userId, onReviewChange }: { signal: MarketSignal; getPrice?: (ticker: string) => PriceInfo | null; onSetAlert?: (s: MarketSignal) => void; hasAlert?: boolean; isAdmin?: boolean; userId?: string; onReviewChange?: (signalId: string, status: "correct" | "wrong" | null) => void }) {
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
  const isLoser = signal.outcome === "missed" || signal.outcome === "loss" || signal.outcome === "near_miss";
  const isExpired = signal.outcome === "expired";
  const isPending = isAI && !isWinner && !isLoser && !isExpired;
  const hasUpdatedLogic = signal.tags?.some((t: string) => t.toUpperCase().includes('UPDATED LOGIC'));
  const isRecentlyResolved = !!(signal.resolvedAt && (Date.now() - new Date(signal.resolvedAt).getTime() < 300_000));
  const isCelebrating = isRecentlyResolved && isWinner;

  const [open, setOpen] = useState(false);
  const priceInfo = getPrice?.(signal.ticker);
  const bull = isCall;
  const accent = bull
    ? "bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
    : "bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.5)]";
  const flowColor = bull ? "text-emerald-400" : "text-rose-400";
  const flowLabel = signal.putCall === "put" ? "PUT FLOW" : "CALL FLOW";
  const is0DTE = (() => {
    if (!signal.expiry) return false;
    const exp = new Date(signal.expiry);
    return !isNaN(exp.getTime()) && exp.toISOString().split("T")[0] === new Date().toISOString().split("T")[0];
  })();
  const mfeVal = signal.mfePercent ?? null;
  const showBuyNow = score >= 80 && !is0DTE && (mfeVal == null || mfeVal < 70);
  const showMoveOver = !is0DTE && mfeVal != null && mfeVal >= 70;
  const contractLine = (() => {
    const parts = [
      formatExpiryShort(signal.expiry),
      signal.strike ? `$${signal.strike}` : "",
      signal.putCall === "put" ? "Put" : signal.putCall === "call" ? "Call" : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
    return signal.suggestedTrade || "";
  })();
  const levelRows: { label: string; value: string; tone?: "flow" | "bad" }[] = [];
  if (signal.entryTrigger) levelRows.push({ label: "Area of Interest", value: signal.entryTrigger });
  if (signal.targetZone) {
    const tn = signal.targetNear;
    const tz = signal.targetZone;
    levelRows.push({ label: "Range", value: tn && tn !== tz ? `${tn} – ${tz}` : tz, tone: "flow" });
  }
  if (signal.keyLevel) levelRows.push({ label: "Key Level", value: signal.keyLevel });
  if (signal.srLevel || signal.gammaLevelLabel) levelRows.push({ label: "Support / Resistance", value: signal.srLevel || signal.gammaLevelLabel || "" });
  if (signal.invalidation) levelRows.push({ label: isCall ? "Support" : "Resistance", value: signal.invalidation, tone: "bad" });
  const biddieParagraphs = simplifySignalDescription(signal).split("\n\n").filter(Boolean);
  const hasDetails = signal.pricePattern || signal.gammaZone || signal.spreadDetails;

  const tradeBadge = is0DTE ? (
    <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider">Day Trade</span>
  ) : (
    <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing Trade</span>
  );

  const statusBadge = (() => {
    let ts: string = signal.tradeStatus || "watching";
    const o: string | null | undefined = signal.outcome;
    const isExp = signal.expiry ? new Date(signal.expiry) < new Date() : false;
    const m = signal.mfePercent ?? 0;
    if (o === "hit" || o === "win") ts = "hit";
    else if (o === "partial_hit") ts = "partial";
    else if (o === "near_miss") ts = "near_miss";
    else if (o === "missed" || o === "loss") ts = "miss";
    else if (o === "expired") ts = "expired";
    if (isExp && m >= 50) {
      if (m >= 75) ts = "hit";
      else ts = "partial";
    } else if (isExp && !o && m >= 30) {
      ts = "near_miss";
    } else if (isExp && !o && m < 30) {
      ts = "miss";
    }
    const statusInfo: Record<string, { label: string; desc: string; color: string; icon: React.ReactNode }> = {
      hit: { label: "WIN", desc: "Price moved 75%+ of the way through the range — a full win.", color: "text-emerald-400 bg-emerald-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
      partial: { label: "WIN", desc: "Price moved 50–74% through the range — a partial win.", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
      partial_hit: { label: "WIN", desc: "Price moved 50–74% through the range — a partial win.", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
      near_miss: { label: "LOSS", desc: "Price moved 30–49% through the range — the right idea, but it fell short.", color: "text-orange-400 bg-orange-400/15", icon: <Target className="h-3 w-3" /> },
      miss: { label: "LOSS", desc: "Price didn't move far through the range, or the support level gave way.", color: "text-red-400 bg-red-400/15", icon: <XCircle className="h-3 w-3" /> },
      expired: { label: "EXPIRED", desc: "Time ran out before this played out.", color: "text-zinc-400 bg-zinc-400/15", icon: <Clock className="h-3 w-3" /> },
      active: { label: "ACTIVE", desc: "This one is moving through the range right now.", color: "text-cyan-400 bg-cyan-400/15 animate-pulse", icon: <Zap className="h-3 w-3" /> },
      ran_without_entry: { label: "MOVED EARLY", desc: "Price moved 15%+ through the range before reaching the area of interest — it moved without us.", color: "text-amber-400 bg-amber-400/15", icon: <Target className="h-3 w-3" /> },
      watching: { label: "WATCHING", desc: "Waiting for the price to come into the area of interest — like fishing, we don't chase!", color: "text-yellow-400 bg-yellow-400/15", icon: <Clock className="h-3 w-3" /> },
    };
    const info = statusInfo[ts] || statusInfo.watching;
    return (
      <span className="relative group/status inline-flex shrink-0">
        <span className={`inline-flex items-center gap-0.5 h-5 text-[10px] font-bold px-2 rounded-full cursor-help ${info.color}`}>
          {info.icon} {info.label}
        </span>
        <span className="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground w-48 text-wrap opacity-0 group-hover/status:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg leading-relaxed">
          {info.desc}
        </span>
      </span>
    );
  })();

  return (
    <div className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 ${
      isCelebrating
        ? "border-yellow-400/80 ring-2 ring-yellow-400/50 shadow-[0_0_30px_-3px_rgba(234,179,8,0.7),0_0_60px_-5px_rgba(16,185,129,0.4)] animate-pulse bg-gradient-to-r from-yellow-500/20 via-emerald-500/15 to-yellow-500/20"
        : hasUpdatedLogic
        ? "border-yellow-500/60 ring-2 ring-yellow-400/30 shadow-[0_0_20px_-3px_rgba(234,179,8,0.5)] bg-yellow-500/10"
        : isWinner
        ? "border-emerald-400/30 shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9),0_0_24px_-10px_rgba(16,185,129,0.45)] bg-emerald-500/[0.07] hover:-translate-y-0.5"
        : isLoser
        ? "border-rose-400/25 shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9),0_0_24px_-10px_rgba(244,63,94,0.4)] bg-rose-500/[0.06] hover:-translate-y-0.5"
        : isExpired
        ? "border-white/[0.08] shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9)] bg-zinc-500/[0.06] hover:-translate-y-0.5"
        : "border-[hsl(230_85%_62%/0.16)] bg-gradient-to-b from-[hsl(230_70%_55%/0.09)] via-white/[0.012] to-[hsl(232_40%_20%/0.04)] shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9),inset_0_0_20px_hsl(230_85%_60%/0.05),0_0_24px_-10px_hsl(230_85%_60%/0.38),inset_0_1px_0_0_hsl(230_90%_72%/0.12)] hover:-translate-y-0.5 hover:border-[hsl(230_85%_62%/0.28)] hover:shadow-[0_14px_38px_-12px_rgba(0,0,0,0.95),inset_0_0_24px_hsl(230_85%_60%/0.08),0_0_34px_-8px_hsl(230_85%_60%/0.55),inset_0_1px_0_0_hsl(230_90%_72%/0.18)]"
    }`}>
      {isCelebrating && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400/10 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
          <div className="absolute top-1 left-[10%] text-lg animate-bounce" style={{ animationDelay: "0s" }}>🎰</div>
          <div className="absolute top-1 left-[30%] text-lg animate-bounce" style={{ animationDelay: "0.3s" }}>💰</div>
          <div className="absolute top-1 left-[50%] text-lg animate-bounce" style={{ animationDelay: "0.6s" }}>🔥</div>
          <div className="absolute top-1 left-[70%] text-lg animate-bounce" style={{ animationDelay: "0.9s" }}>✨</div>
          <div className="absolute top-1 left-[90%] text-lg animate-bounce" style={{ animationDelay: "1.2s" }}>🎯</div>
        </div>
      )}
      {isCelebrating && (
        <div className="px-3 sm:px-4 py-2 bg-gradient-to-r from-yellow-500/20 via-emerald-500/20 to-yellow-500/20 border-b border-yellow-400/30 flex items-center justify-center gap-2">
          <span className="text-sm font-black tracking-wider text-yellow-300 uppercase animate-pulse">
            {signal.outcome === "hit" ? "🎯 BIG WIN! 🎯" : "⚡ PARTIAL WIN! ⚡"}
          </span>
        </div>
      )}
      {isRecentlyResolved && isExpired && (
        <div className="px-3 sm:px-4 py-1.5 bg-zinc-500/15 border-b border-zinc-500/20 flex items-center justify-center gap-2">
          <span className="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">Opportunity Expired — Removing shortly</span>
        </div>
      )}
      {isAdmin && signal.reviewStatus === "wrong" && (
        <div className="px-3 sm:px-4 py-1.5 bg-red-500/20 border-b border-red-500/30 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          <span className="text-[10px] font-bold tracking-wider text-red-400 uppercase">Flagged — Hidden from users</span>
          {signal.reviewNote && <span className="text-[10px] text-red-300/70 ml-1">— {signal.reviewNote}</span>}
        </div>
      )}
      {(() => {
        if (!signal.createdAt) return null;
        const signalDate = new Date(signal.createdAt);
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const todayET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
        const signalET = new Date(signalDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const signalDay = new Date(signalET.getFullYear(), signalET.getMonth(), signalET.getDate());
        if (signalDay >= todayET) return null;
        const dayName = signalET.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
        const dateStr = signalET.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
        return (
          <div className="px-3 sm:px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/20 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-[10px] font-bold tracking-wider text-amber-400 uppercase">Opportunity from {dayName} {dateStr}</span>
          </div>
        );
      })()}
      {/* Price Confirmed Banner */}
      {signal.priceConfirmed && (
        <div className="px-3 sm:px-4 py-1.5 bg-emerald-500/20 border-b border-emerald-500/30 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[10px] font-bold tracking-wider text-emerald-400 uppercase">Price Action Confirmed</span>
          {signal.gammaZone && signal.gammaZone !== 'neutral' && (
            <>
              <Flame className="h-3.5 w-3.5 text-orange-400 animate-pulse" />
              <span className="text-[10px] font-bold tracking-wider text-orange-400 uppercase">ACTIVE</span>
            </>
          )}
        </div>
      )}

      <div className="relative px-4 py-3.5">
        <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full ${accent}`} />

        <div className="pl-2.5">
          {/* Header: ticker + put/call (left) · alert + live price + time (right) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {bull
                ? <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
                : <TrendingDown className="h-4 w-4 text-rose-400 shrink-0" />}
              <span className="text-base font-bold tracking-tight text-foreground">{signal.ticker}</span>
            </div>
            <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
              {onSetAlert && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSetAlert(signal); }}
                  className={`transition-colors ${hasAlert ? "text-amber-400" : "text-muted-foreground/70 hover:text-foreground"}`}
                  title={hasAlert ? "Alert set — tap to add another" : "Set price alert"}
                >
                  <Bell className={`h-3.5 w-3.5 ${hasAlert ? "fill-amber-400/30" : ""}`} />
                </button>
              )}
              {priceInfo && (
                <span className="flex items-center gap-1 text-[12px] font-semibold text-foreground">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      priceInfo.source === "live"
                        ? "bg-emerald-400 animate-pulse"
                        : priceInfo.source === "rest"
                          ? "bg-amber-400"
                          : "bg-zinc-500"
                    }`}
                    title={
                      priceInfo.source === "live"
                        ? "Live price (real-time)"
                        : priceInfo.source === "rest"
                          ? "Recent price (slightly delayed)"
                          : "Last known price (not live)"
                    }
                  />
                  ${priceInfo.price.toFixed(2)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {signal.timestamp}
              </span>
            </span>
          </div>

          {/* Flow label */}
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${flowColor}`}>
              {flowLabel}
            </span>
          </div>

          {/* Secondary pills */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {showMoveOver ? (
              <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-orange-500/20 text-orange-400 uppercase tracking-wider">Move Almost Over</span>
            ) : showBuyNow ? (
              <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider animate-pulse">Strong</span>
            ) : null}
            {signal.aiEvaluated && (
              <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-emerald-500/30 text-emerald-300 uppercase tracking-wider animate-pulse border border-emerald-400/30">Biddie Reviewed</span>
            )}
          </div>

          {/* Contract + premium */}
          {contractLine && (
            <div className="mt-1.5">
              <div className="text-[13px] font-semibold text-foreground">{contractLine}</div>
              {signal.premium && <div className="text-[12px] text-muted-foreground">{formatPremium(signal.premium)} Premium</div>}
            </div>
          )}

          {/* Levels */}
          {levelRows.length > 0 && (
            <>
              <div className="my-3 border-t border-white/10" />
              <div className="space-y-1.5 text-[12px]">
                {levelRows.map((lvl, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground shrink-0">{lvl.label}</span>
                    <span className={`font-semibold text-right ${lvl.tone === "flow" ? flowColor : lvl.tone === "bad" ? "text-destructive" : "text-foreground"}`}>{lvl.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Divider */}
          <div className="my-3 border-t border-white/10" />

          {/* Biddie toggle (left) · reinforcement + MFE + conviction ring (right) */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label="Biddie's take"
              className="flex shrink-0 items-center gap-1.5 text-left"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20">
                <Sparkles className="h-2.5 w-2.5 text-primary" />
              </span>
              <span className="text-[11px] font-bold text-primary">Biddie</span>
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {statusBadge}
              {tradeBadge}
              {(signal.reinforcementCount ?? 0) > 1 && (
                <span className="inline-flex shrink-0 items-center gap-1 h-5 rounded-full bg-emerald-400/15 px-2 text-[10px] font-bold text-emerald-300" title="How many times buyers have re-added to this position">
                  <TrendingUp className="h-3 w-3" /> {ordinalSuffix(signal.reinforcementCount!)} reinforcement
                </span>
              )}
              {signal.mfePercent != null && (() => {
                const oc: string | null | undefined = signal.outcome;
                const isResolved = oc === "hit" || oc === "win" || oc === "partial_hit" || oc === "near_miss" || oc === "missed" || oc === "loss" || oc === "expired";
                const isExpiredDate = signal.expiry ? new Date(signal.expiry) < new Date() : false;
                const isDone = isResolved || isExpiredDate;
                return (
                  <span className="relative group/mfe inline-flex">
                    <span className={`inline-flex items-center gap-1 h-5 text-[10px] font-bold px-2 rounded-full cursor-help ${
                      signal.mfePercent >= 75 ? "bg-emerald-400/15 text-emerald-400" :
                      signal.mfePercent >= 50 ? "bg-blue-400/15 text-blue-400" :
                      signal.mfePercent >= 30 ? "bg-orange-400/15 text-orange-400" :
                      isDone ? "bg-red-400/15 text-red-400" :
                      "bg-muted/20 text-muted-foreground"
                    }`}>
                      MFE {signal.mfePercent.toFixed(0)}%
                    </span>
                    <span className="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground w-[200px] text-wrap opacity-0 group-hover/mfe:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg leading-relaxed">
                      {!isDone ? `Best move so far: ${signal.mfePercent.toFixed(0)}% through the range — still active` :
                       signal.mfePercent >= 75 ? "Full move — price went 75%+ through the range" :
                       signal.mfePercent >= 50 ? "Partial move — 50–74% through the range" :
                       signal.mfePercent >= 30 ? "Fell short — 30–49% through the range" :
                       "Small move — under 50% through the range"}
                      {signal.maxFavorablePrice ? ` (best: $${signal.maxFavorablePrice.toFixed(2)})` : ""}
                    </span>
                  </span>
                );
              })()}
              <ConvictionScoreRing score={score} label={signal.convictionLabel ?? ""} />
            </div>
          </div>

          {/* Expanded: Biddie's take + details + tags */}
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2">
                  {biddieParagraphs.map((p, i) => (
                    <p key={i} className="text-[12px] text-foreground/75 leading-relaxed">{p}</p>
                  ))}
                </div>

                {hasDetails && (
                  <div className="mt-2 space-y-1.5">
                    {signal.pricePattern && (
                      <div className="flex items-start gap-2 bg-emerald-500/10 rounded-lg px-3 py-1.5 text-xs">
                        <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">Pattern: </span>
                        <span className="text-emerald-400 font-semibold">{signal.pricePattern}</span>
                      </div>
                    )}
                    {signal.spreadDetails && (
                      <div className="flex items-start gap-2 bg-violet-500/10 rounded-lg px-3 py-1.5 text-xs">
                        <Target className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
                        <div>
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
                      <div className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-xs ${
                        signal.gammaZone === 'negative' ? 'bg-orange-500/10' : 'bg-blue-500/10'
                      }`}>
                        <Gauge className={`h-3 w-3 mt-0.5 shrink-0 ${
                          signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                        }`} />
                        <div>
                          <span className="text-muted-foreground">Gamma: </span>
                          <span className={`font-semibold ${
                            signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                          }`}>
                            {signal.gammaZone === 'negative' ? 'Negative' : 'Positive'} — {signal.gammaDescription}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </motion.div>
            )}
          </AnimatePresence>

          {isAdmin && userId && (
            <AdminReviewPanel signalId={signal.id} userId={userId} onReviewChange={(s) => onReviewChange?.(signal.id, s)} signalMeta={{ ticker: signal.ticker, strike: signal.strike, option_type: signal.putCall, expiry: signal.expiry, entry_trigger: signal.entry, target: signal.target, invalidation: signal.invalidation, category: signal.category, detected_at: signal.createdAt }} />
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardSignalsWithBoundary() {
  return (
    <SignalErrorBoundary
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center p-8">
            <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-foreground mb-2">Signals page encountered an error</h2>
            <p className="text-sm text-muted-foreground mb-4">Try refreshing the page.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              Refresh Page
            </button>
          </div>
        </div>
      }
    >
      <DashboardSignals />
    </SignalErrorBoundary>
  );
}

export default DashboardSignalsWithBoundary;
