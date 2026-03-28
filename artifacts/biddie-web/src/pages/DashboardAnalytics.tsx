import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, TrendingUp, TrendingDown, Target, Flame, Trophy,
  CheckCircle2, XCircle, Clock, Zap, Activity, PieChart,
  ArrowUpRight, ArrowDownRight, Loader2, ShieldCheck, RefreshCw
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PerformanceSnapshot from "@/components/dashboard/PerformanceSnapshot";
import PerformanceCalendar from "@/components/dashboard/PerformanceCalendar";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimePrices } from "@/hooks/useRealtimePrices";
import type { PriceInfo } from "@/hooks/useRealtimePrices";

interface TradeStats {
  total: number;
  hits: number;
  misses: number;
  pending: number;
  winRate: number;
  streak: number;
  weekWinRate: number;
  weekHits: number;
  weekTotal: number;
  byTicker: Record<string, { hits: number; total: number }>;
  byCategory: Record<string, { hits: number; total: number }>;
}

interface SignalStats {
  total: number;
  hits: number;
  misses: number;
  pending: number;
  winRate: number;
  byTicker: Record<string, { hits: number; total: number }>;
  byCategory: Record<string, { hits: number; total: number }>;
}

interface UserTrade {
  id: string;
  signal_id: string;
  ticker: string;
  direction: string;
  category: string;
  strike: string;
  option_type: string;
  conviction_score: number;
  taken_at: string;
  signal_outcome: string;
  target: string;
  price_at_signal: number | null;
  signal_type: string | null;
}

interface SignalRecord {
  id: string;
  ticker: string;
  signal_type: string;
  category: string;
  target: string;
  outcome: string;
  confidence: number;
  conviction_score: number;
  detected_at: string;
  resolved_at: string;
  strike: string;
  expiry: string;
  option_type: string;
}

