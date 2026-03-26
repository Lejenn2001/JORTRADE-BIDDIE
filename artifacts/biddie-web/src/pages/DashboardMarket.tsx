import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Search, TrendingUp, TrendingDown, Activity, Shield, Target,
  Zap, BarChart3, Eye, ArrowUpRight, ArrowDownRight, Crosshair,
  Waves, AlertTriangle, Clock, ChevronRight, Loader2
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface TradeSetup {
  has_play: boolean;
  action: string | null;
  entry: string | null;
  target: string | null;
  stop: string | null;
  timeframe: string | null;
  confidence: string | null;
  reasoning: string | null;
}

interface Analysis {
  verdict: string;
  verdict_summary: string;
  market_structure: string;
  flow_analysis: string;
  dark_pool_analysis: string;
  key_levels_analysis: string;
  trade_setup: TradeSetup;
  watch_for: string;
}

interface AnalysisData {
  key_levels: any;
  price_confirmation: any;
  flow_summary: {
    total_alerts: number;
    call_premium: number;
    put_premium: number;
    sweeps: number;
    avg_aggression: number;
    top_flow: any[];
  };
  dark_pool: {
    trades: number;
    total_volume: number;
    total_notional: number;
    avg_price: number | null;
    recent: any[];
  };
}

interface AnalysisResult {
  ticker: string;
  timestamp: string;
  analysis: Analysis;
  data: AnalysisData;
}

const formatPremium = (val: number) => {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
};

const popularTickers = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "META", "AMZN", "MSFT", "AMD", "GOOGL"];

const verdictColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  BULLISH: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40", glow: "shadow-emerald-500/20" },
  BEARISH: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/40", glow: "shadow-red-500/20" },
  NEUTRAL: { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/40", glow: "shadow-yellow-500/20" },
  "NO PLAY": { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/40", glow: "shadow-zinc-500/20" },
};

const DashboardMarket = () => {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const analyzeCallback = useCallback(async (t: string) => {
    const clean = t.toUpperCase().replace(/[^A-Z]/g, "");
    if (!clean || clean.length > 5) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setTicker(clean);

    try {
      const resp = await fetch(`/api/whale/analyze/${clean}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || "Analysis failed");
      }
      const data = await resp.json();
      setResult(data);
      setSearchHistory(prev => {
        const filtered = prev.filter(x => x !== clean);
        return [clean, ...filtered].slice(0, 8);
      });
    } catch (err: any) {
      setError(err.message || "Failed to analyze ticker");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) analyzeCallback(ticker.trim());
  };

  const v = result?.analysis?.verdict || "";
  const vc = verdictColors[v] || verdictColors["NEUTRAL"];

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          <div className="max-w-5xl mx-auto space-y-5">

            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
                <Crosshair className="h-6 w-6 text-primary" />
                Market Structure
              </h1>
              <p className="text-sm text-muted-foreground">
                Type any ticker for a full AI-powered breakdown — flow, dark pool, key levels, and trade setup
              </p>
            </div>

            <form onSubmit={handleSubmit} className="relative">
              <div className="glass-panel rounded-2xl border-glow-purple p-1.5 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={inputRef}
                    value={ticker}
                    onChange={e => setTicker(e.target.value.toUpperCase())}
                    placeholder="Enter ticker symbol (e.g. SPY, NVDA, AAPL)"
                    className="pl-12 pr-4 h-14 text-lg font-bold bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50 uppercase"
                    maxLength={5}
                    disabled={loading}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !ticker.trim()}
                  className="h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Analyze
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="flex flex-wrap gap-2">
              {searchHistory.length > 0 && (
                <>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold self-center mr-1">Recent:</span>
                  {searchHistory.map(t => (
                    <button
                      key={t}
                      onClick={() => analyzeCallback(t)}
                      disabled={loading}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20 disabled:opacity-50"
                    >
                      {t}
                    </button>
                  ))}
                  <span className="mx-2 text-border">|</span>
                </>
              )}
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold self-center mr-1">Popular:</span>
              {popularTickers.filter(t => !searchHistory.includes(t)).slice(0, 6).map(t => (
                <button
                  key={t}
                  onClick={() => analyzeCallback(t)}
                  disabled={loading}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {loading && (
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
                      <p className="text-lg font-bold text-foreground">Analyzing {ticker}</p>
                      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                        <p className="flex items-center gap-2 justify-center">
                          <Activity className="h-3 w-3 text-emerald-400 animate-pulse" /> Scanning live options flow
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <Eye className="h-3 w-3 text-blue-400 animate-pulse" /> Checking dark pool activity
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <BarChart3 className="h-3 w-3 text-violet-400 animate-pulse" /> Computing key levels & VWAP
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <Zap className="h-3 w-3 text-yellow-400 animate-pulse" /> Running AI analysis
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {error && !loading && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-2xl border border-red-500/30 p-6"
                >
                  <div className="flex items-center gap-3 text-red-400">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                </motion.div>
              )}

              {result && !loading && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className={`glass-panel rounded-2xl ${vc.border} border p-5 shadow-lg ${vc.glow}`}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4">
                        <div className={`${vc.bg} ${vc.border} border rounded-xl px-4 py-2`}>
                          <p className={`text-2xl font-black ${vc.text}`}>{result.ticker}</p>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${vc.bg} ${vc.text} ${vc.border} border`}>
                              {v === "BULLISH" && <TrendingUp className="h-3 w-3 inline mr-1" />}
                              {v === "BEARISH" && <TrendingDown className="h-3 w-3 inline mr-1" />}
                              {v}
                            </span>
                            {result.data.price_confirmation?.confirmed && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                PRICE CONFIRMED
                              </span>
                            )}
                            {result.data.price_confirmation?.gamma_zone === "negative" && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                                NEG GAMMA
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{result.analysis.verdict_summary}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {result.data.key_levels?.current_price && (
                          <p className="text-2xl font-black text-foreground">${result.data.key_levels.current_price.toFixed(2)}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          <Clock className="h-3 w-3" /> {result.timestamp}
                        </p>
                      </div>
                    </div>
                  </div>

                  {result.analysis.trade_setup?.has_play && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="glass-panel rounded-2xl border border-primary/40 p-5 bg-primary/5"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Target className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-foreground uppercase tracking-wider">Trade Setup</h3>
                          {result.analysis.trade_setup.confidence && (
                            <span className={`text-[10px] font-bold uppercase ${
                              result.analysis.trade_setup.confidence === "High" ? "text-emerald-400"
                                : result.analysis.trade_setup.confidence === "Medium" ? "text-yellow-400"
                                : "text-muted-foreground"
                            }`}>
                              {result.analysis.trade_setup.confidence} Confidence
                            </span>
                          )}
                        </div>
                        {result.analysis.trade_setup.timeframe && (
                          <span className="ml-auto text-[10px] font-bold uppercase px-2.5 py-1 rounded-md bg-violet-500/20 text-violet-400 border border-violet-500/30">
                            {result.analysis.trade_setup.timeframe}
                          </span>
                        )}
                      </div>

                      {result.analysis.trade_setup.action && (
                        <div className="mb-4 p-3 rounded-xl bg-primary/10 border border-primary/20">
                          <p className="text-lg font-black text-primary">{result.analysis.trade_setup.action}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {result.analysis.trade_setup.entry && (
                          <div className="rounded-xl bg-background/60 p-3 border border-border/30">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                              <ArrowUpRight className="h-3 w-3 text-blue-400" /> Entry
                            </p>
                            <p className="text-sm font-bold text-foreground">{result.analysis.trade_setup.entry}</p>
                          </div>
                        )}
                        {result.analysis.trade_setup.target && (
                          <div className="rounded-xl bg-background/60 p-3 border border-emerald-500/20">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                              <Target className="h-3 w-3 text-emerald-400" /> Target
                            </p>
                            <p className="text-sm font-bold text-emerald-400">{result.analysis.trade_setup.target}</p>
                          </div>
                        )}
                        {result.analysis.trade_setup.stop && (
                          <div className="rounded-xl bg-background/60 p-3 border border-red-500/20">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                              <Shield className="h-3 w-3 text-red-400" /> Stop / Invalidation
                            </p>
                            <p className="text-sm font-bold text-red-400">{result.analysis.trade_setup.stop}</p>
                          </div>
                        )}
                      </div>

                      {result.analysis.trade_setup.reasoning && (
                        <p className="mt-3 text-xs text-muted-foreground italic">{result.analysis.trade_setup.reasoning}</p>
                      )}
                    </motion.div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <BarChart3 className="h-4 w-4 text-violet-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Market Structure</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{result.analysis.market_structure}</p>
                    </div>

                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Waves className="h-4 w-4 text-blue-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Options Flow</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{result.analysis.flow_analysis}</p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Calls: {formatPremium(result.data.flow_summary.call_premium)}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                          Puts: {formatPremium(result.data.flow_summary.put_premium)}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          Sweeps: {result.data.flow_summary.sweeps}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                          Aggression: {result.data.flow_summary.avg_aggression}%
                        </span>
                      </div>
                    </div>

                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Eye className="h-4 w-4 text-amber-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Dark Pool</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{result.analysis.dark_pool_analysis}</p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {result.data.dark_pool.trades} Trades
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {formatPremium(result.data.dark_pool.total_notional)} Notional
                        </span>
                        {result.data.dark_pool.avg_price && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Avg: ${result.data.dark_pool.avg_price.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Crosshair className="h-4 w-4 text-cyan-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Key Levels</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{result.analysis.key_levels_analysis}</p>
                      {result.data.key_levels && (
                        <div className="grid grid-cols-2 gap-2">
                          {result.data.key_levels.vwap && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">VWAP</p>
                              <p className="text-xs font-bold text-cyan-400">${result.data.key_levels.vwap}</p>
                            </div>
                          )}
                          {result.data.key_levels.pivot_points?.pivot && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">Pivot</p>
                              <p className="text-xs font-bold text-foreground">${result.data.key_levels.pivot_points.pivot}</p>
                            </div>
                          )}
                          {result.data.key_levels.prior_day?.high && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">PDH</p>
                              <p className="text-xs font-bold text-emerald-400">${result.data.key_levels.prior_day.high}</p>
                            </div>
                          )}
                          {result.data.key_levels.prior_day?.low && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">PDL</p>
                              <p className="text-xs font-bold text-red-400">${result.data.key_levels.prior_day.low}</p>
                            </div>
                          )}
                          {result.data.key_levels.pivot_points?.r1 && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">R1</p>
                              <p className="text-xs font-bold text-emerald-400">${result.data.key_levels.pivot_points.r1}</p>
                            </div>
                          )}
                          {result.data.key_levels.pivot_points?.s1 && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">S1</p>
                              <p className="text-xs font-bold text-red-400">${result.data.key_levels.pivot_points.s1}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {result.analysis.watch_for && (
                    <div className="glass-panel rounded-xl p-4 border border-yellow-500/20 bg-yellow-500/5">
                      <div className="flex items-start gap-3">
                        <div className="h-7 w-7 rounded-lg bg-yellow-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Eye className="h-3.5 w-3.5 text-yellow-400" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-foreground uppercase tracking-wider mb-1">Watch For</p>
                          <p className="text-sm text-muted-foreground">{result.analysis.watch_for}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="glass-panel rounded-xl p-3 border border-border/20">
                    <p className="text-[10px] text-muted-foreground/60 text-center">
                      JORTRADE is an AI-powered analysis tool using data analysis and probabilistic models. This is not financial advice.
                      Trading options involves substantial risk. You are solely responsible for your trading decisions.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!result && !loading && !error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-panel rounded-2xl border-glow-purple p-8 text-center"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Search className="h-8 w-8 text-primary/50" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold text-foreground">Your Personal Trade Assistant</h2>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Enter any ticker above to get a full AI-powered breakdown including live options flow,
                      dark pool activity, key support/resistance levels, and actionable trade setups.
                    </p>
                  </div>
                  <div className="flex items-center gap-6 mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Activity className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Live Flow</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="h-3.5 w-3.5 text-amber-400" />
                      <span>Dark Pool</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Key Levels</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span>AI Analysis</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardMarket;
