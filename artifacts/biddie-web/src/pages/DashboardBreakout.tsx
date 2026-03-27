import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import {
  Zap, TrendingUp, TrendingDown, Activity, Target, Loader2,
  RefreshCw, ArrowUpRight, ArrowDownRight, Clock, AlertTriangle,
  ChevronRight, BarChart3, Crosshair, Minus, Bell, Radio,
  Info, ChevronDown, Plus, X, CheckCircle2
} from "lucide-react";

interface FlowBias {
  direction: "bullish" | "bearish" | "neutral";
  callPremium: number;
  putPremium: number;
  ratio: number;
  sweepBias: "bullish" | "bearish" | "neutral";
  conviction: number;
  details: string;
}

interface BreakoutThesis {
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  reasons: string[];
  flowBias: FlowBias | null;
  momentum: "bullish" | "bearish" | "neutral";
  smaPosition: "above" | "below" | "neutral";
}

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
  directionContext?: string | null;
  scannedAt?: string;
  thesis?: BreakoutThesis;
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
  const { user } = useAuth();
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
  const [customTickerInput, setCustomTickerInput] = useState("");
  const [customTickers, setCustomTickers] = useState<string[]>([]);
  const [addingTicker, setAddingTicker] = useState(false);
  const [tickerMessage, setTickerMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [takenTrades, setTakenTrades] = useState<Set<string>>(new Set());
  const [takingTrade, setTakingTrade] = useState<string | null>(null);

  const buildTradeKey = (setup: BreakoutSetup) =>
    `${setup.ticker}|${setup.contract?.strike}|${setup.contract?.type}|${setup.contract?.expiry}`;

  const handleTakeTrade = useCallback(async (setup: BreakoutSetup, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || !setup.contract) return;
    const key = buildTradeKey(setup);
    if (takenTrades.has(key)) return;

    setTakingTrade(setup.ticker);
    try {
      const signalId = `breakout-${setup.ticker}-${setup.contract.expiry}-${setup.contract.strike}`;
      const resp = await fetch("/api/whale/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          signalId,
          ticker: setup.ticker,
          direction: setup.thesis?.direction || "neutral",
          category: "breakout",
          strike: setup.contract.strike,
          expiry: setup.contract.expiry,
          optionType: setup.contract.type,
          entryTrigger: setup.contract.entry,
          target: setup.contract.target,
          invalidation: setup.contract.stop,
          convictionScore: setup.score,
        }),
      });
      if (resp.ok || resp.status === 409) {
        setTakenTrades(prev => new Set(prev).add(key));
      }
    } catch {}
    setTakingTrade(null);
  }, [user, takenTrades]);

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

  const fetchCustomTickers = useCallback(async () => {
    try {
      const resp = await fetch("/api/breakout/watchlist");
      if (!resp.ok) return;
      const data = await resp.json();
      setCustomTickers(data.customTickers || []);
    } catch {}
  }, []);

  const addCustomTicker = useCallback(async () => {
    const symbol = customTickerInput.toUpperCase().trim().replace(/[^A-Z]/g, "");
    if (!symbol) return;
    setAddingTicker(true);
    setTickerMessage(null);
    try {
      const resp = await fetch("/api/breakout/watchlist/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: symbol }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setTickerMessage({ text: data.error, type: "error" });
        return;
      }
      setTickerMessage({ text: data.message, type: "success" });
      setCustomTickerInput("");
      fetchCustomTickers();
      if (data.added) {
        setTimeout(() => runScan(), 500);
      }
    } catch {
      setTickerMessage({ text: "Failed to add ticker", type: "error" });
    } finally {
      setAddingTicker(false);
      setTimeout(() => setTickerMessage(null), 4000);
    }
  }, [customTickerInput, fetchCustomTickers, runScan]);

  const removeCustomTicker = useCallback(async (ticker: string) => {
    try {
      const resp = await fetch("/api/breakout/watchlist/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (resp.ok) {
        fetchCustomTickers();
        runScan();
      }
    } catch {}
  }, [fetchCustomTickers, runScan]);

  useEffect(() => {
    runScan();
    fetchAlerts();
    fetchCustomTickers();
    alertPollRef.current = setInterval(fetchAlerts, 15000);

    if (user) {
      fetch(`/api/whale/trades?userId=${user.id}`)
        .then(r => r.json())
        .then(data => {
          const taken = new Set<string>();
          for (const t of (data.trades || [])) {
            if (t.category === "breakout") {
              taken.add(`${t.ticker}|${t.strike}|${t.option_type}|${t.expiry}`);
            }
          }
          setTakenTrades(taken);
        })
        .catch(() => {});
    }

    return () => {
      if (alertPollRef.current) clearInterval(alertPollRef.current);
    };
  }, [runScan, fetchAlerts, fetchCustomTickers, user]);

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
                  Bollinger/Keltner squeeze detection + consolidation patterns across {result ? result.tickersScanned : "40+"} tickers
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

            <div className="glass-panel rounded-xl border border-white/[0.06] p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                  <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={customTickerInput}
                    onChange={(e) => setCustomTickerInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
                    onKeyDown={(e) => { if (e.key === "Enter") addCustomTicker(); }}
                    placeholder="Add ticker (e.g. HOOD)"
                    maxLength={5}
                    className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none w-full"
                  />
                  <button
                    onClick={addCustomTicker}
                    disabled={addingTicker || !customTickerInput.trim()}
                    className="px-3 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary text-xs font-bold transition-all disabled:opacity-30 shrink-0"
                  >
                    {addingTicker ? "Adding..." : "Add"}
                  </button>
                </div>
                {customTickers.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {customTickers.map(t => (
                      <span key={t} className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                        {t}
                        <button onClick={() => removeCustomTicker(t)} className="hover:text-red-400 transition-colors">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {tickerMessage && (
                <p className={`text-xs mt-2 font-medium ${tickerMessage.type === "error" ? "text-red-400" : "text-emerald-400"}`}>
                  {tickerMessage.text}
                </p>
              )}
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
                                {setup.thesis && setup.thesis.direction !== "neutral" && (
                                  <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${
                                    setup.thesis.direction === "bullish"
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                      : "bg-red-500/10 text-red-400 border-red-500/30"
                                  }`}>
                                    {setup.thesis.direction === "bullish"
                                      ? <ArrowUpRight className="h-3 w-3" />
                                      : <ArrowDownRight className="h-3 w-3" />
                                    }
                                    {setup.thesis.direction === "bullish" ? "CALLS" : "PUTS"}
                                    {setup.thesis.flowBias && setup.thesis.flowBias.direction !== "neutral" && (
                                      <span className="ml-0.5 opacity-70">+ FLOW</span>
                                    )}
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
                                    {setup.imminenceLabel === "BREAKOUT IMMINENT" ? "🔥 MOVE NOW"
                                      : setup.imminenceLabel === "BREAKOUT ACTIVE" ? "🔥 ACTIVE"
                                      : setup.imminenceLabel === "LIKELY WITHIN 15 MIN" ? "⚡ HEATING UP"
                                      : setup.imminenceLabel === "BUILDING PRESSURE" ? "👀 WATCH"
                                      : setup.imminenceLabel}
                                  </span>
                                )}
                                {setup.scannedAt && (
                                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 ml-auto">
                                    <Clock className="h-2.5 w-2.5" />
                                    {new Date(setup.scannedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                {setup.contract ? (
                                  <span className={`shrink-0 font-black ${setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                                    {setup.ticker} ${setup.contract.strike} {setup.contract.type}
                                    <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                                      setup.contract.expiryLabel === "0DTE"
                                        ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                                        : setup.contract.expiryLabel === "1DTE"
                                          ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                                          : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                    }`}>{setup.contract.expiryLabel}</span>
                                  </span>
                                ) : (
                                  <span className="truncate max-w-md">{setup.reason}</span>
                                )}
                                {setup.targetPrice && (
                                  <span className="shrink-0 font-semibold text-primary">
                                    Target: ${setup.targetPrice.toFixed(2)}
                                  </span>
                                )}
                              </div>
                              {setup.directionContext && (
                                <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5 flex items-start gap-1">
                                  <Info className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                                  <span>{setup.directionContext}</span>
                                </p>
                              )}
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
                                    value={setup.breakoutTriggered ? (setup.breakoutDirection === "bullish" ? "Breaking Up" : "Breaking Down")
                                      : setup.imminenceLabel === "BREAKOUT IMMINENT" ? "Almost There"
                                      : setup.imminenceLabel === "LIKELY WITHIN 15 MIN" ? "Heating Up"
                                      : setup.imminenceLabel === "BUILDING PRESSURE" ? "Building"
                                      : "Setting Up"}
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

                                {setup.thesis && (
                                  <div className="mt-3 glass-panel rounded-xl p-4 border border-white/[0.04]">
                                    <div className="flex items-center gap-2 mb-3">
                                      <Crosshair className="h-3.5 w-3.5 text-purple-400" />
                                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Directional Thesis</span>
                                      <span className={`ml-auto text-xs font-bold px-2 py-0.5 rounded-full border ${
                                        setup.thesis.direction === "bullish"
                                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                          : setup.thesis.direction === "bearish"
                                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                                            : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                                      }`}>
                                        {setup.thesis.direction === "bullish" ? "BULLISH" : setup.thesis.direction === "bearish" ? "BEARISH" : "NEUTRAL"}
                                        {setup.thesis.confidence > 0 && ` ${setup.thesis.confidence}%`}
                                      </span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                      <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                                        <p className="text-[10px] text-muted-foreground uppercase">Momentum</p>
                                        <p className={`text-xs font-bold mt-0.5 ${
                                          setup.thesis.momentum === "bullish" ? "text-emerald-400" :
                                          setup.thesis.momentum === "bearish" ? "text-red-400" : "text-zinc-400"
                                        }`}>
                                          {setup.thesis.momentum === "bullish" ? "Rising" : setup.thesis.momentum === "bearish" ? "Falling" : "Flat"}
                                        </p>
                                      </div>
                                      <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                                        <p className="text-[10px] text-muted-foreground uppercase">Trend</p>
                                        <p className={`text-xs font-bold mt-0.5 ${
                                          setup.thesis.smaPosition === "above" ? "text-emerald-400" :
                                          setup.thesis.smaPosition === "below" ? "text-red-400" : "text-zinc-400"
                                        }`}>
                                          {setup.thesis.smaPosition === "above" ? "Above 50d" : setup.thesis.smaPosition === "below" ? "Below 50d" : "At 50d"}
                                        </p>
                                      </div>
                                      <div className="text-center p-2 rounded-lg bg-white/[0.02]">
                                        <p className="text-[10px] text-muted-foreground uppercase">Flow</p>
                                        <p className={`text-xs font-bold mt-0.5 ${
                                          setup.thesis.flowBias?.direction === "bullish" ? "text-emerald-400" :
                                          setup.thesis.flowBias?.direction === "bearish" ? "text-red-400" : "text-zinc-400"
                                        }`}>
                                          {setup.thesis.flowBias?.direction === "bullish" ? `Calls ${setup.thesis.flowBias.ratio}x` :
                                           setup.thesis.flowBias?.direction === "bearish" ? `Puts ${setup.thesis.flowBias.ratio > 0 ? (1/setup.thesis.flowBias.ratio).toFixed(1) : "N/A"}x` :
                                           setup.thesis.flowBias ? "Neutral" : "No Data"}
                                        </p>
                                      </div>
                                    </div>

                                    {setup.thesis.flowBias && setup.thesis.flowBias.direction !== "neutral" && (
                                      <div className={`mb-3 p-2.5 rounded-lg border text-xs ${
                                        setup.thesis.flowBias.direction === "bullish"
                                          ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                                          : "bg-red-500/5 border-red-500/20 text-red-300"
                                      }`}>
                                        <div className="flex items-center gap-1.5 font-bold mb-1">
                                          {setup.thesis.flowBias.direction === "bullish"
                                            ? <TrendingUp className="h-3 w-3" />
                                            : <TrendingDown className="h-3 w-3" />
                                          }
                                          Smart Money Flow
                                          {setup.thesis.flowBias.sweepBias !== "neutral" && (
                                            <span className="ml-1 text-[10px] opacity-80">SWEEPS {setup.thesis.flowBias.sweepBias.toUpperCase()}</span>
                                          )}
                                        </div>
                                        <p className="text-[11px] opacity-80">{setup.thesis.flowBias.details}</p>
                                      </div>
                                    )}

                                    {setup.thesis.reasons.length > 0 && (
                                      <div className="space-y-1">
                                        {setup.thesis.reasons.map((r, idx) => (
                                          <div key={idx} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                                            <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                                              r.toLowerCase().includes("bullish") || r.toLowerCase().includes("call") || r.toLowerCase().includes("above") || r.toLowerCase().includes("green") || r.toLowerCase().includes("rising")
                                                ? "bg-emerald-400"
                                                : r.toLowerCase().includes("bearish") || r.toLowerCase().includes("put") || r.toLowerCase().includes("below") || r.toLowerCase().includes("red") || r.toLowerCase().includes("falling")
                                                  ? "bg-red-400"
                                                  : "bg-zinc-400"
                                            }`} />
                                            {r}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {setup.contract && (
                                  <div className={`mt-3 rounded-xl p-4 border ${
                                    setup.contract.type === "CALL"
                                      ? "bg-emerald-500/[0.07] border-emerald-500/25"
                                      : "bg-red-500/[0.07] border-red-500/25"
                                  }`}>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Zap className={`h-4 w-4 ${setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"}`} />
                                      <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Contract Recommendation</span>
                                      <span className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-full border ${
                                        setup.contract.expiryLabel === "0DTE"
                                          ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40 animate-pulse"
                                          : setup.contract.expiryLabel === "1DTE"
                                            ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                                            : "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                      }`}>
                                        {setup.contract.expiryLabel}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 mb-3">
                                      <div className={`h-11 w-11 rounded-xl flex items-center justify-center border ${
                                        setup.contract.type === "CALL"
                                          ? "bg-emerald-500/20 border-emerald-500/40"
                                          : "bg-red-500/20 border-red-500/40"
                                      }`}>
                                        {setup.contract.type === "CALL"
                                          ? <ArrowUpRight className="h-5 w-5 text-emerald-400" />
                                          : <ArrowDownRight className="h-5 w-5 text-red-400" />
                                        }
                                      </div>
                                      <div>
                                        <p className={`text-lg font-black tracking-tight ${
                                          setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"
                                        }`}>
                                          {setup.ticker} ${setup.contract.strike} {setup.contract.type}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                          Exp {setup.contract.expiry} ({setup.contract.expiryLabel})
                                        </p>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                      <div className="text-center p-2 rounded-lg bg-white/[0.03]">
                                        <p className="text-[10px] text-muted-foreground uppercase">Entry</p>
                                        <p className="text-xs font-bold text-foreground mt-0.5">{setup.contract.entry}</p>
                                      </div>
                                      <div className="text-center p-2 rounded-lg bg-white/[0.03]">
                                        <p className="text-[10px] text-muted-foreground uppercase">Target</p>
                                        <p className={`text-xs font-bold mt-0.5 ${setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"}`}>{setup.contract.target}</p>
                                      </div>
                                      <div className="text-center p-2 rounded-lg bg-white/[0.03]">
                                        <p className="text-[10px] text-muted-foreground uppercase">Stop</p>
                                        <p className="text-xs font-bold text-yellow-400 mt-0.5">{setup.contract.stop}</p>
                                      </div>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground/80">{setup.contract.rationale}</p>
                                    {user && (
                                      <button
                                        onClick={(e) => handleTakeTrade(setup, e)}
                                        disabled={takingTrade === setup.ticker || takenTrades.has(buildTradeKey(setup))}
                                        className={`mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all border ${
                                          takenTrades.has(buildTradeKey(setup))
                                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 cursor-default"
                                            : setup.contract.type === "CALL"
                                              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.98]"
                                              : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 active:scale-[0.98]"
                                        }`}
                                      >
                                        {takingTrade === setup.ticker ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : takenTrades.has(buildTradeKey(setup)) ? (
                                          <CheckCircle2 className="h-4 w-4" />
                                        ) : (
                                          <Zap className="h-4 w-4" />
                                        )}
                                        {takenTrades.has(buildTradeKey(setup))
                                          ? "Trade Logged"
                                          : "I Took This Trade"
                                        }
                                      </button>
                                    )}
                                  </div>
                                )}

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
