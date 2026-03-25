import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const WhatWeDoSection = () => {
  return (
    <section className="relative py-28 overflow-hidden">
      {/* Subtle ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse,hsl(30_60%_35%_/_0.12)_0%,transparent_70%)]" />

      <div className="container mx-auto px-6">
        <div className="grid lg:grid-cols-3 gap-0">
          {/* Left column - heading */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="lg:pr-12 mb-12 lg:mb-0"
          >
            <span className="inline-block text-xs font-semibold text-foreground border border-muted-foreground/30 rounded-full px-4 py-1.5 mb-8">
              What We Do
            </span>

            <h2 className="text-4xl md:text-5xl font-extrabold text-foreground leading-[1.1] mb-6 relative inline-block">
              <span className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-[hsl(var(--glow-blue)/0.15)] via-[hsl(var(--glow-purple)/0.1)] to-transparent blur-2xl -z-10" />
              Your Edge in Every Market Move
            </h2>

            <p className="text-muted-foreground text-base leading-relaxed mb-8">
              Biddie watches the markets so you don't have to — surfacing the setups that matter
              and translating them into clear, actionable guidance.
            </p>

            <a href="#workflow" className="inline-flex items-center gap-2 text-foreground font-semibold text-sm hover:gap-3 transition-all group">
              See how JORTRADE works
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </motion.div>

          {/* Right columns - stats grid */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-px bg-border/30">
            {[
              {
                title: "1,000+",
                subtitle: "Setups Scanned Daily",
                desc: "AI combs through price action and volume across key markets every day.",
              },
              {
                title: "Real-Time",
                subtitle: "Always-On Monitoring",
                desc: "Futures, equities, and options tracked around the clock.",
              },
              {
                title: "Instant",
                subtitle: "Confidence Scores",
                desc: "Every opportunity ranked so you know where to focus.",
              },
              {
                title: "Institutional",
                subtitle: "Levels Tracked",
                desc: "Key zones where big money is active — surfaced automatically.",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative bg-background p-8 group"
              >
                {/* Corner cross decorations */}
                <div className="absolute top-0 left-0 w-3 h-px bg-muted-foreground/30" />
                <div className="absolute top-0 left-0 w-px h-3 bg-muted-foreground/30" />

                <h3 className="text-3xl md:text-4xl font-extrabold text-foreground leading-tight mb-1">
                  {item.title}
                </h3>
                <p className="text-xl md:text-2xl font-extrabold text-foreground leading-tight mb-3">
                  {item.subtitle}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhatWeDoSection;
