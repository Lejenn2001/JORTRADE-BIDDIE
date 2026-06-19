import "./_group.css";
import { Waves, Activity, ShieldCheck, Compass, Eye } from "lucide-react";

function ConfidenceRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="hsl(232 25% 14%)" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={r} fill="none"
          stroke="hsl(230 85% 60%)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-foreground leading-none">{value}</span>
        <span className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">conf</span>
      </div>
    </div>
  );
}

export function FlowCard() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5 font-sans antialiased">
      <div className="w-full max-w-[380px] rounded-2xl border border-primary/25 bg-card overflow-hidden shadow-[0_0_32px_-10px_hsl(230_85%_60%/0.45)]">
        {/* Hero header */}
        <div className="px-5 pt-5 pb-4 bg-gradient-to-b from-primary/12 to-transparent">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary px-2.5 py-1 text-[10px] font-bold tracking-[0.15em] uppercase">
              <Waves className="h-3 w-3" /> Call Flow
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]" />
              Live · 10:42 AM ET
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-2xl font-bold tracking-tight text-foreground">NFLX</div>
              <p className="mt-1 text-sm font-semibold text-primary leading-snug">
                Watching the Jun 20 $1080 Calls
              </p>
            </div>
            <ConfidenceRing value={82} />
          </div>
        </div>

        {/* Notable activity callout */}
        <div className="mx-5 -mt-1 mb-4 rounded-xl border border-primary/15 bg-primary/[0.06] px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-primary/80">
            <Activity className="h-3.5 w-3.5" /> Notable Activity
          </div>
          <p className="mt-1.5 text-[13px] text-foreground/85 leading-relaxed">
            Heavy call buying near $1,072 — volume running well above the 30-day average.
          </p>
        </div>

        {/* Support / Outlook rows */}
        <div className="px-5 space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-muted/30 px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Support
            </span>
            <span className="text-sm font-semibold text-foreground">$1,068</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-muted/30 px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Compass className="h-3.5 w-3.5 text-accent" /> Outlook
            </span>
            <span className="text-sm font-semibold text-foreground">$1,090 – $1,105</span>
          </div>
        </div>

        {/* Status */}
        <div className="mt-4 px-5 py-3.5 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Status</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-400/15 text-yellow-300 px-3 py-1 text-[11px] font-semibold">
            <Eye className="h-3 w-3" /> Monitoring
          </span>
        </div>
      </div>
    </div>
  );
}
