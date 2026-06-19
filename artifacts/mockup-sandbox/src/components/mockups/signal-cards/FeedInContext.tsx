import "./_group.css";
import { TrendingUp, TrendingDown, ShieldCheck, Eye, Clock } from "lucide-react";

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
        {label && <div className={`text-[11px] font-bold uppercase tracking-[0.12em] ${labelColor}`}>{label}</div>}
        {children}
      </div>
    </div>
  );
}

type CardData = {
  ticker: string;
  direction: "bull" | "bear";
  confidence: number;
  confLabel: string;
  age: string;
  headline: string;
  body: string;
  supportLabel: string;
  support: string;
  outlook: string;
  status: string;
};

function AlertCard(d: CardData) {
  const bull = d.direction === "bull";
  const flowColor = bull ? "text-primary" : "text-rose-400";
  const flowBg = bull ? "bg-primary/15 text-primary" : "bg-rose-500/15 text-rose-400";
  const headColor = bull ? "text-emerald-400" : "text-rose-400";
  const headTile = bull ? "bg-emerald-500/12 border border-emerald-500/20" : "bg-rose-500/12 border border-rose-500/20";
  const headIcon = bull
    ? <BullIcon className="h-5 w-5 text-emerald-400" />
    : <TrendingDown className="h-5 w-5 text-rose-400" />;
  const supColor = bull ? "text-emerald-400" : "text-rose-400";
  const supTile = bull ? "bg-emerald-500/12 border border-emerald-500/20" : "bg-rose-500/12 border border-rose-500/20";

  return (
    <div className="w-full rounded-2xl border border-primary/25 bg-card overflow-hidden shadow-[0_0_28px_-14px_hsl(230_85%_60%/0.5)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <span className="inline-flex items-center rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">Live</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" /> {d.age}
        </span>
      </div>

      {/* Ticker + ring */}
      <div className="px-5 pb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {bull
            ? <TrendingUp className="h-6 w-6 text-primary shrink-0" />
            : <TrendingDown className="h-6 w-6 text-rose-400 shrink-0" />}
          <span className="text-3xl font-bold tracking-tight text-foreground">{d.ticker}</span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] uppercase ${flowBg}`}>
            {bull ? "Call Flow" : "Put Flow"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ConfRing value={d.confidence} />
          <div className="text-[12px] font-semibold leading-tight text-accent whitespace-pre-line">{d.confLabel}</div>
        </div>
      </div>

      {/* Headline */}
      <Row icon={headIcon} tile={headTile} label="" labelColor="">
        <div className={`text-base font-bold -mt-0.5 ${headColor}`}>{d.headline}</div>
        <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">{d.body}</p>
      </Row>

      {/* Support / Resistance */}
      <Row icon={<ShieldCheck className={`h-5 w-5 ${supColor}`} />} tile={supTile} label={d.supportLabel} labelColor={supColor}>
        <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">{d.support}</p>
      </Row>

      {/* Outlook */}
      <Row icon={<TrendingUp className="h-5 w-5 text-accent" />} tile="bg-accent/12 border border-accent/20" label="Outlook" labelColor="text-accent">
        <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">{d.outlook}</p>
      </Row>

      {/* Status */}
      <Row icon={<Eye className="h-5 w-5 text-yellow-400" />} tile="bg-yellow-400/12 border border-yellow-400/20" label="Status" labelColor="text-yellow-400">
        <div className="text-lg font-bold text-foreground mt-0.5">{d.status}</div>
      </Row>
      <div className="h-2" />
    </div>
  );
}

const CARDS: CardData[] = [
  {
    ticker: "STX", direction: "bull", confidence: 66, confLabel: "Elevated\nConfidence", age: "28m ago",
    headline: "Bullish Flow Detected",
    body: "Unusual activity has emerged in the Jun 20 $1080 Calls.",
    supportLabel: "Support", support: "Support remains near $1068.",
    outlook: "Potential continuation toward the $1090 area if bullish momentum persists.",
    status: "Active",
  },
  {
    ticker: "NVDA", direction: "bull", confidence: 81, confLabel: "High\nConfidence", age: "12m ago",
    headline: "Bullish Flow Detected",
    body: "Unusual activity has emerged in the Jun 27 $145 Calls.",
    supportLabel: "Support", support: "Support remains near $138.",
    outlook: "Potential continuation toward the $150 area if bullish momentum persists.",
    status: "Active",
  },
  {
    ticker: "SPY", direction: "bear", confidence: 58, confLabel: "Moderate\nConfidence", age: "44m ago",
    headline: "Bearish Flow Detected",
    body: "Unusual activity has emerged in the Jun 20 $580 Puts.",
    supportLabel: "Resistance", support: "Resistance remains near $592.",
    outlook: "Potential continuation toward the $575 area if bearish momentum persists.",
    status: "Monitoring",
  },
];

export function FeedInContext() {
  return (
    <div className="min-h-screen bg-background p-5 font-sans antialiased flex justify-center">
      <div className="w-full max-w-[460px] space-y-4">
        {/* DECISION ENGINE banner */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
          <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 800 200" preserveAspectRatio="none">
            {[40, 90, 140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640, 690, 740].map((x, i) => {
              const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45];
              const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85];
              const green = i % 3 !== 0;
              return (
                <g key={i}>
                  <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#34d399" : "#06b6d4"} strokeWidth="1" />
                  <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#34d399" : "#06b6d4"} rx="1" />
                </g>
              );
            })}
          </svg>
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/15 via-transparent to-cyan-900/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-transparent to-transparent" />
          <div className="relative px-5 py-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-500" />
              <div>
                <h1 className="text-xl font-black tracking-[0.15em] uppercase text-white">Decision Engine</h1>
                <p className="text-[11px] text-muted-foreground tracking-wide mt-0.5">Live market intelligence</p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
            </span>
          </div>
        </div>

        {/* Feed */}
        {CARDS.map((c) => <AlertCard key={c.ticker} {...c} />)}
      </div>
    </div>
  );
}
