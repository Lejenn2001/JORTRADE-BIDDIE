import "./_group.css";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, Target, Zap, Clock, ChevronDown, Sparkles,
  Radio, Search, Filter, HelpCircle, Waves, Activity,
} from "lucide-react";

function MiniRing({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <div className="relative h-9 w-9 shrink-0" title={`Confidence ${value} / 100`}>
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
  putCall: "Call" | "Put";
  confidence: number;        // convictionScore
  strength: string;          // convictionLabel, reworded
  age: string;
  expiry: string;            // expiry
  strike: string;            // strike
  premium: string;           // premium (total $ on the line)
  flowType: string;          // sweep / repeated hits / block / flow
  keyLevel: string;          // entryTrigger / keyLevel  -> "Key Level"
  outlook: string;           // targetZone -> "Outlook"
  guardLabel: "Support" | "Resistance"; // invalidation / srLevel
  guard: string;
  vwap: string;              // VWAP reference from description
  psych: string;             // psychological / round-number level
  volume: string;            // volume
  openInterest: string;      // open interest
  status: "Active" | "Developing";
  about: string;
  defaultOpen?: boolean;
};

function CompactCard(d: CardData) {
  const [open, setOpen] = useState(!!d.defaultOpen);
  const bull = d.direction === "bull";
  const flowBg = bull ? "bg-primary/15 text-primary" : "bg-rose-500/15 text-rose-400";
  const statusChip = d.status === "Active"
    ? "bg-cyan-400/15 text-cyan-300"
    : "bg-yellow-400/15 text-yellow-400";
  const accent = bull
    ? "bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
    : "bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.5)]";

  return (
    <div className="group relative rounded-2xl bg-gradient-to-b from-white/[0.04] to-white/[0.01] px-4 py-3.5 transition-colors hover:from-white/[0.06]">
      <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full ${accent}`} />

      <div className="pl-2.5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {bull
              ? <TrendingUp className="h-4 w-4 text-primary shrink-0" />
              : <TrendingDown className="h-4 w-4 text-rose-400 shrink-0" />}
            <span className="text-base font-bold tracking-tight text-foreground">{d.ticker}</span>
            <span className={`inline-flex items-center h-5 rounded-full px-2 text-[9px] font-bold tracking-[0.1em] uppercase ${flowBg}`}>
              {d.putCall}
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

        {/* Contract + flow focus + premium */}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[12px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Activity className="h-3 w-3" /> {d.flowType}
          </span>
          <span className="text-foreground/80 font-medium">{d.expiry} · ${d.strike} {d.putCall}</span>
        </div>

        {/* Short level pill: RANGE TO $X (details live in the message) */}
        <div className="mt-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1">
            {d.direction === "bull" ? (
              <TrendingUp className="h-3 w-3 text-emerald-400" />
            ) : (
              <TrendingDown className="h-3 w-3 text-rose-400" />
            )}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Range to</span>
            <span className={`text-[12px] font-bold ${d.direction === "bull" ? "text-emerald-400" : "text-rose-400"}`}>
              {d.outlook}
            </span>
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

        {/* Quote-style Biddie panel */}
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
    ticker: "STX", direction: "bull", putCall: "Call", confidence: 66, strength: "Building", age: "28m",
    expiry: "Jun 20", strike: "1080", premium: "$1.4M", flowType: "Repeated Hits",
    keyLevel: "$1072", outlook: "$1090", guardLabel: "Support", guard: "$1064",
    vwap: "Above today's avg $1066", psych: "$1080 round number", volume: "2,310", openInterest: "1,450",
    status: "Active", defaultOpen: true,
    about: "About $1.4M hit these $1080 calls, and the same strike got bought 40+ times on the ask side — meaning big buyers kept paying full price to get in, the kind of steady demand that often points to institutions. STX is holding above its average price for the day and pressing toward $1080. As long as it keeps holding, the next spot to watch is up near $1090.",
  },
  {
    ticker: "NVDA", direction: "bull", putCall: "Call", confidence: 81, strength: "Strong", age: "12m",
    expiry: "Jun 27", strike: "145", premium: "$3.2M", flowType: "Sweep",
    keyLevel: "$138", outlook: "$150", guardLabel: "Support", guard: "$138",
    vwap: "Above today's avg $142", psych: "$145 round number", volume: "18.5K", openInterest: "9.2K",
    status: "Active",
    about: "A single $3.2M sweep tore through the $145 calls — one fast, aggressive order that paid full price, usually a sign someone with deep pockets wanted in right away. NVDA is trading above its average price for the day and pushing on $145, where a lot of contracts already sit. The next spot people are watching is around $150. Confidence is high at 81 — strong, though never a sure thing.",
  },
  {
    ticker: "SPY", direction: "bear", putCall: "Put", confidence: 58, strength: "Developing", age: "44m",
    expiry: "Jun 20", strike: "580", premium: "$2.1M", flowType: "Flow",
    keyLevel: "$585", outlook: "$575", guardLabel: "Resistance", guard: "$592",
    vwap: "Above today's avg $586", psych: "$590 round number", volume: "12.0K", openInterest: "30.4K",
    status: "Developing",
    about: "About $2.1M went into the $580 puts — a sizable bet the market dips a little. It's piling up right as SPY keeps stalling near $590, a ceiling it can't push past. It hasn't actually dropped yet (still above its average price for the day), but if it slips, the next spot to watch is down near $575.",
  },
  {
    ticker: "AMD", direction: "bull", putCall: "Call", confidence: 73, strength: "Steady", age: "9m",
    expiry: "Jun 27", strike: "175", premium: "$1.1M", flowType: "Repeated Hits",
    keyLevel: "$168", outlook: "$182", guardLabel: "Support", guard: "$168",
    vwap: "Above today's avg $171", psych: "$175 round number", volume: "8.4K", openInterest: "5.1K",
    status: "Active",
    about: "About $1.1M came into the $175 calls, with the same strike getting hit again and again on the ask side — steady, repeated buying at full price, often a sign of bigger money stepping in. Every time AMD dips it bounces off $168, and it's holding above its average price for the day. That points higher, toward $182.",
  },
  {
    ticker: "AAPL", direction: "bull", putCall: "Call", confidence: 49, strength: "Early", age: "1h",
    expiry: "Jul 3", strike: "210", premium: "$420K", flowType: "Light Flow",
    keyLevel: "$205", outlook: "$214", guardLabel: "Support", guard: "$205",
    vwap: "Near today's avg $208", psych: "$210 round number", volume: "1.2K", openInterest: "3.4K",
    status: "Developing",
    about: "Only about $420K has trickled into the $210 calls so far — light and scattered, so nothing strong yet, which is why confidence sits at just 49. AAPL is holding around $205, near its average price for the day. If more buyers step in and it holds above $205, the next spot to watch is near $214.",
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
            <span className="text-[13px] font-bold tracking-wide text-emerald-400">⚡ 1–3 DAY FLOW</span>
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
