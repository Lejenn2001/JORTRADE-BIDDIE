import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const steps = [
  {
    num: "1",
    title: "Market Scan",
    desc: "Biddie continuously monitors price action, volume shifts, and liquidity activity to surface what's worth watching.",
  },
  {
    num: "2",
    title: "Opportunity Ranking",
    desc: "Each setup is scored by strength so you spend time on the best ideas — not sorting through noise.",
  },
  {
    num: "3",
    title: "Execution Guidance",
    desc: "Get clear entry context, risk levels, and timing cues before you pull the trigger.",
  },
];

const AIWorkflowSection = () => {
  return (
    <section id="workflow" className="relative py-28">
      <div className="container mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          {/* Left column */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="inline-block text-xs font-semibold text-foreground border border-muted-foreground/30 rounded-full px-4 py-1.5 mb-8">
              AI Workflow
            </span>

            <h2 className="text-4xl md:text-5xl font-extrabold text-foreground leading-[1.1] mb-6">
              How Biddie Works For You
            </h2>

            <p className="text-muted-foreground text-base leading-relaxed mb-8 max-w-lg">
              Three steps between you and smarter trades. Biddie handles the analysis — you make the call.
            </p>

            <a href="#" className="inline-flex items-center gap-2 text-foreground font-semibold text-sm hover:gap-3 transition-all group">
              Join Early Access
              <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </a>
          </motion.div>

          {/* Right column - steps */}
          <div className="space-y-0">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="relative border-t border-border py-10"
              >
                {/* Corner decoration */}
                <div className="absolute top-0 left-0 w-3 h-px bg-muted-foreground/40" />
                <div className="absolute top-0 left-0 w-px h-3 bg-muted-foreground/40" />
                <div className="absolute top-0 right-0 w-3 h-px bg-muted-foreground/40" />
                <div className="absolute top-0 right-0 w-px h-3 bg-muted-foreground/40" />

                <div className="flex items-baseline gap-4 mb-4">
                  <span className="text-3xl font-extrabold text-foreground">{step.num}</span>
                  <span className="text-muted-foreground/40 font-mono text-sm">///</span>
                  <h3 className="text-xl font-bold text-foreground">{step.title}</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed pl-12">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default AIWorkflowSection;
