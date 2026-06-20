import "./_group.css";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, Clock, ChevronDown, Sparkles, Gauge, HelpCircle,
} from "lucide-react";

type Tier = "fast" | "medium" | "slow";

const TIER_META: Record<Tier, {
  label: string;
  sub: string;
  color: string;       // text color
  ring: string;        // active arc stroke
  glow: string;        // box glow
  chip: string;        // pill bg + text
  zone: 0 | 1 | 2;     // which arc zone lights up (0=left/slow .. 2=right/fast)
}> = {
  fast:   { label: "Often same-day", sub: "Small move · early in the day", color: "text-emerald-400", ring: "#34d399", glow: "rgba(52,211,153,0.5)", chip: "bg-emerald-400/15 text-emerald-300", zone: 2 },
  medium: { label: "Usually a day or two", sub: "Moderate move or mid-session", color: "text-amber-400", ring: "#fbbf24", glow: "rgba(251,191,36,0.45)", chip: "bg-amber-400/15 text-amber-300", zone: 1 },
  slow:   { label: "Tends to take longer", sub: "Bigger move or late in the day", color: "text-slate-300", ring: "#94a3b8", glow: "rgba(148,163,184,0.4)", chip: "bg-slate-400/15 text-slate-300", zone: 0 },
};

// Semicircular "speedometer" gauge. Needle points into the lit zone.
function SpeedGauge({ tier, size = 64 }: { tier: Tier; size?: number }) {
  const m = TIER_META[tier];
  // three arc segments left→right: slow, medium, fast
  const seg = [
    { d: "M10 50 A40 40 0 0 1 30 15.36", on: m.zone === 0, c: TIER_META.slow.ring },
    { d: "M30 15.36 A40 40 0 0 1 70 15.36", on: m.zone === 1, c: TIER_META.medium.ring },
    { d: "M70 15.36 A40 40 0 0 1 90 50", on: m.zone === 2, c: TIER_META.fast.ring },
  ];
  // needle angle: slow=150°, med=90°, fast=30°
  const ang = m.zone === 0 ? 150 : m.zone === 1 ? 90 : 30;
  const rad = (ang * Math.PI) / 180;
  const nx = 50 + 33 * Math.cos(rad);
  const ny = 50 - 33 * Math.sin(rad);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size * 0.62 }} title={`Pace: ${m.label}`}>
      <svg viewBox="0 0 100 58" className="h-full w-full overflow-visible">
        {seg.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={s.on ? s.c : "hsl(232 25% 18%)"}
            strokeWidth={s.on ? 8 : 6}
            strokeLinecap="round"
            style={s.on ? { filter: `drop-shadow(0 0 5px ${m.glow})` } : undefined}
          />
        ))}
        {/* needle */}
        <line x1="50" y1="50" x2={nx} y2={ny} stroke={m.ring} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="4.5" fill={m.ring} />
      </svg>
    </div>
  );
}

