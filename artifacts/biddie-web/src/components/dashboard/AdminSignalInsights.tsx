import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle, XCircle, Clock, TrendingUp, TrendingDown,
  BarChart3, AlertTriangle, Lightbulb, ChevronDown, ChevronUp,
  Target, Activity, Zap, BookOpen, Info, Loader2,
  ArrowUp, ArrowDown, Timer, Crosshair
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

const AdminSignalInsights = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [filterOutcome, setFilterOutcome] = useState<"all" | "hit" | "missed" | "pending">("all");
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
    let hits = 0, misses = 0, pending = 0;
    for (const s of signals) {
      if (s.outcome === "hit") hits++;
      else if (s.outcome === "missed") misses++;
      else pending++;
    }
    const resolved = hits + misses;
    return { hits, misses, pending, total: signals.length, resolved, winRate: resolved > 0 ? (hits / resolved) * 100 : null };
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
      const outcome = s.outcome === "hit" ? "hit" : s.outcome === "missed" ? "missed" : "pending";

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
      const outcome = s.outcome === "hit" ? "hit" : s.outcome === "missed" ? "missed" : "pending";
      if (outcome === "hit") { if (isCall) callHits++; else putHits++; }
      else if (outcome === "missed") { if (isCall) callMisses++; else putMisses++; }
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
      if (s.outcome === "hit") map[cat].hits++;
      else if (s.outcome === "missed") map[cat].misses++;
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
        if (rate < 35) {
          results.push({
            type: "warning",
            title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} source underperforming`,
            detail: `${cat} signals at ${rate.toFixed(0)}% win rate (${s.hits}/${resolved}). This source may need tuning or stricter filtering.`,
          });
        } else if (rate >= 65) {
          results.push({
            type: "success",
            title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} source performing well`,
            detail: `${cat} signals at ${rate.toFixed(0)}% win rate (${s.hits}/${resolved}). This is a reliable signal source.`,
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
      const normalized = s.outcome === "hit" ? "hit" : s.outcome === "missed" ? "missed" : "pending";
      return normalized === filterOutcome;
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
          const order = { hit: 0, missed: 1, pending: 2 };
          const ao = order[(a.outcome === "hit" ? "hit" : a.outcome === "missed" ? "missed" : "pending") as keyof typeof order];
          const bo = order[(b.outcome === "hit" ? "hit" : b.outcome === "missed" ? "missed" : "pending") as keyof typeof order];
          return (ao - bo) * dir;
        }
        case "ticker": return a.ticker.localeCompare(b.ticker) * dir;
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
        case "aipick": return 0;
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
          <h2 className="text-lg font-bold text-foreground">Signal Performance Insights</h2>
          <span className="text-[10px] text-muted-foreground ml-auto">{stats.total} total signals</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 p-4">
          <div className="bg-muted/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
            <p className={`text-2xl font-bold ${stats.winRate !== null && stats.winRate >= 50 ? "text-emerald-400" : stats.winRate !== null ? "text-destructive" : "text-foreground"}`}>
              {stats.winRate !== null ? `${stats.winRate.toFixed(1)}%` : "—"}
            </p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Hits</p>
            <p className="text-2xl font-bold text-emerald-400">{stats.hits}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Misses</p>
            <p className="text-2xl font-bold text-destructive">{stats.misses}</p>
          </div>
          <div className="bg-muted/20 rounded-lg p-3 text-center">
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

      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <button
          onClick={() => setShowMethodology(!showMethodology)}
          className="w-full px-5 py-4 border-b border-border/40 flex items-center gap-2 hover:bg-muted/10 transition-colors"
        >
          <BookOpen className="h-5 w-5 text-blue-400" />
          <h2 className="text-lg font-bold text-foreground">Signal Verification Methodology</h2>
          {showMethodology ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />}
        </button>
        {showMethodology && (
          <div className="p-5 space-y-4 text-sm text-muted-foreground">
            <div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Verification Cycle</h3>
              <p>Every pending signal is checked on a regular interval against live Polygon.io price data. The verifier pulls the stock's price history since the signal was detected, including the current price, the highest price since detection, and the lowest price since detection.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400 uppercase">HIT (Checked First)</span>
                </div>
                <p className="text-xs leading-relaxed">Price reached the target zone. For <span className="text-emerald-400 font-semibold">bullish/CALL</span> signals: the high since detection reached the target price. For <span className="text-red-400 font-semibold">bearish/PUT</span> signals: the low since detection dropped to the target price. <span className="text-foreground font-semibold">Directional move fallback:</span> If the parsed target is invalid or in the wrong direction, the signal is still a HIT if price moved at least 0.5% in the correct direction (up for bullish, down for bearish).</p>
              </div>
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="h-4 w-4 text-red-400" />
                  <span className="text-xs font-bold text-red-400 uppercase">MISS (Checked Second)</span>
                </div>
                <p className="text-xs leading-relaxed">Price breached the invalidation level <span className="text-foreground font-semibold">after 2+ hours</span> of being active. For <span className="text-emerald-400 font-semibold">bullish</span>: current price fell to or below invalidation. For <span className="text-red-400 font-semibold">bearish</span>: current price rose to or above invalidation. Invalidation must be on the correct side (below entry for bullish, above entry for bearish) or it is ignored.</p>
              </div>
              <div className="rounded-lg bg-muted/20 border border-border/40 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400 uppercase">EXPIRED</span>
                </div>
                <p className="text-xs leading-relaxed">The signal's expiry date passed without hitting target or invalidation. If the current price is on the <span className="text-foreground font-semibold">wrong side of entry</span> at expiry, it becomes a MISS. If price is flat or favorable but didn't reach the target, it's marked EXPIRED (not counted in win rate).</p>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Key Rules</h3>
              <ul className="space-y-1.5 text-xs">
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">1.</span>
                  <span><span className="text-foreground font-semibold">Priority order:</span> HIT is checked before MISS every cycle. If price touched the target at any point — even if it later hit invalidation — it's a HIT.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">2.</span>
                  <span><span className="text-foreground font-semibold">2-hour grace period:</span> A signal cannot be marked MISS until it has been active for at least 2 hours. This prevents premature resolution from market noise.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">3.</span>
                  <span><span className="text-foreground font-semibold">Directional sanity checks:</span> Targets and invalidation levels must make directional sense. A bearish signal with a target ABOVE entry price is ignored (bad parse). Same for a bullish signal with invalidation ABOVE entry.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">4.</span>
                  <span><span className="text-foreground font-semibold">Win Rate formula:</span> Hits ÷ (Hits + Misses). Pending and Expired signals are excluded from the calculation.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">5.</span>
                  <span><span className="text-foreground font-semibold">Direction detection:</span> Uses option type (CALL/PUT) first. Falls back to signal_type (bullish/bearish) only if option type is missing.</span>
                </li>
              </ul>
            </div>

            <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3">
              <p className="text-xs text-blue-300">
                <span className="font-bold">Data source:</span> All price verification uses Polygon.io real-time and historical data. Signals are generated by Claude AI analyzing Unusual Whales options flow data with ICT/SMC methodology.
              </p>
            </div>
          </div>
        )}
      </div>

      {insights.length > 0 && (
        <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-400" />
            <h2 className="text-lg font-bold text-foreground">Pattern Analysis</h2>
            <span className="text-[10px] bg-amber-400/15 text-amber-400 px-2 py-0.5 rounded-full font-semibold ml-auto">{insights.length} insights</span>
          </div>
          <div className="p-4 space-y-3">
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
        </div>
      )}

      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Ticker Performance Breakdown</h2>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {tickerPatterns.filter(tp => tp.total >= 1).map(tp => {
              const resolved = tp.hits + tp.misses;
              return (
                <div key={tp.ticker} className="bg-muted/15 rounded-lg p-3 border border-border/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-foreground">{tp.ticker}</span>
                    {tp.winRate !== null ? (
                      <span className={`text-xs font-bold ${tp.winRate >= 50 ? "text-emerald-400" : "text-destructive"}`}>
                        {tp.winRate.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-xs text-amber-400">pending</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="text-emerald-400">{tp.hits}H</span>
                    <span className="text-destructive">{tp.misses}M</span>
                    <span className="text-amber-400">{tp.pending}P</span>
                  </div>
                  {resolved > 0 && (
                    <div className="mt-1.5 h-1 bg-muted/30 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-400 rounded-l-full" style={{ width: `${(tp.hits / resolved) * 100}%` }} />
                      <div className="h-full bg-destructive rounded-r-full" style={{ width: `${(tp.misses / resolved) * 100}%` }} />
                    </div>
                  )}
                  <div className="flex gap-2 mt-1.5 text-[9px] text-muted-foreground/70">
                    {(tp.callHits + tp.callMisses) > 0 && (
                      <span>C: {tp.callHits}/{tp.callHits + tp.callMisses}</span>
                    )}
                    {(tp.putHits + tp.putMisses) > 0 && (
                      <span>P: {tp.putHits}/{tp.putHits + tp.putMisses}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Full Signal Log</h2>
            <span className="text-[10px] text-muted-foreground">({filteredSignals.length} signals)</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "hit", "missed", "pending"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilterOutcome(f)}
                className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all ${
                  filterOutcome === f
                    ? f === "hit" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    : f === "missed" ? "bg-red-500/20 text-red-400 border border-red-500/40"
                    : f === "pending" ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    : "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/20 text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "all" ? "All" : f === "hit" ? `Hits (${stats.hits})` : f === "missed" ? `Misses (${stats.misses})` : `Pending (${stats.pending})`}
              </button>
            ))}
            <button
              onClick={() => setShowAllSignals(!showAllSignals)}
              className="text-[10px] text-muted-foreground hover:text-foreground ml-2 flex items-center gap-1"
            >
              {showAllSignals ? "Collapse" : "Expand"}
              {showAllSignals ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        </div>

        <div className={`overflow-x-auto ${showAllSignals ? "" : "max-h-[400px]"} overflow-y-auto`}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background/95 backdrop-blur z-10">
              <tr className="border-b border-border/30">
                {[
                  { key: "status", label: "Status" },
                  { key: "detected", label: "Detected" },
                  { key: "ticker", label: "Ticker" },
                  { key: "direction", label: "Direction" },
                  { key: "strike", label: "Strike" },
                  { key: "expiry", label: "Expiration" },
                  { key: "source", label: "Source" },
                  { key: "entry", label: "Entry $" },
                  { key: "score", label: "Score" },
                  { key: "aipick", label: "Biddie AI Pick" },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase cursor-pointer hover:text-foreground transition-colors select-none"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortCol === col.key && (
                        <span className="text-primary">{sortDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSignals.map(s => {
                const detected = new Date(s.detected_at || s.created_at);
                const isExpanded = expandedSignal === s.id;
                const detail = signalDetails[s.id];
                const isLoadingDetail = detailLoading === s.id;
                return (
                  <Fragment key={s.id}>
                    <tr
                      className={`border-b border-border/20 hover:bg-muted/20 transition-colors cursor-pointer ${isExpanded ? "bg-muted/30" : ""}`}
                      onClick={() => toggleExpand(s.id)}
                    >
                      <td className="px-4 py-2">
                        {s.outcome === "hit" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                            <CheckCircle className="h-3 w-3" /> HIT
                          </span>
                        ) : s.outcome === "missed" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                            <XCircle className="h-3 w-3" /> MISS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                            <Clock className="h-3 w-3" /> PENDING
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {detected.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                          {detected.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          <span className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>
                            <ChevronDown className="h-3 w-3 text-muted-foreground/50" />
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2 font-bold text-foreground">{s.ticker}</td>
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1 text-xs">
                          {s.signal_type === "bullish" ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <TrendingDown className="h-3 w-3 text-destructive" />
                          )}
                          <span className={s.signal_type === "bullish" ? "text-emerald-400" : "text-destructive"}>
                            {s.put_call?.toUpperCase() || s.signal_type.toUpperCase()}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{s.strike ? `$${s.strike}` : "—"}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{s.expiry || "—"}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground capitalize">{s.category || "—"}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{s.price_at_signal ? `$${Number(s.price_at_signal).toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2 text-xs font-semibold text-foreground">{s.confidence}</td>
                      <td className="px-4 py-2 text-center">
                        <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-400/30">
                          Y
                        </span>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {isExpanded && (
                        <tr>
                          <td colSpan={10} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 py-4 bg-muted/10 border-b border-border/30">
                                {isLoadingDetail ? (
                                  <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading signal details...
                                  </div>
                                ) : detail ? (
                                  <div className="space-y-4">
                                    <div className={`rounded-lg p-3 border ${
                                      s.outcome === "hit" ? "bg-emerald-500/5 border-emerald-500/20" :
                                      s.outcome === "missed" ? "bg-red-500/5 border-red-500/20" :
                                      "bg-amber-500/5 border-amber-500/20"
                                    }`}>
                                      <div className="flex items-start gap-2">
                                        <Info className={`h-4 w-4 mt-0.5 shrink-0 ${
                                          s.outcome === "hit" ? "text-emerald-400" :
                                          s.outcome === "missed" ? "text-destructive" :
                                          "text-amber-400"
                                        }`} />
                                        <div>
                                          <p className={`text-sm font-semibold ${
                                            s.outcome === "hit" ? "text-emerald-400" :
                                            s.outcome === "missed" ? "text-destructive" :
                                            "text-amber-400"
                                          }`}>
                                            {s.outcome === "hit" ? "How this was scored a HIT" :
                                             s.outcome === "missed" ? "How this was scored a MISS" :
                                             "Signal Still Being Tracked"}
                                          </p>
                                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                                            {detail.signal.explanation}
                                          </p>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <Crosshair className="h-3.5 w-3.5 text-blue-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Entry Price</span>
                                        </div>
                                        <p className="text-sm font-bold text-foreground">
                                          {detail.signal.entryPrice ? `$${detail.signal.entryPrice.toFixed(2)}` : "—"}
                                        </p>
                                      </div>

                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <Activity className="h-3.5 w-3.5 text-violet-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Current Price</span>
                                        </div>
                                        <p className="text-sm font-bold text-foreground">
                                          {detail.priceHistory?.currentPrice ? `$${detail.priceHistory.currentPrice.toFixed(2)}` : "—"}
                                        </p>
                                      </div>

                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <ArrowUp className="h-3.5 w-3.5 text-emerald-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">High Since Signal</span>
                                        </div>
                                        <p className="text-sm font-bold text-emerald-400">
                                          {detail.priceHistory?.highSince ? `$${detail.priceHistory.highSince.toFixed(2)}` : "—"}
                                        </p>
                                        {detail.priceHistory?.highSince && detail.signal.entryPrice ? (
                                          <span className="text-[10px] text-emerald-400/70">
                                            +{(((detail.priceHistory.highSince - detail.signal.entryPrice) / detail.signal.entryPrice) * 100).toFixed(2)}%
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <ArrowDown className="h-3.5 w-3.5 text-destructive" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Low Since Signal</span>
                                        </div>
                                        <p className="text-sm font-bold text-destructive">
                                          {detail.priceHistory?.lowSince ? `$${detail.priceHistory.lowSince.toFixed(2)}` : "—"}
                                        </p>
                                        {detail.priceHistory?.lowSince && detail.signal.entryPrice ? (
                                          <span className="text-[10px] text-destructive/70">
                                            {(((detail.priceHistory.lowSince - detail.signal.entryPrice) / detail.signal.entryPrice) * 100).toFixed(2)}%
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <Target className="h-3.5 w-3.5 text-amber-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Target</span>
                                        </div>
                                        <p className="text-xs text-foreground leading-relaxed">
                                          {detail.signal.target || s.target_price || "Not specified"}
                                        </p>
                                      </div>

                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <XCircle className="h-3.5 w-3.5 text-red-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Invalidation</span>
                                        </div>
                                        <p className="text-xs text-foreground leading-relaxed">
                                          {detail.signal.invalidation || s.invalidation || "Not specified"}
                                        </p>
                                      </div>

                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <Timer className="h-3.5 w-3.5 text-blue-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">Time to Resolve</span>
                                        </div>
                                        <p className="text-xs text-foreground">
                                          {detail.signal.timeToResolve || (s.outcome === "pending" ? "Still tracking..." : "—")}
                                        </p>
                                        {s.resolved_at && (
                                          <p className="text-[10px] text-muted-foreground mt-0.5">
                                            Resolved: {new Date(s.resolved_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                                            {new Date(s.resolved_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                          </p>
                                        )}
                                      </div>
                                    </div>

                                    {detail.signal.reason && (
                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-1">
                                          <BookOpen className="h-3.5 w-3.5 text-violet-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">AI Analysis</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground leading-relaxed">{detail.signal.reason}</p>
                                      </div>
                                    )}

                                    {detail.priceHistory && detail.priceHistory.bars.length > 0 && (
                                      <div className="bg-muted/15 rounded-lg p-3 border border-border/20">
                                        <div className="flex items-center gap-1.5 mb-2">
                                          <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
                                          <span className="text-[10px] font-medium text-muted-foreground uppercase">
                                            Price Timeline ({detail.priceHistory.resolution === "5min" ? "5-min bars" : "Hourly bars"})
                                          </span>
                                          <span className="text-[10px] text-muted-foreground/50 ml-auto">{detail.priceHistory.bars.length} bars</span>
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
                                                  title={`${new Date(bar.time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} — $${bar.close.toFixed(2)}`}
                                                />
                                              );
                                            });
                                          })()}
                                        </div>
                                        <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1">
                                          <span>{new Date(detail.priceHistory.bars[0].time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                                          <span>{new Date(detail.priceHistory.bars[detail.priceHistory.bars.length - 1].time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground py-2">Unable to load details</p>
                                )}
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminSignalInsights;
