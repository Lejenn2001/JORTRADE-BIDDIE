import { useState, useEffect, useMemo } from "react";
import { CheckCircle, XCircle, Clock, Calendar, TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

interface SignalRecord {
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
}

interface DayStats {
  date: string;
  hits: number;
  misses: number;
  pending: number;
  total: number;
  winRate: number | null;
  signals: SignalRecord[];
  algoVersion?: string;
}

interface Props {
  compact?: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PerformanceCalendar = ({ compact = false }: Props) => {
  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [algoVersions, setAlgoVersions] = useState<Record<string, string>>({});
  const [algoVersionDefault, setAlgoVersionDefault] = useState("v5");
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayStats | null>(null);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const resp = await fetch("/api/whale/signals/calendar?limit=500");
        if (resp.ok) {
          const data = await resp.json();
          setSignals(data.signals || []);
          if (data.algoVersions) setAlgoVersions(data.algoVersions);
          if (data.algoVersionDefault) setAlgoVersionDefault(data.algoVersionDefault);
        }
      } catch (e) {
        console.warn("Failed to fetch signal calendar:", e);
      }
      setLoading(false);
    };
    fetchSignals();
  }, []);

  const classifyOutcome = (outcome: string | null) => {
    if (outcome === "hit" || outcome === "partial_hit") return "hit";
    if (outcome === "missed" || outcome === "near_miss") return "missed";
    return "pending";
  };

  const dailyStats = useMemo(() => {
    const byDay: Record<string, DayStats> = {};
    for (const s of signals) {
      const raw = s.detected_at || s.created_at || "";
      const dateStr = typeof raw === "string" && raw.length >= 10 ? raw.slice(0, 10) : new Date(raw).toISOString().slice(0, 10);
      if (!byDay[dateStr]) {
        byDay[dateStr] = { date: dateStr, hits: 0, misses: 0, pending: 0, total: 0, winRate: null, signals: [], algoVersion: algoVersions[dateStr] || algoVersionDefault };
      }
      byDay[dateStr].total++;
      byDay[dateStr].signals.push(s);
      const cls = classifyOutcome(s.outcome);
      if (cls === "hit") byDay[dateStr].hits++;
      else if (cls === "missed") byDay[dateStr].misses++;
      else byDay[dateStr].pending++;
    }
    for (const day of Object.values(byDay)) {
      const resolved = day.hits + day.misses;
      day.winRate = resolved > 0 ? (day.hits / resolved) * 100 : null;
    }
    return byDay;
  }, [signals, algoVersions, algoVersionDefault]);

  const overallStats = useMemo(() => {
    let hits = 0, misses = 0, pending = 0;
    for (const s of signals) {
      const cls = classifyOutcome(s.outcome);
      if (cls === "hit") hits++;
      else if (cls === "missed") misses++;
      else pending++;
    }
    const resolved = hits + misses;
    return {
      hits,
      misses,
      pending,
      total: signals.length,
      winRate: resolved > 0 ? ((hits / resolved) * 100).toFixed(1) : "—",
    };
  }, [signals]);

  const calendarDays = useMemo(() => {
    const { year, month } = viewMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const days: (DayStats | null)[] = [];

    for (let i = 0; i < startPad; i++) days.push(null);

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push(dailyStats[dateStr] || { date: dateStr, hits: 0, misses: 0, pending: 0, total: 0, winRate: null, signals: [] });
    }
    return days;
  }, [viewMonth, dailyStats]);

  const monthLabel = new Date(viewMonth.year, viewMonth.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prevMonth = () => {
    setViewMonth(prev => {
      const m = prev.month - 1;
      return m < 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: m };
    });
    setSelectedDay(null);
  };

  const nextMonth = () => {
    setViewMonth(prev => {
      const m = prev.month + 1;
      return m > 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: m };
    });
    setSelectedDay(null);
  };

  const getDayCellColor = (day: DayStats) => {
    if (day.total === 0) return "bg-muted/10";
    if (day.winRate === null) return "bg-amber-400/15 border-amber-400/30";
    if (day.winRate >= 70) return "bg-emerald-500/25 border-emerald-500/40";
    if (day.winRate >= 50) return "bg-emerald-500/15 border-emerald-500/30";
    if (day.winRate >= 30) return "bg-orange-500/15 border-orange-500/30";
    return "bg-red-500/15 border-red-500/30";
  };

  const getDayTextColor = (day: DayStats) => {
    if (day.total === 0) return "text-muted-foreground/40";
    if (day.winRate === null) return "text-amber-400";
    if (day.winRate >= 50) return "text-emerald-400";
    return "text-red-400";
  };

  const today = new Date().toLocaleDateString("en-CA");

  if (loading) {
    return (
      <div className="glass-panel rounded-xl border-border/40 p-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-xs text-muted-foreground">Loading performance data...</span>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">AI Signal Performance</h3>
          <span className="text-[10px] text-muted-foreground ml-auto">{overallStats.total} signals tracked</span>
        </div>
        <div className="grid grid-cols-4 gap-2 p-3">
          <div className="text-center p-2 rounded-lg bg-muted/20">
            <p className={`text-xl font-bold ${overallStats.winRate !== "—" && parseFloat(overallStats.winRate) >= 50 ? "text-emerald-400" : overallStats.winRate !== "—" ? "text-destructive" : "text-foreground"}`}>
              {overallStats.winRate}{overallStats.winRate !== "—" && "%"}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Win Rate</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/20">
            <p className="text-xl font-bold text-emerald-400">{overallStats.hits}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Hits</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/20">
            <p className="text-xl font-bold text-destructive">{overallStats.misses}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Misses</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/20">
            <p className="text-xl font-bold text-amber-400">{overallStats.pending}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Pending</p>
          </div>
        </div>

        <div className="px-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-foreground">{monthLabel}</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-[8px] text-muted-foreground/60 font-medium py-0.5">{d}</div>
            ))}
            {calendarDays.map((day, i) => (
              <div key={i} className="aspect-square flex items-center justify-center">
                {day ? (
                  <button
                    onClick={() => day.total > 0 && setSelectedDay(selectedDay?.date === day.date ? null : day)}
                    className={`w-full h-full rounded text-[9px] font-bold flex flex-col items-center justify-center border transition-all relative ${
                      getDayCellColor(day)
                    } ${getDayTextColor(day)} ${
                      day.date === today ? "ring-1 ring-primary/60" : ""
                    } ${day.total > 0 ? "cursor-pointer hover:brightness-125" : "cursor-default"} ${
                      selectedDay?.date === day.date ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    {parseInt(day.date.split("-")[2])}
                    {day.total > 0 && day.algoVersion && (
                      <span className="text-[6px] font-medium text-primary/70 leading-none">{day.algoVersion}</span>
                    )}
                  </button>
                ) : <div />}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-2 justify-center">
            <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm bg-emerald-500/25 border border-emerald-500/40" /> 70%+
            </span>
            <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm bg-emerald-500/15 border border-emerald-500/30" /> 50%+
            </span>
            <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm bg-orange-500/15 border border-orange-500/30" /> 30%+
            </span>
            <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm bg-red-500/15 border border-red-500/30" /> &lt;30%
            </span>
            <span className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <span className="w-2 h-2 rounded-sm bg-amber-400/15 border border-amber-400/30" /> Pending
            </span>
          </div>
        </div>

        {selectedDay && selectedDay.total > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="border-t border-border/40 px-3 py-2"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold text-foreground">
                  {new Date(selectedDay.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </p>
                {selectedDay.algoVersion && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/20 text-primary">{selectedDay.algoVersion.toUpperCase()}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedDay.winRate !== null && (
                  <span className={`text-[10px] font-bold ${selectedDay.winRate >= 50 ? "text-emerald-400" : "text-destructive"}`}>
                    {selectedDay.winRate.toFixed(0)}% Win Rate
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {selectedDay.hits}H / {selectedDay.misses}M / {selectedDay.pending}P
                </span>
              </div>
            </div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {selectedDay.signals.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded bg-muted/10">
                  {s.outcome === "hit" || s.outcome === "partial_hit" ? (
                    <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : s.outcome === "missed" || s.outcome === "near_miss" ? (
                    <XCircle className="h-3 w-3 text-destructive shrink-0" />
                  ) : (
                    <Clock className="h-3 w-3 text-amber-400 shrink-0" />
                  )}
                  <span className="font-bold text-foreground">{s.ticker}</span>
                  <span className={s.signal_type === "bullish" ? "text-emerald-400" : "text-destructive"}>
                    {s.put_call?.toUpperCase() || s.signal_type}
                  </span>
                  {s.strike && <span className="text-muted-foreground">${s.strike}</span>}
                  {s.expiry && <span className="text-muted-foreground/60">{s.expiry}</span>}
                  <span className="text-muted-foreground/50 ml-auto">{s.category}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl border-border/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Performance Calendar</h2>
        <span className="text-[10px] text-muted-foreground ml-auto">{overallStats.total} signals tracked</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
          <p className={`text-2xl font-bold ${overallStats.winRate !== "—" && parseFloat(overallStats.winRate) >= 50 ? "text-emerald-400" : overallStats.winRate !== "—" ? "text-destructive" : "text-foreground"}`}>
            {overallStats.winRate}{overallStats.winRate !== "—" && "%"}
          </p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Hits</p>
          <p className="text-2xl font-bold text-emerald-400">{overallStats.hits}</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Misses</p>
          <p className="text-2xl font-bold text-destructive">{overallStats.misses}</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-amber-400">{overallStats.pending}</p>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold text-foreground">{monthLabel}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[10px] text-muted-foreground/60 font-medium py-1">{d}</div>
          ))}
          {calendarDays.map((day, i) => (
            <div key={i} className="aspect-square flex items-center justify-center">
              {day ? (
                <button
                  onClick={() => day.total > 0 && setSelectedDay(selectedDay?.date === day.date ? null : day)}
                  className={`w-full h-full rounded-lg text-xs font-bold flex flex-col items-center justify-center border transition-all gap-0.5 ${
                    getDayCellColor(day)
                  } ${getDayTextColor(day)} ${
                    day.date === today ? "ring-1 ring-primary/60" : ""
                  } ${day.total > 0 ? "cursor-pointer hover:brightness-125" : "cursor-default"} ${
                    selectedDay?.date === day.date ? "ring-2 ring-primary" : ""
                  }`}
                >
                  <span>{parseInt(day.date.split("-")[2])}</span>
                  {day.total > 0 && (
                    <span className="text-[8px] opacity-70">
                      {day.hits + day.misses > 0 ? `${day.winRate?.toFixed(0)}%` : `${day.pending}p`}
                    </span>
                  )}
                  {day.total > 0 && day.algoVersion && (
                    <span className="text-[7px] font-medium text-primary/60 leading-none">{day.algoVersion}</span>
                  )}
                </button>
              ) : <div />}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 mt-3 justify-center">
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/25 border border-emerald-500/40" /> 70%+
          </span>
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/15 border border-emerald-500/30" /> 50%+
          </span>
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-500/15 border border-orange-500/30" /> 30%+
          </span>
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500/15 border border-red-500/30" /> &lt;30%
          </span>
          <span className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/15 border border-amber-400/30" /> Pending
          </span>
        </div>
      </div>

      {selectedDay && selectedDay.total > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-border/40 px-4 py-3"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-foreground">
                {new Date(selectedDay.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
              {selectedDay.algoVersion && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/20 text-primary">{selectedDay.algoVersion.toUpperCase()}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {selectedDay.winRate !== null && (
                <span className={`text-xs font-bold ${selectedDay.winRate >= 50 ? "text-emerald-400" : "text-destructive"}`}>
                  {selectedDay.winRate.toFixed(0)}% Win Rate
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {selectedDay.hits} hits / {selectedDay.misses} misses / {selectedDay.pending} pending
              </span>
            </div>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {selectedDay.signals.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-[11px] py-1.5 px-3 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors">
                {s.outcome === "hit" || s.outcome === "partial_hit" ? (
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                ) : s.outcome === "missed" || s.outcome === "near_miss" ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                )}
                <span className="font-bold text-foreground min-w-[40px]">{s.ticker}</span>
                <span className={`min-w-[35px] ${s.signal_type === "bullish" ? "text-emerald-400" : "text-destructive"}`}>
                  {s.put_call?.toUpperCase() || s.signal_type}
                </span>
                {s.strike && <span className="text-muted-foreground">${s.strike}</span>}
                {s.expiry && <span className="text-muted-foreground/60 text-[10px]">{s.expiry}</span>}
                <span className="text-muted-foreground/40 ml-auto text-[10px]">{s.category}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default PerformanceCalendar;
