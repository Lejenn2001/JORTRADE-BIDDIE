import "./_group.css";
import { Waves, TrendingUp, Activity, ShieldCheck, Compass, Eye } from "lucide-react";

export function MonitorFeed() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5 font-sans antialiased">
      <div className="w-full max-w-[380px] rounded-2xl border border-primary/20 bg-card overflow-hidden shadow-[0_0_28px_-10px_hsl(230_85%_60%/0.4)]">
        {/* Direction strip */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-primary/10 border-b border-primary/15">
          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.15em] uppercase text-primary">
            <Waves className="h-3.5 w-3.5" /> Call Flow
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]" />
            10:42 AM ET
          </span>
        </div>

        {/* Header: ticker + story + confidence */}
        <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <span className="text-xl font-bold tracking-tight text-foreground">NFLX</span>
            </div>
            <p className="mt-1.5 text-[13px] font-medium text-foreground/90 leading-snug">
              Watching the Jun 20 $1080 Calls
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Confidence</div>
            <div className="text-2xl font-bold text-primary leading-none mt-0.5">82</div>
          </div>
        </div>

        {/* Notable activity */}
        <div className="mx-4 mb-3 flex items-start gap-2.5 rounded-xl bg-muted/40 px-3 py-2.5">
          <Activity className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Notable Activity</div>
            <p className="text-xs text-foreground/80 leading-relaxed mt-1">
              Heavy call buying near $1,072 — volume well above the 30-day average.
            </p>
          </div>
        </div>

        {/* Support + Outlook */}
        <div className="mx-4 mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-muted/30 px-3 py-2.5">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Support
            </div>
            <div className="text-sm font-semibold text-foreground mt-1">$1,068</div>
          </div>
          <div className="rounded-xl bg-muted/30 px-3 py-2.5">
            <div className="flex items-center gap-1 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              <Compass className="h-3 w-3" /> Outlook
            </div>
            <div className="text-sm font-semibold text-foreground mt-1">$1,090 – 1,105</div>
          </div>
        </div>

        {/* Status footer */}
        <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Status</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-400/15 text-yellow-300 px-3 py-1 text-[11px] font-semibold">
            <Eye className="h-3 w-3" /> Monitoring
          </span>
        </div>
      </div>
    </div>
  );
}
