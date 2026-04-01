import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GitBranch, TrendingUp, TrendingDown, Target, Shield, Zap, BarChart3, ChevronDown, ChevronUp } from "lucide-react";

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

const VERSION_META: Record<string, { label: string; description: string; color: string }> = {
  v2: {
    label: "Pivot Targets",
    description: "Pivot-based targets (R1/S1/PDH/PDL), support/resistance invalidation",
    color: "text-zinc-400",
  },
  v3: {
    label: "Swing Targets + VWAP",
    description: "Swing high/low targets, VWAP-based invalidation",
    color: "text-blue-400",
  },
  v4: {
    label: "Premium Confidence",
    description: "Swing targets + VWAP inv + $200K–$500K premium confidence boost for Biddie Picks",
    color: "text-cyan-400",
  },
};

const AlgoVersionTracker = () => {
  const [versions, setVersions] = useState<VersionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

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
        <p className="text-sm text-muted-foreground">No signal data yet.</p>
      </div>
    );
  }

  const sortedVersions = [...versions].sort((a, b) => {
    const numA = parseInt(a.version.replace("v", "")) || 0;
    const numB = parseInt(b.version.replace("v", "")) || 0;
    return numB - numA;
  });

  const currentVersion = sortedVersions[0];
  const olderVersions = sortedVersions.slice(1);

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getMeta = (v: string) => VERSION_META[v] || { label: v, description: "Unknown version", color: "text-zinc-400" };

  const AccuracyBar = ({ value, label, color }: { value: number | null; label: string; color: string }) => {
    if (value === null) return null;
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
        </div>
        <span className="text-[11px] font-bold text-foreground w-10 text-right">{value}%</span>
      </div>
    );
  };

  const VersionCard = ({ data, isCurrent }: { data: VersionData; isCurrent?: boolean }) => {
    const meta = getMeta(data.version);
    const resolved = data.wins + data.losses;

    return (
      <div className={`rounded-lg p-4 ${isCurrent ? "bg-cyan-500/5 border border-cyan-500/20" : "bg-white/[0.02] border border-white/5"}`}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-base font-bold ${meta.color}`}>{data.version.toUpperCase()}</span>
            <span className={`text-[10px] ${meta.color} bg-white/5 px-2 py-0.5 rounded-full font-semibold`}>{meta.label}</span>
            {isCurrent && <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full font-bold">CURRENT</span>}
          </div>
          <span className="text-[10px] text-muted-foreground">{formatDate(data.first_signal)} → {formatDate(data.last_signal)}</span>
        </div>

        <p className="text-[10px] text-muted-foreground/60 mb-3">{meta.description}</p>

        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="text-center py-2 rounded bg-white/[0.03]">
            <div className="text-lg font-bold text-foreground">{data.total_signals}</div>
            <div className="text-[9px] text-muted-foreground">Signals</div>
          </div>
          <div className="text-center py-2 rounded bg-white/[0.03]">
            <div className={`text-lg font-bold ${data.win_rate !== null && data.win_rate >= 60 ? "text-emerald-400" : data.win_rate !== null && data.win_rate >= 40 ? "text-yellow-400" : data.win_rate !== null ? "text-red-400" : "text-muted-foreground"}`}>
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

        <div className="space-y-1.5 mb-3">
          <AccuracyBar value={data.win_rate} label="Win Rate" color="bg-emerald-500" />
          <AccuracyBar value={data.biddie_win_rate} label="Biddie WR" color="bg-cyan-500" />
          <AccuracyBar value={resolved > 0 ? Math.round((data.entries_hit / resolved) * 100) : null} label="Entry Acc" color="bg-blue-500" />
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

  const ComparisonRow = ({ label, values, suffix, higherIsBetter, icon }: {
    label: string; values: (number | null)[]; suffix?: string;
    higherIsBetter?: boolean; icon: React.ReactNode;
  }) => {
    const best = values.filter(v => v !== null).reduce((a, b) => {
      if (a === null) return b;
      if (b === null) return a;
      return higherIsBetter ? Math.max(a, b) : Math.min(a, b);
    }, null as number | null);

    return (
      <div className="bg-white/[0.03] rounded-lg p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          {icon}
          <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
        </div>
        <div className="grid gap-1">
          {sortedVersions.map((v, i) => {
            const val = values[i];
            const isBest = val !== null && val === best && values.filter(x => x === best).length === 1;
            return (
              <div key={v.version} className="flex items-center justify-between">
                <span className={`text-[10px] ${getMeta(v.version).color}`}>{v.version}</span>
                <span className={`text-[11px] font-bold ${isBest ? "text-emerald-400" : "text-foreground/70"}`}>
                  {val !== null ? `${val}${suffix || ""}` : "—"}
                  {isBest && " ★"}
                </span>
              </div>
            );
          })}
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
          <span className="text-[10px] text-muted-foreground bg-muted/30 px-2.5 py-0.5 rounded-full">
            {sortedVersions.length} version{sortedVersions.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <VersionCard data={currentVersion} isCurrent />

      {olderVersions.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide" : "Show"} previous versions ({olderVersions.length})
          </button>

          {expanded && (
            <div className="space-y-3">
              {olderVersions.map(v => (
                <VersionCard key={v.version} data={v} />
              ))}
            </div>
          )}
        </div>
      )}

      {sortedVersions.length >= 2 && (
        <>
          <div className="border-t border-white/5 pt-4 mt-4 mb-3">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Head-to-Head Comparison</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <ComparisonRow
              label="Win Rate"
              values={sortedVersions.map(v => v.win_rate)}
              suffix="%" higherIsBetter
              icon={<Target className="h-3 w-3 text-emerald-400" />}
            />
            <ComparisonRow
              label="Avg MFE"
              values={sortedVersions.map(v => v.avg_mfe)}
              suffix="%" higherIsBetter
              icon={<TrendingUp className="h-3 w-3 text-emerald-400" />}
            />
            <ComparisonRow
              label="Avg Drawdown"
              values={sortedVersions.map(v => v.avg_drawdown)}
              suffix="%"
              icon={<TrendingDown className="h-3 w-3 text-red-400" />}
            />
            <ComparisonRow
              label="Avg Confidence"
              values={sortedVersions.map(v => v.avg_confidence)}
              higherIsBetter
              icon={<Zap className="h-3 w-3 text-amber-400" />}
            />
            <ComparisonRow
              label="Invalidations"
              values={sortedVersions.map(v => v.invalidations_breached)}
              icon={<Shield className="h-3 w-3 text-red-400" />}
            />
            <ComparisonRow
              label="Biddie WR"
              values={sortedVersions.map(v => v.biddie_win_rate)}
              suffix="%" higherIsBetter
              icon={<BarChart3 className="h-3 w-3 text-cyan-400" />}
            />
          </div>
        </>
      )}
    </motion.div>
  );
};

export default AlgoVersionTracker;
