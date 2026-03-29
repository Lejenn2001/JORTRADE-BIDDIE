import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  BarChart3, Flame, Trophy, TrendingUp,
  CheckCircle2, XCircle, Clock, Zap, Activity, PieChart,
  ArrowUpRight, ArrowDownRight, Loader2, Lightbulb,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Trash2, Wallet, ExternalLink
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
import biddieRobot from "@/assets/biddie-robot.png";

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

interface WeeklyStats {
  week_start: string;
  week_end: string;
  total_signals: number;
  hits: number;
  misses: number;
  partial_hits: number;
  expired: number;
  pending: number;
  win_rate: string;
  avg_conviction: string;
  top_tickers: { ticker: string; hits: number; total: number }[];
  biddie_pick_hits: number;
  biddie_pick_total: number;
  biddie_pick_win_rate: string;
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
  entry_price?: number | null;
}

interface HistoricalSignal {
  id: string;
  ticker: string;
  signal_type: string;
  put_call: string;
  confidence: number;
  strike: string;
  outcome: string;
  created_at: string;
  detected_at: string;
  resolved_at: string | null;
  category: string;
  price_at_signal: number | null;
  target_price: string | null;
  is_biddie_pick: boolean;
  direction: string;
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
  const [allSignals, setAllSignals] = useState<HistoricalSignal[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats[]>([]);
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
          fetch("/api/whale/signals/calendar?limit=1000").then(r => r.json())
        );

        promises.push(
          fetch("/api/whale/weekly-stats").then(r => r.json())
        );

        const [statsData, tradesData, historyData, weeklyData] = await Promise.all(promises);

        if (statsData.stats) setUserStats(statsData.stats);
        if (tradesData.trades) setUserTrades(tradesData.trades);
        if (weeklyData?.weeks) setWeeklyStats(weeklyData.weeks);

