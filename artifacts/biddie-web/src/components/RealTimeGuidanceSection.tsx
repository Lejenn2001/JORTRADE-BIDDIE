import { motion } from "framer-motion";

const RealTimeGuidanceSection = () => {
  return (
    <section className="relative py-28">
      <div className="container mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Left - heading + description card */}
          <div className="space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              <h2 className="text-4xl md:text-5xl font-extrabold text-foreground leading-[1.1] mb-4">
                Biddie in Action
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed max-w-md">
                See how Biddie spots opportunities and walks you through them — before you even ask.
              </p>
            </motion.div>

            {/* Signal alert card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-card rounded-2xl p-8 min-h-[280px] flex flex-col justify-end"
            >
              <div className="mt-auto">
                <p className="text-foreground text-sm leading-relaxed">
                  <span className="font-bold text-warning">Opportunity Alert:</span> ES Futures
                </p>
                <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
                  Structured breakout forming above range resistance.
                </p>
                <p className="text-muted-foreground text-sm mt-1">Confidence Score: 8.2</p>
                <p className="text-muted-foreground text-sm">Market Environment: <span className="text-foreground font-medium">Trending</span></p>
                <p className="text-muted-foreground text-sm">Risk Awareness: Elevated volatility</p>
                <p className="text-warning text-sm mt-2 font-medium">👉 Review setup context</p>
              </div>
            </motion.div>
          </div>

          {/* Right - two cards stacked */}
          <div className="space-y-8">
            {/* Setup card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="bg-card rounded-2xl p-8 min-h-[220px] flex flex-col justify-end"
            >
              <p className="text-foreground text-sm leading-relaxed">
                <span className="font-bold">Potential Setup:</span> PLTR Bullish liquidity sweep near $149
              </p>
              <p className="text-muted-foreground text-sm mt-1">
                Watching call zone: 150–152.5 <span className="text-warning">👉</span> Review setup context
              </p>
            </motion.div>

            {/* Chat conversation card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="bg-card rounded-2xl p-8 min-h-[220px] flex flex-col justify-center"
            >
              <p className="text-foreground text-sm mb-4">
                <span className="text-muted-foreground">Trader:</span> "Is there a structured opportunity to watch this morning?"
              </p>
              <p className="text-foreground text-sm">
                <span className="text-primary font-medium">Biddie:</span> "I'm currently monitoring a potential bullish setup forming in TSLA. Would you like to review a possible call strategy?"
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default RealTimeGuidanceSection;
