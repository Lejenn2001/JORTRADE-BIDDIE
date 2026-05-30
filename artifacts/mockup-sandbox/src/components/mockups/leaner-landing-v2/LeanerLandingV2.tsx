import { useState } from "react";
import {
  LayoutDashboard,
  ListFilter,
  MessageSquare,
  Bot,
  Zap,
  Waves,
  Target,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Send,
  ArrowRight,
  Plus,
  Minus,
} from "lucide-react";
import "./_group.css";

const LOGO = "/__mockup/images/jortrade-logo.png";
const ROBOT = "/__mockup/images/biddie-robot.png";
const LEANING = "/__mockup/images/biddie-leaning.png";

/* ---------- Conviction ring ---------- */
function Ring({ score }: { score: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  const color = score >= 85 ? "#34d399" : score >= 70 ? "#60a5fa" : "#fbbf24";
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className="shrink-0">
      <circle cx="23" cy="23" r={r} fill="none" stroke="hsl(232 25% 14%)" strokeWidth="4" />
      <circle
        cx="23"
        cy="23"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform="rotate(-90 23 23)"
      />
      <text x="23" y="27" textAnchor="middle" fontSize="12" fontWeight="700" fill="hsl(220 30% 95%)">
        {score}
      </text>
    </svg>
  );
}

/* ---------- Nav ---------- */
function Nav() {
  return (
    <nav className="sticky top-0 z-30 flex items-center justify-between px-6 md:px-10 py-4 glass-panel border-b border-[hsl(232_25%_14%)]/40">
      <img src={LOGO} alt="JORTRADE" className="h-8 md:h-9 w-auto" />
      <div className="hidden md:flex items-center gap-8 text-sm text-[hsl(225_15%_50%)]">
        <a href="#features" className="hover:text-[hsl(220_30%_95%)] transition-colors">What you get</a>
        <a href="#how" className="hover:text-[hsl(220_30%_95%)] transition-colors">How it works</a>
        <a href="#faq" className="hover:text-[hsl(220_30%_95%)] transition-colors">FAQ</a>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-full px-4 py-2 text-xs font-semibold text-[hsl(225_15%_50%)] hover:text-[hsl(220_30%_95%)] transition-colors">
          Log In
        </button>
        <button className="rounded-full px-5 py-2 text-xs font-semibold bg-[hsl(220_30%_95%)] text-[hsl(230_25%_5%)] hover:opacity-90 transition-opacity">
          Start Free
        </button>
      </div>
    </nav>
  );
}

/* ---------- Hero (Biddie off to the side, not front & center) ---------- */
function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-16 pb-20 md:pt-20 md:pb-24">
      <div className="absolute top-1/2 right-[12%] -translate-y-1/2 w-[620px] h-[620px] pointer-events-none">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,hsl(270_75%_40%_/_0.35)_0%,transparent_60%)]" />
        <div className="absolute inset-[60px] rounded-full bg-[radial-gradient(circle,hsl(30_80%_40%_/_0.25)_0%,transparent_55%)]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto grid lg:grid-cols-[1.25fr_0.75fr] gap-10 items-center">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-[hsl(230_85%_60%)] bg-[hsl(230_85%_60%)]/10 border border-[hsl(230_85%_60%)]/20 rounded-full px-3 py-1.5 mb-6">
            👋 Meet Biddie, your AI trading assistant
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight text-[hsl(220_30%_95%)]">
            Trade With Confidence
            <br />
            Using Your AI Assistant
          </h1>
          <p className="text-[hsl(225_15%_50%)] mt-5 max-w-xl mx-auto lg:mx-0 text-base md:text-lg leading-relaxed">
            JORTRADE spots opportunities, reads market conditions, and helps you make more
            structured trading decisions — with Biddie guiding every call.
          </p>
          <div className="flex flex-wrap gap-4 justify-center lg:justify-start mt-8 items-center">
            <button className="rounded-full px-8 py-3.5 text-base font-semibold bg-[hsl(220_30%_95%)] text-[hsl(230_25%_5%)] hover:opacity-90 transition-opacity">
              Start Free
            </button>
            <a href="#how" className="inline-flex items-center gap-2 text-sm font-semibold text-[hsl(220_30%_95%)] hover:gap-3 transition-all">
              See how it works <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Biddie: smaller, offset to the side rather than dominating the hero */}
        <div className="flex justify-center lg:justify-end">
          <img
            src={ROBOT}
            alt="Biddie - AI Trading Assistant"
            className="w-36 h-36 md:w-44 md:h-44 drop-shadow-[0_0_24px_hsl(230_85%_60%_/_0.35)]"
          />
        </div>
      </div>
    </section>
  );
}

