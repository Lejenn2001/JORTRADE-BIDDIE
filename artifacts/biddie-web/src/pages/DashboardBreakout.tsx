import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Zap, TrendingUp, TrendingDown, Activity, Target, Loader2,
  RefreshCw, ArrowUpRight, ArrowDownRight, Clock, AlertTriangle,
  ChevronRight, BarChart3, Crosshair, Minus, Bell, Radio,
  Info, ChevronDown
} from "lucide-react";

interface BreakoutSetup {
  ticker: string;
  squeezeActive: boolean;
  squeezeLength: number;
  consolidationDays: number;
  volumeRatio: number;
  breakoutTriggered: boolean;
  breakoutDirection: "bullish" | "bearish" | "none";
  breakoutPrice: number | null;
  currentPrice: number;
  resistanceLevel: number;
  supportLevel: number;
  score: number;
  reason: string;
  bbWidth: number;
  kcWidth: number;
  atr: number;
  targetPrice: number | null;
  proximityPct: number | null;
  imminenceLabel: string | null;
  imminenceScore: number;
}

interface ScanResult {
  setups: BreakoutSetup[];
  count: number;
  lastScan: string;
  tickersScanned: number;
}

interface BreakoutAlertData {
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
  volumeConfirmation?: {
    sessionVolumeRatio: number;
    burstVolumeRatio: number;
    institutionalConfirmed: boolean;
  };
}

interface AlertsResponse {
  count: number;
  alerts: BreakoutAlertData[];
  monitoring: {
    subscribedTickers: number;
    setupsWatched: number;
    wsConnected: boolean;
  };
}

const scoreColor = (score: number) => {
  if (score >= 60) return "text-emerald-400";
  if (score >= 40) return "text-yellow-400";
  if (score >= 25) return "text-orange-400";
  return "text-zinc-400";
};

const scoreBg = (score: number) => {
  if (score >= 60) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 40) return "bg-yellow-500/15 border-yellow-500/30";
  if (score >= 25) return "bg-orange-500/15 border-orange-500/30";
  return "bg-zinc-500/15 border-zinc-500/30";
};

const WATCHED_KEY = "jortrade-breakout-watched";

