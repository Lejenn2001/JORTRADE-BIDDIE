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
  const [filterOutcome, setFilterOutcome] = useState<"all" | "hit" | "partial_hit" | "near_miss" | "missed" | "expired" | "pending">("all");
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
  const [showSignalLog, setShowSignalLog] = useState(false);
  const [showAlgorithmDocs, setShowAlgorithmDocs] = useState(false);

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
    let hits = 0, partialHits = 0, nearMisses = 0, misses = 0, expired = 0, pending = 0;
    for (const s of signals) {
      if (s.outcome === "hit") hits++;
      else if (s.outcome === "partial_hit") partialHits++;
      else if (s.outcome === "near_miss") nearMisses++;
      else if (s.outcome === "missed") misses++;
      else if (s.outcome === "expired") expired++;
      else pending++;
    }
    const resolved = hits + partialHits + nearMisses + misses;
    const successRate = resolved > 0 ? ((hits + partialHits) / resolved) * 100 : null;
    return { hits, partialHits, nearMisses, misses, expired, pending, total: signals.length, resolved, winRate: successRate };
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
      const outcome = s.outcome === "hit" ? "hit" : s.outcome === "partial_hit" ? "hit" : s.outcome === "missed" ? "missed" : s.outcome === "near_miss" ? "missed" : s.outcome === "expired" ? "missed" : "pending";

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
      else if (s.outcome === "missed" || s.outcome === "near_miss" || s.outcome === "expired") { if (isCall) callMisses++; else putMisses++; }
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
      else if (s.outcome === "missed" || s.outcome === "near_miss" || s.outcome === "expired") map[cat].misses++;
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
          const order: Record<string, number> = { hit: 0, partial_hit: 1, near_miss: 2, pending: 3, expired: 4, missed: 5 };
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

        <div className="grid grid-cols-3 lg:grid-cols-9 gap-3 p-4">
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Win rate: (Hits + Partials) / (Hits + Partials + Near Misses + Misses)">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
            <p className={`text-2xl font-bold ${stats.winRate !== null && stats.winRate >= 50 ? "text-emerald-400" : stats.winRate !== null ? "text-destructive" : "text-foreground"}`}>
              {stats.winRate !== null ? `${stats.winRate.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="MFE ≥75% of target — full hit">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Hits</p>
            <p className="text-2xl font-bold text-emerald-400">{stats.hits}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="MFE 50-74% of target — directionally right, tradeable">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Partial</p>
            <p className="text-2xl font-bold text-blue-400">{stats.partialHits}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="MFE 30-49% of target — right idea, weak execution window">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Near Miss</p>
            <p className="text-2xl font-bold text-orange-400">{stats.nearMisses}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="MFE <30% of target or invalidation breached">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Misses</p>
            <p className="text-2xl font-bold text-destructive">{stats.misses}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center" title="Expired without resolution">
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
            <h2 className="text-lg font-bold text-foreground">Chart Analysis</h2>
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
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowSignalLog(!showSignalLog)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setShowSignalLog(!showSignalLog); }}
          className="w-full px-5 py-4 flex items-center gap-2 hover:bg-muted/10 transition-colors cursor-pointer"
        >
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
          {showSignalLog ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />}
        </div>
        {showSignalLog && (<>
        <div className="px-4 py-2 border-t border-border/30 flex items-center gap-1.5 flex-wrap">
          {(["all", "hit", "partial_hit", "near_miss", "missed", "expired", "pending"] as const).map(f => {
            const colors: Record<string, string> = {
              all: "bg-primary/20 text-primary border border-primary/40",
              hit: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
              partial_hit: "bg-blue-500/20 text-blue-400 border border-blue-500/40",
              near_miss: "bg-orange-500/20 text-orange-400 border border-orange-500/40",
              missed: "bg-red-500/20 text-red-400 border border-red-500/40",
              expired: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40",
              pending: "bg-amber-500/20 text-amber-400 border border-amber-500/40",
            };
            const labels: Record<string, string> = {
              all: "All",
              hit: `Hits (${stats.hits})`,
              partial_hit: `Partial (${stats.partialHits})`,
              near_miss: `Near Miss (${stats.nearMisses})`,
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
                            ) : s.outcome === "near_miss" ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full"><AlertTriangle className="h-3 w-3" /> NEAR MISS</span>
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
                              <span className={`font-bold ${
                                mfePct >= 75 ? "text-emerald-400" :
                                mfePct >= 50 ? "text-blue-400" :
                                mfePct >= 30 ? "text-orange-400" :
                                mfePct >= 0 ? "text-red-400" :
                                "text-destructive"
                              }`}>
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
                                    s.outcome === "near_miss" ? "bg-orange-500/5 border-orange-500/20" :
                                    s.outcome === "missed" ? "bg-red-500/5 border-red-500/20" :
                                    s.outcome === "expired" ? "bg-zinc-500/5 border-zinc-500/20" :
                                    "bg-amber-500/5 border-amber-500/20"
                                  }`}>
                                    <div className="flex items-start gap-2">
                                      <Info className={`h-4 w-4 mt-0.5 shrink-0 ${
                                        s.outcome === "hit" ? "text-emerald-400" :
                                        s.outcome === "partial_hit" ? "text-blue-400" :
                                        s.outcome === "near_miss" ? "text-orange-400" :
                                        s.outcome === "missed" ? "text-destructive" :
                                        s.outcome === "expired" ? "text-zinc-400" :
                                        "text-amber-400"
                                      }`} />
                                      <div>
                                        <p className={`text-sm font-semibold ${
                                          s.outcome === "hit" ? "text-emerald-400" :
                                          s.outcome === "partial_hit" ? "text-blue-400" :
                                          s.outcome === "near_miss" ? "text-orange-400" :
                                          s.outcome === "missed" ? "text-destructive" :
                                          s.outcome === "expired" ? "text-zinc-400" :
                                          "text-amber-400"
                                        }`}>
                                          {s.outcome === "hit" ? "How this was scored a HIT (MFE ≥75%)" :
                                           s.outcome === "partial_hit" ? "How this was scored a PARTIAL HIT (MFE 50-74%)" :
                                           s.outcome === "near_miss" ? "How this was scored a NEAR MISS (MFE 30-49%)" :
                                           s.outcome === "missed" ? "How this was scored a MISS (MFE <30%)" :
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
                                    <div className={`rounded-lg p-2.5 border ${
                                      detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 75 ? "bg-emerald-500/10 border-emerald-500/20" :
                                      detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 50 ? "bg-blue-500/10 border-blue-500/20" :
                                      detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 30 ? "bg-orange-500/10 border-orange-500/20" :
                                      "bg-muted/15 border-border/20"
                                    }`}>
                                      <span className="text-[9px] font-medium text-muted-foreground uppercase">MFE % to Target</span>
                                      <div className="flex items-center gap-1.5">
                                        <p className={`text-sm font-bold ${
                                          detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 75 ? "text-emerald-400" :
                                          detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 50 ? "text-blue-400" :
                                          detail.signal.pctToTarget != null && detail.signal.pctToTarget >= 30 ? "text-orange-400" :
                                          "text-muted-foreground"
                                        }`}>
                                          {detail.signal.pctToTarget != null ? `${detail.signal.pctToTarget.toFixed(1)}%` : "—"}
                                        </p>
                                        {detail.signal.pctToTarget != null && (
                                          <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${
                                            detail.signal.pctToTarget >= 75 ? "bg-emerald-400/15 text-emerald-400" :
                                            detail.signal.pctToTarget >= 50 ? "bg-blue-400/15 text-blue-400" :
                                            detail.signal.pctToTarget >= 30 ? "bg-orange-400/15 text-orange-400" :
                                            "bg-red-400/15 text-red-400"
                                          }`}>
                                            {detail.signal.pctToTarget >= 75 ? "HIT" :
                                             detail.signal.pctToTarget >= 50 ? "PARTIAL" :
                                             detail.signal.pctToTarget >= 30 ? "NEAR" :
                                             "MISS"}
                                          </span>
                                        )}
                                      </div>
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
        </>)}
      </div>

      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowAlgorithmDocs(!showAlgorithmDocs)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setShowAlgorithmDocs(!showAlgorithmDocs); }}
          className="flex items-center gap-3 p-5 cursor-pointer hover:bg-muted/10 transition-colors"
        >
          <BookOpen className="h-5 w-5 text-indigo-400" />
          <h2 className="text-lg font-bold text-foreground">Algorithm Documentation</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold">REFERENCE</span>
          {showAlgorithmDocs ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />}
        </div>
        {showAlgorithmDocs && (
          <div className="p-5 pt-0 space-y-6">

            <div className="bg-card/50 rounded-xl p-5 border border-border/30">
              <h3 className="text-sm font-bold text-foreground mb-4">Signal Categories</h3>
              <div className="space-y-4">
                <div className="rounded-lg p-4 border border-emerald-500/20 bg-emerald-500/5">
                  <h4 className="font-semibold text-emerald-400 text-xs mb-2">Algorithm Plays</h4>
                  <p className="text-[11px] text-muted-foreground mb-3">Default category for signals that pass all hard filters but don't meet Whale or Spread thresholds.</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p className="text-foreground font-semibold text-[10px] uppercase tracking-wider">Hard Filters (must pass all):</p>
                    <p>• Min <span className="text-emerald-400 font-medium">$25,000</span> total premium</p>
                    <p>• Min <span className="text-emerald-400 font-medium">50%</span> ask-side aggression</p>
                    <p>• Strike within <span className="text-emerald-400 font-medium">15% OTM</span> max</p>
                    <p>• Strike not deeper than <span className="text-emerald-400 font-medium">5% ITM</span> (hedge filter)</p>
                    <p>• Expiry within <span className="text-emerald-400 font-medium">45 days</span></p>
                    <p>• Polygon vs UW price divergence &lt; <span className="text-emerald-400 font-medium">20%</span></p>
                    <p>• Strike/price ratio <span className="text-emerald-400 font-medium">0.33x – 3x</span></p>
                    <p className="text-foreground font-semibold text-[10px] uppercase tracking-wider pt-2">Price Action Confirmation:</p>
                    <p>• 1m/5m candles checked for engulfing, pin bars, VWAP/PDH/PDL/Pivot breaks</p>
                    <p>• Gamma zone alignment (neg gamma = explosive, pos gamma = mean reversion)</p>
                    <p>• VWAP position: Calls above VWAP or Puts below VWAP = "⚡ Act Now"</p>
                  </div>
                </div>

                <div className="rounded-lg p-4 border border-blue-500/20 bg-blue-500/5">
                  <h4 className="font-semibold text-blue-400 text-xs mb-2">Whale Plays</h4>
                  <p className="text-[11px] text-muted-foreground mb-3">Large institutional flow. Same hard filters as Algorithm, plus premium thresholds.</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p className="text-foreground font-semibold text-[10px] uppercase tracking-wider">Classification (either condition):</p>
                    <p>• Total premium ≥ <span className="text-blue-400 font-medium">$2,000,000</span></p>
                    <p>• OR premium ≥ <span className="text-blue-400 font-medium">$1,000,000</span> AND (<span className="text-blue-400 font-medium">Sweep</span> OR aggression ≥ <span className="text-blue-400 font-medium">90%</span>)</p>
                  </div>
                </div>

                <div className="rounded-lg p-4 border border-purple-500/20 bg-purple-500/5">
                  <h4 className="font-semibold text-purple-400 text-xs mb-2">Spread Plays</h4>
                  <p className="text-[11px] text-muted-foreground mb-3">Multi-leg options strategies with defined risk.</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p className="text-foreground font-semibold text-[10px] uppercase tracking-wider">Detection (two paths):</p>
                    <p>• UW <span className="text-purple-400 font-medium">has_multileg = true</span> flag</p>
                    <p>• OR AI-generated spread recs from strong Whale/Algo signals</p>
                  </div>
                </div>

                <div className="rounded-lg p-4 border border-amber-500/20 bg-amber-500/5">
                  <h4 className="font-semibold text-amber-400 text-xs mb-2">Biddie Picks ⭐</h4>
                  <p className="text-[11px] text-muted-foreground mb-3">Highest-conviction signals. Must pass both algorithmic scoring AND Claude AI evaluation.</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p className="text-foreground font-semibold text-[10px] uppercase tracking-wider">All 3 must be true:</p>
                    <p>• Claude confirms <span className="text-amber-400 font-medium">NOT a hedge</span></p>
                    <p>• AI-adjusted confidence ≥ <span className="text-amber-400 font-medium">8 / 10</span></p>
                    <p>• Quality rated <span className="text-amber-400 font-medium">"strong" or "moderate"</span></p>
                    <p className="text-foreground font-semibold text-[10px] uppercase tracking-wider pt-2">Claude ICT/SMC Evaluation:</p>
                    <p>• <span className="text-foreground font-medium">8-10:</span> Trend-aligned + Discount/Premium zone + liquidity sweep</p>
                    <p>• <span className="text-foreground font-medium">5-8:</span> Valid reversal (CHoCH confirmed) or FVG play</p>
                    <p>• <span className="text-foreground font-medium">3-5:</span> Counter-trend without structure, or likely hedge</p>
                    <p>• Checks: BOS, CHoCH, FVG, Order Blocks, Liquidity Sweeps</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card/50 rounded-xl p-5 border border-border/30">
              <h3 className="text-sm font-bold text-foreground mb-4">Confidence Scoring — Base Algorithm</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Base score starts at <span className="text-foreground font-semibold">5</span>. Top 15 candidates go to Claude for final AI refinement.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg p-3 border border-emerald-500/20 bg-emerald-500/5">
                  <p className="text-[10px] font-bold text-emerald-400 uppercase mb-2">Score Additions</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p><span className="text-emerald-400 font-medium">+1</span> Sweep order</p>
                    <p><span className="text-emerald-400 font-medium">+1</span> Ask aggression ≥ 80%</p>
                    <p><span className="text-emerald-400 font-medium">+1.5</span> Ask aggression ≥ 95%</p>
                    <p><span className="text-emerald-400 font-medium">+0.5</span> Premium ≥ $100K</p>
                    <p><span className="text-emerald-400 font-medium">+1</span> Premium ≥ $500K</p>
                    <p><span className="text-emerald-400 font-medium">+1.5</span> Premium ≥ $1M</p>
                    <p><span className="text-emerald-400 font-medium">+0.5</span> Vol/OI ≥ 2x</p>
                    <p><span className="text-emerald-400 font-medium">+1</span> Vol/OI ≥ 5x</p>
                    <p><span className="text-emerald-400 font-medium">+0.5–1</span> ATM strike (within 2-5%)</p>
                    <p><span className="text-emerald-400 font-medium">+1</span> Price action confirmation</p>
                  </div>
                </div>
                <div className="rounded-lg p-3 border border-red-500/20 bg-red-500/5">
                  <p className="text-[10px] font-bold text-red-400 uppercase mb-2">Score Penalties</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p><span className="text-red-400 font-medium">-1.5</span> Counter-trend (Call below VWAP, Put above VWAP)</p>
                    <p><span className="text-red-400 font-medium">-1</span> Deep OTM strike</p>
                  </div>
                  <p className="text-[10px] font-bold text-blue-400 uppercase mb-2 mt-4">AI Refinement (Top 15)</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>• Claude adjusts via ICT/SMC confluence</p>
                    <p>• Returns: is_hedge, adjusted_confidence, signal_quality</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card/50 rounded-xl p-5 border border-border/30">
              <h3 className="text-sm font-bold text-foreground mb-4">Breakout Scanner</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Scans 40+ tickers using 60 days of daily candles + live Polygon WebSocket. Cached 5 min.</p>
              <div className="space-y-3">
                <div className="rounded-lg p-3 border border-cyan-500/20 bg-cyan-500/5">
                  <p className="text-[10px] font-bold text-cyan-400 uppercase mb-2">Detection Layers & Scoring</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p><span className="text-cyan-400 font-medium">+25 pts</span> <span className="text-foreground font-medium">Squeeze:</span> BBands (2.0σ) inside Keltner (1.5 ATR)</p>
                    <p><span className="text-cyan-400 font-medium">+15 pts</span> <span className="text-foreground font-medium">Consolidation:</span> Price within 3% range for 3+ days</p>
                    <p><span className="text-cyan-400 font-medium">+20 pts</span> <span className="text-foreground font-medium">Volume:</span> Current &gt; 2.0x 20-day avg (+10 for &gt; 1.3x)</p>
                    <p><span className="text-cyan-400 font-medium">+trend</span> <span className="text-foreground font-medium">Momentum:</span> EMA8 + SMA20 alignment</p>
                    <p><span className="text-cyan-400 font-medium">+flow</span> <span className="text-foreground font-medium">Options bias:</span> Call/put ratios, sweeps, near-term weighted 1.0-1.5x</p>
                  </div>
                </div>
                <div className="rounded-lg p-3 border border-amber-500/20 bg-amber-500/5">
                  <p className="text-[10px] font-bold text-amber-400 uppercase mb-2">Breakout Trigger ("ENTER NOW")</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>1. Close crosses resistance (bull) or support (bear)</p>
                    <p>2. Previous candle was inside the range</p>
                    <p>3. Volume ≥ <span className="text-amber-400 font-medium">1.5x</span> 20-day average</p>
                  </div>
                </div>
                <div className="rounded-lg p-3 border border-red-500/20 bg-red-500/5">
                  <p className="text-[10px] font-bold text-red-400 uppercase mb-2">Real-Time Alerts (WebSocket)</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>• Price crosses R/S buffer (<span className="text-foreground font-medium">0.2%</span>)</p>
                    <p>• Session vol ≥ <span className="text-red-400 font-medium">1.5x</span> expected</p>
                    <p>• Burst vol ≥ <span className="text-red-400 font-medium">3.0x</span> (60s vs 10min)</p>
                    <p>• Both high → <span className="text-foreground font-medium">"INSTITUTIONAL"</span> tag</p>
                    <p>• <span className="text-foreground font-medium">15-min cooldown</span> per ticker/direction</p>
                    <p>• Auto-suggests option contract</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card/50 rounded-xl p-5 border border-border/30">
              <h3 className="text-sm font-bold text-foreground mb-4">Dashboard Biddie — Chat AI</h3>
              <p className="text-[11px] text-muted-foreground mb-4">Claude Sonnet 4 (claude-sonnet-4-6). Two modes: full analysis (private) and social (community).</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg p-3 border border-purple-500/20 bg-purple-500/5">
                  <p className="text-[10px] font-bold text-purple-400 uppercase mb-2">Data Available Per Response</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>• UW flow (premium, sweeps, aggression) — <span className="text-foreground font-medium">always</span></p>
                    <p>• VWAP, Pivots, PDH/PDL — <span className="text-foreground font-medium">per ticker</span></p>
                    <p>• FVGs, Order Blocks, Liquidity — <span className="text-foreground font-medium">per ticker</span></p>
                    <p>• Dark pool — <span className="text-foreground font-medium">when requested</span></p>
                    <p>• Sector ETFs + econ calendar — <span className="text-foreground font-medium">on "market" query</span></p>
                    <p>• 14-day trading calendar — <span className="text-foreground font-medium">always</span></p>
                  </div>
                </div>
                <div className="rounded-lg p-3 border border-purple-500/20 bg-purple-500/5">
                  <p className="text-[10px] font-bold text-purple-400 uppercase mb-2">Trade Call Format</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>• Ticker + contract (e.g. "SPY 645 Put")</p>
                    <p>• Entry trigger tied to VWAP/levels</p>
                    <p>• Target + Invalidation</p>
                    <p>• Confidence (7-10) from flow + premium</p>
                    <p>• Position reviews: Delta, Gamma, Theta → Hold/Cut/Add</p>
                  </div>
                </div>
                <div className="rounded-lg p-3 border border-purple-500/20 bg-purple-500/5 md:col-span-2">
                  <p className="text-[10px] font-bold text-amber-400 uppercase mb-2">Personality & Guardrails</p>
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <p>• "Your trading bestie" — warm, casual, trader slang</p>
                    <p>• Never suggests alternative tickers</p>
                    <p>• Validates expiry dates against real calendar</p>
                    <p>• If nothing good: "Sit tight, don't force it."</p>
                    <p>• <span className="text-foreground font-medium">/whale/chat</span> = full data | <span className="text-foreground font-medium">/whale/community-chat</span> = social mode</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSignalInsights;
