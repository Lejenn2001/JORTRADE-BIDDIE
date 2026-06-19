import "./_group.css";
import { useState } from "react";
import { TrendingUp, TrendingDown, Shield, Target, Zap, Clock, ChevronDown, Sparkles } from "lucide-react";

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
  status: "Active" | "Developing";
  about: string;
  defaultOpen?: boolean;
};

function CompactCard(d: CardData) {
  const [open, setOpen] = useState(!!d.defaultOpen);
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

        {/* About toggle */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-2.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Sparkles className="h-3 w-3 text-primary" />
          Biddie's take
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>

        {/* About panel */}
        {open && (
          <div className="mt-2 rounded-lg bg-primary/[0.06] border border-primary/15 px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                <Sparkles className="h-3 w-3 text-primary" />
              </span>
              <span className="text-[11px] font-bold text-primary">Biddie</span>
              <span className="text-[10px] text-muted-foreground">· in plain English</span>
            </div>
            <p className="text-[12px] text-foreground/80 leading-relaxed">{d.about}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const CARDS: CardData[] = [
  {
    ticker: "STX", direction: "bull", confidence: 66, age: "28m", headline: "Bullish Flow", contract: "Jun 20 $1080 Calls",
    supportLabel: "Support", support: "$1068", outlook: "$1090", status: "Active", defaultOpen: true,
    about: "Okay, here's the deal with STX. A big trader came in and scooped up a chunk of the $1080 calls that run through June 20 — basically a bet that the stock keeps climbing. The encouraging part is STX is holding steady around $1068, which acts like a floor, so there's real demand showing up to defend it. If that holds, the next spot people are eyeing is up near $1090. It's still early, so think of it as a story that's just starting to unfold.",
  },
  {
    ticker: "NVDA", direction: "bull", confidence: 81, age: "12m", headline: "Bullish Flow", contract: "Jun 27 $145 Calls",
    supportLabel: "Support", support: "$138", outlook: "$150", status: "Active",
    about: "This one's looking strong. A lot of money rushed into NVDA's $145 calls (June 27), and almost everyone paid full price to jump in — which usually means folks are confident and don't want to miss out. The stock's trading above its average price for the day and holding nicely above $138, so the bulls are clearly in charge right now. That's why the confidence score is sitting up at 81. Just keep in mind: a high score means the odds look good, never that it's a sure thing.",
  },
  {
    ticker: "SPY", direction: "bear", confidence: 58, age: "44m", headline: "Bearish Flow", contract: "Jun 20 $580 Puts",
    supportLabel: "Resist.", support: "$592", outlook: "$575", status: "Developing",
    about: "Heads up — this one leans the other way. Someone's been piling into SPY puts (the $580s for June 20), which is a bet the market drifts lower. And it's happening right as SPY bumps into a kind of ceiling near $592 that it can't quite push through. That said, it's still hanging above its average price for the day, so the bears haven't fully taken over yet — if things start slipping, $575 is the level to keep an eye on.",
  },
  {
    ticker: "AMD", direction: "bull", confidence: 73, age: "9m", headline: "Bullish Flow", contract: "Jun 27 $175 Calls",
    supportLabel: "Support", support: "$168", outlook: "$182", status: "Active",
    about: "AMD's been quietly interesting. The same $175 calls (June 27) keep getting hit again and again — not just one trade but a steady stream, which tells you the interest is real. And every time the stock dips, it keeps bouncing off $168, so that floor is holding up well. As long as that's the case, $182 is the area people are watching next.",
  },
  {
    ticker: "AAPL", direction: "bull", confidence: 49, age: "1h", headline: "Bullish Flow", contract: "Jul 3 $210 Calls",
    supportLabel: "Support", support: "$205", outlook: "$214", status: "Developing",
    about: "AAPL's a bit of a maybe right now. There's some action in the $210 calls (July 3), but it's pretty light and scattered, so nothing's really jumping off the page yet — that's why the score is only 49. It's leaning on $205 as a support level, and if it can firm up there and pull in more interest, $214 starts to come into play. For now, it's just one to keep on the radar.",
  },
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