        if (historyData.signals) {
          setAllSignals(historyData.signals);
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
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
              <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 800 200" preserveAspectRatio="none">
                {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
                  const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45];
                  const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85];
                  const green = i % 3 !== 0;
                  return (
                    <g key={i}>
                      <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#34d399" : "#10b981"} strokeWidth="1" />
                      <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#34d399" : "#10b981"} rx="1" />
                    </g>
                  );
                })}
              </svg>
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/15 via-transparent to-green-900/12" />
              <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />

              <div className="relative px-6 py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-emerald-400 to-green-500" />
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                      ANALYTICS
                    </h1>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-400/80 font-semibold mt-0.5">
                      Performance & Tracking
                    </p>
                  </div>
                </div>

                <div className="flex gap-1 bg-white/[0.04] border border-white/[0.08] rounded-xl p-1">
                  {(["overview", "mytrades", "pnl"] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        activeTab === tab ? "bg-primary text-primary-foreground shadow-lg" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.05]"
                      }`}
                    >
                      {tab === "overview" ? "Overview" : tab === "mytrades" ? "My Trades" : "P&L Calendar"}
                    </button>
                  ))}
                </div>
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
                      weeklyStats={weeklyStats}
                    />
                  </>
                )}
                {activeTab === "mytrades" && (
                  <MyTradesTab userStats={userStats} userTrades={userTrades} userTopTickers={userTopTickers} allSignals={allSignals} />
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
      className={`relative overflow-hidden rounded-xl p-4 border ${color} bg-[hsl(232,30%,8%,0.8)] backdrop-blur-md`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(270,60%,40%,0.06)] to-transparent pointer-events-none" />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
          <p className="text-2xl font-extrabold text-foreground mt-1">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className="p-2 rounded-lg bg-[hsl(270,60%,40%,0.1)] border border-[hsl(270,60%,40%,0.15)]">{icon}</div>
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
  const gradients: Record<string, string> = {
    algorithm: "bg-gradient-to-r from-emerald-500 to-emerald-400",
    whale: "bg-gradient-to-r from-[hsl(230,85%,60%)] to-[hsl(200,90%,55%)]",
    spread: "bg-gradient-to-r from-[hsl(270,75%,60%)] to-[hsl(300,60%,50%)]",
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">{labels[category] || category}</span>
        <span className="text-xs text-muted-foreground font-medium">{rate}% ({hits}/{total})</span>
      </div>
      <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${gradients[category] || "bg-gradient-to-r from-[hsl(230,85%,60%)] to-[hsl(270,75%,60%)]"}`}
          initial={{ width: 0 }}
          animate={{ width: `${rate}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

function OverviewTab({ userStats, signalStats, topTickers, userTopTickers, weeklyStats }: {
  userStats: TradeStats | null; signalStats: SignalStats | null;
  topTickers: { ticker: string; hits: number; total: number; winRate: number }[];
  userTopTickers: { ticker: string; hits: number; total: number; winRate: number }[];
  weeklyStats: WeeklyStats[];
}) {
  const [selectedWeek, setSelectedWeek] = useState<WeeklyStats | null>(null);

  const formatWeekLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getWeekColor = (winRate: number, total: number) => {
    if (total === 0) return "bg-muted/20 border-white/5";
    if (winRate >= 80) return "bg-emerald-500/15 border-emerald-500/30";
    if (winRate >= 60) return "bg-blue-500/15 border-blue-500/30";
    if (winRate >= 40) return "bg-yellow-500/15 border-yellow-500/30";
    return "bg-red-500/15 border-red-500/30";
  };

  const getWinRateEmoji = (winRate: number, total: number) => {
    if (total === 0) return "—";
    if (winRate >= 80) return "🔥";
    if (winRate >= 60) return "✅";
    if (winRate >= 40) return "⚠️";
    return "📉";
  };

  const sortedWeeks = [...weeklyStats].filter(w => (w.biddie_pick_total || w.total_signals) > 0).sort((a, b) =>
    new Date(a.week_start).getTime() - new Date(b.week_start).getTime()
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="relative overflow-hidden rounded-xl p-5 border border-white/10 bg-gradient-to-br from-yellow-500/10 via-background to-background">
          <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-2xl -translate-y-8 translate-x-8" />
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-yellow-400" />
            Your Trading Stats
          </h3>
          {userStats && userStats.total > 0 ? (
            <div className="flex items-center gap-5">
              <WinRateRing rate={userStats.winRate} size={80} />
              <div className="flex-1 space-y-2.5">
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
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-yellow-500/10 flex items-center justify-center">
                <Trophy className="h-6 w-6 text-yellow-400/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No trades taken yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Click "I Took This Trade" on signals to start tracking</p>
            </div>
          )}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
        className="relative overflow-hidden rounded-xl p-5 border border-white/10 bg-gradient-to-br from-primary/5 via-background to-background">
        <div className="absolute top-0 left-0 w-40 h-40 bg-primary/5 rounded-full blur-3xl -translate-y-12 -translate-x-12" />
        <h3 className="text-sm font-bold text-foreground mb-1 flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          Weekly Signal Report Card
        </h3>
        <p className="text-[10px] text-muted-foreground/60 mb-4">
          How Biddie's signals performed each week — every week is saved so you can track progress over time!
        </p>

        {sortedWeeks.length > 0 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {sortedWeeks.map((week) => {
                const wr = week.biddie_pick_win_rate ? parseFloat(week.biddie_pick_win_rate) : parseFloat(week.win_rate);
                const pickTotal = week.biddie_pick_total ?? week.total_signals;
                const pickHits = week.biddie_pick_hits ?? (week.hits + week.partial_hits);
                const isSelected = selectedWeek?.week_start === week.week_start;
                const now = new Date();
                const ws = new Date(week.week_start);
                const isCurrentWeek = ws <= now && new Date(week.week_end) > now;

                return (
                  <button
                    key={week.week_start}
                    onClick={() => setSelectedWeek(isSelected ? null : week)}
                    className={`relative rounded-xl p-3 border text-left transition-all hover:scale-[1.02] cursor-pointer ${
                      isSelected
                        ? "border-primary/50 bg-primary/10 ring-1 ring-primary/30"
                        : getWeekColor(wr, pickTotal)
                    }`}
                  >
                    {isCurrentWeek && (
                      <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30 animate-pulse">
                        NOW
                      </span>
                    )}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {formatWeekLabel(week.week_start)} – {formatWeekLabel(week.week_end)}
                      </span>
                      <span className="text-xs">{getWinRateEmoji(wr, pickTotal)}</span>
                    </div>
                    <div className={`text-xl font-black ${
                      wr >= 80 ? "text-emerald-400" : wr >= 60 ? "text-blue-400" : wr >= 40 ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {wr.toFixed(0)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {pickTotal} signals · {pickHits}W / {week.misses}L
                    </div>
                    <div className="mt-1.5 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          wr >= 80 ? "bg-emerald-400" : wr >= 60 ? "bg-blue-400" : wr >= 40 ? "bg-yellow-400" : "bg-red-400"
                        }`}
                        style={{ width: `${Math.min(wr, 100)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedWeek && (() => {
              const w = selectedWeek;
              const wr = parseFloat(w.win_rate);
              const avgConv = parseFloat(w.avg_conviction);
              const biddieWr = parseFloat(w.biddie_pick_win_rate);
              const resolved = w.hits + w.partial_hits + w.misses;

              return (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-2">
                      <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                      Week of {formatWeekLabel(w.week_start)} – {formatWeekLabel(w.week_end)}
                    </h4>
                    <span className={`text-lg font-black ${
                      wr >= 80 ? "text-emerald-400" : wr >= 60 ? "text-blue-400" : wr >= 40 ? "text-yellow-400" : "text-red-400"
                    }`}>
                      {wr.toFixed(0)}% Win Rate
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-center">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 mx-auto mb-1" />
                      <div className="text-lg font-black text-emerald-400">{w.hits + w.partial_hits}</div>
                      <div className="text-[9px] text-muted-foreground">Wins</div>
                    </div>
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-center">
                      <XCircle className="h-4 w-4 text-red-400 mx-auto mb-1" />
                      <div className="text-lg font-black text-red-400">{w.misses}</div>
                      <div className="text-[9px] text-muted-foreground">Losses</div>
                    </div>
                    <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2.5 text-center">
                      <Clock className="h-4 w-4 text-yellow-400 mx-auto mb-1" />
                      <div className="text-lg font-black text-yellow-400">{w.pending + w.expired}</div>
                      <div className="text-[9px] text-muted-foreground">Pending/Expired</div>
                    </div>
                    <div className="rounded-lg bg-primary/10 border border-primary/20 p-2.5 text-center">
                      <Activity className="h-4 w-4 text-primary mx-auto mb-1" />
                      <div className="text-lg font-black text-primary">{avgConv.toFixed(0)}</div>
                      <div className="text-[9px] text-muted-foreground">Avg Conviction</div>
                    </div>
                  </div>

                  {w.biddie_pick_total > 0 && (
                    <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5 text-violet-400" />
                        <span className="text-xs text-foreground font-semibold">Biddie Picks</span>
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-black ${biddieWr >= 70 ? "text-emerald-400" : biddieWr >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                          {biddieWr.toFixed(0)}%
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-1.5">
                          ({w.biddie_pick_hits}/{w.biddie_pick_total})
                        </span>
                      </div>
                    </div>
                  )}

                  {w.top_tickers && w.top_tickers.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1.5 font-semibold">Most Active Tickers This Week</p>
                      <div className="flex flex-wrap gap-1.5">
                        {w.top_tickers.map((t) => (
                          <span key={t.ticker} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-muted/20 border border-white/5">
                            <span className="text-foreground">{t.ticker}</span>
                            <span className="text-muted-foreground ml-1">{t.hits}/{t.total}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="px-3 py-2 bg-muted/10 rounded-lg border border-white/5">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {wr >= 80
                        ? "🔥 Incredible week! The signals were on fire — this is what a hot streak looks like."
                        : wr >= 60
                        ? "✅ Solid week! More winners than losers — that's what consistent trading looks like."
                        : wr >= 40
                        ? "⚠️ Mixed week — some hits, some misses. Every week teaches you something new!"
                        : "📉 Tough week — the market didn't cooperate. Even the best traders have off weeks. The key is staying disciplined!"}
                      {" "}This week had {w.biddie_pick_total ?? w.total_signals} Biddie pick signals with an average conviction of {avgConv.toFixed(0)}/100.
                    </p>
                  </div>
                </motion.div>
              );
            })()}

            <div className="flex items-center gap-2 text-[9px] text-muted-foreground/50">
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400/30" /> 80%+</div>
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400/30" /> 60-79%</div>
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400/30" /> 40-59%</div>
              <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400/30" /> &lt;40%</div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <CalendarIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No weekly data yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Weekly stats are saved automatically — check back after the first full week!</p>
          </div>
        )}
      </motion.div>

      {topTickers.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="relative overflow-hidden rounded-xl p-5 border border-white/10 bg-gradient-to-br from-violet-500/5 via-background to-background">
          <div className="absolute bottom-0 left-0 w-40 h-40 bg-violet-500/5 rounded-full blur-3xl translate-y-12 -translate-x-12" />
          <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-violet-400" />
            Top Performing Tickers
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {topTickers.slice(0, 5).map((t, i) => (
              <div key={t.ticker} className="relative rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center hover:border-white/15 transition-colors">
                {i === 0 && <div className="absolute -top-1.5 -right-1.5 text-yellow-400 text-xs">&#9733;</div>}
                <div className="text-sm font-extrabold text-foreground">{t.ticker}</div>
                <div className={`text-lg font-black mt-0.5 ${t.winRate >= 70 ? "text-emerald-400" : t.winRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                  {t.winRate}%
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{t.hits}/{t.total} wins</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}


function computeLearningInsights(userTrades: UserTrade[], userTopTickers: { ticker: string; hits: number; total: number; winRate: number }[]) {
  const insights: { text: string; type: "positive" | "warning" | "neutral" }[] = [];
  if (userTrades.length < 3) return insights;

  const dayStats: Record<string, { wins: number; losses: number; total: number }> = {};
  const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const t of userTrades) {
    if (!t.signal_outcome || t.signal_outcome === "pending") continue;
    const day = DAYS_FULL[new Date(t.taken_at).getDay()];
    if (!dayStats[day]) dayStats[day] = { wins: 0, losses: 0, total: 0 };
    dayStats[day].total++;
    if (t.signal_outcome === "hit" || t.signal_outcome === "partial_hit") dayStats[day].wins++;
    else dayStats[day].losses++;
  }

  let worstDay = "", worstRate = 100, bestDay = "", bestRate = 0;
  for (const [day, s] of Object.entries(dayStats)) {
    if (s.total < 2) continue;
    const rate = Math.round((s.wins / s.total) * 100);
    if (rate < worstRate) { worstRate = rate; worstDay = day; }
    if (rate > bestRate) { bestRate = rate; bestDay = day; }
  }
  if (worstDay && worstRate < 40) insights.push({ text: `You tend to lose on ${worstDay}s (${worstRate}% win rate)`, type: "warning" });
  if (bestDay && bestRate >= 60) insights.push({ text: `Your best day is ${bestDay} (${bestRate}% win rate)`, type: "positive" });

  if (userTopTickers.length > 0) {
    const best = userTopTickers.reduce((a, b) => b.winRate > a.winRate && b.total >= 2 ? b : a, userTopTickers[0]);
    if (best.winRate >= 60 && best.total >= 2) insights.push({ text: `Your best ticker is ${best.ticker} (${best.winRate}% over ${best.total} trades)`, type: "positive" });
    const worst = userTopTickers.reduce((a, b) => b.winRate < a.winRate && b.total >= 2 ? b : a, userTopTickers[0]);
    if (worst.winRate < 40 && worst.total >= 2 && worst.ticker !== best.ticker) insights.push({ text: `Watch out for ${worst.ticker} — only ${worst.winRate}% win rate`, type: "warning" });
  }

  const catStats: Record<string, { wins: number; total: number }> = {};
  for (const t of userTrades) {
    if (!t.signal_outcome || t.signal_outcome === "pending") continue;
    const cat = t.category || "algorithm";
    if (!catStats[cat]) catStats[cat] = { wins: 0, total: 0 };
    catStats[cat].total++;
    if (t.signal_outcome === "hit" || t.signal_outcome === "partial_hit") catStats[cat].wins++;
  }
  const catLabels: Record<string, string> = { algorithm: "Algorithm signals", whale: "Whale flow signals", spread: "Spread signals" };
  for (const [cat, s] of Object.entries(catStats)) {
    if (s.total < 3) continue;
    const rate = Math.round((s.wins / s.total) * 100);
    if (rate >= 70) insights.push({ text: `${catLabels[cat] || cat} are working well for you (${rate}%)`, type: "positive" });
    else if (rate < 30) insights.push({ text: `${catLabels[cat] || cat} have a low hit rate for you (${rate}%)`, type: "warning" });
  }

  const resolvedTrades = userTrades.filter(t => t.signal_outcome === "hit" || t.signal_outcome === "partial_hit" || t.signal_outcome === "missed");
  if (resolvedTrades.length >= 5) {
    const recent5 = resolvedTrades.slice(0, 5);
    const recentWins = recent5.filter(t => t.signal_outcome === "hit" || t.signal_outcome === "partial_hit").length;
    if (recentWins >= 4) insights.push({ text: `You're on fire — ${recentWins}/5 recent trades were winners`, type: "positive" });
    else if (recentWins <= 1) insights.push({ text: `Rough stretch — only ${recentWins}/5 recent trades hit. Consider being more selective`, type: "warning" });
  }

  return insights.slice(0, 4);
}


function MyTradesTab({ userStats, userTrades, userTopTickers, allSignals }: {
  userStats: TradeStats | null; userTrades: UserTrade[]; userTopTickers: { ticker: string; hits: number; total: number; winRate: number }[];
  allSignals: HistoricalSignal[];
}) {
  const navigate = useNavigate();
  const insights = useMemo(() => computeLearningInsights(userTrades, userTopTickers), [userTrades, userTopTickers]);

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

          {insights.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="relative overflow-hidden rounded-xl p-5 border border-white/10 bg-gradient-to-br from-amber-500/10 via-background to-background">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full blur-2xl -translate-y-8 translate-x-8" />
              <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-400" />
                Learning Insights
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold">AI-POWERED</span>
              </h3>
              <div className="space-y-2">
                {insights.map((insight, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.05 }}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
                      insight.type === "positive" ? "bg-emerald-500/10 border border-emerald-500/20"
                      : insight.type === "warning" ? "bg-red-500/10 border border-red-500/20"
                      : "bg-white/5 border border-white/10"
                    }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                      insight.type === "positive" ? "bg-emerald-500/20" : insight.type === "warning" ? "bg-red-500/20" : "bg-white/10"
                    }`}>
                      {insight.type === "positive" ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <Flame className="h-3 w-3 text-red-400" />}
                    </div>
                    <p className="text-xs text-foreground font-medium leading-relaxed">{insight.text}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {userTopTickers.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className="relative overflow-hidden rounded-xl border border-[hsl(230,85%,60%,0.15)] bg-[hsl(232,30%,8%,0.7)] backdrop-blur-md p-5">
                <div className="absolute inset-0 bg-gradient-to-br from-[hsl(230,85%,60%,0.04)] to-transparent pointer-events-none" />
                <div className="relative">
                  <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                    <div className="w-1.5 h-4 rounded-full bg-gradient-to-b from-[hsl(230,85%,60%)] to-[hsl(200,90%,55%)]" />
                    Your Top Tickers
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {userTopTickers.map((t, i) => (
                      <div key={t.ticker} className="relative rounded-lg p-3 text-center border border-white/[0.06] bg-gradient-to-br from-white/[0.03] to-transparent hover:border-[hsl(270,60%,40%,0.25)] transition-colors">
                        {i === 0 && <div className="absolute -top-1 -right-1 text-yellow-400 text-[10px]">&#9733;</div>}
                        <p className="text-sm font-extrabold text-foreground">{t.ticker}</p>
                        <p className={`text-base font-black mt-0.5 ${t.winRate >= 70 ? "text-emerald-400" : t.winRate >= 50 ? "text-[hsl(270,75%,70%)]" : "text-red-400"}`}>
                          {t.winRate}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">{t.total} trades</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {userStats.byCategory && Object.keys(userStats.byCategory).length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="relative overflow-hidden rounded-xl border border-[hsl(270,60%,40%,0.15)] bg-[hsl(232,30%,8%,0.7)] backdrop-blur-md p-5">
                <div className="absolute inset-0 bg-gradient-to-br from-[hsl(270,60%,40%,0.04)] to-transparent pointer-events-none" />
                <div className="relative">
                  <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                    <div className="w-1.5 h-4 rounded-full bg-gradient-to-b from-[hsl(270,75%,60%)] to-[hsl(300,60%,50%)]" />
                    Win Rate by Signal Type
                  </h3>
                  <div className="space-y-3">
                    {Object.entries(userStats.byCategory).map(([cat, data]) => (
                      <CategoryBar key={cat} category={cat} hits={data.hits} total={data.total} />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="relative overflow-hidden rounded-xl border border-[hsl(270,60%,40%,0.2)] bg-[hsl(232,30%,8%,0.7)] backdrop-blur-md">
            <div className="absolute inset-0 bg-gradient-to-b from-[hsl(270,60%,40%,0.05)] via-transparent to-[hsl(230,85%,60%,0.03)] pointer-events-none" />
            <div className="relative p-5">
              <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                <div className="w-1.5 h-4 rounded-full bg-gradient-to-b from-[hsl(270,75%,60%)] to-[hsl(230,85%,60%)]" />
                Recent Trades
              </h3>
              <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                {userTrades.slice(0, 20).map((trade, i) => {
                  const isWin = trade.signal_outcome === "hit" || trade.signal_outcome === "partial_hit";
                  const isLoss = trade.signal_outcome === "missed";
                  const isBullish = (trade.signal_type || trade.direction) === "bullish";
                  const borderGlow = isWin ? "border-l-emerald-500/60" : isLoss ? "border-l-red-500/60" : "border-l-[hsl(270,75%,60%,0.4)]";

                  return (
                    <motion.div key={trade.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * Math.min(i, 10) }}
                      className={`relative rounded-lg border border-white/[0.06] border-l-2 ${borderGlow} bg-gradient-to-r from-white/[0.03] to-transparent hover:from-white/[0.06] transition-all duration-200 px-4 py-3 space-y-2`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          isBullish
                            ? "bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-emerald-400 shadow-[0_0_12px_hsl(142,71%,45%,0.15)]"
                            : "bg-gradient-to-br from-red-500/20 to-red-600/10 text-red-400 shadow-[0_0_12px_hsl(0,72%,51%,0.15)]"
                        }`}>
                          {isBullish ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-extrabold text-foreground tracking-tight">{trade.ticker}</span>
                            {trade.strike && <span className="text-[10px] text-muted-foreground font-medium">${trade.strike} {trade.option_type || ""}</span>}
                            {trade.category && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${
                                trade.category === "whale" ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                : trade.category === "spread" ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                                : "bg-[hsl(230,85%,60%,0.1)] text-[hsl(230,85%,70%)] border-[hsl(230,85%,60%,0.2)]"
                              }`}>{trade.category}</span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(trade.taken_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`text-[11px] font-bold px-2.5 py-1 rounded-md border ${
                            isWin ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25 shadow-[0_0_8px_hsl(142,71%,45%,0.1)]"
                            : isLoss ? "bg-red-500/15 text-red-400 border-red-500/25 shadow-[0_0_8px_hsl(0,72%,51%,0.1)]"
                            : "bg-[hsl(270,60%,40%,0.1)] text-[hsl(270,75%,70%)] border-[hsl(270,60%,40%,0.2)]"
                          }`}>
                            {isWin ? "WIN" : isLoss ? "LOSS" : "PENDING"}
                          </div>
                          <button
                            onClick={() => {
                              const resolved = trade.signal_outcome !== "pending" ? "true" : "false";
                              navigate(`/dashboard/signals?search=${encodeURIComponent(trade.ticker)}&resolved=${resolved}`);
                            }}
                            className="w-7 h-7 rounded-md flex items-center justify-center border border-white/[0.08] bg-white/[0.03] hover:bg-[hsl(270,60%,40%,0.15)] hover:border-[hsl(270,60%,40%,0.3)] transition-all text-muted-foreground hover:text-[hsl(270,75%,70%)]"
                            title="View Signal"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      ) : (
        <div className="relative overflow-hidden rounded-xl p-12 border border-[hsl(270,60%,40%,0.15)] bg-[hsl(232,30%,8%,0.7)] backdrop-blur-md text-center">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(270,60%,40%,0.06)] via-transparent to-[hsl(230,85%,60%,0.04)] pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-[radial-gradient(circle,hsl(270,75%,40%,0.08)_0%,transparent_60%)] pointer-events-none" />
          <div className="relative">
            <img src={biddieRobot} alt="Biddie" className="w-20 h-20 mx-auto mb-4 opacity-40 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-500 drop-shadow-[0_0_15px_hsl(230_85%_60%_/_0.3)]" />
            <h3 className="text-lg font-bold text-foreground">No Trades Yet</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
              Head to the Signals tab and click "I Took This Trade" on any signal you follow.
              Your stats will start building here automatically!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


export default DashboardAnalytics;
