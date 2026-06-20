import "./_group.css";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, Clock, ChevronDown, Sparkles, Gauge, HelpCircle,
  Bell, CheckCircle2, Zap,
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
  const seg = [
    { d: "M10 50 A40 40 0 0 1 30 15.36", on: m.zone === 0, c: TIER_META.slow.ring },
    { d: "M30 15.36 A40 40 0 0 1 70 15.36", on: m.zone === 1, c: TIER_META.medium.ring },
    { d: "M70 15.36 A40 40 0 0 1 90 50", on: m.zone === 2, c: TIER_META.fast.ring },
  ];
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
        <line x1="50" y1="50" x2={nx} y2={ny} stroke={m.ring} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="4.5" fill={m.ring} />
      </svg>
    </div>
  );
}

// Compact in-card version: mini gauge + label pill. THIS is what sits where the
// conviction ring used to be (bottom-right of the card).
function SpeedTag({ tier }: { tier: Tier }) {
  const m = TIER_META[tier];
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${m.chip}`}>
      <SpeedGauge tier={tier} size={32} />
      <div className="leading-tight">
        <div className="text-[9px] font-bold uppercase tracking-[0.14em] opacity-70">Pace</div>
        <div className="text-[11px] font-bold">{m.label}</div>
      </div>
    </div>
  );
}

// The "?" circle that explains what each pace means (replaces the big header block).
function PaceHelp() {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground"
        aria-label="What does Pace mean?"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {show && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[270px] rounded-xl border border-border bg-popover p-3 shadow-xl">
          <div className="text-[11px] font-bold text-foreground">What Pace means</div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            How soon a play tends to resolve — read from how small a move it needs
            and how much trading time is left in the day.
          </p>
          <div className="mt-2.5 space-y-2">
            {(["fast", "medium", "slow"] as Tier[]).map((t) => {
              const m = TIER_META[t];
              return (
                <div key={t} className="flex items-center gap-2.5">
                  <SpeedGauge tier={t} size={42} />
                  <div className="leading-tight">
                    <div className={`text-[11px] font-bold ${m.color}`}>{m.label}</div>
                    <div className="text-[9.5px] text-muted-foreground">{m.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-amber-400/15 bg-amber-400/[0.06] px-2.5 py-2">
            <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400/80" />
            <p className="text-[10px] leading-snug text-muted-foreground">
              Pace is a tendency, not a promise. Even the quickest-looking setups don't
              always finish the same day — about one in four still takes longer.
            </p>
          </div>
        </div>
      )}
    </span>
  );
}

type PriceSource = "live" | "rest" | "stale";
type StatusKey = "active" | "watching" | "hit";

const STATUS_META: Record<StatusKey, { label: string; color: string; icon: "zap" | "clock" | "check"; pulse?: boolean }> = {
  active:   { label: "ACTIVE",   color: "text-cyan-400 bg-cyan-400/15", icon: "zap", pulse: true },
  watching: { label: "WATCHING", color: "text-yellow-400 bg-yellow-400/15", icon: "clock" },
  hit:      { label: "WIN",      color: "text-emerald-400 bg-emerald-400/15", icon: "check" },
};

function StatusBadge({ status }: { status: StatusKey }) {
  const s = STATUS_META[status];
  const Icon = s.icon === "zap" ? Zap : s.icon === "check" ? CheckCircle2 : Clock;
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 h-5 text-[10px] font-bold px-2 rounded-full ${s.color} ${s.pulse ? "animate-pulse" : ""}`}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

function TradeBadge({ kind }: { kind: "Day" | "Swing" }) {
  return kind === "Day" ? (
    <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider">Day Trade</span>
  ) : (
    <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing Trade</span>
  );
}

type CardData = {
  ticker: string;
  direction: "bull" | "bear";
  putCall: "Call" | "Put";
  tier: Tier;
  price: string;
  priceSource: PriceSource;
  signalTime: string;
  contract: string;     // e.g. "Jun 27 $145 Call"
  premium: string;
  secondary?: "Strong" | "Move Almost Over";
  reviewed?: boolean;
  status: StatusKey;
  trade: "Day" | "Swing";
  reinforcement?: number;   // ordinal, >1 to show
  mfe?: number;             // %
  levels: { label: string; value: string; tone?: "flow" | "bad" }[];
  needs: string;            // transparent input line behind the pace read
  about: string;
  defaultOpen?: boolean;
};

