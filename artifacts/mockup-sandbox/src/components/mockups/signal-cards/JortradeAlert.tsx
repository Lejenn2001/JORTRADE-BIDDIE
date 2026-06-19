import "./_group.css";
import { Zap, TrendingUp, ShieldCheck, Eye, Clock } from "lucide-react";

function BullIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 4.5c0 3.2 1.4 4.8 3.6 5.3" />
      <path d="M20 4.5c0 3.2-1.4 4.8-3.6 5.3" />
      <path d="M7.4 9.6c-.6 1.1-.6 2.4 0 3.6C8.5 15.4 10.1 17 12 17s3.5-1.6 4.6-3.8c.6-1.2.6-2.5 0-3.6" />
      <circle cx="10.4" cy="13.4" r=".5" fill="currentColor" stroke="none" />
      <circle cx="13.6" cy="13.4" r=".5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ConfRing({ value }: { value: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative h-[60px] w-[60px] shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="hsl(232 25% 14%)" strokeWidth="5" />
        <circle cx="30" cy="30" r={r} fill="none" stroke="hsl(270 75% 60%)" strokeWidth="5"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-foreground">{value}</span>
      </div>
    </div>
  );
}

function Row({
  icon, tile, label, labelColor, children,
}: {
  icon: React.ReactNode; tile: string; label: string; labelColor: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 border-t border-white/5">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${tile}`}>
        {icon}
      </div>
      <div className="min-w-0 pt-0.5">
        <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${labelColor}`}>{label}</div>
        {children}
      </div>
    </div>
  );
}

export function JortradeAlert() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5 font-sans antialiased">
      <div className="w-full max-w-[400px] rounded-2xl border border-primary/25 bg-card overflow-hidden shadow-[0_0_36px_-12px_hsl(230_85%_60%/0.5)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-accent" />
            <span className="text-[12px] font-bold tracking-[0.18em] uppercase text-accent">JORTRADE Alert</span>
            <span className="inline-flex items-center rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">Live</span>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" /> 28m ago
          </span>
        </div>

        {/* Ticker + confidence ring */}
        <div className="px-5 pb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <TrendingUp className="h-6 w-6 text-primary shrink-0" />
            <span className="text-3xl font-bold tracking-tight text-foreground">STX</span>
            <span className="inline-flex items-center rounded-full bg-primary/15 text-primary px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] uppercase">Call Flow</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ConfRing value={66} />
            <div className="text-[12px] font-semibold leading-tight text-accent">Elevated<br />Confidence</div>
          </div>
        </div>

        {/* Bull headline */}
        <Row
          icon={<BullIcon className="h-5 w-5 text-emerald-400" />}
          tile="bg-emerald-500/12 border border-emerald-500/20"
          label=""
          labelColor=""
        >
          <div className="text-base font-bold text-emerald-400 -mt-0.5">Bullish Flow Detected</div>
          <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">
            Watching reaction near $1,080.
          </p>
        </Row>

        {/* Support */}
        <Row
          icon={<ShieldCheck className="h-5 w-5 text-emerald-400" />}
          tile="bg-emerald-500/12 border border-emerald-500/20"
          label="Support" labelColor="text-emerald-400"
        >
          <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">
            Support remains near $1,068.
          </p>
        </Row>

        {/* Outlook */}
        <Row
          icon={<TrendingUp className="h-5 w-5 text-accent" />}
          tile="bg-accent/12 border border-accent/20"
          label="Outlook" labelColor="text-accent"
        >
          <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">
            Potential continuation toward the $1,090 area if momentum persists.
          </p>
        </Row>

        {/* Status */}
        <Row
          icon={<Eye className="h-5 w-5 text-yellow-400" />}
          tile="bg-yellow-400/12 border border-yellow-400/20"
          label="Status" labelColor="text-yellow-400"
        >
          <div className="text-lg font-bold text-foreground mt-0.5">Monitoring</div>
        </Row>

        <div className="h-2" />
      </div>
    </div>
  );
}