const DashboardAnalytics = () => {
  const { user } = useAuth();
  const { getPrice } = useRealtimePrices();
  const [userStats, setUserStats] = useState<TradeStats | null>(null);
  const [signalStats, setSignalStats] = useState<SignalStats | null>(null);
  const [userTrades, setUserTrades] = useState<UserTrade[]>([]);
  const [allSignals, setAllSignals] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "mytrades" | "signals" | "admin">("overview");

  useEffect(() => {
    if (user?.id) {
      fetch(`/api/whale/admin/check?userId=${user.id}`)
        .then(r => r.json())
        .then(d => setIsAdmin(d.isAdmin))
        .catch(() => setIsAdmin(false));
    }
  }, [user?.id]);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const resp = await fetch("/api/whale/verify-signals", { method: "POST" });
      const data = await resp.json();
      setVerifyResult(data);
      const histResp = await fetch("/api/whale/signals/history?limit=200");
      const histData = await histResp.json();
      if (histData.signals) setAllSignals(histData.signals);
    } catch (e) {
      setVerifyResult({ error: "Verification failed" });
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const promises: Promise<any>[] = [];

        if (user?.id) {
          promises.push(
            fetch(`/api/whale/trades/stats?userId=${user.id}`).then(r => r.json()),
            fetch(`/api/whale/trades?userId=${user.id}`).then(r => r.json())
          );
        } else {
          promises.push(Promise.resolve({ stats: null }), Promise.resolve({ trades: [] }));
        }

        promises.push(
          fetch("/api/whale/signals/calendar?limit=500").then(r => r.json())
        );

        const [statsData, tradesData, historyData] = await Promise.all(promises);

        if (statsData.stats) setUserStats(statsData.stats);
        if (tradesData.trades) setUserTrades(tradesData.trades);

        if (historyData.signals) {
          setAllSignals(historyData.signals);
          const signals = historyData.signals;
          const resolved = signals.filter((s: any) => s.outcome === "hit" || s.outcome === "missed");
          const hits = resolved.filter((s: any) => s.outcome === "hit").length;

          const byTicker: Record<string, { hits: number; total: number }> = {};
          const byCategory: Record<string, { hits: number; total: number }> = {};
          for (const s of resolved) {
            const tk = s.ticker;
            if (!byTicker[tk]) byTicker[tk] = { hits: 0, total: 0 };
            byTicker[tk].total++;
            if (s.outcome === "hit") byTicker[tk].hits++;

            const cat = s.category || "algorithm";
            if (!byCategory[cat]) byCategory[cat] = { hits: 0, total: 0 };
            byCategory[cat].total++;
            if (s.outcome === "hit") byCategory[cat].hits++;
          }

          setSignalStats({
            total: signals.length,
            hits,
            misses: resolved.length - hits,
            pending: signals.filter((s: any) => !s.outcome || s.outcome === "pending").length,
            winRate: resolved.length > 0 ? Math.round((hits / resolved.length) * 100) : 0,
            byTicker,
            byCategory,
          });
        }
      } catch (e) {
        console.error("Analytics load error:", e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user?.id]);

  const topTickers = useMemo(() => {
    if (!signalStats?.byTicker) return [];
    return Object.entries(signalStats.byTicker)
      .map(([ticker, data]) => ({ ticker, ...data, winRate: data.total > 0 ? Math.round((data.hits / data.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [signalStats]);

  const userTopTickers = useMemo(() => {
    if (!userStats?.byTicker) return [];
    return Object.entries(userStats.byTicker)
      .map(([ticker, data]) => ({ ticker, ...data, winRate: data.total > 0 ? Math.round((data.hits / data.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [userStats]);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-mesh">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-primary" />
                  Performance Analytics
                </h1>
                <p className="text-sm text-muted-foreground">Track Biddie AI Pick accuracy and your personal trading performance</p>
              </div>

              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                {(["overview", "mytrades", "signals", ...(isAdmin ? ["admin" as const] : [])] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab as any)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                      activeTab === tab ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "overview" ? "Overview" : tab === "mytrades" ? "My Trades" : tab === "admin" ? "Admin" : "AI Signals"}
                  </button>
                ))}
              </div>
            </div>

            <PerformanceSnapshot />

            <PerformanceCalendar />

            {loading ? (
              <div className="flex items-center justify-center h-60">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {activeTab === "overview" && (
                  <OverviewTab
                    userStats={userStats}
                    signalStats={signalStats}
                    topTickers={topTickers}
                    userTopTickers={userTopTickers}
                  />
                )}
                {activeTab === "mytrades" && (
                  <MyTradesTab userStats={userStats} userTrades={userTrades} userTopTickers={userTopTickers} getPrice={getPrice} />
                )}
                {activeTab === "signals" && (
                  <SignalsTab signalStats={signalStats} topTickers={topTickers} />
                )}
                {activeTab === "admin" && isAdmin && (
                  <AdminTab
                    allSignals={allSignals}
                    onVerify={handleVerify}
                    verifying={verifying}
                    verifyResult={verifyResult}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

function StatCard({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-panel rounded-xl p-4 border ${color}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
          <p className="text-2xl font-extrabold text-foreground mt-1">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className="p-2 rounded-lg bg-white/5">{icon}</div>
      </div>
    </motion.div>
  );
}

function WinRateRing({ rate, size = 80 }: { rate: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (rate / 100) * circumference;
  const color = rate >= 70 ? "text-emerald-400" : rate >= 50 ? "text-yellow-400" : "text-red-400";
  const strokeColor = rate >= 70 ? "stroke-emerald-400" : rate >= 50 ? "stroke-yellow-400" : "stroke-red-400";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-white/5" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          className={`${strokeColor} transition-all duration-1000`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-lg font-extrabold ${color}`}>{rate}%</span>
      </div>
    </div>
  );
}

function CategoryBar({ category, hits, total }: { category: string; hits: number; total: number }) {
  const rate = total > 0 ? Math.round((hits / total) * 100) : 0;
  const labels: Record<string, string> = { algorithm: "Algorithm", whale: "Whale", spread: "Spread" };
  const colors: Record<string, string> = { algorithm: "bg-emerald-500", whale: "bg-blue-500", spread: "bg-violet-500" };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">{labels[category] || category}</span>
        <span className="text-xs text-muted-foreground">{rate}% ({hits}/{total})</span>
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${colors[category] || "bg-primary"}`} style={{ width: `${rate}%` }} />
      </div>
    </div>
  );
}

function OverviewTab({ userStats, signalStats, topTickers, userTopTickers }: {
  userStats: TradeStats | null; signalStats: SignalStats | null;
  topTickers: { ticker: string; hits: number; total: number; winRate: number }[];
  userTopTickers: { ticker: string; hits: number; total: number; winRate: number }[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Biddie AI Pick Win Rate"
          value={signalStats ? `${signalStats.winRate}%` : "—"}
          sub={signalStats ? `${signalStats.hits} hits / ${signalStats.hits + signalStats.misses} resolved` : undefined}
          icon={<Target className="h-5 w-5 text-emerald-400" />}
          color="border-emerald-500/20"
        />
        <StatCard
          label="Your Win Rate"
          value={userStats ? `${userStats.winRate}%` : "—"}
          sub={userStats && userStats.total > 0 ? `${userStats.hits} wins / ${userStats.hits + userStats.misses} resolved` : "Take signals to track"}
          icon={<Trophy className="h-5 w-5 text-yellow-400" />}
          color="border-yellow-500/20"
        />
        <StatCard
          label="Trades Taken"
          value={userStats?.total || 0}
          sub={userStats && userStats.pending > 0 ? `${userStats.pending} still pending` : undefined}
          icon={<Activity className="h-5 w-5 text-blue-400" />}
          color="border-blue-500/20"
        />
        <StatCard
          label="Win Streak"
          value={userStats?.streak || 0}
          sub={userStats && userStats.streak >= 3 ? "On fire!" : undefined}
          icon={<Flame className="h-5 w-5 text-orange-400" />}
          color="border-orange-500/20"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-xl p-5 border border-white/10">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Biddie AI Pick Performance
          </h3>
          {signalStats ? (
            <div className="flex items-center gap-6">
              <WinRateRing rate={signalStats.winRate} size={90} />
              <div className="flex-1 space-y-3">
                {signalStats.byCategory && Object.entries(signalStats.byCategory).map(([cat, data]) => (
                  <CategoryBar key={cat} category={cat} hits={data.hits} total={data.total} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No signal data yet</p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel rounded-xl p-5 border border-white/10">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-400" />
            Your Trading Stats
          </h3>
          {userStats && userStats.total > 0 ? (
            <div className="flex items-center gap-6">
              <WinRateRing rate={userStats.winRate} size={90} />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">This Week</span>
                  <span className="font-bold text-foreground">{userStats.weekWinRate}% ({userStats.weekHits}/{userStats.weekTotal})</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Total Trades</span>
                  <span className="font-bold text-foreground">{userStats.total}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Pending</span>
                  <span className="font-bold text-yellow-400">{userStats.pending}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Win Streak</span>
                  <span className="font-bold text-orange-400 flex items-center gap-1">
                    {userStats.streak >= 3 && <Flame className="h-3 w-3" />}
                    {userStats.streak}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No trades taken yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Click "I Took This Trade" on signals to start tracking</p>
            </div>
          )}
        </motion.div>
      </div>

      {topTickers.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel rounded-xl p-5 border border-white/10">
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <PieChart className="h-4 w-4 text-primary" />
            Top Tickers — Biddie AI Pick Accuracy
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {topTickers.map(t => (
              <div key={t.ticker} className="bg-white/5 rounded-lg p-3 text-center">
                <p className="text-sm font-extrabold text-foreground">{t.ticker}</p>
                <p className={`text-lg font-extrabold ${t.winRate >= 70 ? "text-emerald-400" : t.winRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                  {t.winRate}%
                </p>
                <p className="text-[10px] text-muted-foreground">{t.hits}/{t.total} signals</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function parseTargetPrice(target?: string): number | null {
  if (!target) return null;
  const match = target.match(/\$?([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ""));
}

function calcPercentToTarget(
  entryPrice: number,
  currentPrice: number,
  targetPrice: number,
  isBullish: boolean
): number {
  const totalMove = isBullish ? targetPrice - entryPrice : entryPrice - targetPrice;
  if (totalMove <= 0) return 0;
  const currentMove = isBullish ? currentPrice - entryPrice : entryPrice - currentPrice;
  const pct = (currentMove / totalMove) * 100;
  return Math.max(0, Math.min(pct, 100));
}

function MyTradesTab({ userStats, userTrades, userTopTickers, getPrice }: {
  userStats: TradeStats | null; userTrades: UserTrade[]; userTopTickers: { ticker: string; hits: number; total: number; winRate: number }[];
  getPrice: (ticker: string) => PriceInfo | null;
}) {
  return (
    <div className="space-y-6">
      {userStats && userStats.total > 0 ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Trades" value={userStats.total} icon={<Activity className="h-5 w-5 text-blue-400" />} color="border-blue-500/20" />
            <StatCard label="Wins" value={userStats.hits} sub={`${userStats.winRate}% rate`} icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />} color="border-emerald-500/20" />
            <StatCard label="Losses" value={userStats.misses} icon={<XCircle className="h-5 w-5 text-red-400" />} color="border-red-500/20" />
            <StatCard label="Pending" value={userStats.pending} icon={<Clock className="h-5 w-5 text-yellow-400" />} color="border-yellow-500/20" />
          </div>

          {userTopTickers.length > 0 && (
            <div className="glass-panel rounded-xl p-5 border border-white/10">
              <h3 className="text-sm font-bold text-foreground mb-3">Your Top Tickers</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {userTopTickers.map(t => (
                  <div key={t.ticker} className="bg-white/5 rounded-lg p-3 flex items-center gap-3">
                    <div className="text-center flex-1">
                      <p className="text-sm font-extrabold text-foreground">{t.ticker}</p>
                      <p className={`text-sm font-bold ${t.winRate >= 70 ? "text-emerald-400" : t.winRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                        {t.winRate}%
                      </p>
                      <p className="text-[10px] text-muted-foreground">{t.total} trades</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {userStats.byCategory && Object.keys(userStats.byCategory).length > 0 && (
            <div className="glass-panel rounded-xl p-5 border border-white/10">
              <h3 className="text-sm font-bold text-foreground mb-3">Win Rate by Signal Type</h3>
              <div className="space-y-3">
                {Object.entries(userStats.byCategory).map(([cat, data]) => (
                  <CategoryBar key={cat} category={cat} hits={data.hits} total={data.total} />
                ))}
              </div>
            </div>
          )}

          <div className="glass-panel rounded-xl p-5 border border-white/10">
            <h3 className="text-sm font-bold text-foreground mb-3">Recent Trades</h3>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {userTrades.slice(0, 20).map(trade => {
                const targetPrice = parseTargetPrice(trade.target);
                const entryPrice = trade.price_at_signal ? Number(trade.price_at_signal) : null;
                const priceInfo = getPrice(trade.ticker);
                const currentPrice = priceInfo?.price ?? null;
                const isBullish = (trade.signal_type || trade.direction) === "bullish";
                const showProgress = entryPrice && currentPrice && targetPrice;

                let pct = 0;
                let barColor = "bg-orange-400";
                let label = "0% to Target";
                let currentMove = 0;

                if (showProgress) {
                  pct = calcPercentToTarget(entryPrice!, currentPrice!, targetPrice!, isBullish);
                  const pctRounded = Math.round(pct);
                  barColor = pct >= 100 ? "bg-emerald-400" : pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-400" : pct >= 25 ? "bg-amber-400" : "bg-orange-400";
                  label = pct >= 100 ? "Target Reached!" : `${pctRounded}% to Target`;
                  currentMove = isBullish ? currentPrice! - entryPrice! : entryPrice! - currentPrice!;
                }

                return (
                  <div key={trade.id} className="bg-white/5 rounded-lg px-3 py-2 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        trade.direction === "bullish" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                      }`}>
                        {trade.direction === "bullish" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">{trade.ticker}</span>
                          {trade.strike && <span className="text-[10px] text-muted-foreground">${trade.strike} {trade.option_type || ""}</span>}
                          {trade.category && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                              trade.category === "whale" ? "bg-blue-500/20 text-blue-400"
                              : trade.category === "spread" ? "bg-violet-500/20 text-violet-400"
                              : "bg-primary/20 text-primary"
                            }`}>{trade.category}</span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(trade.taken_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className={`text-xs font-bold px-2 py-1 rounded-md ${
                        trade.signal_outcome === "hit" ? "bg-emerald-500/20 text-emerald-400"
                        : trade.signal_outcome === "missed" ? "bg-red-500/20 text-red-400"
                        : "bg-yellow-500/20 text-yellow-400"
                      }`}>
                        {trade.signal_outcome === "hit" ? "WIN" : trade.signal_outcome === "missed" ? "LOSS" : "PENDING"}
                      </div>
                    </div>

                    {showProgress && (
                      <div className="bg-muted/20 rounded-lg px-3 py-2.5 space-y-1.5 ml-11">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Target className="h-3 w-3 text-primary" />
                            <span className={`text-[11px] font-bold ${pct >= 100 ? "text-emerald-400" : "text-foreground"}`}>
                              {label}
                            </span>
                          </div>
                          <span className={`text-[10px] font-semibold ${currentMove >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                            {currentMove >= 0 ? "+" : ""}${Math.abs(currentMove).toFixed(2)}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-muted/40 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${barColor}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(pct, 100)}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground">
                          <span>Entry: ${entryPrice!.toFixed(2)}</span>
                          <span className="text-foreground font-medium">${currentPrice!.toFixed(2)}</span>
                          <span>Target: ${targetPrice!.toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="glass-panel rounded-xl p-10 border border-white/10 text-center">
          <Activity className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-foreground">No Trades Yet</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            Go to the Signals tab and click "I Took This Trade" on any signal you follow.
            Your personal win rate and stats will automatically build here.
          </p>
        </div>
      )}
    </div>
  );
}

function SignalsTab({ signalStats, topTickers }: {
  signalStats: SignalStats | null;
  topTickers: { ticker: string; hits: number; total: number; winRate: number }[];
}) {
  return (
    <div className="space-y-6">
      {signalStats ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Biddie AI Picks" value={signalStats.total} icon={<Zap className="h-5 w-5 text-primary" />} color="border-primary/20" />
            <StatCard label="Pick Win Rate" value={`${signalStats.winRate}%`} sub={`${signalStats.hits} hits`} icon={<Target className="h-5 w-5 text-emerald-400" />} color="border-emerald-500/20" />
            <StatCard label="Misses" value={signalStats.misses} icon={<XCircle className="h-5 w-5 text-red-400" />} color="border-red-500/20" />
            <StatCard label="Pending" value={signalStats.pending} icon={<Clock className="h-5 w-5 text-yellow-400" />} color="border-yellow-500/20" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="glass-panel rounded-xl p-5 border border-white/10">
              <h3 className="text-sm font-bold text-foreground mb-4">Win Rate by Category</h3>
              <div className="flex items-center gap-6">
                <WinRateRing rate={signalStats.winRate} size={100} />
                <div className="flex-1 space-y-3">
                  {signalStats.byCategory && Object.entries(signalStats.byCategory).map(([cat, data]) => (
                    <CategoryBar key={cat} category={cat} hits={data.hits} total={data.total} />
                  ))}
                </div>
              </div>
            </div>

            <div className="glass-panel rounded-xl p-5 border border-white/10">
              <h3 className="text-sm font-bold text-foreground mb-4">Top Performing Tickers</h3>
              <div className="space-y-2">
                {topTickers.map((t, i) => (
                  <div key={t.ticker} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <span className="text-sm font-bold text-foreground w-12">{t.ticker}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${t.winRate >= 70 ? "bg-emerald-500" : t.winRate >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${t.winRate}%` }} />
                    </div>
                    <span className={`text-xs font-bold w-10 text-right ${t.winRate >= 70 ? "text-emerald-400" : t.winRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                      {t.winRate}%
                    </span>
                    <span className="text-[10px] text-muted-foreground w-10 text-right">{t.total} sig</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-5 border border-white/10">
            <h3 className="text-sm font-bold text-foreground mb-2">Signal Breakdown</h3>
            <p className="text-xs text-muted-foreground mb-4">How Biddie AI Picks have performed across all categories</p>
            <div className="grid grid-cols-3 gap-4">
              {signalStats.byCategory && Object.entries(signalStats.byCategory).map(([cat, data]) => {
                const rate = data.total > 0 ? Math.round((data.hits / data.total) * 100) : 0;
                const colors: Record<string, string> = { algorithm: "text-emerald-400", whale: "text-blue-400", spread: "text-violet-400" };
                const labels: Record<string, string> = { algorithm: "Algorithm", whale: "Whale", spread: "Spread" };
                return (
                  <div key={cat} className="text-center bg-white/5 rounded-lg p-4">
                    <WinRateRing rate={rate} size={70} />
                    <p className={`text-xs font-bold mt-2 ${colors[cat] || "text-foreground"}`}>{labels[cat] || cat}</p>
                    <p className="text-[10px] text-muted-foreground">{data.hits}/{data.total} signals</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="glass-panel rounded-xl p-10 border border-white/10 text-center">
          <Zap className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-foreground">No Signal Data</h3>
          <p className="text-sm text-muted-foreground mt-2">Signal performance will appear here once signals are generated and verified.</p>
        </div>
      )}
    </div>
  );
}

function AdminTab({ allSignals, onVerify, verifying, verifyResult }: {
  allSignals: SignalRecord[];
  onVerify: () => void;
  verifying: boolean;
  verifyResult: any;
}) {
  const summary = useMemo(() => {
    const total = allSignals.length;
    const hits = allSignals.filter(s => s.outcome === "hit").length;
    const misses = allSignals.filter(s => s.outcome === "missed").length;
    const expired = allSignals.filter(s => s.outcome === "expired").length;
    const pending = allSignals.filter(s => !s.outcome || s.outcome === "pending").length;
    const resolved = hits + misses;
    const winRate = resolved > 0 ? Math.round((hits / resolved) * 100) : 0;
    return { total, hits, misses, expired, pending, resolved, winRate };
  }, [allSignals]);

  const tickerStats = useMemo(() => {
    const map: Record<string, { hits: number; total: number }> = {};
    allSignals.forEach(s => {
      if (s.outcome !== "hit" && s.outcome !== "missed") return;
      if (!map[s.ticker]) map[s.ticker] = { hits: 0, total: 0 };
      map[s.ticker].total++;
      if (s.outcome === "hit") map[s.ticker].hits++;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [allSignals]);

  const categoryStats = useMemo(() => {
    const map: Record<string, { hits: number; total: number }> = {};
    allSignals.forEach(s => {
      if (s.outcome !== "hit" && s.outcome !== "missed") return;
      const cat = s.category || "algorithm";
      if (!map[cat]) map[cat] = { hits: 0, total: 0 };
      map[cat].total++;
      if (s.outcome === "hit") map[cat].hits++;
    });
    return map;
  }, [allSignals]);

  const winRateAngle = (summary.winRate / 100) * 360;

  return (
    <div className="space-y-6">
      <div className="glass-panel rounded-xl p-5 border border-yellow-500/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-yellow-400" />
            <h3 className="text-sm font-bold text-foreground">Signal Verification Control</h3>
          </div>
          <button
            onClick={onVerify}
            disabled={verifying}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 text-xs font-bold transition-all disabled:opacity-50"
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {verifying ? "Verifying..." : "Verify Now"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Checks each pending signal against real price data from Yahoo Finance. Signals that hit their target are marked as wins, expired ones as misses. Auto-runs every 30 minutes.
        </p>
        {verifyResult && (
          <div className={`p-3 rounded-lg text-xs font-medium ${verifyResult.error ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400"}`}>
            {verifyResult.error ? verifyResult.error : `Checked ${verifyResult.verified} signals: ${verifyResult.hits} hits, ${verifyResult.misses} misses, ${verifyResult.expired} expired, ${verifyResult.remaining_pending} still pending`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-panel rounded-xl p-5 border border-white/10 flex flex-col items-center justify-center">
          <div className="relative w-28 h-28 mb-3">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor"
                className={summary.winRate >= 60 ? "text-emerald-400" : summary.winRate >= 40 ? "text-yellow-400" : "text-red-400"}
                strokeWidth="8" strokeLinecap="round"
                strokeDasharray={`${(winRateAngle / 360) * 264} 264`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${summary.winRate >= 60 ? "text-emerald-400" : summary.winRate >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                {summary.winRate}%
              </span>
              <span className="text-[9px] text-muted-foreground">Win Rate</span>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{summary.resolved} resolved of {summary.total} total</div>
        </div>

        <div className="glass-panel rounded-xl p-5 border border-white/10">
          <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-primary" /> By Category
          </h4>
          <div className="space-y-3">
            {Object.entries(categoryStats).map(([cat, stats]) => {
              const rate = Math.round((stats.hits / stats.total) * 100);
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold capitalize ${
                      cat === "whale" ? "text-blue-400" : cat === "spread" ? "text-violet-400" : "text-primary"
                    }`}>{cat}</span>
                    <span className="text-xs text-muted-foreground">{stats.hits}/{stats.total} ({rate}%)</span>
                  </div>
                  <div className="h-2 bg-muted/20 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${rate >= 60 ? "bg-emerald-400" : rate >= 40 ? "bg-yellow-400" : "bg-red-400"}`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {Object.keys(categoryStats).length === 0 && (
              <p className="text-xs text-muted-foreground">No resolved signals yet</p>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-xl p-5 border border-white/10 grid grid-cols-2 gap-3">
          <div className="text-center p-3 bg-muted/10 rounded-lg">
            <div className="text-2xl font-bold text-emerald-400">{summary.hits}</div>
            <div className="text-[10px] text-muted-foreground">Hits</div>
          </div>
          <div className="text-center p-3 bg-muted/10 rounded-lg">
            <div className="text-2xl font-bold text-red-400">{summary.misses}</div>
            <div className="text-[10px] text-muted-foreground">Misses</div>
          </div>
          <div className="text-center p-3 bg-muted/10 rounded-lg">
            <div className="text-2xl font-bold text-zinc-400">{summary.expired}</div>
            <div className="text-[10px] text-muted-foreground">Expired</div>
          </div>
          <div className="text-center p-3 bg-muted/10 rounded-lg">
            <div className="text-2xl font-bold text-yellow-400">{summary.pending}</div>
            <div className="text-[10px] text-muted-foreground">Pending</div>
          </div>
        </div>
      </div>

      {tickerStats.length > 0 && (
        <div className="glass-panel rounded-xl p-5 border border-white/10">
          <h4 className="text-xs font-bold text-foreground mb-3 flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-emerald-400" /> Accuracy by Ticker
          </h4>
          <div className="flex flex-wrap gap-2">
            {tickerStats.map(([ticker, stats]) => {
              const rate = Math.round((stats.hits / stats.total) * 100);
              return (
                <span key={ticker} className="inline-flex items-center gap-1.5 text-xs bg-muted/20 px-2.5 py-1.5 rounded-lg">
                  <span className="font-bold text-foreground">{ticker}</span>
                  <span className={`font-semibold ${rate >= 50 ? "text-emerald-400" : "text-red-400"}`}>{rate}%</span>
                  <span className="text-muted-foreground">({stats.hits}/{stats.total})</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="glass-panel rounded-xl p-5 border border-white/10">
        <h3 className="text-sm font-bold text-foreground mb-3">All Signals ({allSignals.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-muted-foreground">
                <th className="text-left py-2 px-2 font-semibold">Outcome</th>
                <th className="text-left py-2 px-2 font-semibold">Ticker</th>
                <th className="text-left py-2 px-2 font-semibold">Direction</th>
                <th className="text-left py-2 px-2 font-semibold">Category</th>
                <th className="text-left py-2 px-2 font-semibold">Strike</th>
                <th className="text-left py-2 px-2 font-semibold">Target</th>
                <th className="text-left py-2 px-2 font-semibold">Detected</th>
                <th className="text-left py-2 px-2 font-semibold">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {allSignals.map(s => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      s.outcome === "hit" ? "bg-emerald-500/20 text-emerald-400"
                      : s.outcome === "missed" ? "bg-red-500/20 text-red-400"
                      : s.outcome === "expired" ? "bg-zinc-500/20 text-zinc-400"
                      : "bg-yellow-500/20 text-yellow-400"
                    }`}>
                      {s.outcome === "hit" ? "HIT" : s.outcome === "missed" ? "MISSED" : s.outcome === "expired" ? "EXPIRED" : "PENDING"}
                    </span>
                  </td>
                  <td className="py-2 px-2 font-bold text-foreground">{s.ticker}</td>
                  <td className="py-2 px-2">
                    <span className={`flex items-center gap-1 ${s.signal_type === "bullish" ? "text-emerald-400" : "text-red-400"}`}>
                      {s.signal_type === "bullish" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {s.signal_type}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      s.category === "whale" ? "bg-blue-500/20 text-blue-400"
                      : s.category === "spread" ? "bg-violet-500/20 text-violet-400"
                      : "bg-primary/20 text-primary"
                    }`}>{s.category || "algorithm"}</span>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">{s.strike ? `$${s.strike}` : "—"}</td>
                  <td className="py-2 px-2 text-muted-foreground max-w-[120px] truncate">{s.target || "—"}</td>
                  <td className="py-2 px-2 text-muted-foreground">
                    {s.detected_at ? new Date(s.detected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : "—"}
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">
                    {s.resolved_at ? new Date(s.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default DashboardAnalytics;
