import { Activity, CheckCircle2, Send, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";

const SignalFeed = () => (
  <div className="glass-panel rounded-xl p-5 border-glow-blue flex-1 min-w-0">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <span className="font-semibold text-sm text-foreground">Signal Feed</span>
      </div>
      <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">● 2 Active</span>
    </div>

    <div className="border-l-2 border-primary p-3 rounded-r-lg bg-primary/5 mb-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-primary font-bold">Opportunity Detected</div>
          <div className="font-semibold text-foreground">NQ Futures</div>
        </div>
        <div className="w-10 h-10 rounded-full border-2 border-primary flex items-center justify-center">
          <span className="text-primary font-bold text-sm">9.1</span>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div>Confidence Score: 9.1</div>
        <div>Market Environment: <span className="text-primary font-medium">Trending</span></div>
        <div className="flex items-center gap-1 text-primary">
          <CheckCircle2 className="h-3 w-3" /> Liquidity sweep confirmed
        </div>
      </div>
    </div>

    <div className="border-l-2 border-accent p-3 rounded-r-lg bg-accent/5">
      <div className="font-semibold text-foreground text-sm">Structured Setup</div>
      <div className="text-foreground">SPX Index</div>
      <div className="text-xs text-muted-foreground mt-1">Watching breakout above 5,220</div>
    </div>

    <div className="flex items-center gap-1 mt-4 text-xs text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
      Last updated: 2 minutes ago
    </div>
  </div>
);

const MarketStructureView = () => (
  <div className="glass-panel rounded-xl p-5 border-glow-purple flex-[2] min-w-0">
    <div className="flex items-center justify-between mb-4">
      <span className="font-semibold text-sm text-foreground">Market Structure View</span>
      <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">Bullish Bias ↗</span>
    </div>

    <div className="relative h-48 w-full mb-4">
      <svg viewBox="0 0 500 200" className="w-full h-full" preserveAspectRatio="none">
        <line x1="0" y1="90" x2="500" y2="90" stroke="hsl(230 85% 60%)" strokeWidth="1" strokeDasharray="6 4" opacity="0.4" />
        <rect x="250" y="30" width="250" height="40" fill="hsl(230 85% 60%)" opacity="0.06" rx="4" />
        <rect x="150" y="150" width="250" height="30" fill="hsl(0 72% 51%)" opacity="0.06" rx="4" />

        {[
          { x: 30, o: 160, c: 145, h: 140, l: 165, bull: true },
          { x: 55, o: 145, c: 155, h: 138, l: 158, bull: false },
          { x: 80, o: 150, c: 135, h: 130, l: 155, bull: true },
          { x: 105, o: 135, c: 140, h: 128, l: 145, bull: false },
          { x: 130, o: 140, c: 125, h: 120, l: 148, bull: true },
          { x: 155, o: 125, c: 130, h: 118, l: 135, bull: false },
          { x: 180, o: 128, c: 115, h: 108, l: 135, bull: true },
          { x: 205, o: 115, c: 120, h: 108, l: 125, bull: false },
          { x: 230, o: 118, c: 105, h: 98, l: 125, bull: true },
          { x: 255, o: 105, c: 110, h: 98, l: 115, bull: false },
          { x: 280, o: 108, c: 95, h: 88, l: 115, bull: true },
          { x: 305, o: 95, c: 100, h: 88, l: 105, bull: false },
          { x: 330, o: 98, c: 85, h: 78, l: 105, bull: true },
          { x: 355, o: 85, c: 75, h: 68, l: 90, bull: true },
          { x: 380, o: 75, c: 80, h: 68, l: 85, bull: false },
          { x: 405, o: 78, c: 65, h: 58, l: 85, bull: true },
          { x: 430, o: 65, c: 55, h: 48, l: 72, bull: true },
          { x: 455, o: 55, c: 60, h: 48, l: 65, bull: false },
          { x: 480, o: 58, c: 48, h: 42, l: 65, bull: true },
        ].map((c, i) => {
          const top = Math.min(c.o, c.c);
          const bottom = Math.max(c.o, c.c);
          const color = c.bull ? "hsl(230 85% 60%)" : "hsl(0 72% 51%)";
          return (
            <g key={i}>
              <line x1={c.x} y1={c.h} x2={c.x} y2={c.l} stroke={color} strokeWidth="2" />
              <rect x={c.x - 8} y={top} width="16" height={Math.max(bottom - top, 3)} fill={color} rx="1" />
            </g>
          );
        })}
      </svg>

      <div className="absolute top-4 right-4 text-xs text-primary font-medium">Call Zone 150 – 152.5</div>
      <div className="absolute right-4 top-[45%] text-xs text-primary">Key Level: $149</div>
      <div className="absolute bottom-4 right-4 text-xs text-destructive">Invalidation: $147</div>
    </div>

    <div className="grid grid-cols-3 gap-4 border-t border-border pt-3">
      <div className="text-center">
        <div className="text-xs text-muted-foreground">Asset</div>
        <div className="font-bold text-foreground text-sm">PLTR</div>
      </div>
      <div className="text-center">
        <div className="text-xs text-muted-foreground">Strategy</div>
        <div className="font-bold text-foreground text-sm">Call Option</div>
      </div>
      <div className="text-center">
        <div className="text-xs text-muted-foreground">Expiration</div>
        <div className="font-bold text-foreground text-sm">March 27, 2026</div>
      </div>
    </div>
  </div>
);

const AIAssistantPanel = () => (
  <div className="glass-panel rounded-xl p-5 border-glow-purple min-w-0 flex-1">
    <div className="flex items-center justify-between mb-4">
      <span className="font-semibold text-sm text-foreground">AI Assistant</span>
      <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">● Online</span>
    </div>

    <div className="space-y-3">
      <div className="bg-muted/50 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-accent">Trader</span>
          <span className="text-xs text-muted-foreground">10:32 AM</span>
        </div>
        <p className="text-sm text-foreground">Is there a setup to watch?</p>
      </div>

      <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-primary">Biddie</span>
          <span className="text-xs text-muted-foreground">10:32 AM</span>
        </div>
        <p className="text-sm text-foreground">
          Monitoring a possible bullish structure forming near a key liquidity zone.
        </p>
        <p className="text-sm text-foreground mt-2">
          Would you like entry timing context?
        </p>
      </div>

      <div className="flex items-center gap-1 text-xs text-primary">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
        Analyzing market conditions...
      </div>
    </div>
  </div>
);

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
          <span className="text-xs font-display tracking-widest text-primary bg-primary/10 px-4 py-1.5 rounded-full">
            ● LIVE PLATFORM PREVIEW
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mt-6 text-foreground">
            Inside the JORTRADE AI Dashboard
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
            See how JORTRADE delivers structured trade intelligence, real-time alerts,
            and AI-guided decision support — all in one simple interface.
          </p>
        </motion.div>

        {/* Dashboard panels */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="glass-panel rounded-2xl p-4 md:p-6 border-glow-purple"
        >
          <div className="flex flex-col lg:flex-row gap-4">
            <SignalFeed />
            <MarketStructureView />
            <AIAssistantPanel />
          </div>
        </motion.div>

        {/* Chat input */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="glass-panel rounded-xl p-4 mt-4 border-glow-purple"
        >
          <div className="flex items-center gap-3">
            <span className="text-accent">✨</span>
            <span className="text-sm text-muted-foreground flex-1">Ask Biddie anything about the market...</span>
            <button className="bg-primary/20 text-primary rounded-lg p-2.5 hover:bg-primary/30 transition-colors">
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              '"Should I consider calls or puts?"',
              '"What\'s the confidence level?"',
              '"Show me similar setups"',
            ].map((q) => (
              <span
                key={q}
                className="text-xs bg-muted/50 text-muted-foreground px-3 py-1.5 rounded-full border border-border hover:border-primary/40 cursor-pointer transition-colors"
              >
                {q}
              </span>
            ))}
          </div>
        </motion.div>

        <div className="text-center mt-6 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary inline mr-1" />
          Demo environment with real market data • No sign-up required to explore
        </div>
      </div>
    </section>
  );
};

export default DashboardPreview;
