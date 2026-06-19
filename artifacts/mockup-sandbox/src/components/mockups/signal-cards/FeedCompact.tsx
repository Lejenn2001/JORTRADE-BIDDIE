import "./_group.css";
import { TrendingUp, TrendingDown, Shield, Target, Zap, Clock } from "lucide-react";

function MiniRing({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative h-9 w-9 shrink-0" title={`Confidence ${value}`}>
      <svg className="h-full w-full -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="hsl(232 25% 16%)" strokeWidth="3.5" />
        <circle cx="20" cy="20" r={r} fill="none" stroke="hsl(270 75% 62%)" strokeWidth="3.5"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold text-foreground">{value}</span>
      </div>
    </div>
  );
}

function Chip({ icon, label, val, valColor }: { icon: React.ReactNode; label: string; val: string; valColor: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-1 text-[11px]">
      {icon}
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${valColor}`}>{val}</span>
    </span>
  );
}

type CardData = {
  ticker: string;
  direction: "bull" | "bear";
  confidence: number;
  age: string;
  headline: string;
  contract: string;
  supportLabel: string;
  support: string;
  outlook: string;
  status: "Active" | "Monitoring";
};

function CompactCard(d: CardData) {
  const bull = d.direction === "bull";
  const accentBar = bull ? "bg-emerald-400" : "bg-rose-400";
  const flowBg = bull ? "bg-primary/15 text-primary" : "bg-rose-500/15 text-rose-400";
  const headColor = bull ? "text-emerald-400" : "text-rose-400";
  const supColor = bull ? "text-emerald-400" : "text-rose-400";
  const statusChip = d.status === "Active"
    ? "bg-cyan-400/15 text-cyan-300"
    : "bg-yellow-400/15 text-yellow-400";

  return (
    <div className="relative rounded-xl border border-white/[0.07] bg-card overflow-hidden hover:border-primary/30 transition-colors">
      <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentBar}`} />
      <div className="pl-4 pr-3.5 py-3">
        {/* Top row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {bull
              ? <TrendingUp className="h-4 w-4 text-primary shrink-0" />
              : <TrendingDown className="h-4 w-4 text-rose-400 shrink-0" />}
            <span className="text-base font-bold tracking-tight text-foreground">{d.ticker}</span>
            <span className={`inline-flex items-center h-5 rounded-full px-2 text-[9px] font-bold tracking-[0.1em] uppercase ${flowBg}`}>
              {bull ? "Call" : "Put"}
            </span>
            <span className={`inline-flex items-center gap-0.5 h-5 rounded-full px-2 text-[9px] font-bold uppercase tracking-wider ${statusChip}`}>
              {d.status === "Active" && <Zap className="h-2.5 w-2.5" />}
              {d.status}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />{d.age}
            </span>
            <MiniRing value={d.confidence} />
          </div>
        </div>

        {/* Headline + contract */}
        <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
          <span className={`text-[12px] font-semibold shrink-0 ${headColor}`}>{d.headline}</span>
          <span className="text-[11px] text-muted-foreground truncate">· {d.contract}</span>
        </div>

        {/* Stat chips */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip icon={<Shield className={`h-3 w-3 ${supColor}`} />} label={d.supportLabel} val={d.support} valColor={supColor} />
          <Chip icon={<Target className="h-3 w-3 text-accent" />} label="Outlook" val={d.outlook} valColor="text-accent" />
        </div>
      </div>
    </div>
  );
}

const CARDS: CardData[] = [
  { ticker: "STX",  direction: "bull", confidence: 66, age: "28m", headline: "Bullish Flow", contract: "Jun 20 $1080 Calls", supportLabel: "Support", support: "$1068", outlook: "$1090", status: "Active" },
  { ticker: "NVDA", direction: "bull", confidence: 81, age: "12m", headline: "Bullish Flow", contract: "Jun 27 $145 Calls",  supportLabel: "Support", support: "$138",  outlook: "$150",  status: "Active" },
  { ticker: "SPY",  direction: "bear", confidence: 58, age: "44m", headline: "Bearish Flow", contract: "Jun 20 $580 Puts",   supportLabel: "Resist.", support: "$592",  outlook: "$575",  status: "Monitoring" },
  { ticker: "AMD",  direction: "bull", confidence: 73, age: "9m",  headline: "Bullish Flow", contract: "Jun 27 $175 Calls",  supportLabel: "Support", support: "$168",  outlook: "$182",  status: "Active" },
  { ticker: "AAPL", direction: "bull", confidence: 49, age: "1h",  headline: "Bullish Flow", contract: "Jul 3 $210 Calls",   supportLabel: "Support", support: "$205",  outlook: "$214",  status: "Monitoring" },
];

export function FeedCompact() {
  return (
    <div className="min-h-screen bg-background p-5 font-sans antialiased flex justify-center">
      <div className="w-full max-w-[460px] space-y-2.5">
        {/* DECISION ENGINE banner */}
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)] mb-3.5">
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
          <div className="relative px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-500" />
              <div>
                <h1 className="text-lg font-black tracking-[0.15em] uppercase text-white">Decision Engine</h1>
                <p className="text-[10px] text-muted-foreground tracking-wide mt-0.5">Live market intelligence</p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
            </span>
          </div>
        </div>

        {/* Compact feed */}
        {CARDS.map((c) => <CompactCard key={c.ticker} {...c} />)}
      </div>
    </div>
  );
}