const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function Card(d: CardData) {
  const [open, setOpen] = useState(!!d.defaultOpen);
  const bull = d.direction === "bull";
  const accent = bull
    ? "bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
    : "bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.5)]";
  const flowColor = bull ? "text-emerald-400" : "text-rose-400";
  const dotClass = d.priceSource === "live"
    ? "bg-emerald-400 animate-pulse"
    : d.priceSource === "rest"
      ? "bg-amber-400"
      : "bg-zinc-500";
  const mfeColor = d.mfe == null ? "" :
    d.mfe >= 75 ? "bg-emerald-400/15 text-emerald-400" :
    d.mfe >= 50 ? "bg-blue-400/15 text-blue-400" :
    d.mfe >= 30 ? "bg-orange-400/15 text-orange-400" :
    "bg-muted/20 text-muted-foreground";
  const paragraphs = d.about.split("\n\n");

  return (
    <div className="group relative rounded-2xl border border-[hsl(230_85%_62%/0.16)] bg-gradient-to-b from-[hsl(230_70%_55%/0.09)] via-white/[0.012] to-[hsl(232_40%_20%/0.04)] shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9),inset_0_0_20px_hsl(230_85%_60%/0.05),0_0_24px_-10px_hsl(230_85%_60%/0.38)]">
      <div className="relative px-4 py-3.5">
        <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full ${accent}`} />
        <div className="pl-2.5">
          {/* Header: ticker + direction (left) · alert + live price + time (right) */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {bull
                ? <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
                : <TrendingDown className="h-4 w-4 text-rose-400 shrink-0" />}
              <span className="text-base font-bold tracking-tight text-foreground">{d.ticker}</span>
            </div>
            <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
              <Bell className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span className="flex items-center gap-1 text-[12px] font-semibold text-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} /> {d.price}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {d.signalTime}
              </span>
            </span>
          </div>

          {/* Flow label */}
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${flowColor}`}>
              {d.putCall === "Put" ? "PUT FLOW" : "CALL FLOW"}
            </span>
          </div>

          {/* Secondary pills */}
          {(d.secondary || d.reviewed) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {d.secondary === "Move Almost Over" && (
                <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-orange-500/20 text-orange-400 uppercase tracking-wider">Move Almost Over</span>
              )}
              {d.secondary === "Strong" && (
                <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider animate-pulse">Strong</span>
              )}
              {d.reviewed && (
                <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-emerald-500/30 text-emerald-300 uppercase tracking-wider animate-pulse border border-emerald-400/30">Biddie Reviewed</span>
              )}
            </div>
          )}

          {/* Contract + premium */}
          <div className="mt-1.5">
            <div className="text-[13px] font-semibold text-foreground">{d.contract}</div>
            <div className="text-[12px] text-muted-foreground">{d.premium} Premium</div>
          </div>

          {/* Levels */}
          <div className="my-3 border-t border-white/10" />
          <div className="space-y-1.5 text-[12px]">
            {d.levels.map((lvl, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground shrink-0">{lvl.label}</span>
                <span className={`font-semibold text-right ${lvl.tone === "flow" ? flowColor : lvl.tone === "bad" ? "text-destructive" : "text-foreground"}`}>{lvl.value}</span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="my-3 border-t border-white/10" />

          {/* Biddie toggle (left) · status + trade + reinforcement + MFE + PACE (right) */}
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
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusBadge status={d.status} />
              <TradeBadge kind={d.trade} />
              {(d.reinforcement ?? 0) > 1 && (
                <span className="inline-flex shrink-0 items-center gap-1 h-5 rounded-full bg-emerald-400/15 px-2 text-[10px] font-bold text-emerald-300">
                  <TrendingUp className="h-3 w-3" /> {ORDINAL(d.reinforcement!)} reinforcement
                </span>
              )}
              {d.mfe != null && (
                <span className={`inline-flex items-center gap-1 h-5 text-[10px] font-bold px-2 rounded-full ${mfeColor}`}>
                  MFE {d.mfe}%
                </span>
              )}
            </div>
          </div>

          {open && (
            <div className="mt-3 space-y-3">
              {/* Pace now lives inside Biddie's take */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Pace</span>
                    <PaceHelp />
                  </div>
                  <SpeedTag tier={d.tier} />
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground/80">{d.needs}</div>
              </div>
              {paragraphs.map((p, i) => (
                <p key={i} className="text-[12px] text-foreground/75 leading-relaxed">{p}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CARDS: CardData[] = [
  {
    ticker: "NVDA", direction: "bull", putCall: "Call", tier: "fast",
    price: "$143.20", priceSource: "live", signalTime: "9:42 AM",
    contract: "Jun 20 $145 Call", premium: "$3.2M",
    status: "active", trade: "Day", reinforcement: 6, mfe: 48,
    levels: [
      { label: "Area of Interest", value: "$142.50" },
      { label: "Range", value: "$145 – $150", tone: "flow" },
      { label: "Key Level", value: "$147" },
      { label: "Support", value: "$138", tone: "bad" },
    ],
    needs: "Pace reads from: ~0.4% to reach $145 · fired near the open",
    defaultOpen: true,
    about: "NVDA only has to travel a short distance to $145, and the flow showed up early while there's a full day of trading ahead. Setups that need a small move first thing tend to resolve quickly — most of the day is still in front of them.\n\nThat's what the pace is reading here. It's a tendency drawn from how these have behaved before, never a promise.",
  },
  {
    ticker: "AMD", direction: "bull", putCall: "Call", tier: "medium",
    price: "$176.10", priceSource: "rest", signalTime: "12:18 PM",
    contract: "Jun 27 $182 Call", premium: "$1.1M",
    status: "watching", trade: "Swing", reinforcement: 3,
    levels: [
      { label: "Area of Interest", value: "$176.00" },
      { label: "Range", value: "$182 – $188", tone: "flow" },
      { label: "Key Level", value: "$180" },
      { label: "Support", value: "$168", tone: "bad" },
    ],
    needs: "Pace reads from: ~3.3% to reach $182 · fired mid-session",
    about: "AMD has a bit more ground to cover to $182, and it showed up around midday with less of the session left. Moves like this often need an extra day to play out rather than finishing the same afternoon.\n\nThe pace simply reflects the distance and the timing — it isn't telling you what to do, just how these have tended to unfold.",
  },
  {
    ticker: "SPY", direction: "bear", putCall: "Put", tier: "slow",
    price: "$583.90", priceSource: "stale", signalTime: "3:31 PM",
    contract: "Jun 27 $575 Put", premium: "$2.1M",
    status: "watching", trade: "Swing", mfe: 22,
    levels: [
      { label: "Area of Interest", value: "$584.00" },
      { label: "Range", value: "$575 – $568", tone: "flow" },
      { label: "Key Level", value: "$578" },
      { label: "Resistance", value: "$592", tone: "bad" },
    ],
    needs: "Pace reads from: ~1.5% to reach $575 · fired late in the day",
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
              <p className="text-[11px] text-muted-foreground">Now lives inside Biddie's take</p>
            </div>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-foreground/75">
            The round confidence score is gone. Instead, each play's
            <span className="font-semibold text-foreground"> Pace</span> is tucked inside
            <span className="font-semibold text-foreground"> Biddie's take</span> — tap the Biddie
            row on any card below to open it. The
            <span className="inline-flex h-3.5 w-3.5 align-text-bottom items-center justify-center mx-0.5 text-muted-foreground"><HelpCircle className="h-3.5 w-3.5" /></span>
            next to Pace explains what each pace means.
          </p>
        </div>

        {/* live examples in the real card */}
        <div className="flex items-center gap-2 px-1 pt-1">
          <span className="text-[12px] font-bold uppercase tracking-[0.18em] text-emerald-400">On the real card</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <div className="space-y-3">
          {CARDS.map((c) => <Card key={c.ticker} {...c} />)}
        </div>
      </div>
    </div>
  );
}
