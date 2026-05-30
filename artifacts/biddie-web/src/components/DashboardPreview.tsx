import { Zap, Waves, Target, TrendingUp, TrendingDown, Sparkles, Send } from "lucide-react";
import { motion } from "framer-motion";
import ConvictionScoreRing from "@/components/dashboard/ConvictionScoreRing";

type Card = {
  category: string;
  icon: typeof Zap;
  color: string;
  headerBg: string;
  border: string;
  bg: string;
  ticker: string;
  direction: "call" | "put";
  score: number;
  note: string;
  tags: { label: string; cls: string }[];
};

const cards: Card[] = [
  {
    category: "Top Signal",
    icon: Zap,
    color: "text-emerald-400",
    headerBg: "bg-emerald-500/15",
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/5",
    ticker: "SPY",
    direction: "call",
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
    direction: "call",
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
    direction: "put",
    score: 76,
    note: "Multi-leg spread setup forming on weakness.",
    tags: [{ label: "Swing", cls: "bg-blue-500/20 text-blue-400" }],
  },
];

const DecisionEngineBanner = () => (
  <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
    <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 1000 200" preserveAspectRatio="none">
      {[40, 95, 150, 205, 260, 315, 370, 425, 480, 535, 590, 645, 700, 755, 810, 865, 920].map((x, i) => {
        const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45, 70, 55];
        const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85, 50, 75];
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
    <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-[hsl(232,30%,7%)]/30 to-transparent" />

    <div className="relative px-6 py-6 lg:py-7">
      <div className="flex items-center gap-3">
        <div className="w-1.5 h-10 rounded-full bg-gradient-to-b from-[hsl(var(--glow-blue))] via-[hsl(var(--glow-purple))] to-[hsl(var(--glow-cyan))]" />
        <div>
          <h3 className="text-2xl sm:text-3xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent">
            Decision Engine
          </h3>
          <p className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--glow-blue))]/80 font-semibold mt-0.5">
            Flow · Insight · Execution
          </p>
        </div>
      </div>
    </div>
  </div>
);

const SignalCard = ({ card, index }: { card: Card; index: number }) => {
  const Icon = card.icon;
  const isCall = card.direction === "call";
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.12 }}
      className={`rounded-xl border ${card.border} ${card.bg} overflow-hidden`}
    >
      <div className={`px-4 py-2 flex items-center justify-between ${card.headerBg}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Icon className={`h-3 w-3 ${card.color}`} />
          <span className={`text-[11px] font-bold tracking-widest uppercase ${card.color}`}>
            {card.category}
          </span>
          {card.tags.map((t) => (
            <span key={t.label} className={`inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full uppercase tracking-wider ${t.cls}`}>
              {t.label}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      </div>

      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isCall ? (
              <TrendingUp className="h-5 w-5 text-primary" />
            ) : (
              <TrendingDown className="h-5 w-5 text-destructive" />
            )}
            <span className="font-bold text-foreground text-lg tracking-tight">{card.ticker}</span>
            <span
              className={`inline-flex items-center h-5 text-[10px] font-bold uppercase px-2 rounded-full ${
                isCall ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"
              }`}
            >
              {isCall ? "Call" : "Put"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{card.note}</p>
        </div>
        <div className="shrink-0">
          <ConvictionScoreRing score={card.score} label="" />
        </div>
      </div>
    </motion.div>
  );
};

const DashboardPreview = () => {
  return (
    <section className="relative py-24">
      <div className="container mx-auto px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-flex items-center gap-2 text-xs font-semibold text-primary bg-primary/10 px-4 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            A Look Inside
          </span>
          <h2 className="text-4xl md:text-5xl font-extrabold mt-6 text-foreground leading-[1.1]">
            Your Dashboard, Built for Decisions
          </h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto text-base leading-relaxed">
            Biddie surfaces the day's highest-conviction plays — scored, sorted, and ready
            the moment you log in.
          </p>
        </motion.div>

        {/* Framed dashboard preview */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.15 }}
          className="glass-panel rounded-2xl p-4 md:p-6 border-glow-purple max-w-4xl mx-auto"
        >
          <DecisionEngineBanner />

          <div className="grid md:grid-cols-3 gap-4 mt-4">
            {cards.map((card, i) => (
              <SignalCard key={card.ticker} card={card} index={i} />
            ))}
          </div>

          {/* Ask Biddie bar */}
          <div className="glass-panel rounded-xl p-3 mt-4 border border-border/60">
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-accent shrink-0" />
              <span className="text-sm text-muted-foreground flex-1">Ask Biddie anything about the market…</span>
              <button aria-label="Send question to Biddie" className="bg-primary/20 text-primary rounded-lg p-2.5 hover:bg-primary/30 transition-colors">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default DashboardPreview;