function loadWatched(): Set<string> {
  try {
    const raw = localStorage.getItem(WATCHED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}

function saveWatched(set: Set<string>) {
  localStorage.setItem(WATCHED_KEY, JSON.stringify([...set]));
}

const DashboardBreakout = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<BreakoutAlertData[]>([]);
  const [monitoring, setMonitoring] = useState<AlertsResponse["monitoring"] | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const alertPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [watchedTickers, setWatchedTickers] = useState<Set<string>>(loadWatched);
  const prevAlertsRef = useRef<string[]>([]);

  const toggleWatch = useCallback((ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setWatchedTickers(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      saveWatched(next);
      return next;
    });
  }, []);

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/breakout/scan");
      if (!resp.ok) throw new Error("Scan failed");
      const data = await resp.json();
      setResult(data);
      setLastScan(data.lastScan ? new Date(data.lastScan) : new Date());
    } catch (err: any) {
      setError(err.message || "Failed to run scan");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const resp = await fetch("/api/breakout/alerts");
      if (!resp.ok) return;
      const data: AlertsResponse = await resp.json();
      setAlerts(data.alerts);
      setMonitoring(data.monitoring);
    } catch {}
  }, []);

  useEffect(() => {
    runScan();
    fetchAlerts();
    alertPollRef.current = setInterval(fetchAlerts, 15000);
    return () => {
      if (alertPollRef.current) clearInterval(alertPollRef.current);
    };
  }, [runScan, fetchAlerts]);

  const timeSinceStr = lastScan
    ? `${Math.floor((Date.now() - lastScan.getTime()) / 60000)}m ago`
    : "—";

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          <div className="max-w-5xl mx-auto space-y-5">

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
                  <Crosshair className="h-6 w-6 text-primary" />
                  Breakout Scanner
                </h1>
                <p className="text-sm text-muted-foreground">
                  Bollinger/Keltner squeeze detection + consolidation patterns across 40 tickers
                </p>
              </div>
              <button
                onClick={runScan}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-sm transition-all border border-primary/20 disabled:opacity-40"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Scanning..." : "Rescan"}
              </button>
            </div>

            {lastScan && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Last scan: {timeSinceStr}
                </span>
                {result && (
                  <>
                    <span className="text-border">|</span>
                    <span>{result.tickersScanned} tickers scanned</span>
                    <span className="text-border">|</span>
                    <span className="font-semibold text-primary">{result.count} setups found</span>
                  </>
                )}
                {monitoring && (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1.5">
                      <Radio className={`h-3 w-3 ${monitoring.wsConnected ? "text-emerald-400 animate-pulse" : "text-zinc-500"}`} />
                      {monitoring.wsConnected ? `Monitoring ${monitoring.subscribedTickers} tickers live` : "Live monitor offline"}
                    </span>
                  </>
                )}
                {watchedTickers.size > 0 && (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1.5 text-primary font-semibold">
                      <Bell className="h-3 w-3 fill-current" />
                      {watchedTickers.size} watched
                    </span>
                  </>
                )}
              </div>
            )}

            {alerts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-yellow-400" />
                  <h2 className="text-sm font-bold text-foreground">Live Breakout Alerts</h2>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 font-bold">
                    {alerts.length}
                  </span>
                  {watchedTickers.size > 0 && alerts.some(a => watchedTickers.has(a.ticker)) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30 font-bold">
                      {alerts.filter(a => watchedTickers.has(a.ticker)).length} watched
                    </span>
                  )}
                </div>
                {[...alerts].sort((a, b) => {
                  const aWatched = watchedTickers.has(a.ticker) ? 1 : 0;
                  const bWatched = watchedTickers.has(b.ticker) ? 1 : 0;
                  return bWatched - aWatched;
                }).map((alert) => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={[
                      "rounded-2xl border p-4",
                      alert.direction === "bullish" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30",
                      watchedTickers.has(alert.ticker) ? "ring-2 ring-primary/40" : ""
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className={`h-12 w-12 rounded-xl flex items-center justify-center border ${
                          alert.direction === "bullish"
                            ? "bg-emerald-500/20 border-emerald-500/40"
                            : "bg-red-500/20 border-red-500/40"
                        }`}>
                          {alert.direction === "bullish"
                            ? <ArrowUpRight className="h-6 w-6 text-emerald-400" />
                            : <ArrowDownRight className="h-6 w-6 text-red-400" />
                          }
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xl font-black text-foreground tracking-tight">
                              {alert.suggestedTrade}
                            </p>
                            {alert.volumeConfirmation?.institutionalConfirmed && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/40">
                                INSTITUTIONAL
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Broke {alert.direction === "bullish" ? "above" : "below"} ${alert.direction === "bullish" ? alert.resistanceLevel.toFixed(2) : alert.supportLevel.toFixed(2)} at ${alert.breakoutPrice.toFixed(2)}
                            {alert.volumeConfirmation && (
                              <span className="ml-2 text-primary font-semibold">
                                Vol: {alert.volumeConfirmation.sessionVolumeRatio.toFixed(1)}x avg | Burst: {alert.volumeConfirmation.burstVolumeRatio.toFixed(1)}x
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {alert.targetPrice && (
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Target</p>
                            <p className="text-lg font-black text-primary">${alert.targetPrice.toFixed(2)}</p>
                          </div>
                        )}
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Score</p>
                          <p className={`text-lg font-black ${scoreColor(alert.score)}`}>{alert.score}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Triggered</p>
                          <p className="text-xs font-semibold text-foreground">
                            {new Date(alert.triggeredAt).toLocaleTimeString("en-US", {
                              hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York"
                            })} ET
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
              {loading && !result && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="glass-panel rounded-2xl border-glow-purple p-8"
                >
                  <div className="flex flex-col items-center gap-5">
                    <div className="relative">
                      <div className="h-20 w-20 rounded-full border-2 border-primary/30 flex items-center justify-center">
                        <Loader2 className="h-10 w-10 text-primary animate-spin" />
                      </div>
                      <div className="absolute inset-0 rounded-full border-2 border-primary/10 animate-ping" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-lg font-bold text-foreground">Scanning 40 Tickers</p>
                      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                        <p className="flex items-center gap-2 justify-center">
                          <Activity className="h-3.5 w-3.5 text-blue-400" />
                          Bollinger Band / Keltner Channel squeeze detection
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <BarChart3 className="h-3.5 w-3.5 text-purple-400" />
                          Consolidation pattern + volume spike analysis
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <Zap className="h-3.5 w-3.5 text-yellow-400" />
                          Breakout trigger detection on support/resistance
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-2xl p-6 border border-red-500/30"
                >
                  <div className="flex items-center gap-3 text-red-400">
                    <AlertTriangle className="h-5 w-5" />
                    <p className="font-semibold">{error}</p>
                  </div>
                </motion.div>
              )}

              {result && result.count === 0 && !loading && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-2xl p-10 text-center"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="h-16 w-16 rounded-full bg-muted/30 flex items-center justify-center">
                      <Minus className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-lg font-bold text-foreground">No Active Setups</p>
                      <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        No tickers are currently showing squeeze or consolidation breakout patterns.
                        This is normal — quality setups only appear 10-20% of the time.
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-2">
                      Scanner checks for Bollinger/Keltner squeezes, multi-day consolidation,
                      and volume spikes across SPY, QQQ, NVDA, AAPL, TSLA + 35 more tickers.
                    </p>
                  </div>
                </motion.div>
              )}

              {result && result.count > 0 && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-3"
                >
                  {result.setups.map((setup, i) => (
                    <motion.div
                      key={setup.ticker}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="glass-panel rounded-2xl border border-white/[0.06] hover:border-primary/30 transition-all cursor-pointer"
                      onClick={() => setExpandedTicker(expandedTicker === setup.ticker ? null : setup.ticker)}
                    >
                      <div className="p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 border ${scoreBg(setup.score)}`}>
                              <span className={`text-lg font-black ${scoreColor(setup.score)}`}>{setup.score}</span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-lg font-extrabold text-foreground">{setup.ticker}</span>
                                {setup.breakoutTriggered && (
                                  <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                    <Zap className="h-3 w-3" />
                                    BREAKOUT
                                  </span>
                                )}
                                {setup.squeezeActive && !setup.breakoutTriggered && (
                                  <span className="flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                                    <Activity className="h-3 w-3" />
                                    SQUEEZE
                                  </span>
                                )}
                                {setup.imminenceLabel && (
                                  <span className={`flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border ${
                                    setup.imminenceLabel === "BREAKOUT IMMINENT" || setup.imminenceLabel === "BREAKOUT ACTIVE"
                                      ? "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse"
                                      : setup.imminenceLabel === "LIKELY WITHIN 15 MIN"
                                        ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                                        : setup.imminenceLabel === "LIKELY WITHIN 1 HOUR"
                                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                          : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                  }`}>
                                    <Radio className="h-2.5 w-2.5" />
                                    {setup.imminenceLabel}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="truncate max-w-md">{setup.reason}</span>
                                {setup.targetPrice && (
                                  <span className="shrink-0 font-semibold text-primary">
                                    Target: ${setup.targetPrice.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right hidden sm:block">
                              <p className="text-sm font-bold text-foreground">${setup.currentPrice.toFixed(2)}</p>
                              <p className="text-[10px] text-muted-foreground">Current Price</p>
                            </div>
                            <button
                              onClick={(e) => toggleWatch(setup.ticker, e)}
                              className={`relative h-9 w-9 rounded-xl flex items-center justify-center transition-all border ${
                                watchedTickers.has(setup.ticker)
                                  ? "bg-primary/20 border-primary/50 text-primary shadow-[0_0_12px_rgba(124,58,237,0.3)]"
                                  : "bg-white/[0.03] border-white/[0.08] text-muted-foreground hover:border-primary/30 hover:text-primary/70"
                              }`}
                              title={watchedTickers.has(setup.ticker) ? "Stop watching for breakout" : "Watch for breakout alert"}
                            >
                              <Bell className={`h-4 w-4 ${watchedTickers.has(setup.ticker) ? "fill-current" : ""}`} />
                              {watchedTickers.has(setup.ticker) && (
                                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                              )}
                            </button>
                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedTicker === setup.ticker ? "rotate-90" : ""}`} />
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedTicker === setup.ticker && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                  <DetailCard
                                    label="Squeeze"
                                    value={setup.squeezeActive ? `Active (${setup.squeezeLength} bars)` : "Inactive"}
                                    icon={<Activity className="h-3.5 w-3.5" />}
                                    active={setup.squeezeActive}
                                  />
                                  <DetailCard
                                    label="Consolidation"
                                    value={`${setup.consolidationDays} days`}
                                    icon={<BarChart3 className="h-3.5 w-3.5" />}
                                    active={setup.consolidationDays >= 3}
                                  />
                                  <DetailCard
                                    label="Volume"
                                    value={`${setup.volumeRatio.toFixed(1)}x avg`}
                                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                                    active={setup.volumeRatio >= 1.5}
                                  />
                                  <DetailCard
                                    label="Breakout"
                                    value={setup.breakoutTriggered ? setup.breakoutDirection : "Pending"}
                                    icon={setup.breakoutDirection === "bullish"
                                      ? <ArrowUpRight className="h-3.5 w-3.5" />
                                      : setup.breakoutDirection === "bearish"
                                        ? <ArrowDownRight className="h-3.5 w-3.5" />
                                        : <Minus className="h-3.5 w-3.5" />
                                    }
                                    active={setup.breakoutTriggered}
                                  />
                                </div>

                                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                                  <div className="glass-panel rounded-xl p-3 border border-white/[0.04]">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Resistance</span>
                                      <ArrowUpRight className="h-3 w-3 text-red-400" />
                                    </div>
                                    <p className="text-sm font-bold text-red-400">${setup.resistanceLevel.toFixed(2)}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      {((setup.resistanceLevel - setup.currentPrice) / setup.currentPrice * 100).toFixed(1)}% above
                                    </p>
                                  </div>
                                  <div className="glass-panel rounded-xl p-3 border border-white/[0.04]">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Support</span>
                                      <ArrowDownRight className="h-3 w-3 text-emerald-400" />
                                    </div>
                                    <p className="text-sm font-bold text-emerald-400">${setup.supportLevel.toFixed(2)}</p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      {((setup.currentPrice - setup.supportLevel) / setup.currentPrice * 100).toFixed(1)}% below
                                    </p>
                                  </div>
                                  {setup.targetPrice && (
                                    <div className="glass-panel rounded-xl p-3 border border-primary/20 bg-primary/5">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target</span>
                                        <Target className="h-3 w-3 text-primary" />
                                      </div>
                                      <p className="text-sm font-bold text-primary">${setup.targetPrice.toFixed(2)}</p>
                                      <p className="text-[10px] text-muted-foreground mt-0.5">
                                        {setup.proximityPct !== null ? `${setup.proximityPct.toFixed(1)}% to breakout` : ""}
                                      </p>
                                    </div>
                                  )}
                                </div>

                                <button
                                  onClick={(e) => toggleWatch(setup.ticker, e)}
                                  className={`mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all border ${
                                    watchedTickers.has(setup.ticker)
                                      ? "bg-primary/20 border-primary/50 text-primary hover:bg-primary/30"
                                      : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5"
                                  }`}
                                >
                                  <Bell className={`h-4 w-4 ${watchedTickers.has(setup.ticker) ? "fill-current" : ""}`} />
                                  {watchedTickers.has(setup.ticker) ? `Watching ${setup.ticker} for Breakout` : `Watch ${setup.ticker} for Breakout Alert`}
                                </button>

                                {setup.bbWidth > 0 && setup.kcWidth > 0 && (
                                  <div className="mt-3 glass-panel rounded-xl p-3 border border-white/[0.04]">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Target className="h-3.5 w-3.5 text-purple-400" />
                                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Band Width</span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs">
                                      <span className="text-muted-foreground">BB: <span className="text-foreground font-semibold">{(setup.bbWidth * 100).toFixed(2)}%</span></span>
                                      <span className="text-muted-foreground">KC: <span className="text-foreground font-semibold">{(setup.kcWidth * 100).toFixed(2)}%</span></span>
                                      <span className="text-muted-foreground">Ratio: <span className={`font-semibold ${setup.bbWidth / setup.kcWidth < 1 ? "text-yellow-400" : "text-zinc-400"}`}>{(setup.bbWidth / setup.kcWidth).toFixed(3)}</span></span>
                                    </div>
                                    <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${setup.squeezeActive ? "bg-yellow-500" : setup.bbWidth / setup.kcWidth < 1.2 ? "bg-orange-400" : "bg-zinc-500"}`}
                                        style={{ width: `${Math.min(100, (1 - Math.min(1, setup.bbWidth / setup.kcWidth)) * 200 + 10)}%` }}
                                      />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                      {setup.squeezeActive
                                        ? "Squeeze ON — BBs inside KCs, expect explosive move"
                                        : setup.bbWidth / setup.kcWidth < 1.2
                                          ? "Near squeeze — BBs narrowing towards KCs"
                                          : "Normal volatility — no squeeze detected"
                                      }
                                    </p>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="glass-panel rounded-2xl border border-white/[0.04] overflow-hidden">
              <button
                onClick={() => setShowHowItWorks(!showHowItWorks)}
                className="w-full p-5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
              >
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />
                  How It Works &amp; What the Numbers Mean
                </h3>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showHowItWorks ? "rotate-180" : ""}`} />
              </button>

              <AnimatePresence>
                {showHowItWorks && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 space-y-5">
                      <div className="grid sm:grid-cols-3 gap-4 text-xs text-muted-foreground">
                        <div className="space-y-1.5">
                          <p className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                            <Activity className="h-3.5 w-3.5 text-yellow-400" />
                            Squeeze Detection
                          </p>
                          <p>
                            When Bollinger Bands (2 StdDev) contract inside Keltner Channels (1.5 ATR),
                            volatility is compressing. This "squeeze" precedes explosive moves in either direction.
                            The longer the squeeze, the bigger the expected move.
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <p className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                            <BarChart3 className="h-3.5 w-3.5 text-purple-400" />
                            Consolidation
                          </p>
                          <p>
                            Identifies multi-day tight ranges where price trades within a narrow channel
                            (under 3% range). Combined with declining volume, this builds energy for a
                            directional break. More days = stronger setup.
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          <p className="font-semibold text-foreground text-[11px] flex items-center gap-1.5">
                            <Zap className="h-3.5 w-3.5 text-emerald-400" />
                            Auto Breakout Alerts
                          </p>
                          <p>
                            When the scanner finds setups, it subscribes those tickers to our real-time
                            price feed. If price breaks above resistance or below support <span className="text-foreground font-semibold">with volume confirmation</span>,
                            you get an instant trade alert. Alerts only fire when:
                          </p>
                          <ul className="list-disc list-inside mt-1 space-y-0.5 text-muted-foreground">
                            <li><span className="text-foreground font-semibold">Session Volume ≥ 1.5x</span> the 20-day average (adjusted for time of day) — confirms real participation</li>
                            <li><span className="text-foreground font-semibold">Burst Volume ≥ 3x</span> the recent average — the last 60 seconds must show 3x+ activity vs the prior 10 minutes, confirming smart money entered</li>
                            <li>When both conditions are met, the alert is tagged <span className="text-purple-400 font-semibold">INSTITUTIONAL</span></li>
                          </ul>
                        </div>
                      </div>

                      <div className="border-t border-white/[0.06] pt-4">
                        <p className="font-semibold text-foreground text-[11px] mb-3">Score Breakdown (0–100)</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
                            <span className="text-yellow-400 font-bold w-12">25-40</span>
                            <span className="text-muted-foreground">Squeeze active (more bars = more points)</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
                            <span className="text-orange-400 font-bold w-12">15</span>
                            <span className="text-muted-foreground">Near-squeeze (BB/KC ratio under 1.2)</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
                            <span className="text-purple-400 font-bold w-12">15-25</span>
                            <span className="text-muted-foreground">Consolidation (3+ days tight range)</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
                            <span className="text-blue-400 font-bold w-12">10-20</span>
                            <span className="text-muted-foreground">Volume spike (1.3x–2x+ avg)</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
                            <span className="text-emerald-400 font-bold w-12">+30</span>
                            <span className="text-muted-foreground">Breakout triggered (above/below key level)</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02]">
                            <span className="text-zinc-400 font-bold w-12">+10</span>
                            <span className="text-muted-foreground">Tight range (under 3% high-to-low)</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-white/[0.06] pt-4">
                        <p className="font-semibold text-foreground text-[11px] mb-3">Card Details Explained</p>
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-muted-foreground">
                          <p><span className="text-foreground font-semibold">Squeeze Length</span> — How many consecutive days BBs have been inside KCs. Longer = bigger expected move.</p>
                          <p><span className="text-foreground font-semibold">BB Width / KC Width</span> — Bollinger Band and Keltner Channel widths. When BB &lt; KC, that's a squeeze.</p>
                          <p><span className="text-foreground font-semibold">Volume Ratio</span> — Today's volume vs. 20-day avg. Above 1.5x is notable, 2x+ is a spike.</p>
                          <p><span className="text-foreground font-semibold">Consolidation Days</span> — How many days price has stayed in a tight range.</p>
                          <p><span className="text-foreground font-semibold">Resistance / Support</span> — Upper and lower boundaries the price is trading between.</p>
                          <p><span className="text-foreground font-semibold">BB/KC Ratio</span> — Below 1.0 = squeeze active. 1.0–1.2 = near squeeze. Above 1.2 = normal.</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
};

const DetailCard = ({
  label, value, icon, active
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  active: boolean;
}) => (
  <div className={`rounded-xl p-3 border transition-colors ${
    active ? "bg-primary/5 border-primary/20" : "bg-white/[0.02] border-white/[0.04]"
  }`}>
    <div className="flex items-center gap-1.5 mb-1">
      <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
    </div>
    <p className={`text-sm font-bold ${active ? "text-foreground" : "text-muted-foreground"}`}>{value}</p>
  </div>
);

export default DashboardBreakout;
