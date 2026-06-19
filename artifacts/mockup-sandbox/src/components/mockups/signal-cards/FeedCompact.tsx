import "./_group.css";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, Shield, Target, Zap, Clock, ChevronDown, Sparkles,
  Radio, Search, Filter, HelpCircle, Waves, XCircle,
} from "lucide-react";

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
  const flowBg = bull ? "bg-primary/15 text-primary" : "bg-rose-500/15 text-rose-400";
  const headColor = bull ? "text-emerald-400" : "text-rose-400";
  const supColor = bull ? "text-emerald-400" : "text-rose-400";
  const statusChip = d.status === "Active"
    ? "bg-cyan-400/15 text-cyan-300"
    : "bg-yellow-400/15 text-yellow-400";
  const accent = bull
    ? "bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
    : "bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.5)]";

  return (
    <div className="group relative rounded-2xl bg-gradient-to-b from-white/[0.04] to-white/[0.01] px-4 py-3.5 transition-colors hover:from-white/[0.06]">
      <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full ${accent}`} />

      {/* Top row */}
      <div className="pl-2.5">
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

        {/* Inline stats (no boxes) */}
        <div className="mt-2 flex items-center gap-2.5 text-[11px]">
          <span className="flex items-center gap-1">
            <Shield className={`h-3 w-3 ${supColor}`} />
            <span className="text-muted-foreground">{d.supportLabel}</span>
            <span className={`font-semibold ${supColor}`}>{d.support}</span>
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3 text-accent" />
            <span className="text-muted-foreground">Outlook</span>
            <span className="font-semibold text-accent">{d.outlook}</span>
          </span>
        </div>

        {/* Star-only toggle */}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Biddie's take"
          className={`mt-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
            open ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary hover:bg-white/5"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>

        {/* Quote-style Biddie panel (no box) */}
        {open && (
          <div className="mt-1.5 pl-3 border-l-2 border-primary/30">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20">
                <Sparkles className="h-2.5 w-2.5 text-primary" />
              </span>
              <span className="text-[11px] font-bold text-primary">Biddie</span>
              <span className="text-[10px] text-muted-foreground">· in plain English</span>
            </div>
            <p className="text-[12px] text-foreground/75 leading-relaxed">{d.about}</p>
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
    about: "STX is catching some real attention. A large trader stepped in and picked up a sizable batch of the $1080 calls expiring June 20 — in plain terms, a bet that the stock keeps climbing. What's encouraging is that STX keeps holding around $1068, a level that's been acting like a floor, so there's steady demand defending it. As long as that holds, the next area worth watching is up near $1090. It's still early, so this is more of a story just beginning to take shape.",
  },
  {
    ticker: "NVDA", direction: "bull", confidence: 81, age: "12m", headline: "Bullish Flow", contract: "Jun 27 $145 Calls",
    supportLabel: "Support", support: "$138", outlook: "$150", status: "Active",
    about: "This one's looking strong. A lot of money moved into NVDA's $145 calls (June 27), and most of it paid full price to get in — usually a sign of real confidence. The stock is trading above its average price for the day and holding comfortably above $138, so the bulls are clearly in control for now. That's what's pushing the confidence score up to 81. Keep in mind, though: a high score means the odds look favorable, not that it's guaranteed.",
  },
  {
    ticker: "SPY", direction: "bear", confidence: 58, age: "44m", headline: "Bearish Flow", contract: "Jun 20 $580 Puts",
    supportLabel: "Resist.", support: "$592", outlook: "$575", status: "Developing",
    about: "SPY is leaning the other way here. A trader has been building a position in the $580 puts (June 20), which is a bet the market drifts lower. It's worth noting because it's happening just as SPY runs into a kind of ceiling near $592 that it hasn't been able to push through. For now the stock is still above its average price for the day, so the bears haven't taken full control yet — if it starts to slip, $575 is the level to keep an eye on.",
  },
  {
    ticker: "AMD", direction: "bull", confidence: 73, age: "9m", headline: "Bullish Flow", contract: "Jun 27 $175 Calls",
    supportLabel: "Support", support: "$168", outlook: "$182", status: "Active",
    about: "AMD has been quietly building interest. The $175 calls (June 27) keep getting picked up again and again — not a single trade, but a steady stream, which suggests the interest is genuine. Each time the stock dips, it keeps bouncing off $168, so that level is holding up well. As long as it does, $182 is the next area drawing attention.",
  },
  {
    ticker: "AAPL", direction: "bull", confidence: 49, age: "1h", headline: "Bullish Flow", contract: "Jul 3 $210 Calls",
    supportLabel: "Support", support: "$205", outlook: "$214", status: "Developing",
    about: "AAPL is more of a wait-and-see right now. There's some activity in the $210 calls (July 3), but it's light and scattered, so nothing stands out strongly yet — which is why the score sits at just 49. The stock is leaning on $205 as support, and if it firms up there and draws more interest, $214 comes into view. For now, it's simply one to keep an eye on.",
  },
];

function Tab({ icon, label, count, color, active }: { icon: React.ReactNode; label: string; count: number; color: string; active?: boolean }) {
  const activeCls =
    color === "emerald" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
    : color === "blue" ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
    : "bg-violet-500/20 text-violet-400 border border-violet-500/40";
  const pillCls =
    color === "emerald" ? "bg-emerald-500/30" : color === "blue" ? "bg-blue-500/30" : "bg-violet-500/30";
  return (
    <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
      active ? activeCls : "bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50"
    }`}>
      {icon}
      {label}
      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? pillCls : "bg-muted/50"}`}>{count}</span>
    </button>
  );
}

