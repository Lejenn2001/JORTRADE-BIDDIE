import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Zap, TrendingUp, TrendingDown, Activity, Target, Loader2,
  RefreshCw, ArrowUpRight, ArrowDownRight, Clock, AlertTriangle,
  ChevronRight, BarChart3, Crosshair, Minus
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
}

interface ScanResult {
  setups: BreakoutSetup[];
  count: number;
  lastScan: string;
  tickersScanned: number;
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

const DashboardBreakout = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

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

  useEffect(() => {
    runScan();
  }, [runScan]);

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
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
                              <div className="flex items-center gap-2">
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
                              </div>
                              <p className="text-xs text-muted-foreground truncate max-w-md">{setup.reason}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 shrink-0">
                            <div className="text-right hidden sm:block">
                              <p className="text-sm font-bold text-foreground">${setup.currentPrice.toFixed(2)}</p>
                              <p className="text-[10px] text-muted-foreground">Current Price</p>
                            </div>
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

                                <div className="mt-3 grid grid-cols-2 gap-3">
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
                                </div>

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

            <div className="glass-panel rounded-2xl p-5 border border-white/[0.04]">
              <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                How It Works
              </h3>
              <div className="grid sm:grid-cols-3 gap-4 text-xs text-muted-foreground">
                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground text-[11px]">Squeeze Detection</p>
                  <p>
                    When Bollinger Bands (2 StdDev) contract inside Keltner Channels (1.5 ATR),
                    volatility is compressing. This "squeeze" precedes explosive moves in either direction.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground text-[11px]">Consolidation</p>
                  <p>
                    Identifies multi-day tight ranges where price action narrows into a smaller channel.
                    Combined with declining volume, this builds energy for a directional break.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-foreground text-[11px]">Breakout Trigger</p>
                  <p>
                    When price closes above resistance or below support on elevated volume,
                    a breakout is triggered. Higher scores = more confluence across indicators.
                  </p>
                </div>
              </div>
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