/* ---------- Dashboard preview (Decision Engine) ---------- */
const signalCards = [
  {
    category: "Top Signal",
    icon: Zap,
    color: "text-emerald-400",
    headerBg: "bg-emerald-500/15",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    ticker: "SPY",
    direction: "call" as const,
    score: 88,
    note: "Algorithm-confirmed bullish setup near a key level.",
    tags: [
      { label: "Swing", cls: "bg-blue-500/20 text-blue-400" },
      { label: "Biddie Pick", cls: "bg-emerald-500/30 text-emerald-300" },
    ],
  },
  {
    category: "Whale Play",
    icon: Waves,
    color: "text-blue-400",
    headerBg: "bg-blue-500/15",
    border: "border-blue-500/30",
    bg: "bg-blue-500/5",
    ticker: "NVDA",
    direction: "call" as const,
    score: 92,
    note: "Large institutional call flow hitting the tape.",
    tags: [{ label: "Day Trade", cls: "bg-amber-500/20 text-amber-400" }],
  },
  {
    category: "Spread Play",
    icon: Target,
    color: "text-violet-400",
    headerBg: "bg-violet-500/15",
    border: "border-violet-500/30",
    bg: "bg-violet-500/5",
    ticker: "QQQ",
    direction: "put" as const,
    score: 76,
    note: "Multi-leg spread setup forming on weakness.",
    tags: [{ label: "Swing", cls: "bg-blue-500/20 text-blue-400" }],
  },
];

