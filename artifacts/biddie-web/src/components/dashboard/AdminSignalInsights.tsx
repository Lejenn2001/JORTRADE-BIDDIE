import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  BarChart3, AlertTriangle, Lightbulb, ChevronDown, ChevronUp,
  Target, Activity, Zap, BookOpen, Info, Loader2,
  ArrowUp, ArrowDown, Timer, Crosshair, ExternalLink, Download
} from "lucide-react";

interface Signal {
  id: string;
  ticker: string;
  signal_type: string;
  put_call: string | null;
  confidence: number;
  strike: string | null;
  expiry: string | null;
  outcome: string;
  created_at: string;
  detected_at?: string;
  resolved_at: string | null;
  category?: string;
  price_at_signal?: number | null;
  target_price?: string | null;
  invalidation?: string | null;
  entry_trigger?: string | null;
  direction?: string;
  max_favorable_price?: number | null;
  mfe_percent?: number | null;
  max_adverse_price?: number | null;
  entry_price_reached?: boolean;
  invalidation_breached?: boolean;
  pct_past_invalidation?: number | null;
  time_at_target?: string | null;
  entry_price?: number | null;
  key_level?: string | null;
  sr_level?: string | null;
  is_biddie_pick?: boolean;
  signal_quality?: string | null;
}

interface SignalDetail {
  signal: {
    isBullish: boolean;
    entryPrice: number | null;
    timeToResolve: string | null;
    explanation: string;
    target: string | null;
    invalidation: string | null;
    entry_trigger: string | null;
    reason: string | null;
    alertPrice: number | null;
    targetPrice: number | null;
    invalidationPrice: number | null;
    pctProfitAchieved: number | null;
    pctToTarget: number | null;
    entryPriceReached: boolean;
    invalidationBreached: boolean;
    pctPastInvalidation: number | null;
    timeAtTarget: string | null;
  };
  priceHistory: {
    bars: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
    highSince: number | null;
    lowSince: number | null;
    currentPrice: number;
    resolution: string;
  } | null;
}

interface TickerPattern {
  ticker: string;
  hits: number;
  misses: number;
  pending: number;
  total: number;
  winRate: number | null;
  callHits: number;
  callMisses: number;
  putHits: number;
  putMisses: number;
  categories: Record<string, { hits: number; misses: number }>;
}

interface PatternInsight {
  type: "success" | "warning" | "info";
  title: string;
  detail: string;
}

