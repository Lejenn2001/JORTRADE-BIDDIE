import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useAuth } from "@/hooks/useAuth";
import ConvictionScoreRing from "@/components/dashboard/ConvictionScoreRing";
import {
  Zap, TrendingUp, TrendingDown, Activity, Target, Loader2,
  RefreshCw, ArrowUpRight, ArrowDownRight, Clock, AlertTriangle,
  ChevronRight, BarChart3, Crosshair, Minus, Bell, Radio,
  Info, ChevronDown, Plus, X, CheckCircle2, Eye
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
  squeezeFirstSeen?: string;
  thesis?: BreakoutThesis;
  contract?: {
    type: "CALL" | "PUT";
    strike: number;
    expiry: string;
    expiryLabel: string;
    entry: string;
    target: string;
    stop: string;
    rationale: string;
  };
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

function freshnessLabel(scannedAt?: string): { label: string; color: string } {
  if (!scannedAt) return { label: "", color: "" };
  const mins = Math.floor((Date.now() - new Date(scannedAt).getTime()) / 60000);
  if (mins < 10) return { label: "Just now", color: "text-emerald-400" };
  if (mins < 30) return { label: `${mins}m ago`, color: "text-emerald-400" };
  if (mins < 60) return { label: `${mins}m ago`, color: "text-yellow-400" };
  const hrs = Math.floor(mins / 60);
  if (hrs < 4) return { label: `${hrs}h ago`, color: "text-orange-400" };
  return { label: `${hrs}h ago`, color: "text-zinc-500" };
}

function statusTag(setup: BreakoutSetup): { label: string; colors: string; pulse?: boolean } {
  if (setup.score >= 75 || setup.breakoutTriggered) return { label: "ENTER NOW", colors: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40", pulse: true };
  if (setup.score >= 55) return { label: "BREAKOUT IMMINENT", colors: "bg-blue-500/20 text-blue-400 border-blue-500/40", pulse: true };
  if (setup.score >= 35) return { label: "WATCH & SET ALERT", colors: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
  return { label: "ON YOUR RADAR", colors: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
}

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.25 } }),
};

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
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  }, []);

  const sendBrowserNotif = useCallback((alert: BreakoutAlertData) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const dir = alert.direction === "bullish" ? "CALL" : "PUT";
    const notif = new Notification(`Breakout Alert: ${alert.ticker}`, {
      body: `${alert.ticker} $${alert.suggestedStrike} ${dir} @ $${alert.breakoutPrice}\nTarget: $${alert.targetPrice} | Score: ${alert.score}`,
      icon: "/favicon.ico",
      tag: alert.id,
      requireInteraction: true,
    });
    notif.onclick = () => { window.focus(); notif.close(); };
  }, []);

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
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      saveWatched(next);
      return next;
    });
  }, []);

  const runScan = useCallback(async (force?: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/breakout/scan${force ? "?force=1" : ""}`);
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
      const prevIds = prevAlertsRef.current;
      const newAlerts = data.alerts.filter(a => !prevIds.includes(a.id));
      if (prevIds.length > 0 && newAlerts.length > 0) {
        newAlerts.forEach(a => sendBrowserNotif(a));
      }
      prevAlertsRef.current = data.alerts.map(a => a.id);
      setAlerts(data.alerts);
      setMonitoring(data.monitoring);
    } catch {}
  }, [sendBrowserNotif]);

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
      if (data.added) setTimeout(() => runScan(), 500);
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
      if (resp.ok) { fetchCustomTickers(); runScan(); }
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

    return () => { if (alertPollRef.current) clearInterval(alertPollRef.current); };
  }, [runScan, fetchAlerts, fetchCustomTickers, user]);

  const timeSinceStr = lastScan
    ? `${Math.floor((Date.now() - lastScan.getTime()) / 60000)}m ago`
    : "—";

  const activeBreakouts = result?.setups.filter(s => s.breakoutTriggered) || [];
  const squeezeSetups = result?.setups.filter(s => !s.breakoutTriggered && s.squeezeActive) || [];
  const buildingSetups = result?.setups.filter(s => !s.breakoutTriggered && !s.squeezeActive) || [];

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          <div className="max-w-5xl mx-auto space-y-5">

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <h1 className="text-xl sm:text-2xl font-extrabold text-foreground flex items-center gap-2">
                  <Crosshair className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                  Breakout Scanner
                </h1>
                <p className="text-xs text-muted-foreground">
                  Volatility squeeze detection + consolidation breakouts across {result ? result.tickersScanned : "40+"} tickers
                </p>
              </div>
              <div className="flex items-center gap-2">
                {notifPermission === "default" && (
                  <button
                    onClick={requestNotifPermission}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 font-semibold text-xs transition-all border border-yellow-500/20"
                    title="Get desktop notifications when breakouts fire"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    Notify Me
                  </button>
                )}
                {notifPermission === "granted" && (
                  <span className="flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20" title="Desktop notifications are active">
                    <Bell className="h-3 w-3" />
                    Alerts On
                  </span>
                )}
                <button
                  onClick={() => runScan(true)}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-sm transition-all border border-primary/20 disabled:opacity-40"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  {loading ? "Scanning..." : "Rescan"}
                </button>
              </div>
            </div>

            {tickerMessage && (
              <p className={`text-xs font-medium ${tickerMessage.type === "error" ? "text-red-400" : "text-emerald-400"}`}>
                {tickerMessage.text}
              </p>
            )}

            {lastScan && (
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Scanned {timeSinceStr}
                </span>
                {result && (
                  <>
                    <span className="text-border">|</span>
                    <span>{result.tickersScanned} tickers</span>
                    <span className="text-border">|</span>
                    <span className="font-semibold text-primary">{result.count} setups</span>
                  </>
                )}
                {monitoring && (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1">
                      <Radio className={`h-2.5 w-2.5 ${monitoring.wsConnected ? "text-emerald-400 animate-pulse" : "text-zinc-500"}`} />
                      {monitoring.wsConnected ? `${monitoring.subscribedTickers} tickers live` : "Offline"}
                    </span>
                  </>
                )}
                {watchedTickers.size > 0 && (
                  <>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1 text-primary font-semibold">
                      <Bell className="h-2.5 w-2.5 fill-current" />
                      {watchedTickers.size} watched
                    </span>
                  </>
                )}
              </div>
            )}

            {alerts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-400" />
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
                  const aW = watchedTickers.has(a.ticker) ? 1 : 0;
                  const bW = watchedTickers.has(b.ticker) ? 1 : 0;
                  return bW - aW;
                }).map((alert) => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={[
                      "rounded-xl border p-3 sm:p-4",
                      alert.direction === "bullish" ? "bg-emerald-500/8 border-emerald-500/25" : "bg-red-500/8 border-red-500/25",
                      watchedTickers.has(alert.ticker) ? "ring-2 ring-primary/40" : ""
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <ConvictionScoreRing score={alert.score} size="sm" />
                        <div>
                          <p className="text-base sm:text-lg font-black text-foreground tracking-tight">
                            {alert.suggestedTrade}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                              alert.direction === "bullish" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"
                            }`}>
                              {alert.direction === "bullish" ? "BULLISH" : "BEARISH"}
                            </span>
                            {alert.volumeConfirmation?.institutionalConfirmed && (
                              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/40">
                                INSTITUTIONAL
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              Broke {alert.direction === "bullish" ? "above" : "below"} ${alert.direction === "bullish" ? alert.resistanceLevel.toFixed(2) : alert.supportLevel.toFixed(2)} at ${alert.breakoutPrice.toFixed(2)}
                              {alert.volumeConfirmation && (
                                <span className="ml-1.5 text-primary font-semibold">
                                  Vol {alert.volumeConfirmation.sessionVolumeRatio.toFixed(1)}x | Burst {alert.volumeConfirmation.burstVolumeRatio.toFixed(1)}x
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {alert.volumeConfirmation && (
                          <div className="text-right hidden sm:block">
                            <p className="text-[10px] text-muted-foreground uppercase">Volume</p>
                            <p className="text-xs font-bold text-foreground">{alert.volumeConfirmation.sessionVolumeRatio.toFixed(1)}x</p>
                          </div>
                        )}
                        {alert.targetPrice > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground uppercase">Target</p>
                            <p className="text-sm font-black text-primary">${alert.targetPrice.toFixed(2)}</p>
                          </div>
                        )}
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground uppercase">Time</p>
                          <p className="text-xs font-semibold text-foreground">
                            {new Date(alert.triggeredAt).toLocaleTimeString("en-US", {
                              hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York"
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            <AnimatePresence>
              {loading && !result && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="glass-panel rounded-xl p-8"
                >
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <div className="h-16 w-16 rounded-full border-2 border-primary/30 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                      </div>
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-base font-bold text-foreground">Scanning Tickers</p>
                      <p className="text-xs text-muted-foreground">Squeeze detection, consolidation analysis, volume confirmation</p>
                    </div>
                  </div>
                </motion.div>
              )}

              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-xl p-5 border border-red-500/30"
                >
                  <div className="flex items-center gap-3 text-red-400">
                    <AlertTriangle className="h-5 w-5" />
                    <p className="font-semibold text-sm">{error}</p>
                  </div>
                </motion.div>
              )}

              {result && result.count === 0 && !loading && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-xl p-8 text-center"
                >
                  <Minus className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-base font-bold text-foreground">No Active Setups</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                    No tickers showing squeeze or consolidation patterns right now. Quality setups appear 10-20% of the time.
                  </p>
                </motion.div>
              )}

              {result && result.count > 0 && (
                <motion.div
                  key="results"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-5"
                >
                  <div className="space-y-2">
                    {[...result.setups].sort((a, b) => b.score - a.score).map((setup, i) => (
                      <motion.div
                        key={setup.ticker}
                        custom={i}
                        initial="hidden"
                        animate="visible"
                        variants={cardVariants}
                      >
                        <SetupCard
                          setup={setup}
                          expanded={expandedTicker === setup.ticker}
                          onToggle={() => setExpandedTicker(expandedTicker === setup.ticker ? null : setup.ticker)}
                          watched={watchedTickers.has(setup.ticker)}
                          onWatch={(e) => toggleWatch(setup.ticker, e)}
                          taken={takenTrades.has(buildTradeKey(setup))}
                          taking={takingTrade === setup.ticker}
                          onTake={(e) => handleTakeTrade(setup, e)}
                          user={user}
                          buildTradeKey={buildTradeKey}
                          takenTrades={takenTrades}
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="rounded-xl border border-white/[0.04] overflow-hidden">
              <button
                onClick={() => setShowHowItWorks(!showHowItWorks)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-xs font-bold text-foreground flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-primary" />
                  How It Works
                </span>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showHowItWorks ? "rotate-180" : ""}`} />
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
                    <div className="px-4 pb-4 space-y-4">
                      <p className="text-[11px] text-muted-foreground">A <span className="text-foreground font-semibold">breakout</span> is when a stock's price suddenly moves past a key level (resistance or support) with strong volume. This scanner watches for the conditions that lead to breakouts so you can be ready before they happen.</p>

                      <div className="space-y-3 text-[11px] text-muted-foreground">
                        <div className="rounded-lg p-3 bg-yellow-500/[0.05] border border-yellow-500/15">
                          <p className="font-bold text-yellow-400 flex items-center gap-1.5 mb-1.5">
                            <Activity className="h-3 w-3" />
                            What is a Squeeze?
                          </p>
                          <p className="mb-1">A squeeze happens when a stock's price range gets really tight — it stops moving much in either direction. Think of it like pulling back a rubber band. The tighter you pull, the harder it snaps.</p>
                          <p className="mb-1"><span className="text-foreground font-semibold">Why it matters:</span> Squeezes almost always lead to big, fast moves. The stock is building up energy, and when it finally breaks out of that tight range, it tends to move explosively.</p>
                          <p><span className="text-foreground font-semibold">Candles count:</span> Shows how long the squeeze has been active. More candles = more energy building up = bigger expected move.</p>
                        </div>

                        <div className="rounded-lg p-3 bg-purple-500/[0.05] border border-purple-500/15">
                          <p className="font-bold text-purple-400 flex items-center gap-1.5 mb-1.5">
                            <BarChart3 className="h-3 w-3" />
                            What is Consolidation?
                          </p>
                          <p className="mb-1">Consolidation is when a stock trades sideways in a narrow range for multiple days. The price keeps bouncing between the same high and low levels without picking a direction.</p>
                          <p><span className="text-foreground font-semibold">Why days matter:</span> The longer a stock consolidates (3+ days is ideal), the bigger the eventual move. It's like a spring being compressed — more time compressing = more force when it releases.</p>
                        </div>

                        <div className="rounded-lg p-3 bg-blue-500/[0.05] border border-blue-500/15">
                          <p className="font-bold text-blue-400 flex items-center gap-1.5 mb-1.5">
                            <TrendingUp className="h-3 w-3" />
                            What is Volume?
                          </p>
                          <p className="mb-1">Volume is how many shares are being traded. When volume is 2x or 3x higher than normal, it means big money is moving in — institutions, hedge funds, or a wave of traders all jumping at once.</p>
                          <p><span className="text-foreground font-semibold">Why it matters:</span> A breakout without volume is fake — price might just fall back. A breakout WITH heavy volume means real money is behind the move and it's more likely to keep going.</p>
                        </div>

                        <div className="rounded-lg p-3 bg-cyan-500/[0.05] border border-cyan-500/15">
                          <p className="font-bold text-cyan-400 flex items-center gap-1.5 mb-1.5">
                            <Target className="h-3 w-3" />
                            What is Proximity?
                          </p>
                          <p>This shows how close the current price is to the breakout level (resistance or support). If proximity is 0.5%, the stock is right at the edge — one push and it breaks. If it's 3%, there's still some distance to go.</p>
                        </div>

                        <div className="rounded-lg p-3 bg-zinc-500/[0.05] border border-zinc-500/15">
                          <p className="font-bold text-zinc-300 flex items-center gap-1.5 mb-1.5">
                            <Activity className="h-3 w-3" />
                            What is the BB/KC Ratio?
                          </p>
                          <p className="mb-1">This is the technical measurement behind the squeeze. BB stands for Bollinger Bands (a measure of price volatility) and KC stands for Keltner Channels (a measure of average price range).</p>
                          <p><span className="text-foreground font-semibold">Simple version:</span> When the ratio is below 1.0, the squeeze is ON — volatility has compressed inside the normal range. The lower the number, the tighter the squeeze. When it climbs back above 1.0, the breakout is starting.</p>
                        </div>
                      </div>

                      <div className="border-t border-white/[0.06] pt-3">
                        <p className="font-semibold text-foreground text-[11px] mb-1">Breakout Readiness Score (0–100)</p>
                        <p className="text-[10px] text-muted-foreground mb-2">Each factor above adds points to the score. The more factors that are active and stacking together, the higher the score — and the closer the stock is to breaking out.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                          <div className="p-2.5 rounded-lg bg-zinc-500/10 border border-zinc-500/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-black text-zinc-400">20–35</span>
                              <span className="font-bold text-zinc-300">On Your Radar</span>
                            </div>
                            <p className="text-muted-foreground">Something is starting to form but it's early. Keep an eye on it, but don't act yet — it might fizzle out.</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-black text-yellow-400">35–55</span>
                              <span className="font-bold text-yellow-300">Watch &amp; Set Alert</span>
                            </div>
                            <p className="text-muted-foreground">A real setup is forming. Hit the bell icon so you get notified when it breaks. Look at the suggested contract and decide how much you'd want to risk.</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-black text-blue-400">55–75</span>
                              <span className="font-bold text-blue-300">High Alert — Breakout Imminent</span>
                            </div>
                            <p className="text-muted-foreground">Multiple factors are lined up and price is right near the breakout level. Stay ready. When the alert fires, that's your entry signal.</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-black text-emerald-400">75–100</span>
                              <span className="font-bold text-emerald-300">Breakout Confirmed — Enter Now</span>
                            </div>
                            <p className="text-muted-foreground">It broke. Price pushed through the key level with heavy volume behind it. The alert card above has the trade details — this is the entry moment.</p>
                          </div>
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

function SetupSection({
  label, icon, count, accentColor, setups, expandedTicker, setExpandedTicker,
  watchedTickers, toggleWatch, takenTrades, takingTrade, handleTakeTrade, buildTradeKey, user
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  accentColor: string;
  setups: BreakoutSetup[];
  expandedTicker: string | null;
  setExpandedTicker: (t: string | null) => void;
  watchedTickers: Set<string>;
  toggleWatch: (t: string, e: React.MouseEvent) => void;
  takenTrades: Set<string>;
  takingTrade: string | null;
  handleTakeTrade: (s: BreakoutSetup, e: React.MouseEvent) => void;
  buildTradeKey: (s: BreakoutSetup) => string;
  user: any;
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/20",
    yellow: "text-yellow-400 bg-yellow-500/20",
    blue: "text-blue-400 bg-blue-500/20",
  };
  const accent = colorMap[accentColor] || colorMap.blue;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        {icon}
        <span className={`font-bold text-xs ${accent.split(" ")[0]}`}>{label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${accent}`}>{count}</span>
      </div>
      <div className="space-y-2">
        {setups.map((setup, i) => (
          <motion.div
            key={setup.ticker}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
          >
            <SetupCard
              setup={setup}
              expanded={expandedTicker === setup.ticker}
              onToggle={() => setExpandedTicker(expandedTicker === setup.ticker ? null : setup.ticker)}
              watched={watchedTickers.has(setup.ticker)}
              onWatch={(e) => toggleWatch(setup.ticker, e)}
              taken={takenTrades.has(buildTradeKey(setup))}
              taking={takingTrade === setup.ticker}
              onTake={(e) => handleTakeTrade(setup, e)}
              user={user}
              buildTradeKey={buildTradeKey}
              takenTrades={takenTrades}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SetupCard({
  setup, expanded, onToggle, watched, onWatch, taken, taking, onTake, user, buildTradeKey, takenTrades
}: {
  setup: BreakoutSetup;
  expanded: boolean;
  onToggle: () => void;
  watched: boolean;
  onWatch: (e: React.MouseEvent) => void;
  taken: boolean;
  taking: boolean;
  onTake: (e: React.MouseEvent) => void;
  user: any;
  buildTradeKey: (s: BreakoutSetup) => string;
  takenTrades: Set<string>;
}) {
  const tag = statusTag(setup);
  const fresh = freshnessLabel(setup.scannedAt);
  const dir = setup.thesis?.direction || (setup.breakoutDirection !== "none" ? setup.breakoutDirection : "neutral");
  const isBullish = dir === "bullish";
  const isBearish = dir === "bearish";

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all cursor-pointer hover:border-primary/25 ${
        setup.breakoutTriggered
          ? "bg-emerald-500/[0.06] border-emerald-500/20"
          : setup.squeezeActive
            ? "bg-yellow-500/[0.04] border-yellow-500/15"
            : "bg-white/[0.02] border-white/[0.06]"
      }`}
      onClick={onToggle}
    >
      <div className="px-3 sm:px-4 py-3 flex items-center gap-3">
        <ConvictionScoreRing score={setup.score} size="sm" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-extrabold text-foreground">{setup.ticker}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${tag.colors} ${tag.pulse ? "animate-pulse" : ""}`}>
              {tag.label}
            </span>
            {dir !== "neutral" && (
              <span className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                isBullish ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" : "bg-red-500/10 text-red-400 border-red-500/25"
              }`}>
                {isBullish ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                {isBullish ? "CALLS" : "PUTS"}
              </span>
            )}
            {setup.contract && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                setup.contract.expiryLabel === "0DTE"
                  ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                  : setup.contract.expiryLabel === "1DTE"
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                    : "bg-blue-500/15 text-blue-400 border-blue-500/30"
              }`}>{setup.contract.expiryLabel}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
            {setup.contract ? (
              <span className={`font-bold ${setup.contract.type === "CALL" ? "text-emerald-400/80" : "text-red-400/80"}`}>
                ${setup.contract.strike} {setup.contract.type}
              </span>
            ) : (
              <span className="truncate max-w-[200px]">{setup.reason.split(". ")[0]}</span>
            )}
            {setup.targetPrice && (
              <>
                <span className="text-border">→</span>
                <span className="font-semibold text-primary">Target ${setup.targetPrice.toFixed(2)}</span>
              </>
            )}
            {setup.squeezeFirstSeen && (
              <>
                <span className="text-border">|</span>
                <span className="text-muted-foreground/70">Squeeze since {new Date(setup.squeezeFirstSeen).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-bold text-foreground">${setup.currentPrice.toFixed(2)}</p>
            {fresh.label && (
              <p className={`text-[10px] ${fresh.color}`}>{fresh.label}</p>
            )}
          </div>
          <button
            onClick={onWatch}
            className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all border ${
              watched
                ? "bg-primary/20 border-primary/50 text-primary"
                : "bg-white/[0.03] border-white/[0.08] text-muted-foreground hover:border-primary/30 hover:text-primary/70"
            }`}
            title={watched ? "Stop watching" : "Watch for breakout"}
          >
            <Bell className={`h-3.5 w-3.5 ${watched ? "fill-current" : ""}`} />
          </button>
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 sm:px-4 pb-4 border-t border-white/[0.06] pt-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <MiniStat
                  label="Squeeze"
                  value={setup.squeezeActive ? `${setup.squeezeLength} candles` : "Inactive"}
                  active={setup.squeezeActive}
                  icon={<Activity className="h-3 w-3" />}
                />
                <MiniStat
                  label="Consolidation"
                  value={`${setup.consolidationDays}d`}
                  active={setup.consolidationDays >= 3}
                  icon={<BarChart3 className="h-3 w-3" />}
                />
                <MiniStat
                  label="Volume"
                  value={`${setup.volumeRatio.toFixed(1)}x`}
                  active={setup.volumeRatio >= 1.5}
                  icon={<TrendingUp className="h-3 w-3" />}
                />
                <MiniStat
                  label="Distance to Break"
                  value={setup.proximityPct !== null ? `${setup.proximityPct.toFixed(1)}%` : "—"}
                  active={(setup.proximityPct ?? 99) <= 1.0}
                  icon={<Target className="h-3 w-3" />}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg p-2.5 bg-white/[0.02] border border-white/[0.04]">
                  <p className="text-[10px] text-muted-foreground mb-1">Ceiling (Resistance)</p>
                  <p className="text-sm font-bold text-red-400">${setup.resistanceLevel.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">{((setup.resistanceLevel - setup.currentPrice) / setup.currentPrice * 100).toFixed(1)}% above price</p>
                </div>
                <div className="rounded-lg p-2.5 bg-white/[0.02] border border-white/[0.04]">
                  <p className="text-[10px] text-muted-foreground mb-1">Floor (Support)</p>
                  <p className="text-sm font-bold text-emerald-400">${setup.supportLevel.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">{((setup.currentPrice - setup.supportLevel) / setup.currentPrice * 100).toFixed(1)}% below price</p>
                </div>
                {setup.bbWidth > 0 && setup.kcWidth > 0 && (
                  <div className="rounded-lg p-2.5 bg-white/[0.02] border border-white/[0.04]">
                    <p className="text-[10px] text-muted-foreground mb-1">Squeeze Tightness</p>
                    <p className={`text-sm font-bold ${setup.bbWidth / setup.kcWidth < 1 ? "text-yellow-400" : "text-zinc-400"}`}>
                      {(setup.bbWidth / setup.kcWidth).toFixed(3)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{setup.squeezeActive ? "Below 1.0 = squeeze ON" : "Above 1.0 = normal"}</p>
                  </div>
                )}
              </div>

              {setup.thesis && (
                <div className="rounded-lg p-3 bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center gap-2 mb-2">
                    <Crosshair className="h-3 w-3 text-purple-400" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Directional Thesis</span>
                    <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                      setup.thesis.direction === "bullish"
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : setup.thesis.direction === "bearish"
                          ? "bg-red-500/15 text-red-400 border-red-500/30"
                          : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                    }`}>
                      {setup.thesis.direction.toUpperCase()}{setup.thesis.confidence > 0 ? ` ${setup.thesis.confidence}%` : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="text-center p-1.5 rounded-md bg-white/[0.02]">
                      <p className="text-[9px] text-muted-foreground uppercase">Momentum</p>
                      <p className={`text-[11px] font-bold ${setup.thesis.momentum === "bullish" ? "text-emerald-400" : setup.thesis.momentum === "bearish" ? "text-red-400" : "text-zinc-400"}`}>
                        {setup.thesis.momentum === "bullish" ? "Rising" : setup.thesis.momentum === "bearish" ? "Falling" : "Flat"}
                      </p>
                    </div>
                    <div className="text-center p-1.5 rounded-md bg-white/[0.02]">
                      <p className="text-[9px] text-muted-foreground uppercase">Trend</p>
                      <p className={`text-[11px] font-bold ${setup.thesis.smaPosition === "above" ? "text-emerald-400" : setup.thesis.smaPosition === "below" ? "text-red-400" : "text-zinc-400"}`}>
                        {setup.thesis.smaPosition === "above" ? "Above 50d" : setup.thesis.smaPosition === "below" ? "Below 50d" : "At 50d"}
                      </p>
                    </div>
                    <div className="text-center p-1.5 rounded-md bg-white/[0.02]">
                      <p className="text-[9px] text-muted-foreground uppercase">Flow</p>
                      <p className={`text-[11px] font-bold ${
                        setup.thesis.flowBias?.direction === "bullish" ? "text-emerald-400" :
                        setup.thesis.flowBias?.direction === "bearish" ? "text-red-400" : "text-zinc-400"
                      }`}>
                        {setup.thesis.flowBias?.direction === "bullish" ? `Calls ${setup.thesis.flowBias.ratio}x` :
                         setup.thesis.flowBias?.direction === "bearish" ? `Puts ${setup.thesis.flowBias.ratio > 0 ? (1/setup.thesis.flowBias.ratio).toFixed(1) : "N/A"}x` :
                         "Neutral"}
                      </p>
                    </div>
                  </div>

                  {setup.thesis.flowBias && setup.thesis.flowBias.direction !== "neutral" && (
                    <div className={`p-2 rounded-md border text-[11px] mb-2 ${
                      setup.thesis.flowBias.direction === "bullish"
                        ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                        : "bg-red-500/5 border-red-500/20 text-red-300"
                    }`}>
                      <div className="flex items-center gap-1 font-bold mb-0.5">
                        {setup.thesis.flowBias.direction === "bullish" ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                        Smart Money Flow
                        {setup.thesis.flowBias.sweepBias !== "neutral" && (
                          <span className="ml-1 text-[9px] opacity-80">SWEEPS {setup.thesis.flowBias.sweepBias.toUpperCase()}</span>
                        )}
                      </div>
                      <p className="text-[10px] opacity-80">{setup.thesis.flowBias.details}</p>
                    </div>
                  )}

                  {setup.thesis.reasons.length > 0 && (
                    <div className="space-y-0.5">
                      {setup.thesis.reasons.map((r, idx) => (
                        <div key={idx} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                          <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                            r.toLowerCase().includes("bullish") || r.toLowerCase().includes("call") || r.toLowerCase().includes("above") || r.toLowerCase().includes("rising")
                              ? "bg-emerald-400"
                              : r.toLowerCase().includes("bearish") || r.toLowerCase().includes("put") || r.toLowerCase().includes("below") || r.toLowerCase().includes("falling")
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

              {setup.directionContext && (
                <p className="text-[10px] text-muted-foreground/70 flex items-start gap-1">
                  <Info className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                  {setup.directionContext}
                </p>
              )}

              {setup.contract && (
                <div className={`rounded-xl p-3 border ${
                  setup.contract.type === "CALL"
                    ? "bg-emerald-500/[0.06] border-emerald-500/20"
                    : "bg-red-500/[0.06] border-red-500/20"
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className={`h-3.5 w-3.5 ${setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"}`} />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Contract Rec</span>
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center border ${
                      setup.contract.type === "CALL" ? "bg-emerald-500/20 border-emerald-500/40" : "bg-red-500/20 border-red-500/40"
                    }`}>
                      {setup.contract.type === "CALL" ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : <ArrowDownRight className="h-4 w-4 text-red-400" />}
                    </div>
                    <div>
                      <p className={`text-base font-black ${setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"}`}>
                        {setup.ticker} ${setup.contract.strike} {setup.contract.type}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Exp {setup.contract.expiry} ({setup.contract.expiryLabel})
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="text-center p-1.5 rounded-md bg-white/[0.03]">
                      <p className="text-[9px] text-muted-foreground uppercase">Entry</p>
                      <p className="text-[11px] font-bold text-foreground">{setup.contract.entry}</p>
                    </div>
                    <div className="text-center p-1.5 rounded-md bg-white/[0.03]">
                      <p className="text-[9px] text-muted-foreground uppercase">Target</p>
                      <p className={`text-[11px] font-bold ${setup.contract.type === "CALL" ? "text-emerald-400" : "text-red-400"}`}>{setup.contract.target}</p>
                    </div>
                    <div className="text-center p-1.5 rounded-md bg-white/[0.03]">
                      <p className="text-[9px] text-muted-foreground uppercase">Stop</p>
                      <p className="text-[11px] font-bold text-yellow-400">{setup.contract.stop}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/80 mb-2">{setup.contract.rationale}</p>
                  {user && (
                    <button
                      onClick={onTake}
                      disabled={taking || takenTrades.has(buildTradeKey(setup))}
                      className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-bold text-xs transition-all border ${
                        takenTrades.has(buildTradeKey(setup))
                          ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 cursor-default"
                          : setup.contract.type === "CALL"
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 active:scale-[0.98]"
                            : "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 active:scale-[0.98]"
                      }`}
                    >
                      {taking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                       takenTrades.has(buildTradeKey(setup)) ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                       <Zap className="h-3.5 w-3.5" />}
                      {takenTrades.has(buildTradeKey(setup)) ? "Trade Logged" : "I Took This Trade"}
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={onWatch}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-bold text-xs transition-all border ${
                  watched
                    ? "bg-primary/20 border-primary/50 text-primary hover:bg-primary/30"
                    : "bg-white/[0.04] border-white/[0.08] text-muted-foreground hover:border-primary/30 hover:text-primary hover:bg-primary/5"
                }`}
              >
                <Bell className={`h-3.5 w-3.5 ${watched ? "fill-current" : ""}`} />
                {watched ? `Watching ${setup.ticker}` : `Watch ${setup.ticker} for Alert`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniStat({ label, value, active, icon }: { label: string; value: string; active: boolean; icon: React.ReactNode }) {
  return (
    <div className={`rounded-lg p-2 border transition-colors ${active ? "bg-primary/5 border-primary/20" : "bg-white/[0.02] border-white/[0.04]"}`}>
      <div className="flex items-center gap-1 mb-0.5">
        <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      </div>
      <p className={`text-xs font-bold ${active ? "text-foreground" : "text-muted-foreground"}`}>{value}</p>
    </div>
  );
}

export default DashboardBreakout;
