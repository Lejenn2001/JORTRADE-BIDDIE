import { motion } from "framer-motion";
import { LayoutDashboard, ListFilter, MessageSquare, Bot } from "lucide-react";

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

const SignalBreakdownSection = () => {
  return (
    <section className="relative py-28 overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-full bg-[radial-gradient(ellipse_50%_40%_at_50%_30%,hsl(230_70%_40%_/_0.1)_0%,transparent_70%)] blur-2xl pointer-events-none" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="text-center mb-16"
        >
          <span className="inline-block text-xs font-semibold text-foreground border border-muted-foreground/30 rounded-full px-4 py-1.5 mb-8">
            What You Get
          </span>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-foreground leading-[1.1] max-w-3xl mx-auto">
            Four Ways Biddie
            <br />
            <span className="text-primary">Finds Your Edge</span>
          </h2>
          <p className="text-muted-foreground mt-5 max-w-2xl mx-auto text-base leading-relaxed">
            Every feature is powered by live institutional flow data, real-time key levels, and AI that actually understands how the market moves.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-5 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 25 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className={`relative rounded-2xl border ${f.borderColor} bg-card/60 p-7 overflow-hidden hover:border-primary/20 transition-colors`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${f.accent} pointer-events-none`} />
              <div className="relative">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-secondary/80 flex items-center justify-center">
                    <f.icon className={`h-5 w-5 ${f.iconColor}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground">{f.title}</h3>
                    <p className={`text-xs font-medium ${f.iconColor}`}>{f.tagline}</p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                  {f.description}
                </p>

                <ul className="space-y-2">
                  {f.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className={`mt-1 w-1 h-1 rounded-full ${f.iconColor} bg-current shrink-0`} />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SignalBreakdownSection;