const AdminSignalInsights = ({ onExport, exporting }: { onExport?: () => void; exporting?: boolean }) => {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [filterOutcome, setFilterOutcome] = useState<"all" | "hit" | "partial_hit" | "missed" | "expired" | "pending">("all");
  const [fetchError, setFetchError] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
  const [signalDetails, setSignalDetails] = useState<Record<string, SignalDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const fetchSignalDetail = useCallback(async (signalId: string) => {
    if (signalDetails[signalId]) return;
    setDetailLoading(signalId);
    try {
      const resp = await fetch(`/api/whale/signals/detail/${signalId}`);
      if (resp.ok) {
        const data = await resp.json();
        setSignalDetails(prev => ({ ...prev, [signalId]: data }));
      }
    } catch (e) {
      console.warn("Failed to fetch signal detail:", e);
    }
    setDetailLoading(null);
  }, [signalDetails]);

  const toggleExpand = useCallback((signalId: string) => {
    if (expandedSignal === signalId) {
      setExpandedSignal(null);
    } else {
      setExpandedSignal(signalId);
      fetchSignalDetail(signalId);
    }
  }, [expandedSignal, fetchSignalDetail]);
  const [sortCol, setSortCol] = useState<string>("detected");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showMethodology, setShowMethodology] = useState(false);
  const [showTickerBreakdown, setShowTickerBreakdown] = useState(false);
  const [showPatternAnalysis, setShowPatternAnalysis] = useState(false);
  const [logPage, setLogPage] = useState(0);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const resp = await fetch("/api/whale/signals/calendar?limit=1000");
        if (resp.ok) {
          const data = await resp.json();
          setSignals(data.signals || []);
          setFetchError(false);
        } else {
          setFetchError(true);
        }
      } catch (e) {
        console.warn("Failed to fetch signals:", e);
        setFetchError(true);
      }
      setLoading(false);
    };
    fetchSignals();
  }, []);

  const stats = useMemo(() => {
    let hits = 0, partialHits = 0, misses = 0, expired = 0, pending = 0;
    for (const s of signals) {
      if (s.outcome === "hit") hits++;
      else if (s.outcome === "partial_hit") partialHits++;
      else if (s.outcome === "missed") misses++;
      else if (s.outcome === "expired") expired++;
      else pending++;
    }
    const resolved = hits + partialHits + misses + expired;
    const successRate = resolved > 0 ? ((hits + partialHits) / resolved) * 100 : null;
    return { hits, partialHits, misses, expired, pending, total: signals.length, resolved, winRate: successRate };
  }, [signals]);

  const tickerPatterns = useMemo(() => {
    const map: Record<string, TickerPattern> = {};
    for (const s of signals) {
      if (!map[s.ticker]) {
        map[s.ticker] = { ticker: s.ticker, hits: 0, misses: 0, pending: 0, total: 0, winRate: null, callHits: 0, callMisses: 0, putHits: 0, putMisses: 0, categories: {} };
      }
      const tp = map[s.ticker];
      tp.total++;
      const isCall = s.put_call ? s.put_call === "call" : s.signal_type === "bullish";
      const cat = s.category || "algorithm";
      if (!tp.categories[cat]) tp.categories[cat] = { hits: 0, misses: 0 };
      const outcome = s.outcome === "hit" ? "hit" : s.outcome === "partial_hit" ? "hit" : s.outcome === "missed" ? "missed" : s.outcome === "expired" ? "missed" : "pending";

      if (outcome === "hit") {
        tp.hits++;
        tp.categories[cat].hits++;
        if (isCall) tp.callHits++; else tp.putHits++;
      } else if (outcome === "missed") {
        tp.misses++;
        tp.categories[cat].misses++;
        if (isCall) tp.callMisses++; else tp.putMisses++;
      } else {
        tp.pending++;
      }
    }
    for (const tp of Object.values(map)) {
      const resolved = tp.hits + tp.misses;
      tp.winRate = resolved > 0 ? (tp.hits / resolved) * 100 : null;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [signals]);

  const directionStats = useMemo(() => {
    let callHits = 0, callMisses = 0, putHits = 0, putMisses = 0;
    for (const s of signals) {
      const isCall = s.put_call ? s.put_call === "call" : s.signal_type === "bullish";
      if (s.outcome === "hit" || s.outcome === "partial_hit") { if (isCall) callHits++; else putHits++; }
      else if (s.outcome === "missed" || s.outcome === "expired") { if (isCall) callMisses++; else putMisses++; }
    }
    const callResolved = callHits + callMisses;
    const putResolved = putHits + putMisses;
    return {
      callHits, callMisses, putHits, putMisses,
      callWinRate: callResolved > 0 ? (callHits / callResolved) * 100 : null,
      putWinRate: putResolved > 0 ? (putHits / putResolved) * 100 : null,
    };
  }, [signals]);

  const categoryStats = useMemo(() => {
    const map: Record<string, { hits: number; misses: number; pending: number; total: number }> = {};
    for (const s of signals) {
      const cat = s.category || "algorithm";
      if (!map[cat]) map[cat] = { hits: 0, misses: 0, pending: 0, total: 0 };
      map[cat].total++;
      if (s.outcome === "hit" || s.outcome === "partial_hit") map[cat].hits++;
      else if (s.outcome === "missed" || s.outcome === "expired") map[cat].misses++;
      else map[cat].pending++;
    }
    return map;
  }, [signals]);

  const insights = useMemo(() => {
    const results: PatternInsight[] = [];

    if (directionStats.putWinRate !== null && directionStats.callWinRate !== null) {
      if (directionStats.putWinRate > directionStats.callWinRate + 15) {
        results.push({
          type: "success",
          title: "PUT signals significantly outperforming CALLs",
          detail: `PUTs at ${directionStats.putWinRate.toFixed(0)}% vs CALLs at ${directionStats.callWinRate.toFixed(0)}%. The algorithm's bearish reads are stronger than bullish. Consider weighting bearish signals higher or requiring stronger confirmation for CALL signals.`,
        });
      } else if (directionStats.callWinRate > directionStats.putWinRate + 15) {
        results.push({
          type: "success",
          title: "CALL signals significantly outperforming PUTs",
          detail: `CALLs at ${directionStats.callWinRate.toFixed(0)}% vs PUTs at ${directionStats.putWinRate.toFixed(0)}%. The algorithm's bullish reads are stronger. Consider weighting bullish signals higher.`,
        });
      }
    }

    const worstTickers = tickerPatterns.filter(tp => tp.winRate !== null && tp.winRate < 30 && (tp.hits + tp.misses) >= 3);
    if (worstTickers.length > 0) {
      results.push({
        type: "warning",
        title: `Weak tickers: ${worstTickers.map(t => t.ticker).join(", ")}`,
        detail: `These tickers have <30% win rate with 3+ resolved signals. ${worstTickers.map(t => `${t.ticker}: ${t.winRate?.toFixed(0)}% (${t.hits}/${t.hits + t.misses})`).join(", ")}. Consider filtering these out or requiring higher conviction thresholds.`,
      });
    }

    const bestTickers = tickerPatterns.filter(tp => tp.winRate !== null && tp.winRate >= 70 && (tp.hits + tp.misses) >= 3);
    if (bestTickers.length > 0) {
      results.push({
        type: "success",
        title: `Strong tickers: ${bestTickers.map(t => t.ticker).join(", ")}`,
        detail: `These tickers have 70%+ win rate with 3+ signals. ${bestTickers.map(t => `${t.ticker}: ${t.winRate?.toFixed(0)}% (${t.hits}/${t.hits + t.misses})`).join(", ")}. These are the algorithm's sweet spots.`,
      });
    }

    for (const [cat, s] of Object.entries(categoryStats)) {
      const resolved = s.hits + s.misses;
      if (resolved >= 3) {
        const rate = (s.hits / resolved) * 100;
        const pendingNote = s.pending > 0 ? ` ${s.pending} still pending out of ${s.total} total.` : "";
        if (rate < 35) {
          results.push({
            type: "warning",
            title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} source underperforming`,
            detail: `${cat} signals at ${rate.toFixed(0)}% win rate (${s.hits}H/${s.misses}M of ${resolved} resolved).${pendingNote} This source may need tuning or stricter filtering.`,
          });
        } else if (rate >= 65) {
          results.push({
            type: "success",
            title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} source performing well`,
            detail: `${cat} signals at ${rate.toFixed(0)}% win rate (${s.hits}H/${s.misses}M of ${resolved} resolved).${pendingNote} This is a reliable signal source.`,
          });
        }
      }
    }

    for (const tp of tickerPatterns) {
      if (tp.callMisses >= 3 && tp.callHits === 0 && tp.putHits >= 2) {
        results.push({
          type: "info",
          title: `${tp.ticker}: Only PUT signals hit, all CALLs missed`,
          detail: `${tp.ticker} has ${tp.putHits} PUT hits but ${tp.callMisses} CALL misses with 0 CALL hits. This ticker may have a persistent bearish bias the algorithm should learn from.`,
        });
      }
      if (tp.putMisses >= 3 && tp.putHits === 0 && tp.callHits >= 2) {
        results.push({
          type: "info",
          title: `${tp.ticker}: Only CALL signals hit, all PUTs missed`,
          detail: `${tp.ticker} has ${tp.callHits} CALL hits but ${tp.putMisses} PUT misses with 0 PUT hits. This ticker may have a persistent bullish bias.`,
        });
      }
    }

    if (results.length === 0) {
      results.push({
        type: "info",
        title: "Not enough data for pattern detection yet",
        detail: "Keep tracking signals — patterns will emerge after a few more trading days with more resolved signals.",
      });
    }

    return results;
  }, [directionStats, tickerPatterns, categoryStats]);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const filteredSignals = useMemo(() => {
    let list = filterOutcome === "all" ? [...signals] : signals.filter(s => {
      return s.outcome === filterOutcome || (!s.outcome && filterOutcome === "pending");
    });

    const parseExpiryDate = (expiry: string | null): number => {
      if (!expiry) return 0;
      const d = new Date(expiry);
      if (!isNaN(d.getTime())) return d.getTime();
      const cleaned = expiry.replace(/,/g, "").trim();
      const parts = cleaned.split(/\s+/);
      if (parts.length >= 3) {
        const rebuilt = `${parts[0]} ${parts[1]}, ${parts[2]}`;
        const d2 = new Date(rebuilt);
        if (!isNaN(d2.getTime())) return d2.getTime();
      }
      return 0;
    };

    list.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortCol) {
        case "status": {
          const order: Record<string, number> = { hit: 0, partial_hit: 1, pending: 2, expired: 3, missed: 4 };
          const ao = order[a.outcome || "pending"] ?? 2;
          const bo = order[b.outcome || "pending"] ?? 2;
          return (ao - bo) * dir;
        }
        case "ticker": return a.ticker.localeCompare(b.ticker) * dir;
        case "option": {
          const ao = `${a.put_call || ""} ${a.strike || ""} ${a.expiry || ""}`;
          const bo = `${b.put_call || ""} ${b.strike || ""} ${b.expiry || ""}`;
          return ao.localeCompare(bo) * dir;
        }
        case "direction": {
          const ad = a.put_call || a.signal_type;
          const bd = b.put_call || b.signal_type;
          return ad.localeCompare(bd) * dir;
        }
        case "strike": {
          const as = parseFloat(a.strike || "0");
          const bs = parseFloat(b.strike || "0");
          return (as - bs) * dir;
        }
        case "expiry": {
          const ae = parseExpiryDate(a.expiry);
          const be = parseExpiryDate(b.expiry);
          return (ae - be) * dir;
        }
        case "score": return ((a.confidence || 0) - (b.confidence || 0)) * dir;
        case "source": return (a.category || "").localeCompare(b.category || "") * dir;
        case "entry": return ((a.price_at_signal || 0) - (b.price_at_signal || 0)) * dir;
        case "target": {
          const parseP = (t?: string | null) => { const m = t?.match(/\$([0-9]+\.?[0-9]*)/); return m ? parseFloat(m[1]) : 0; };
          return (parseP(a.target_price) - parseP(b.target_price)) * dir;
        }
        case "invalidation": {
          const parseP = (t?: string | null) => { const m = t?.match(/\$([0-9]+\.?[0-9]*)/); return m ? parseFloat(m[1]) : 0; };
          return (parseP(a.invalidation) - parseP(b.invalidation)) * dir;
        }
        case "pctProfit": {
          const calcPct = (s: Signal) => {
            const alert = s.price_at_signal ? Number(s.price_at_signal) : 0;
            const mfp = s.max_favorable_price ? Number(s.max_favorable_price) : 0;
            if (!alert || !mfp) return -999;
            return s.signal_type === "bullish" ? ((mfp - alert) / alert) * 100 : ((alert - mfp) / alert) * 100;
          };
          return (calcPct(a) - calcPct(b)) * dir;
        }
        case "pctTarget": {
          const calcTgt = (s: Signal) => {
            const alert = s.price_at_signal ? Number(s.price_at_signal) : 0;
            const mfp = s.max_favorable_price ? Number(s.max_favorable_price) : 0;
            const tgtM = s.target_price?.match(/\$([0-9]+\.?[0-9]*)/);
            const tgt = tgtM ? parseFloat(tgtM[1]) : 0;
            if (!alert || !mfp || !tgt) return -999;
            const dist = Math.abs(tgt - alert);
            if (dist <= 0) return -999;
            const fav = s.signal_type === "bullish" ? mfp - alert : alert - mfp;
            return Math.max(0, (fav / dist) * 100);
          };
          return (calcTgt(a) - calcTgt(b)) * dir;
        }
        case "reachedEntry": return ((a.entry_price_reached ? 1 : 0) - (b.entry_price_reached ? 1 : 0)) * dir;
        case "breachedInv": return ((a.invalidation_breached ? 1 : 0) - (b.invalidation_breached ? 1 : 0)) * dir;
        case "pctPastInv": return ((a.pct_past_invalidation || 0) - (b.pct_past_invalidation || 0)) * dir;
        case "timeAtTarget": {
          const at = a.time_at_target ? new Date(a.time_at_target).getTime() : 0;
          const bt = b.time_at_target ? new Date(b.time_at_target).getTime() : 0;
          return (at - bt) * dir;
        }
        case "aipick": {
          const aIsAI = Number(a.confidence) >= 9.5 ? 1 : 0;
          const bIsAI = Number(b.confidence) >= 9.5 ? 1 : 0;
          return (aIsAI - bIsAI) * dir;
        }
        case "detected":
        default: {
          const at = new Date(a.detected_at || a.created_at).getTime();
          const bt = new Date(b.detected_at || b.created_at).getTime();
          return (at - bt) * dir;
        }
      }
    });

    return list;
  }, [signals, filterOutcome, sortCol, sortDir]);

  if (loading) {
    return (
      <div className="glass-panel rounded-xl p-6 border-border/40">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-sm text-muted-foreground">Loading signal insights...</span>
        </div>
      </div>
    );
  }

  if (fetchError && signals.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-6 border-border/40">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-foreground">Failed to load signal data</p>
            <p className="text-xs text-muted-foreground mt-0.5">The API server may be restarting. Refresh the page to retry.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Signal Analysis</h2>
          <span className="text-[10px] text-muted-foreground ml-auto">{stats.total} total signals</span>
        </div>

        <div className="grid grid-cols-3 lg:grid-cols-8 gap-3 p-4">
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Success rate: (Hits + Partial Hits) / All Resolved">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Success Rate</p>
            <p className={`text-2xl font-bold ${stats.winRate !== null && stats.winRate >= 50 ? "text-emerald-400" : stats.winRate !== null ? "text-destructive" : "text-foreground"}`}>
              {stats.winRate !== null ? `${stats.winRate.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Target price was reached">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Hits</p>
            <p className="text-2xl font-bold text-emerald-400">{stats.hits}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Expired with significant favorable move (50%+ to target or 1%+ price move)">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Partial Hits</p>
            <p className="text-2xl font-bold text-blue-400">{stats.partialHits}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Invalidation level was breached — thesis was wrong">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Misses</p>
            <p className="text-2xl font-bold text-destructive">{stats.misses}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Expired without hitting target or invalidation, minimal favorable move">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Expired</p>
            <p className="text-2xl font-bold text-muted-foreground">{stats.expired}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Still active — not expired, not invalidated">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</p>
            <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">CALL Win%</p>
            <p className={`text-2xl font-bold ${directionStats.callWinRate !== null && directionStats.callWinRate >= 50 ? "text-emerald-400" : directionStats.callWinRate !== null ? "text-destructive" : "text-foreground"}`}>
              {directionStats.callWinRate !== null ? `${directionStats.callWinRate.toFixed(0)}%` : "—"}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{directionStats.callHits}H / {directionStats.callMisses}M</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">PUT Win%</p>
            <p className={`text-2xl font-bold ${directionStats.putWinRate !== null && directionStats.putWinRate >= 50 ? "text-emerald-400" : directionStats.putWinRate !== null ? "text-destructive" : "text-foreground"}`}>
              {directionStats.putWinRate !== null ? `${directionStats.putWinRate.toFixed(0)}%` : "—"}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{directionStats.putHits}H / {directionStats.putMisses}M</p>
          </div>
        </div>

        <div className="px-4 pb-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">By Source</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(categoryStats).map(([cat, s]) => {
              const resolved = s.hits + s.misses;
              const rate = resolved > 0 ? ((s.hits / resolved) * 100).toFixed(0) : "—";
              return (
                <span key={cat} className="inline-flex items-center gap-1.5 text-xs bg-muted/20 px-3 py-2 rounded-lg">
                  <span className="font-bold text-foreground capitalize">{cat}</span>
                  <span className={`font-semibold ${rate !== "—" && parseInt(rate) >= 50 ? "text-emerald-400" : rate !== "—" ? "text-destructive" : "text-foreground"}`}>{rate}{rate !== "—" && "%"}</span>
                  <span className="text-muted-foreground">({s.hits}H/{s.misses}M/{s.pending}P)</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
          <button
            onClick={() => setShowPatternAnalysis(!showPatternAnalysis)}
            className="w-full px-5 py-4 flex items-center gap-2 hover:bg-muted/10 transition-colors"
          >
            <Lightbulb className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-bold text-foreground">Pattern Analysis</h2>
            <span className="text-[10px] text-muted-foreground ml-1">({insights.length} insights)</span>
            {showPatternAnalysis ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />}
          </button>
          {showPatternAnalysis && (
            <div className="p-4 border-t border-border/40 space-y-3">
              {insights.map((insight, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={`rounded-lg p-4 border ${
                    insight.type === "success" ? "bg-emerald-500/10 border-emerald-500/30" :
                    insight.type === "warning" ? "bg-amber-500/10 border-amber-500/30" :
                    "bg-blue-500/10 border-blue-500/30"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {insight.type === "success" ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    ) : insight.type === "warning" ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                    ) : (
                      <Lightbulb className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <p className={`text-sm font-semibold ${
                        insight.type === "success" ? "text-emerald-400" :
                        insight.type === "warning" ? "text-amber-400" : "text-blue-400"
                      }`}>{insight.title}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.detail}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <button
          onClick={() => setShowTickerBreakdown(!showTickerBreakdown)}
          className="w-full px-5 py-4 flex items-center gap-2 hover:bg-muted/10 transition-colors"
        >
          <Target className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Ticker Breakdown</h2>
          <span className="text-[10px] text-muted-foreground ml-1">({tickerPatterns.filter(tp => tp.total >= 1).length} tickers across {tickerPatterns.reduce((sum, tp) => sum + tp.total, 0)} signals)</span>
          {showTickerBreakdown ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />}
        </button>
        {showTickerBreakdown && (() => {
          const sorted = [...tickerPatterns].filter(tp => tp.total >= 1).sort((a, b) => b.total - a.total);
          const maxTotal = sorted.length > 0 ? sorted[0].total : 1;
          return (
            <div className="p-4 border-t border-border/40 space-y-1.5">
              {sorted.map(tp => {
                const resolved = tp.hits + tp.misses;
                const barWidth = (tp.total / maxTotal) * 100;
                return (
                  <div key={tp.ticker} className="flex items-center gap-2 group">
                    <span className="text-xs font-bold text-foreground w-12 shrink-0 text-right">{tp.ticker}</span>
                    <div className="flex-1 h-5 bg-muted/10 rounded overflow-hidden relative">
                      <div className="absolute inset-0 flex" style={{ width: `${barWidth}%` }}>
                        {tp.hits > 0 && (
                          <div className="h-full bg-emerald-500/60" style={{ width: `${(tp.hits / tp.total) * 100}%` }} />
                        )}
                        {tp.misses > 0 && (
                          <div className="h-full bg-red-500/60" style={{ width: `${(tp.misses / tp.total) * 100}%` }} />
                        )}
                        {tp.pending > 0 && (
                          <div className="h-full bg-amber-500/40" style={{ width: `${(tp.pending / tp.total) * 100}%` }} />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] w-28 shrink-0">
                      <span className="text-emerald-400">{tp.hits}H</span>
                      <span className="text-destructive">{tp.misses}M</span>
                      <span className="text-amber-400">{tp.pending}P</span>
                      {tp.winRate !== null ? (
                        <span className={`font-bold ml-auto ${tp.winRate >= 50 ? "text-emerald-400" : "text-destructive"}`}>
                          {tp.winRate.toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground ml-auto">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 pt-2 text-[9px] text-muted-foreground border-t border-border/20 mt-2">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/60" /> Hits</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/60" /> Misses</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40" /> Pending</span>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Full Signal Log</h2>
            <span className="text-[10px] text-muted-foreground">({filteredSignals.length} signals)</span>
            {onExport && (
              <button
                onClick={(e) => { e.stopPropagation(); onExport(); }}
                disabled={exporting}
                className="ml-2 inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                <Download className="h-3 w-3" />
                {exporting ? "Exporting..." : "Export CSV"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["all", "hit", "partial_hit", "missed", "expired", "pending"] as const).map(f => {
              const colors: Record<string, string> = {
                all: "bg-primary/20 text-primary border border-primary/40",
                hit: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
                partial_hit: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
                missed: "bg-red-500/20 text-red-400 border border-red-500/40",
                expired: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40",
                pending: "bg-amber-500/20 text-amber-400 border border-amber-500/40",
              };
              const labels: Record<string, string> = {
                all: "All",
                hit: `Hits (${stats.hits})`,
                partial_hit: `Partial (${stats.partialHits})`,
                missed: `Misses (${stats.misses})`,
                expired: `Expired (${stats.expired})`,
                pending: `Pending (${stats.pending})`,
              };
              return (
                <button
                  key={f}
                  onClick={() => { setFilterOutcome(f); setLogPage(0); }}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all ${
                    filterOutcome === f ? colors[f] : "bg-muted/20 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {labels[f]}
                </button>
              );
            })}
          </div>
        </div>

        {(() => {
          const PAGE_SIZE = 10;
          const totalPages = Math.ceil(filteredSignals.length / PAGE_SIZE);
          const paged = filteredSignals.slice(logPage * PAGE_SIZE, (logPage + 1) * PAGE_SIZE);
          return (
            <>
              <div className="divide-y divide-border/20">
                {paged.map((s, idx) => {
                  const detected = new Date(s.detected_at || s.created_at);
                  const isExpanded = expandedSignal === s.id;
                  const detail = signalDetails[s.id];
                  const isLoadingDetail = detailLoading === s.id;
                  const globalIdx = logPage * PAGE_SIZE + idx + 1;
                  const type = (s.put_call || "").toUpperCase() || (s.signal_type === "bullish" ? "CALL" : "PUT");
                  const strike = s.strike ? `$${Number(s.strike).toFixed(0)}` : "";
                  const exp = s.expiry ? (() => { const d = new Date(s.expiry); return !isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : s.expiry.replace(/,?\s*\d{4}$/, ""); })() : "";
                  const optionStr = [type, strike, exp].filter(Boolean).join(" ");
                  const mfePct = (() => {
                    if (s.mfe_percent != null && Number(s.mfe_percent) !== 0) return Number(s.mfe_percent);
                    const alertP = s.price_at_signal ? Number(s.price_at_signal) : null;
                    const mfp = s.max_favorable_price ? Number(s.max_favorable_price) : null;
                    if (!alertP || !mfp || alertP <= 0) return null;
                    return s.signal_type === "bullish" ? ((mfp - alertP) / alertP) * 100 : ((alertP - mfp) / alertP) * 100;
                  })();
                  const score = (() => { const c = Number(s.confidence) || 0; let cs = Math.round(c * 10); if (c >= 9) cs = Math.max(cs, 92); else if (c >= 8) cs = Math.max(cs, 85); else if (c >= 7) cs = Math.max(cs, 78); else if (c >= 6) cs = Math.max(cs, 70); return cs; })();

                  return (
                    <Fragment key={s.id}>
                      <div
                        className={`px-4 py-3 hover:bg-muted/15 transition-colors cursor-pointer ${isExpanded ? "bg-muted/20" : ""}`}
                        onClick={() => toggleExpand(s.id)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-muted-foreground w-5 text-right shrink-0">{globalIdx}</span>
                          <div className="shrink-0">
                            {s.outcome === "hit" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full"><CheckCircle className="h-3 w-3" /> HIT</span>
                            ) : s.outcome === "partial_hit" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full"><CheckCircle className="h-3 w-3" /> PARTIAL</span>
                            ) : s.outcome === "missed" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full"><XCircle className="h-3 w-3" /> MISS</span>
                            ) : s.outcome === "expired" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 bg-zinc-400/10 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" /> EXPIRED</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" /> PENDING</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-sm text-foreground">{s.ticker}</span>
                            {s.is_biddie_pick && <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold uppercase">BP</span>}
                            <span className={`text-xs ${s.signal_type === "bullish" ? "text-emerald-400" : "text-destructive"}`}>
                              {s.signal_type === "bullish" ? "▲" : "▼"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{optionStr}</span>
                          </div>
                          <div className="flex items-center gap-3 ml-auto shrink-0 text-[10px]">
                            {s.price_at_signal && (
                              <span className="text-muted-foreground">${Number(s.price_at_signal).toFixed(2)}</span>
                            )}
                            {mfePct !== null && (
                              <span className={`font-semibold ${mfePct >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                                {mfePct >= 0 ? "+" : ""}{mfePct.toFixed(1)}%
                              </span>
                            )}
                            <span className="text-muted-foreground/70">
                              {detected.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                            </span>
                            <span className="font-medium text-foreground/70">{score}</span>
                            <button
                              title="View signal card"
                              className="text-primary/60 hover:text-primary transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/dashboard/signals?search=${encodeURIComponent(s.ticker)}&resolved=${s.outcome !== "pending" ? "true" : "false"}`);
                              }}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                            <span className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                              <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
                            </span>
                          </div>
                        </div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-5 py-4 bg-muted/10">
                              {isLoadingDetail ? (
                                <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading signal details...
                                </div>
                              ) : detail ? (
                                <div className="space-y-3">
                                  <div className={`rounded-lg p-3 border ${
                                    s.outcome === "hit" ? "bg-emerald-500/5 border-emerald-500/20" :
                                    s.outcome === "partial_hit" ? "bg-blue-500/5 border-blue-500/20" :
                                    s.outcome === "missed" ? "bg-red-500/5 border-red-500/20" :
                                    s.outcome === "expired" ? "bg-zinc-500/5 border-zinc-500/20" :
                                    "bg-amber-500/5 border-amber-500/20"
                                  }`}>
                                    <div className="flex items-start gap-2">
                                      <Info className={`h-4 w-4 mt-0.5 shrink-0 ${
                                        s.outcome === "hit" ? "text-emerald-400" :
                                        s.outcome === "partial_hit" ? "text-blue-400" :
                                        s.outcome === "missed" ? "text-destructive" :
                                        s.outcome === "expired" ? "text-zinc-400" :
                                        "text-amber-400"
                                      }`} />
                                      <div>
                                        <p className={`text-sm font-semibold ${
                                          s.outcome === "hit" ? "text-emerald-400" :
                                          s.outcome === "partial_hit" ? "text-blue-400" :
                                          s.outcome === "missed" ? "text-destructive" :
                                          s.outcome === "expired" ? "text-zinc-400" :
                                          "text-amber-400"
                                        }`}>
                                          {s.outcome === "hit" ? "How this was scored a HIT" :
                                           s.outcome === "partial_hit" ? "How this was scored a PARTIAL HIT" :
                                           s.outcome === "missed" ? "How this was scored a MISS" :
                                           s.outcome === "expired" ? "Why this EXPIRED" :
                                           "Signal Still Being Tracked"}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                          {detail.signal.explanation}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Alert</span>
                                      <p className="text-sm font-bold text-foreground">{detail.signal.alertPrice ? `$${detail.signal.alertPrice.toFixed(2)}` : "—"}</p>
                                    </div>
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Target</span>
                                      <p className="text-sm font-bold text-foreground">{detail.signal.targetPrice ? `$${detail.signal.targetPrice.toFixed(2)}` : "—"}</p>
                                    </div>
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Invalidation</span>
                                      <p className="text-sm font-bold text-foreground">{detail.signal.invalidationPrice ? `$${detail.signal.invalidationPrice.toFixed(2)}` : "—"}</p>
                                    </div>
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Current</span>
                                      <p className="text-sm font-bold text-foreground">{detail.priceHistory?.currentPrice ? `$${detail.priceHistory.currentPrice.toFixed(2)}` : "—"}</p>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">High Since</span>
                                      <p className="text-sm font-bold text-emerald-400">{detail.priceHistory?.highSince ? `$${detail.priceHistory.highSince.toFixed(2)}` : "—"}</p>
                                    </div>
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Low Since</span>
                                      <p className="text-sm font-bold text-destructive">{detail.priceHistory?.lowSince ? `$${detail.priceHistory.lowSince.toFixed(2)}` : "—"}</p>
                                    </div>
                                    <div className={`rounded-lg p-2.5 border ${detail.signal.entryPriceReached ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/15 border-border/20"}`}>
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Entry Reached</span>
                                      <p className={`text-sm font-bold ${detail.signal.entryPriceReached ? "text-emerald-400" : "text-muted-foreground"}`}>{detail.signal.entryPriceReached ? "YES" : "NO"}</p>
                                    </div>
                                    <div className={`rounded-lg p-2.5 border ${detail.signal.invalidationBreached ? "bg-red-500/10 border-red-500/20" : "bg-muted/15 border-border/20"}`}>
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Inval Breached</span>
                                      <p className={`text-sm font-bold ${detail.signal.invalidationBreached ? "text-destructive" : "text-muted-foreground"}`}>{detail.signal.invalidationBreached ? "YES" : "NO"}</p>
                                      {detail.signal.pctPastInvalidation != null && <span className="text-[9px] text-destructive/70">-{detail.signal.pctPastInvalidation.toFixed(2)}% past</span>}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div className={`rounded-lg p-2.5 border ${detail.signal.pctProfitAchieved != null && detail.signal.pctProfitAchieved > 0 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/15 border-border/20"}`}>
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">MFE %</span>
                                      <p className={`text-sm font-bold ${detail.signal.pctProfitAchieved != null && detail.signal.pctProfitAchieved > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                                        {detail.signal.pctProfitAchieved != null ? `${detail.signal.pctProfitAchieved >= 0 ? "+" : ""}${detail.signal.pctProfitAchieved.toFixed(2)}%` : "—"}
                                      </p>
                                    </div>
                                    <div className={`rounded-lg p-2.5 border ${detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 100 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/15 border-border/20"}`}>
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">% to Target</span>
                                      <p className={`text-sm font-bold ${detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 100 ? "text-emerald-400" : detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 50 ? "text-amber-400" : "text-muted-foreground"}`}>
                                        {detail.signal.pctToTarget != null ? `${detail.signal.pctToTarget.toFixed(1)}%` : "—"}
                                      </p>
                                    </div>
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Time @ Target</span>
                                      <p className="text-xs text-foreground">{detail.signal.timeAtTarget ? (() => { const d = new Date(detail.signal.timeAtTarget); return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`; })() : "Not reached"}</p>
                                    </div>
                                    <div className="bg-muted/15 rounded-lg p-2.5 border border-border/20">
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">Time to Resolve</span>
                                      <p className="text-xs text-foreground">{detail.signal.timeToResolve || (s.outcome === "pending" ? "Tracking..." : "—")}</p>
                                    </div>
                                  </div>

                                  {detail.signal.reason && (
                                    <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                      <div className="flex items-center gap-1.5 mb-1">
                                        <BookOpen className="h-3.5 w-3.5 text-violet-400" />
                                        <span className="text-[9px] font-medium text-muted-foreground uppercase">AI Analysis</span>
                                      </div>
                                      <p className="text-xs text-muted-foreground leading-relaxed">{detail.signal.reason}</p>
                                    </div>
                                  )}

                                  {detail.priceHistory && detail.priceHistory.bars.length > 0 && (
                                    <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
                                        <span className="text-[9px] font-medium text-muted-foreground uppercase">
                                          Price Timeline ({detail.priceHistory.resolution === "5min" ? "5-min" : "Hourly"})
                                        </span>
                                        <span className="text-[9px] text-muted-foreground/50 ml-auto">{detail.priceHistory.bars.length} bars</span>
                                      </div>
                                      <div className="flex gap-1 items-end h-16 overflow-hidden">
                                        {(() => {
                                          const bars = detail.priceHistory!.bars;
                                          const maxBars = 60;
                                          const step = bars.length > maxBars ? Math.ceil(bars.length / maxBars) : 1;
                                          const sampled = bars.filter((_: any, i: number) => i % step === 0);
                                          const closes = sampled.map((b: any) => b.close);
                                          const min = Math.min(...closes);
                                          const max = Math.max(...closes);
                                          const range = max - min || 1;
                                          const entry = detail.signal.entryPrice || 0;
                                          return sampled.map((bar: any, i: number) => {
                                            const pct = ((bar.close - min) / range) * 100;
                                            const isAboveEntry = bar.close >= entry;
                                            return (
                                              <div
                                                key={i}
                                                className={`flex-1 min-w-[2px] max-w-[6px] rounded-t-sm ${isAboveEntry ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                                                style={{ height: `${Math.max(pct, 5)}%` }}
                                                title={`${new Date(bar.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} — $${bar.close.toFixed(2)}`}
                                              />
                                            );
                                          });
                                        })()}
                                      </div>
                                      <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1">
                                        <span>{new Date(detail.priceHistory.bars[0].time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span>
                                        <span>{new Date(detail.priceHistory.bars[detail.priceHistory.bars.length - 1].time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground py-2">Unable to load details</p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Fragment>
                  );
                })}
              </div>
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-border/30 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    Page {logPage + 1} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setLogPage(0)}
                      disabled={logPage === 0}
                      className="text-[10px] px-2 py-1 rounded bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setLogPage(Math.max(0, logPage - 1))}
                      disabled={logPage === 0}
                      className="text-[10px] px-2 py-1 rounded bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setLogPage(Math.min(totalPages - 1, logPage + 1))}
                      disabled={logPage >= totalPages - 1}
                      className="text-[10px] px-2 py-1 rounded bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setLogPage(totalPages - 1)}
                      disabled={logPage >= totalPages - 1}
                      className="text-[10px] px-2 py-1 rounded bg-muted/20 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Last
                    </button>
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
};

export default AdminSignalInsights;
