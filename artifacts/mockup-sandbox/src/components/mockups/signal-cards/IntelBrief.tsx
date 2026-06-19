import "./_group.css";
import { Waves, Eye } from "lucide-react";

export function IntelBrief() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5 font-sans antialiased">
      <div className="w-full max-w-[380px] rounded-2xl border border-border bg-card overflow-hidden">
        {/* Quiet header */}
        <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
          <div>
            <div className="text-[22px] font-bold tracking-tight text-foreground leading-none">NFLX</div>
            <span className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.15em] uppercase text-primary">
              <Waves className="h-3 w-3" /> Call Flow
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-400/12 text-yellow-300 px-2.5 py-1 text-[10px] font-semibold">
            <Eye className="h-3 w-3" /> Monitoring
          </span>
        </div>

        {/* Story line */}
        <div className="px-5 pb-3">
          <p className="text-[15px] font-medium text-foreground leading-snug">
            Watching the Jun 20 $1080 Calls
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
            Heavy call buying came in near $1,072 today, with volume running well above the
            30-day average — a sign of building interest worth keeping an eye on.
          </p>
        </div>

        {/* Key levels — clean ledger */}
        <div className="mx-5 mb-5 rounded-xl border border-border/70 divide-y divide-border/70">
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Support</span>
            <span className="text-sm font-semibold text-foreground">$1,068</span>
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5">
            <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Outlook</span>
            <span className="text-sm font-semibold text-foreground">$1,090 – $1,105</span>
          </div>
        </div>

        {/* Subtle confidence bar */}
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Confidence</span>
            <span className="text-xs font-semibold text-foreground">82<span className="text-muted-foreground">/100</span></span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted/50 overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: "82%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