// Compact in-card version: mini gauge + label pill (this is what replaces the conviction ring)
function SpeedTag({ tier }: { tier: Tier }) {
  const m = TIER_META[tier];
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${m.chip}`}>
      <SpeedGauge tier={tier} size={34} />
      <div className="leading-tight">
        <div className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-70">Pace</div>
        <div className="text-[11px] font-bold">{m.label}</div>
      </div>
    </div>
  );
}

type CardData = {
  ticker: string;
  direction: "bull" | "bear";
  putCall: "Call" | "Put";
  tier: Tier;
  price: string;
  signalTime: string;
  expiry: string;
  strike: string;
  premium: string;
  needs: string;        // transparent input line: how small a move + when it fired
  levels: { label: string; value: string; flow?: boolean }[];
  status: "Active" | "Developing";
  about: string;
  defaultOpen?: boolean;
};

function Card(d: CardData) {
  const [open, setOpen] = useState(!!d.defaultOpen);
  const bull = d.direction === "bull";
  const accent = bull
    ? "bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
    : "bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.5)]";
  const flowColor = bull ? "text-emerald-400" : "text-rose-400";
  const paragraphs = d.about.split("\n\n");

  return (
    <div className="group relative rounded-2xl border border-[hsl(230_85%_62%/0.16)] bg-gradient-to-b from-[hsl(230_70%_55%/0.09)] via-white/[0.012] to-[hsl(232_40%_20%/0.04)] px-4 py-3.5 shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9),inset_0_0_20px_hsl(230_85%_60%/0.05)]">
      <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full ${accent}`} />
      <div className="pl-2.5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {bull
              ? <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
              : <TrendingDown className="h-4 w-4 text-rose-400 shrink-0" />}
            <span className="text-base font-bold tracking-tight text-foreground">{d.ticker}</span>
          </div>
          <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1 text-[12px] font-semibold text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> {d.price}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {d.signalTime}
            </span>
          </span>
        </div>

        {/* Flow label */}
        <div className={`mt-2 text-[10px] font-bold uppercase tracking-[0.18em] ${flowColor}`}>
          {d.putCall} Flow
        </div>

        {/* Contract */}
        <div className="mt-1.5">
          <div className="text-[13px] font-semibold text-foreground">{d.expiry} ${d.strike} {d.putCall}s</div>
          <div className="text-[12px] text-muted-foreground">{d.premium} Premium</div>
        </div>

        <div className="my-3 border-t border-white/10" />

        {/* Levels */}
        <div className="space-y-1.5 text-[12px]">
          {d.levels.map((lvl, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-muted-foreground">{lvl.label}</span>
              <span className={`font-semibold ${lvl.flow ? flowColor : "text-foreground"}`}>{lvl.value}</span>
            </div>
          ))}
        </div>

        <div className="my-3 border-t border-white/10" />

        {/* THE NEW SPEED ROW (replaces the conviction ring) */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Biddie's take"
            className="flex shrink-0 items-center gap-1.5 text-left"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20">
              <Sparkles className="h-2.5 w-2.5 text-primary" />
            </span>
            <span className="text-[11px] font-bold text-primary">Biddie</span>
            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <SpeedTag tier={d.tier} />
        </div>

        {/* transparent inputs — what the pace is read from */}
        <div className="mt-2 text-[11px] text-muted-foreground/80">{d.needs}</div>

        {open && (
          <div className="mt-2 space-y-2">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-[12px] text-foreground/75 leading-relaxed">{p}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const CARDS: CardData[] = [
  {
    ticker: "NVDA", direction: "bull", putCall: "Call", tier: "fast",
    price: "$143.20", signalTime: "Jun 19 · 9:42 AM",
    expiry: "Jun 20", strike: "145", premium: "$3.2M",
    needs: "Reads from: ~0.4% to reach $145 · fired near the open",
    levels: [
      { label: "Floor", value: "$138" },
      { label: "Ceiling", value: "$150", flow: true },
    ],
    status: "Active", defaultOpen: true,
    about: "NVDA only has to travel a short distance to $145, and the flow showed up early while there's a full day of trading ahead. Setups that need a small move first thing tend to resolve quickly — most of the day is still in front of them.\n\nThat's what the pace is reading here. It's a tendency drawn from how these have behaved before, never a promise.",
  },
  {
    ticker: "AMD", direction: "bull", putCall: "Call", tier: "medium",
    price: "$176.10", signalTime: "Jun 19 · 12:18 PM",
    expiry: "Jun 27", strike: "182", premium: "$1.1M",
    needs: "Reads from: ~3.3% to reach $182 · fired mid-session",
    levels: [
      { label: "Floor", value: "$168" },
      { label: "Ceiling", value: "$182", flow: true },
    ],
    status: "Active",
    about: "AMD has a bit more ground to cover to $182, and it showed up around midday with less of the session left. Moves like this often need an extra day to play out rather than finishing the same afternoon.\n\nThe pace simply reflects the distance and the timing — it isn't telling you what to do, just how these have tended to unfold.",
  },
  {
    ticker: "SPY", direction: "bear", putCall: "Put", tier: "slow",
    price: "$583.90", signalTime: "Jun 19 · 3:31 PM",
    expiry: "Jun 27", strike: "575", premium: "$2.1M",
    needs: "Reads from: ~1.5% to reach $575 · fired late in the day",
    levels: [
      { label: "Ceiling", value: "$592" },
      { label: "Floor", value: "$575", flow: true },
    ],
    status: "Developing",
    about: "SPY would need to drift down to $575, and this one showed up late with barely any trading time left today. Setups that arrive near the close rarely finish the same day — there simply isn't much session remaining.\n\nThat's all the pace is pointing out. It's an observation about timing and distance, nothing more.",
  },
];

export function SpeedIndicator() {
  return (
    <div className="min-h-screen bg-background p-5 font-sans antialiased flex justify-center">
      <div className="w-full max-w-[480px] space-y-4">
        {/* Header / concept explainer */}
        <div className="rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,8%)] px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15">
              <Gauge className="h-5 w-5 text-emerald-400" />
            </span>
            <div>
              <h1 className="text-lg font-black tracking-tight text-foreground">Pace</h1>
              <p className="text-[11px] text-muted-foreground">Replaces the old confidence number</p>
            </div>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-foreground/75">
            Instead of a score that didn't actually predict anything, each play now shows
            roughly <span className="font-semibold text-foreground">how soon it tends to resolve</span>.
            It's read from two honest things we know the moment a play appears:
            how small a move it needs, and how much trading time is left in the day.
          </p>

          {/* three tiers */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["fast", "medium", "slow"] as Tier[]).map((t) => {
              const m = TIER_META[t];
              return (
                <div key={t} className="flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-3 text-center">
                  <SpeedGauge tier={t} size={58} />
                  <div className={`mt-1.5 text-[11px] font-bold ${m.color}`}>{m.label}</div>
                  <div className="mt-0.5 text-[9.5px] leading-tight text-muted-foreground">{m.sub}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-3 py-2.5">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Pace is a tendency, not a promise. Even the quickest-looking setups don't always
              finish the same day — roughly one in four still takes longer.
            </p>
          </div>
        </div>

        {/* live examples in the real card */}
        <div className="flex items-center gap-2 px-1 pt-1">
          <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-emerald-400">On the card</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="space-y-3">
          {CARDS.map((c) => <Card key={c.ticker} {...c} />)}
        </div>
      </div>
    </div>
  );
}