function DecisionEngineBanner() {
  const xs = [40, 95, 150, 205, 260, 315, 370, 425, 480, 535, 590, 645, 700, 755, 810, 865, 920];
  const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45, 70, 55];
  const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85, 50, 75];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232_30%_7%)]">
      <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 1000 200" preserveAspectRatio="none">
        {xs.map((x, i) => {
          const green = i % 3 !== 0;
          return (
            <g key={i}>
              <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#818cf8" : "#a78bfa"} strokeWidth="1" />
              <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#818cf8" : "#a78bfa"} rx="1" />
            </g>
          );
        })}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-r from-blue-900/15 via-purple-900/8 to-cyan-900/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232_30%_7%)] via-[hsl(232_30%_7%)]/30 to-transparent" />
      <div className="relative px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-10 rounded-full bg-gradient-to-b from-[hsl(230_85%_60%)] via-[hsl(270_75%_60%)] to-[hsl(200_90%_55%)]" />
          <div>
            <h3 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent">
              Decision Engine
            </h3>
            <p className="text-[10px] uppercase tracking-[0.3em] text-[hsl(230_85%_60%)]/80 font-semibold mt-0.5">
              Flow · Insight · Execution
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalCard({ card }: { card: (typeof signalCards)[number] }) {
  const Icon = card.icon;
  const isCall = card.direction === "call";
  return (
    <div className={`rounded-xl border ${card.border} ${card.bg} overflow-hidden`}>
      <div className={`px-4 py-2 flex items-center justify-between ${card.headerBg}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`h-3 w-3 ${card.color}`} />
          <span className={`text-[11px] font-bold tracking-widest uppercase ${card.color}`}>{card.category}</span>
          {card.tags.map((t) => (
            <span key={t.label} className={`inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full uppercase tracking-wider ${t.cls}`}>
              {t.label}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-[hsl(225_15%_50%)] flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      </div>
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isCall ? <TrendingUp className="h-5 w-5 text-[hsl(230_85%_60%)]" /> : <TrendingDown className="h-5 w-5 text-[hsl(0_72%_51%)]" />}
            <span className="font-bold text-[hsl(220_30%_95%)] text-lg tracking-tight">{card.ticker}</span>
            <span className={`inline-flex items-center h-5 text-[10px] font-bold uppercase px-2 rounded-full ${isCall ? "bg-[hsl(230_85%_60%)]/20 text-[hsl(230_85%_60%)]" : "bg-[hsl(0_72%_51%)]/20 text-[hsl(0_72%_51%)]"}`}>
              {isCall ? "Call" : "Put"}
            </span>
          </div>
          <p className="text-xs text-[hsl(225_15%_50%)] leading-relaxed">{card.note}</p>
        </div>
        <Ring score={card.score} />
      </div>
    </div>
  );
}

function DashboardSection() {
  return (
    <section className="relative py-16 md:py-20 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[820px] h-full bg-[radial-gradient(ellipse_50%_40%_at_50%_30%,hsl(230_70%_40%_/_0.1)_0%,transparent_70%)] blur-2xl pointer-events-none" />
      <div className="container mx-auto px-6 relative z-10 max-w-5xl">
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-[hsl(230_85%_60%)] bg-[hsl(230_85%_60%)]/10 px-4 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(230_85%_60%)] animate-pulse" />
            Everything in one view
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold mt-5 text-[hsl(220_30%_95%)] leading-[1.1]">
            Your dashboard, built for decisions
          </h2>
          <p className="text-[hsl(225_15%_50%)] mt-4 max-w-xl mx-auto text-base leading-relaxed">
            Biddie surfaces the day's highest-conviction plays — scored, sorted, and ready the
            moment you log in.
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-4 md:p-6 border-glow-purple max-w-4xl mx-auto">
          <DecisionEngineBanner />
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            {signalCards.map((card) => (
              <SignalCard key={card.ticker} card={card} />
            ))}
          </div>
          <div className="glass-panel rounded-xl p-3 mt-4 border border-[hsl(232_25%_14%)]/60">
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-[hsl(270_75%_60%)] shrink-0" />
              <span className="text-sm text-[hsl(225_15%_50%)] flex-1">Ask Biddie anything about the market…</span>
              <span className="bg-[hsl(230_85%_60%)]/20 text-[hsl(230_85%_60%)] rounded-lg p-2.5">
                <Send className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Four squares: "Four Ways Biddie Finds Your Edge" (restored) ---------- */
const features = [
  {
    icon: LayoutDashboard,
    title: "Dashboard Panels",
    tagline: "Your daily edge at a glance",
    description:
      "Every session, Biddie scans the live options tape and surfaces the top 5 highest-conviction plays across three categories — algorithm-confirmed entries, institutional whale flow, and multi-leg spread setups. Each signal is scored by AI using real-time key levels, gamma zones, and price action confirmation. Only the best make the cut.",
    highlights: [
      "Top 5 plays per category, refreshed every session",
      "AI confidence scoring with price + gamma confirmation",
      "Entry triggers, targets, and invalidation levels built in",
    ],
    accent: "from-emerald-500/20 to-emerald-500/5",
    iconColor: "text-emerald-400",
    borderColor: "border-emerald-500/20",
  },
  {
    icon: ListFilter,
    title: "Signals Tab",
    tagline: "A wider net, still high-conviction",
    description:
      "The full signal feed with broader parameters so you have more setups to choose from. Same AI scoring, same conviction thresholds — just more flexibility. Filter by category, search by ticker, and scroll through 7 days of signal history so you never miss a move.",
    highlights: [
      "Expanded scan with more tickers and setups",
      "Searchable, filterable signal history",
      "7-day lookback so nothing slips through the cracks",
    ],
    accent: "from-blue-500/20 to-blue-500/5",
    iconColor: "text-blue-400",
    borderColor: "border-blue-500/20",
  },
  {
    icon: MessageSquare,
    title: "Live Signal Chat",
    tagline: "Cream of the crop, delivered in real-time",
    description:
      "Biddie watches the tape all day and only speaks up when something serious hits — massive sweep orders with heavy institutional premium, extreme aggression, and unusual volume at strikes that actually matter. Think of it as your experienced trader friend tapping you on the shoulder.",
    highlights: [
      "Only the highest-conviction flow makes it here",
      "Auto-posted in real-time during market hours",
      "3-5 alerts on a busy day, zero on a quiet one",
    ],
    accent: "from-purple-500/20 to-purple-500/5",
    iconColor: "text-purple-400",
    borderColor: "border-purple-500/20",
  },
  {
    icon: Bot,
    title: "Biddie AI",
    tagline: "Your personal trading analyst, on demand",
    description:
      "Ask Biddie about any ticker, any setup, any strategy — and get a data-backed answer in seconds. He pulls live flow data, key technical levels, dark pool activity, and gamma positioning to give you a specific, actionable breakdown with entries, targets, and risk levels.",
    highlights: [
      "Full access to live institutional flow data",
      "Answers grounded in VWAP, pivots, and gamma zones",
      "Ask anything — premarket outlook, position review, sector analysis",
    ],
    accent: "from-amber-500/20 to-amber-500/5",
    iconColor: "text-amber-400",
    borderColor: "border-amber-500/20",
  },
];

function FourSquares() {
  return (
    <section id="features" className="relative py-16 md:py-20 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-full bg-[radial-gradient(ellipse_50%_40%_at_50%_30%,hsl(230_70%_40%_/_0.1)_0%,transparent_70%)] blur-2xl pointer-events-none" />
      <div className="container mx-auto px-6 relative z-10">
        <div className="text-center mb-12">
          <span className="inline-block text-xs font-semibold text-[hsl(220_30%_95%)] border border-[hsl(225_15%_50%)]/30 rounded-full px-4 py-1.5 mb-6">
            What You Get
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-[hsl(220_30%_95%)] leading-[1.1] max-w-3xl mx-auto">
            Four Ways Biddie
            <br />
            <span className="text-[hsl(230_85%_60%)]">Finds Your Edge</span>
          </h2>
          <p className="text-[hsl(225_15%_50%)] mt-5 max-w-2xl mx-auto text-base leading-relaxed">
            Every feature is powered by live institutional flow data, real-time key levels, and AI
            that actually understands how the market moves.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-5xl mx-auto">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className={`relative rounded-2xl border ${f.borderColor} bg-[hsl(232_30%_8%)]/60 p-7 overflow-hidden hover:border-[hsl(230_85%_60%)]/20 transition-colors`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${f.accent} pointer-events-none`} />
                <div className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-[hsl(232_30%_12%)]/80 flex items-center justify-center">
                      <Icon className={`h-5 w-5 ${f.iconColor}`} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-[hsl(220_30%_95%)]">{f.title}</h3>
                      <p className={`text-xs font-medium ${f.iconColor}`}>{f.tagline}</p>
                    </div>
                  </div>
                  <p className="text-sm text-[hsl(225_15%_50%)] leading-relaxed mb-4">{f.description}</p>
                  <ul className="space-y-2">
                    {f.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2 text-xs text-[hsl(225_15%_50%)]">
                        <span className={`mt-1 w-1 h-1 rounded-full ${f.iconColor} bg-current shrink-0`} />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------- How it works ---------- */
const steps = [
  { num: "1", title: "Market Scan", desc: "Biddie monitors price action, volume shifts, and liquidity to surface what's worth watching." },
  { num: "2", title: "Opportunity Ranking", desc: "Each setup is scored by strength so you spend time on the best ideas — not the noise." },
  { num: "3", title: "Execution Guidance", desc: "Clear entry context, risk levels, and timing cues before you pull the trigger." },
];

function HowItWorks() {
  return (
    <section id="how" className="relative py-16 md:py-20">
      <div className="container mx-auto px-6 max-w-5xl">
        <div className="text-center mb-10">
          <span className="inline-block text-xs font-semibold text-[hsl(220_30%_95%)] border border-[hsl(225_15%_50%)]/30 rounded-full px-4 py-1.5 mb-5">
            How Biddie works for you
          </span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[hsl(220_30%_95%)] leading-[1.1]">
            Three steps between you and smarter trades
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {steps.map((s) => (
            <div key={s.num} className="relative border-t border-[hsl(232_25%_14%)] pt-6">
              <div className="absolute top-0 left-0 w-3 h-px bg-[hsl(225_15%_50%)]/40" />
              <div className="absolute top-0 left-0 w-px h-3 bg-[hsl(225_15%_50%)]/40" />
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-2xl font-extrabold text-[hsl(220_30%_95%)]">{s.num}</span>
                <span className="text-[hsl(225_15%_50%)]/40 font-mono text-xs">///</span>
                <h3 className="text-lg font-bold text-[hsl(220_30%_95%)]">{s.title}</h3>
              </div>
              <p className="text-[hsl(225_15%_50%)] text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Mentorship (restored as its own compact section) ---------- */
function Mentorship() {
  return (
    <section className="relative py-16 md:py-20 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[440px] pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse,hsl(270_60%_35%_/_0.15)_0%,transparent_60%)]" />
        <div className="absolute inset-[80px] bg-[radial-gradient(ellipse,hsl(230_70%_45%_/_0.1)_0%,transparent_55%)]" />
      </div>
      <div className="container mx-auto px-6 relative z-10 text-center max-w-2xl">
        <span className="inline-block text-xs font-semibold text-[hsl(220_30%_95%)] border border-[hsl(225_15%_50%)]/30 rounded-full px-4 py-1.5 mb-6">
          Mentorship
        </span>
        <h2 className="text-3xl md:text-4xl font-extrabold text-[hsl(220_30%_95%)] leading-[1.1] mb-5">
          Need a Human Edge? <span className="text-[hsl(230_85%_60%)]">We've Got You.</span>
        </h2>
        <p className="text-[hsl(225_15%_50%)] text-base leading-relaxed mb-7 max-w-lg mx-auto">
          Biddie handles the data — but sometimes you need a real mentor in your corner. Get direct
          access to experienced traders who'll help you level up faster.
        </p>
        <button className="rounded-full px-8 py-3 text-sm font-semibold bg-[hsl(220_30%_95%)] text-[hsl(230_25%_5%)] hover:opacity-90 transition-opacity">
          Inquire About Mentorship
        </button>
      </div>
    </section>
  );
}

/* ---------- Final CTA + stats ---------- */
function FinalCTA() {
  return (
    <section className="relative py-16 md:py-20 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[760px] h-[440px] pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse,hsl(270_60%_35%_/_0.25)_0%,transparent_60%)]" />
        <div className="absolute inset-[40px] bg-[radial-gradient(ellipse,hsl(30_70%_40%_/_0.2)_0%,transparent_55%)]" />
      </div>
      <div className="relative z-10 container mx-auto px-6 text-center max-w-3xl">
        <div className="relative inline-block">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-[hsl(220_30%_95%)] leading-[1.1]">
            Ready to Trade<br />Smarter?
          </h2>
          <img
            src={LEANING}
            alt="Biddie leaning casually"
            className="absolute -left-16 md:-left-24 bottom-0 w-20 h-20 md:w-32 md:h-32 object-contain drop-shadow-[0_0_30px_hsl(230_85%_60%_/_0.35)] -scale-x-100"
          />
        </div>
        <p className="text-[hsl(225_15%_50%)] mt-6 max-w-xl mx-auto text-base leading-relaxed">
          Let Biddie do the heavy lifting — you focus on pulling the trigger at the right time.
        </p>
        <div className="mt-9">
          <button className="rounded-full px-10 py-3.5 text-base font-semibold bg-[hsl(220_30%_95%)] text-[hsl(230_25%_5%)] hover:opacity-90 transition-opacity">
            Chat with Biddie
          </button>
        </div>

        <div className="grid grid-cols-3 gap-6 border-t border-[hsl(232_25%_14%)] pt-8 mt-12">
          {["24/7 Market Scanning", "AI Confidence Scores", "Futures • Options • Stocks"].map((t) => (
            <span key={t} className="text-sm md:text-lg font-extrabold text-[hsl(220_30%_95%)]">{t}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
const faqs = [
  { q: "How does JORTRADE find opportunities?", a: "Biddie uses AI to scan price action, volume, and liquidity across futures, options, and stocks — then surfaces what's worth your attention." },
  { q: "Does it tell me exactly what to trade?", a: "No — Biddie gives you the context and analysis. You always make the final call. Think of it as a smarter second opinion." },
  { q: "Do I need trading experience?", a: "Not at all. Biddie simplifies complex data into plain-language guidance that anyone can act on." },
  { q: "What markets are covered?", a: "NQ and ES futures, individual stocks, and options — with a focus on the highest-conviction setups." },
  { q: "Can I chat with Biddie?", a: "Yes! Ask about any ticker, strategy, or setup and get a clear, conversational response in seconds." },
];

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative py-16 md:py-20">
      <div className="container mx-auto px-6 max-w-3xl">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-[hsl(220_30%_95%)] text-center mb-10">
          Frequently Asked Questions
        </h2>
        <div>
          {faqs.map((faq, i) => (
            <div key={i} className="border-b border-[hsl(232_25%_14%)]">
              <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between py-5 text-left group">
                <span className="text-base md:text-lg font-semibold text-[hsl(225_15%_50%)] group-hover:text-[hsl(220_30%_95%)] transition-colors pr-8">
                  {faq.q}
                </span>
                {open === i ? <Minus className="h-5 w-5 text-[hsl(225_15%_50%)] shrink-0" /> : <Plus className="h-5 w-5 text-[hsl(225_15%_50%)] shrink-0" />}
              </button>
              {open === i && <p className="text-[hsl(225_15%_50%)] text-sm leading-relaxed pb-5">{faq.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="border-t border-[hsl(232_25%_14%)] py-8">
      <div className="container mx-auto px-6 max-w-5xl flex flex-col md:flex-row items-center justify-between gap-4">
        <img src={LOGO} alt="JORTRADE" className="h-7 w-auto opacity-80" />
        <p className="text-[11px] text-[hsl(225_15%_50%)] text-center md:text-right max-w-xl leading-relaxed">
          For educational purposes only. Not financial advice. Trading involves risk. © JORTRADE.
        </p>
      </div>
    </footer>
  );
}

export function LeanerLandingV2() {
  return (
    <div className="lp-root min-h-screen">
      <Nav />
      <Hero />
      <DashboardSection />
      <FourSquares />
      <HowItWorks />
      <Mentorship />
      <FinalCTA />
      <FAQ />
      <Footer />
    </div>
  );
}

export default LeanerLandingV2;
