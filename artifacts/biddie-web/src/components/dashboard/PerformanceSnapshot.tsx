import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, Flame, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
  const [verifying, setVerifying] = useState(false);

  const fetchStats = async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("signal_outcomes")
        .select("outcome, resolved_at")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false });

      if (data) {
        const resolved = data.filter(d => d.outcome !== "pending" && d.outcome !== "expired");
        const wins = data.filter(d => d.outcome === "win" || d.outcome === "hit").length;
        const losses = data.filter(d => d.outcome === "loss" || d.outcome === "missed").length;
        const pending = data.filter(d => d.outcome === "pending").length;

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

  // Auto-verify on mount, then refresh stats
  useEffect(() => {
    const autoVerify = async () => {
      try {
        await supabase.functions.invoke("verify-signals");
      } catch (e) {
        console.warn("Auto-verify failed:", e);
      }
      fetchStats();
    };
    autoVerify();
  }, []);

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signals");
      if (!error) {
        console.log("Verification result:", data);
        await fetchStats(); // Refresh stats after verification
      }
    } catch (e) {
      console.error("Verify error:", e);
    } finally {
      setVerifying(false);
    }
  };

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
        <div className="flex items-center gap-2">
          {stats.streak >= 3 && (
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400">
              <Flame className="h-3 w-3" />
              {stats.streak}W Streak
            </div>
          )}
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${verifying ? "animate-spin" : ""}`} />
            {verifying ? "Checking..." : "Verify"}
          </button>
        </div>
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
