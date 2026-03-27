import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, Flame, Zap, Waves } from "lucide-react";

interface CategoryStats {
  hits: number;
  misses: number;
  pending: number;
}

interface DayStats {
  algorithm: CategoryStats;
  whale: CategoryStats;
  spread: CategoryStats;
}

const PerformanceSnapshot = () => {
  const [today, setToday] = useState<DayStats>({ algorithm: { hits: 0, misses: 0, pending: 0 }, whale: { hits: 0, misses: 0, pending: 0 }, spread: { hits: 0, misses: 0, pending: 0 } });
  const [week, setWeek] = useState<DayStats>({ algorithm: { hits: 0, misses: 0, pending: 0 }, whale: { hits: 0, misses: 0, pending: 0 }, spread: { hits: 0, misses: 0, pending: 0 } });
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const resp = await fetch('/api/whale/signals/history?limit=500');
        const result = resp.ok ? await resp.json() : null;
        const data = result?.signals;
        if (!data) return;

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        const todayStats: DayStats = { algorithm: { hits: 0, misses: 0, pending: 0 }, whale: { hits: 0, misses: 0, pending: 0 }, spread: { hits: 0, misses: 0, pending: 0 } };
        const weekStats: DayStats = { algorithm: { hits: 0, misses: 0, pending: 0 }, whale: { hits: 0, misses: 0, pending: 0 }, spread: { hits: 0, misses: 0, pending: 0 } };

        let winStreak = 0;
        for (const d of data) {
          if (d.outcome === "hit" || d.outcome === "win") winStreak++;
          else if (d.outcome !== "pending" && d.outcome !== null && d.outcome !== undefined) break;
        }

        for (const s of data) {
          const detected = new Date(s.detected_at || s.created_at);
          const cat = (s.category === "whale" ? "whale" : s.category === "spread" ? "spread" : "algorithm") as keyof DayStats;
          const isHit = s.outcome === "hit" || s.outcome === "win";
          const isMiss = s.outcome === "missed" || s.outcome === "loss";
          const isPending = !s.outcome || s.outcome === "pending";

          if (detected >= weekStart) {
            if (isHit) weekStats[cat].hits++;
            else if (isMiss) weekStats[cat].misses++;
            else if (isPending) weekStats[cat].pending++;
          }

          if (detected >= todayStart) {
            if (isHit) todayStats[cat].hits++;
            else if (isMiss) todayStats[cat].misses++;
            else if (isPending) todayStats[cat].pending++;
          }
        }

        setToday(todayStats);
        setWeek(weekStats);
        setStreak(winStreak);
      } catch (e) {
        console.error("Performance fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const totalWeek = Object.values(week).reduce((sum, c) => sum + c.hits + c.misses, 0);
  const totalWeekHits = Object.values(week).reduce((sum, c) => sum + c.hits, 0);
  const totalWeekLosses = Object.values(week).reduce((sum, c) => sum + c.misses, 0);
  const weekWinRate = totalWeek > 0 ? Math.round((totalWeekHits / totalWeek) * 100) : 0;
  const totalWeekPending = Object.values(week).reduce((sum, c) => sum + c.pending, 0);

  const totalToday = Object.values(today).reduce((sum, c) => sum + c.hits + c.misses + c.pending, 0);

  if (loading) {
    return <div className="glass-panel rounded-xl p-5 border-glow-green animate-pulse h-28" />;
  }

  const CategoryRow = ({ label, icon, stats, color }: { label: string; icon: React.ReactNode; stats: CategoryStats; color: string }) => {
    const resolved = stats.hits + stats.misses;
    const rate = resolved > 0 ? Math.round((stats.hits / resolved) * 100) : null;
    const total = stats.hits + stats.misses + stats.pending;
    if (total === 0) return null;
    return (
      <div className="flex items-center gap-3 text-xs">
        {icon}
        <span className={`font-semibold w-20 ${color}`}>{label}</span>
        <div className="flex items-center gap-4 flex-1">
          <span className="text-emerald-400 font-bold">{stats.hits} <span className="text-[10px] font-normal opacity-70">Win</span></span>
          <span className="text-red-400 font-bold">{stats.misses} <span className="text-[10px] font-normal opacity-70">Loss</span></span>
          <span className="text-muted-foreground">{stats.pending} <span className="text-[10px] font-normal opacity-70">Pending</span></span>
        </div>
        {rate !== null && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${rate >= 60 ? "bg-emerald-500/20 text-emerald-400" : rate >= 40 ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}`}>
            {rate}%
          </span>
        )}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-panel rounded-xl p-5 border-glow-green"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-foreground">AI Signal Performance</span>
          <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">This Week</span>
        </div>
        <div className="flex items-center gap-3">
          {totalToday > 0 && (
            <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {totalToday} today
            </span>
          )}
          {streak >= 3 && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400">
              <Flame className="h-3 w-3" />
              {streak}W Streak
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center py-2 rounded-lg bg-white/[0.03]">
          <div className={`text-2xl font-extrabold ${weekWinRate >= 60 ? "text-emerald-400" : weekWinRate >= 40 ? "text-yellow-400" : "text-red-400"}`}>{weekWinRate}%</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Win Rate</div>
        </div>
        <div className="text-center py-2 rounded-lg bg-white/[0.03]">
          <div className="text-2xl font-extrabold text-emerald-400">{totalWeekHits}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Wins</div>
        </div>
        <div className="text-center py-2 rounded-lg bg-white/[0.03]">
          <div className="text-2xl font-extrabold text-red-400">{totalWeekLosses}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Losses</div>
        </div>
        <div className="text-center py-2 rounded-lg bg-white/[0.03]">
          <div className="text-2xl font-extrabold text-blue-400">{totalWeekPending}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Pending</div>
        </div>
      </div>

      <div className="space-y-2 pt-3 border-t border-white/5">
        <CategoryRow label="Algorithm" icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />} stats={week.algorithm} color="text-emerald-400" />
        <CategoryRow label="Whale" icon={<Waves className="h-3.5 w-3.5 text-blue-400" />} stats={week.whale} color="text-blue-400" />
        <CategoryRow label="Spread" icon={<Target className="h-3.5 w-3.5 text-violet-400" />} stats={week.spread} color="text-violet-400" />
      </div>

      <p className="text-[9px] text-muted-foreground/50 mt-3 pt-2 border-t border-white/5 leading-relaxed">
        * Tracking only Biddie AI Picks — signals evaluated and scored by the AI from live options flow. Raw flow alerts are not included in these stats.
      </p>
    </motion.div>
  );
};

export default PerformanceSnapshot;
