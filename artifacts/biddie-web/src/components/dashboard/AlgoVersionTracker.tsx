import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, TrendingUp, TrendingDown, Target, Shield, Zap, BarChart3 } from "lucide-react";

interface VersionData {
  version: string;
  total_signals: number;
  wins: number;
  losses: number;
  pending: number;
  win_rate: number | null;
  avg_confidence: number | null;
  avg_mfe: number | null;
  avg_drawdown: number | null;
  entries_hit: number;
  invalidations_breached: number;
  biddie_picks: number;
  biddie_win_rate: number | null;
  first_signal: string;
  last_signal: string;
}

const AlgoVersionTracker = () => {
  const [versions, setVersions] = useState<VersionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/whale/admin/version-comparison");
        if (res.ok) {
          const data = await res.json();
          setVersions(data.versions || []);
        }
      } catch {} finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="glass-panel rounded-xl p-6 border-cyan-500/20 animate-pulse h-48" />;
  }

  if (versions.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-6 border-cyan-500/20">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-foreground">Algorithm Version Tracker</span>
        </div>
        <p className="text-sm text-muted-foreground">No signal data yet. Comparison will appear once v3 signals start generating.</p>
      </div>
    );
  }

  const v2 = versions.find(v => v.version === "v2");
  const v3 = versions.find(v => v.version === "v3");

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const MetricCard = ({ label, v2Val, v3Val, suffix, higherIsBetter, icon }: {
    label: string; v2Val: number | null; v3Val: number | null; suffix?: string;
    higherIsBetter?: boolean; icon: React.ReactNode;
  }) => {
    const v2Str = v2Val !== null && v2Val !== undefined ? `${v2Val}${suffix || ""}` : "—";
    const v3Str = v3Val !== null && v3Val !== undefined ? `${v3Val}${suffix || ""}` : "—";
    const hasComparison = v2Val !== null && v3Val !== null && v2Val !== undefined && v3Val !== undefined;
    const diff = hasComparison ? v3Val! - v2Val! : 0;
    const improved = higherIsBetter ? diff > 0 : diff < 0;
    const neutral = Math.abs(diff) < 0.5;

    return (
      <div className="bg-white/[0.03] rounded-lg p-3">
        <div className="flex items-center gap-1.5 mb-2">
          {icon}
          <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] text-muted-foreground/60 mb-0.5">v2</div>
            <div className="text-sm font-bold text-foreground/70">{v2Str}</div>
          </div>
          <div>
            <div className="text-[10px] text-cyan-400/80 mb-0.5">v3</div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-foreground">{v3Str}</span>
              {hasComparison && !neutral && (
                <span className={`text-[10px] font-bold ${improved ? "text-emerald-400" : "text-red-400"}`}>
                  {diff > 0 ? "+" : ""}{suffix === "%" ? diff.toFixed(0) : diff.toFixed(1)}{suffix === "%" ? "pp" : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const VersionColumn = ({ data, isNew }: { data: VersionData | undefined; isNew?: boolean }) => {
    if (!data) return (
      <div className="flex-1 bg-white/[0.02] rounded-lg p-4 text-center">
        <p className="text-sm text-muted-foreground">Waiting for data...</p>
      </div>
    );

    const resolved = data.wins + data.losses;
    return (
      <div className={`flex-1 rounded-lg p-4 ${isNew ? "bg-cyan-500/5 border border-cyan-500/20" : "bg-white/[0.02] border border-white/5"}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`text-base font-bold ${isNew ? "text-cyan-400" : "text-foreground/70"}`}>{data.version.toUpperCase()}</span>
            {isNew && <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full font-bold">CURRENT</span>}
          </div>
          <span className="text-[10px] text-muted-foreground">{formatDate(data.first_signal)} → {formatDate(data.last_signal)}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="text-center py-2 rounded bg-white/[0.03]">
            <div className="text-lg font-bold text-foreground">{data.total_signals}</div>
            <div className="text-[9px] text-muted-foreground">Signals</div>
          </div>
          <div className="text-center py-2 rounded bg-white/[0.03]">
            <div className={`text-lg font-bold ${data.win_rate && data.win_rate >= 60 ? "text-emerald-400" : data.win_rate && data.win_rate >= 40 ? "text-yellow-400" : data.win_rate ? "text-red-400" : "text-muted-foreground"}`}>
              {data.win_rate !== null ? `${data.win_rate}%` : "—"}
            </div>
            <div className="text-[9px] text-muted-foreground">Win Rate</div>
          </div>
          <div className="text-center py-2 rounded bg-white/[0.03]">
            <div className="text-lg font-bold text-emerald-400">{data.wins}</div>
            <div className="text-[9px] text-muted-foreground">Wins</div>
          </div>
          <div className="text-center py-2 rounded bg-white/[0.03]">
            <div className="text-lg font-bold text-red-400">{data.losses}</div>
            <div className="text-[9px] text-muted-foreground">Losses</div>
          </div>
        </div>

        <div className="space-y-1.5 text-[11px]">
          {data.avg_mfe !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg MFE</span>
              <span className="text-emerald-400 font-semibold">{data.avg_mfe}%</span>
            </div>
          )}
          {data.avg_drawdown !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg Drawdown</span>
              <span className="text-red-400 font-semibold">{data.avg_drawdown}%</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Entries Reached</span>
            <span className="text-foreground font-semibold">{data.entries_hit}/{resolved > 0 ? resolved : data.total_signals}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invalidations Hit</span>
            <span className="text-foreground font-semibold">{data.invalidations_breached}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Biddie Picks</span>
            <span className="text-foreground font-semibold">{data.biddie_picks} {data.biddie_win_rate !== null ? `(${data.biddie_win_rate}% WR)` : ""}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pending</span>
            <span className="text-blue-400 font-semibold">{data.pending}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="glass-panel rounded-xl px-6 py-5 border-cyan-500/20"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <GitBranch className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-foreground">Algorithm Version Tracker</span>
          <span className="text-[10px] text-muted-foreground bg-muted/30 px-2.5 py-0.5 rounded-full">v2 → v3 Comparison</span>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <VersionColumn data={v2} />
        <VersionColumn data={v3} isNew />
      </div>

      {v2 && v3 && (
        <>
          <div className="border-t border-white/5 pt-4 mb-3">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Head-to-Head</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <MetricCard label="Win Rate" v2Val={v2.win_rate} v3Val={v3.win_rate} suffix="%" higherIsBetter icon={<Target className="h-3 w-3 text-emerald-400" />} />
            <MetricCard label="Avg MFE" v2Val={v2.avg_mfe} v3Val={v3.avg_mfe} suffix="%" higherIsBetter icon={<TrendingUp className="h-3 w-3 text-emerald-400" />} />
            <MetricCard label="Avg Drawdown" v2Val={v2.avg_drawdown} v3Val={v3.avg_drawdown} suffix="%" icon={<TrendingDown className="h-3 w-3 text-red-400" />} />
            <MetricCard label="Avg Confidence" v2Val={v2.avg_confidence} v3Val={v3.avg_confidence} higherIsBetter icon={<Zap className="h-3 w-3 text-amber-400" />} />
            <MetricCard label="Invalidations" v2Val={v2.invalidations_breached} v3Val={v3.invalidations_breached} icon={<Shield className="h-3 w-3 text-red-400" />} />
            <MetricCard label="Biddie WR" v2Val={v2.biddie_win_rate} v3Val={v3.biddie_win_rate} suffix="%" higherIsBetter icon={<BarChart3 className="h-3 w-3 text-cyan-400" />} />
          </div>
        </>
      )}

      <p className="text-[9px] text-muted-foreground/40 mt-4 pt-3 border-t border-white/5">
        v2: Pivot-based targets (R1/S1/PDH/PDL), support/resistance invalidation. v3: Swing high/low targets, VWAP-based invalidation. Excludes SPX/SPXW signals.
      </p>
    </motion.div>
  );
};

export default AlgoVersionTracker;
