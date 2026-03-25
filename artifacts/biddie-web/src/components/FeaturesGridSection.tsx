import { motion } from "framer-motion";

const features = [
  {
    title: "Opportunity Scanner",
    desc: "Finds high-probability setups by reading price action, volume, and where institutional money is moving.",
  },
  {
    title: "Confidence Scoring",
    desc: "Every setup gets a score so you instantly know which ideas deserve your attention.",
  },
  {
    title: "Ask Biddie Anything",
    desc: "Chat with your AI assistant about any ticker, setup, or strategy — and get a clear answer.",
  },
  {
    title: "Execution Alerts",
    desc: "Timed notifications with entry zones, risk levels, and context — delivered when it matters.",
  },
  {
    title: "Market Structure Map",
    desc: "Visualize trend direction, key levels, and where liquidity is sitting at a glance.",
  },
  {
    title: "Performance Feedback",
    desc: "Review past trades and patterns to sharpen your edge over time.",
  },
];

const FeaturesGridSection = () => {
  return (
    <section className="relative py-28 overflow-hidden">
      {/* Center ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-full bg-[radial-gradient(ellipse_50%_60%_at_50%_40%,hsl(270_60%_40%_/_0.12)_0%,transparent_70%)] blur-2xl pointer-events-none" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-foreground leading-[1.1] max-w-3xl mx-auto">
            Everything Biddie Brings to Your Trading
          </h2>
          <p className="text-muted-foreground mt-5 max-w-2xl mx-auto text-base leading-relaxed">
            One platform. Six capabilities. Zero guesswork.
          </p>
        </motion.div>

        {/* 3x2 grid */}
        <div className="grid md:grid-cols-2 gap-px bg-border/20 max-w-4xl mx-auto">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="relative bg-background p-10"
            >
              {/* Corner crosses */}
              <div className="absolute top-0 left-0 w-3 h-px bg-muted-foreground/30" />
              <div className="absolute top-0 left-0 w-px h-3 bg-muted-foreground/30" />
              <div className="absolute top-0 right-0 w-3 h-px bg-muted-foreground/30" />
              <div className="absolute top-0 right-0 w-px h-3 bg-muted-foreground/30" />

              <h3 className="text-lg font-bold text-foreground mb-3">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesGridSection;
