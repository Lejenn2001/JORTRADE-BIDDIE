import { Activity, TrendingUp, TrendingDown, Clock, Target, ShieldX, Zap, Crosshair, MapPin, Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { MarketSignal } from "@/hooks/useMarketData";
import SignalLegend from "./SignalLegend";
import ConvictionScoreRing from "./ConvictionScoreRing";

interface Props {
  signals: MarketSignal[];
  loading: boolean;
  limit?: number;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, delay: i * 0.12, ease: "easeOut" as const },
  }),
};

const SignalFeedPanel = ({ signals, loading, limit }: Props) => {
  const displaySignals = limit ? signals.slice(0, limit) : signals;
  return (
    <div className="glass-panel rounded-xl p-5 border-glow-blue">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Live Signal Feed</span>
        </div>
        <span className="text-xs bg-primary/20 text-primary px-2.5 py-0.5 rounded-full flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          {displaySignals.length} Active
        </span>
      </div>

      <SignalLegend />

      {loading && signals.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-lg bg-muted/20 animate-pulse h-36" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {displaySignals.map((signal, index) => (
            <motion.div
              key={signal.id}
              custom={index}
              initial="hidden"
              animate="visible"
              variants={cardVariants}
              className={`rounded-xl border overflow-hidden ${
                signal.type === "bullish"
                  ? "border-primary/30 bg-primary/5"
                  : signal.type === "bearish"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-muted bg-muted/30"
              }`}
            >
              {/* Alert Header */}
              <div
                className={`px-4 py-2 flex items-center justify-between ${
                  signal.type === "bullish"
                    ? "bg-primary/15"
                    : "bg-destructive/15"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-accent" />
                  <span className="text-[10px] font-bold tracking-widest text-accent uppercase">
                    JORTRADE Alert
                  </span>
                  {signal.source === "live" ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">Live</span>
                  ) : signal.source === "example" ? (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground uppercase tracking-wider">Example</span>
                  ) : null}
                </div>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {signal.timestamp}
                </span>
              </div>

              <div className="px-4 py-3 space-y-3">
                {/* Ticker + Direction + Conviction Ring */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {signal.type === "bullish" ? (
                      <TrendingUp className="h-4 w-4 text-primary" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-bold text-foreground text-base">{signal.ticker}</span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        signal.type === "bullish"
                          ? "bg-primary/20 text-primary"
                          : "bg-destructive/20 text-destructive"
                      }`}
                    >
                      {signal.putCall === "call" ? "CALL" : signal.putCall === "put" ? "PUT" : signal.type}
                    </span>
                  </div>
                  <ConvictionScoreRing
                    score={signal.convictionScore ?? Math.round(signal.confidence * 10)}
                    label={signal.convictionLabel ?? ""}
                  />
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {signal.description}
                </p>

                {/* Trade Details Grid */}
                <div className="grid grid-cols-1 gap-2 text-xs">
                  {signal.suggestedTrade && (
                    <div className="flex items-start gap-2 bg-muted/30 rounded-lg px-3 py-2">
                      <Target className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Suggested trade: </span>
                        <span className="text-foreground font-semibold">{signal.suggestedTrade}</span>
                      </div>
                    </div>
                  )}

                  {signal.entryTrigger && (
                    <div className="flex items-start gap-2 bg-muted/30 rounded-lg px-3 py-2">
                      <TrendingUp className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Entry trigger: </span>
                        <span className="text-foreground font-semibold">{signal.entryTrigger}</span>
                      </div>
                    </div>
                  )}

                  {signal.gammaLevelLabel && (
                    <div className="flex items-start gap-2 bg-accent/10 rounded-lg px-3 py-2">
                      <Gauge className="h-3.5 w-3.5 text-accent mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">S/R alignment: </span>
                        <span className="text-accent font-semibold">{signal.gammaLevelLabel}</span>
                      </div>
                    </div>
                  )}

                  {signal.keyLevel && (
                    <div className="flex items-start gap-2 bg-primary/10 rounded-lg px-3 py-2">
                      <Crosshair className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Key level: </span>
                        <span className="text-primary font-semibold">{signal.keyLevel}</span>
                      </div>
                    </div>
                  )}

                  {signal.targetZone && (
                    <div className="flex items-start gap-2 bg-primary/10 rounded-lg px-3 py-2">
                      <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Target zone: </span>
                        <span className="text-primary font-semibold">{signal.targetZone}</span>
                      </div>
                    </div>
                  )}

                  {signal.invalidation && (
                    <div className="flex items-start gap-2 bg-destructive/10 rounded-lg px-3 py-2">
                      <ShieldX className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Invalidation: </span>
                        <span className="text-destructive font-semibold">{signal.invalidation}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {signal.tags.map((tag) => {
                    const isUrgent = tag.includes('ACT NOW') || tag.includes('HIGH CONVICTION');
                    return (
                      <span
                        key={tag}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          isUrgent
                            ? "bg-destructive/20 text-destructive animate-pulse"
                            : "bg-muted/50 text-muted-foreground"
                        }`}
                      >
                        {tag}
                      </span>
                    );
                  })}
                  {signal.premium && (
                    <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded-full font-medium">
                      Premium: {signal.premium}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {limit && signals.length > limit && (
        <Link to="/dashboard/signals" className="block mt-3 text-center text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
          View All {signals.length} Signals →
        </Link>
      )}
    </div>
  );
};

export default SignalFeedPanel;