export function FeedCompact() {
  return (
    <div className="min-h-screen bg-background p-5 font-sans antialiased flex justify-center">
      <div className="w-full max-w-[480px] space-y-3">
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
          <div className="relative px-5 py-6 flex items-center gap-2.5">
            <div className="w-1.5 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-500" />
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
                  Decision Engine
                </h1>
                <span className="flex items-center gap-1.5 text-[9px] font-semibold px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <Radio className="h-2.5 w-2.5 animate-pulse" /> Real-Time
                </span>
              </div>
              <p className="text-[9px] uppercase tracking-[0.3em] text-emerald-400/80 font-semibold mt-1">
                Filtered · Scored · Actionable
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <Tab icon={<Zap className="h-3.5 w-3.5" />} label="Algorithm Plays" count={3} color="emerald" active />
          <Tab icon={<Waves className="h-3.5 w-3.5" />} label="Whale Activity" count={2} color="blue" />
          <Tab icon={<Target className="h-3.5 w-3.5" />} label="Spreads & Butterflies" count={0} color="violet" />
          <span className="ml-auto text-[11px] text-muted-foreground font-semibold">
            Total: <span className="text-foreground">300</span>
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <div className="flex items-center h-10 pl-9 pr-3 rounded-lg bg-muted/30 border border-border/40 text-[13px] font-semibold tracking-wider text-muted-foreground/50">
            Search ticker (SPY, TSLA, QQQ...)
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary/20 text-primary">All</span>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-muted-foreground">Calls</span>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-muted-foreground">Puts</span>
          <span className="w-px h-4 bg-border/40 mx-1" />
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-muted-foreground">Show Resolved (295)</span>
        </div>

        {/* Signal Terms Guide */}
        <div className="rounded-xl border border-white/5 bg-white/[0.02]">
          <div className="w-full flex items-center justify-between px-4 py-2.5 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4" /> Signal Terms Guide</span>
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>

        {/* Group header */}
        <div className="flex items-center justify-between pt-1 pb-0.5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-emerald-400" />
            <span className="text-[13px] font-bold tracking-wide text-emerald-400">⚡ 1–3 DAY TRADE</span>
          </div>
          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/15 rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center">3</span>
        </div>

        {/* Compact feed */}
        <div className="space-y-2">
          {CARDS.map((c) => <CompactCard key={c.ticker} {...c} />)}
        </div>
      </div>
    </div>
  );
}
