import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, Flame } from "lucide-react";

interface Stats {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  streak: number;
}

const PerformanceSnapshot = () => {
  const [stats, setStats] = useState<Stats>({ total: 0, wins: 0, losses: 0, pending: 0, streak: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const resp = await fetch('/api/whale/signals/history?limit=100');
        const result = resp.ok ? await resp.json() : null;
        const data = result?.signals;

        if (data) {
          const resolved = data.filter((d: any) => d.outcome !== "pending" && d.outcome !== "expired");
          const wins = data.filter((d: any) => d.outcome === "win" || d.outcome === "hit").length;
          const losses = data.filter((d: any) => d.outcome === "loss" || d.outcome === "missed").length;
          const pending = data.filter((d: any) => d.outcome === "pending").length;

          let streak = 0;
          for (const d of data) {
            if (d.outcome === "win" || d.outcome === "hit") streak++;
            else if (d.outcome !== "pending" && d.outcome !== "expired") break;
          }

          setStats({ total: resolved.length, wins, losses, pending, streak });
        }
      } catch (e) {
        console.error("Performance fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const winRate = stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0;

  if (loading) {
    return <div className="glass-panel rounded-xl p-4 border-glow-green animate-pulse h-20" />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-panel rounded-xl p-4 border-glow-green"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-semibold text-foreground">This Week's Performance</span>
        </div>
        {stats.streak >= 3 && (
          <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400">
            <Flame className="h-3 w-3" />
            {stats.streak}W Streak
          </div>
        )}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-400">{winRate}%</div>
          <div className="text-[9px] text-muted-foreground">Win Rate</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-foreground">{stats.wins}</div>
          <div className="text-[9px] text-muted-foreground">Wins</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-destructive">{stats.losses}</div>
          <div className="text-[9px] text-muted-foreground">Losses</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-primary">{stats.pending}</div>
          <div className="text-[9px] text-muted-foreground">Pending</div>
        </div>
      </div>
    </motion.div>
  );
};

export default PerformanceSnapshot;
