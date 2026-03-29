import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, Target, Flame, Trophy,
  CheckCircle2, XCircle, Clock, Zap, Activity, PieChart,
  ArrowUpRight, ArrowDownRight, Loader2,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Trash2, Wallet
} from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PerformanceSnapshot from "@/components/dashboard/PerformanceSnapshot";
import { useAuth } from "@/hooks/useAuth";
import { useRealtimePrices } from "@/hooks/useRealtimePrices";
import type { PriceInfo } from "@/hooks/useRealtimePrices";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

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


const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface PnLTrade {
  id: string;
  trade_date: string;
  amount: number;
  ticker: string | null;
  notes: string | null;
}

const PnLTab = () => {
  const { profile, session } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const [trades, setTrades] = useState<PnLTrade[]>([]);
  const [pnlLoading, setPnlLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [ticker, setTicker] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  useEffect(() => {
    if (!session?.user?.id) return;
    const fetchTrades = async () => {
      setPnlLoading(true);
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", session.user.id)
        .gte("trade_date", startDate)
        .lte("trade_date", endDate)
        .order("trade_date", { ascending: true });
      if (!error && data) setTrades(data as PnLTrade[]);
      setPnlLoading(false);
    };
    fetchTrades();
  }, [session?.user?.id, year, month, daysInMonth]);

  const pnlData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of trades) {
      map[t.trade_date] = (map[t.trade_date] || 0) + Number(t.amount);
    }
    return map;
  }, [trades]);

  const entries = Object.values(pnlData);
  const totalPnL = entries.reduce((a, b) => a + b, 0);
  const winDays = entries.filter((v) => v > 0).length;
  const loseDays = entries.filter((v) => v < 0).length;
  const winRate = entries.length > 0 ? Math.round((winDays / entries.length) * 100) : 0;
  const bestDay = entries.length > 0 ? Math.max(...entries) : 0;
  const worstDay = entries.length > 0 ? Math.min(...entries) : 0;

  const sortedDates = Object.keys(pnlData).sort().reverse();
  let streak = 0;
  for (const d of sortedDates) {
    if (pnlData[d] > 0) streak++;
    else break;
  }

  const handleDayClick = (d: number) => {
    const date = new Date(year, month, d);
    if (date.getDay() === 0 || date.getDay() === 6) return;
    if (date > new Date()) return;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayTrades = trades.filter((t) => t.trade_date === key);
    if (dayTrades.length > 0) {
      setDetailDate(key);
    } else {
      setSelectedDate(key);
      setAmount("");
      setTicker("");
      setNotes("");
      setDialogOpen(true);
    }
  };

  const handleSave = async () => {
    if (!session?.user?.id || !amount) return;
    setSaving(true);
    const { error } = await supabase.from("trades").insert({
      user_id: session.user.id,
      trade_date: selectedDate,
      amount: parseFloat(amount),
      ticker: ticker || null,
      notes: notes || null,
    } as any);
    if (error) {
      toast({ title: "Error saving trade", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Trade logged!" });
      const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
      const { data } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", session.user.id)
        .gte("trade_date", startDate)
        .lte("trade_date", endDate)
        .order("trade_date", { ascending: true });
      if (data) setTrades(data as PnLTrade[]);
      setDialogOpen(false);
    }
    setSaving(false);
  };

  const handleDelete = async (tradeId: string) => {
    const { error } = await supabase.from("trades").delete().eq("id", tradeId);
    if (!error) {
      setTrades((prev) => prev.filter((t) => t.id !== tradeId));
      toast({ title: "Trade deleted" });
      const remaining = trades.filter((t) => t.id !== tradeId && t.trade_date === detailDate);
      if (remaining.length === 0) setDetailDate(null);
    }
  };

  const detailTrades = detailDate ? trades.filter((t) => t.trade_date === detailDate) : [];
  const detailTotal = detailTrades.reduce((s, t) => s + Number(t.amount), 0);

  const calendarCells = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="aspect-square" />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const pnl = pnlData[key];
    const isToday = new Date().toDateString() === new Date(year, month, d).toDateString();
    const date = new Date(year, month, d);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const isFuture = date > new Date();
    const isClickable = !isWeekend && !isFuture;
    calendarCells.push(
      <div
        key={d}
        onClick={() => isClickable && handleDayClick(d)}
        className={`aspect-square rounded-xl border transition-all flex flex-col items-center justify-center gap-0.5 text-xs
          ${isClickable ? "cursor-pointer hover:border-primary/50 hover:scale-105" : ""}
          ${isToday ? "ring-2 ring-primary/50" : ""}
          ${isWeekend ? "bg-muted/20 border-border/20" : "border-border/40"}
          ${pnl !== undefined && pnl > 0 ? "bg-emerald-500/10 border-emerald-500/30" : ""}
          ${pnl !== undefined && pnl < 0 ? "bg-red-500/10 border-red-500/30" : ""}
          ${pnl !== undefined && pnl === 0 ? "bg-muted/30 border-border/40" : ""}
        `}
      >
        <span className={`font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>{d}</span>
        {pnl !== undefined && (
          <span className={`text-[10px] font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(0)}
          </span>
        )}
        {!isWeekend && !isFuture && pnl === undefined && (
          <Plus className="h-3 w-3 text-muted-foreground/30" />
        )}
      </div>
    );
  }

  if (pnlLoading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="glass-panel rounded-xl p-4 border-glow-blue">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Monthly P&L</p>
          <p className={`text-xl font-extrabold ${totalPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
          </p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win Rate</p>
          <p className="text-xl font-extrabold text-foreground">{winRate}%</p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Win / Loss Days</p>
          <p className="text-xl font-extrabold text-foreground">
            <span className="text-emerald-400">{winDays}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-red-400">{loseDays}</span>
          </p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Best Day</p>
          <p className="text-xl font-extrabold text-emerald-400">+${bestDay.toFixed(0)}</p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Worst Day</p>
          <p className="text-xl font-extrabold text-red-400">-${Math.abs(worstDay).toFixed(0)}</p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
            <Flame className="h-3 w-3 text-primary" /> Win Streak
          </p>
          <p className="text-xl font-extrabold text-primary">{streak} days</p>
        </div>
      </div>

      <div className="glass-panel rounded-xl border-glow-purple p-5">
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <ChevronLeft className="h-5 w-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-bold text-foreground">{monthName}</h2>
          </div>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground text-center mb-3">Click any weekday to log a trade</p>
        <div className="grid grid-cols-7 gap-2 mb-2">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">{calendarCells}</div>
      </div>

      <div className="glass-panel rounded-xl p-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          <p className="text-sm text-muted-foreground">
            {entries.length === 0
              ? `Start logging your trades ${firstName}! Click any day on the calendar.`
              : totalPnL > 0
                ? `Great month so far ${firstName}! Keep the momentum going.`
                : `Stay disciplined ${firstName}. Every trader has rough patches.`}
          </p>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-panel border-border/50 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Log Trade</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {selectedDate && new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Profit / Loss ($)</Label>
              <Input type="number" step="0.01" placeholder="e.g. 250 or -100" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-muted/30 border-border/50" />
              <p className="text-[10px] text-muted-foreground mt-1">Use negative for losses</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Ticker (optional)</Label>
              <Input placeholder="e.g. SPY, AAPL" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="bg-muted/30 border-border/50" />
            </div>
            <div>
              <Label className="text-muted-foreground">Notes (optional)</Label>
              <Input placeholder="e.g. Caught the morning dip" value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-muted/30 border-border/50" />
            </div>
            <Button onClick={handleSave} disabled={!amount || saving} className="w-full" variant="hero">
              {saving ? "Saving..." : "Log Trade"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailDate} onOpenChange={(open) => !open && setDetailDate(null)}>
        <DialogContent className="glass-panel border-border/50 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {detailDate && new Date(detailDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </DialogTitle>
            <DialogDescription>
              <span className={`font-bold ${detailTotal >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                Day Total: {detailTotal >= 0 ? "+" : ""}${detailTotal.toFixed(2)}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {detailTrades.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30">
                <div>
                  <span className={`font-bold text-sm ${Number(t.amount) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(t.amount) >= 0 ? "+" : ""}${Number(t.amount).toFixed(2)}
                  </span>
                  {t.ticker && <span className="text-xs text-muted-foreground ml-2">{t.ticker}</span>}
                  {t.notes && <p className="text-[10px] text-muted-foreground mt-0.5">{t.notes}</p>}
                </div>
                <button onClick={() => handleDelete(t.id)} className="p-1 hover:bg-red-500/20 rounded transition-colors">
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            ))}
          </div>
          <Button variant="hero" className="w-full" onClick={() => { setSelectedDate(detailDate!); setAmount(""); setTicker(""); setNotes(""); setDetailDate(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Another Trade
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const DashboardAnalytics = () => {
  const { user } = useAuth();
  const { getPrice } = useRealtimePrices();
  const [userStats, setUserStats] = useState<TradeStats | null>(null);
  const [signalStats, setSignalStats] = useState<SignalStats | null>(null);
  const [userTrades, setUserTrades] = useState<UserTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "mytrades" | "pnl">("overview");

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
          const picks = historyData.signals.filter((s: any) => s.is_biddie_pick);
          const resolved = picks.filter((s: any) => s.outcome === "hit" || s.outcome === "partial_hit" || s.outcome === "missed");
          const hits = resolved.filter((s: any) => s.outcome === "hit" || s.outcome === "partial_hit").length;

          const byTicker: Record<string, { hits: number; total: number }> = {};
          const byCategory: Record<string, { hits: number; total: number }> = {};
          for (const s of resolved) {
            const tk = s.ticker;
            if (!byTicker[tk]) byTicker[tk] = { hits: 0, total: 0 };
            byTicker[tk].total++;
            if (s.outcome === "hit" || s.outcome === "partial_hit") byTicker[tk].hits++;

            const cat = s.category || "algorithm";
            if (!byCategory[cat]) byCategory[cat] = { hits: 0, total: 0 };
            byCategory[cat].total++;
            if (s.outcome === "hit" || s.outcome === "partial_hit") byCategory[cat].hits++;
          }

          setSignalStats({
            total: picks.length,
            hits,
            misses: resolved.length - hits,
            pending: picks.filter((s: any) => !s.outcome || s.outcome === "pending").length,
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
              </div>

              <div className="flex gap-1 bg-muted/30 rounded-lg p-1">
                {(["overview", "mytrades", "pnl"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                      activeTab === tab ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab === "overview" ? "Overview" : tab === "mytrades" ? "My Trades" : "P&L Calendar"}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-60">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {activeTab === "overview" && (
                  <>
                    <PerformanceSnapshot />
                    <OverviewTab
                      userStats={userStats}
                      signalStats={signalStats}
                      topTickers={topTickers}
                      userTopTickers={userTopTickers}
                    />
                  </>
                )}
                {activeTab === "mytrades" && (
                  <MyTradesTab userStats={userStats} userTrades={userTrades} userTopTickers={userTopTickers} getPrice={getPrice} />
                )}
                {activeTab === "pnl" && (
                  <PnLTab />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                const alertPrice = trade.price_at_signal ? Number(trade.price_at_signal) : null;
                const entryPrice = trade.entry_price ? Number(trade.entry_price) : alertPrice;
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


export default DashboardAnalytics;
