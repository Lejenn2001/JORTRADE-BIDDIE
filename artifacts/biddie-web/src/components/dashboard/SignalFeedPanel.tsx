import { Activity, TrendingUp, TrendingDown, Clock, Target, ShieldX, Zap, Crosshair, MapPin, Gauge, CheckCircle2, Flame, Waves, Plus, Check, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { MarketSignal } from "@/hooks/useMarketData";
import SignalLegend from "./SignalLegend";
import ConvictionScoreRing from "./ConvictionScoreRing";

interface Props {
  signals: MarketSignal[];
  loading: boolean;
  limit?: number;
  title?: string;
  subtitle?: string;
  icon?: "algorithm" | "whale" | "spread";
  takenSignalIds?: Set<string>;
  takingId?: string | null;
  onTakeTrade?: (signal: MarketSignal) => void;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, delay: i * 0.12, ease: "easeOut" as const },
  }),
};

const SignalFeedPanel = ({ signals, loading, limit, title, subtitle, icon, takenSignalIds, takingId, onTakeTrade }: Props) => {
  const displaySignals = limit ? signals.slice(0, limit) : signals;
  const isWhale = icon === "whale";
  const isSpread = icon === "spread";
  const headerTitle = title || "Live Signal Feed";
  const headerIcon = isWhale
    ? <Waves className="h-4 w-4 text-blue-400" />
    : isSpread
    ? <Target className="h-4 w-4 text-violet-400" />
    : icon === "algorithm"
    ? <Zap className="h-4 w-4 text-emerald-400" />
    : <Activity className="h-4 w-4 text-primary" />;
  const accentColor = isWhale ? "text-blue-400" : isSpread ? "text-violet-400" : icon === "algorithm" ? "text-emerald-400" : "text-primary";
  const accentBg = isWhale ? "bg-blue-400/20" : isSpread ? "bg-violet-400/20" : icon === "algorithm" ? "bg-emerald-400/20" : "bg-primary/20";

  return (
    <div className={`glass-panel rounded-xl p-5 ${isWhale ? "border-blue-500/30 border" : isSpread ? "border-violet-500/30 border" : icon === "algorithm" ? "border-emerald-500/30 border" : "border-glow-blue"}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {headerIcon}
          <span className={`font-semibold text-sm ${accentColor}`}>{headerTitle}</span>
        </div>
        <span className={`text-xs ${accentBg} ${accentColor} px-2.5 py-0.5 rounded-full flex items-center gap-1`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isWhale ? "bg-blue-400" : isSpread ? "bg-violet-400" : icon === "algorithm" ? "bg-emerald-400" : "bg-primary"} animate-pulse`} />
          {displaySignals.length} Active
        </span>
      </div>
      {subtitle && (
        <p className="text-[10px] text-muted-foreground mb-4 ml-6">{subtitle}</p>
      )}
      {!subtitle && <div className="mb-4" />}

      {!icon && <SignalLegend />}

      {loading && signals.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-lg bg-muted/20 animate-pulse h-36" />
          ))}
        </div>
      ) : displaySignals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm text-muted-foreground">No signals detected yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Signals update during market hours (9:30 AM – 4 PM ET)</p>
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
              {/* Price Confirmed Banner */}
              {signal.priceConfirmed && (
                <div className="px-4 py-1.5 bg-emerald-500/20 border-b border-emerald-500/30 flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-[10px] font-bold tracking-wider text-emerald-400 uppercase">
                    Price Action Confirmed
                  </span>
                  {signal.gammaZone && signal.gammaZone !== 'neutral' && (
                    <>
                      <Flame className="h-3.5 w-3.5 text-orange-400 animate-pulse" />
                      <span className="text-[10px] font-bold tracking-wider text-orange-400 uppercase">
                        ACT NOW
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Alert Header */}
              <div
                className={`px-4 py-2 flex items-center justify-between ${
                  signal.category === "whale"
                    ? "bg-blue-500/15"
                    : signal.category === "spread"
                    ? "bg-violet-500/15"
                    : signal.type === "bullish"
                    ? "bg-primary/15"
                    : "bg-destructive/15"
                }`}
              >
                <div className="flex items-center gap-2">
                  {signal.category === "whale" ? (
                    <Waves className="h-3.5 w-3.5 text-blue-400" />
                  ) : signal.category === "spread" ? (
                    <Target className="h-3.5 w-3.5 text-violet-400" />
                  ) : (
                    <Zap className="h-3.5 w-3.5 text-accent" />
                  )}
                  <span className={`text-[10px] font-bold tracking-widest uppercase ${
                    signal.category === "whale" ? "text-blue-400" : signal.category === "spread" ? "text-violet-400" : "text-accent"
                  }`}>
                      {signal.category === "whale" ? "Whale Play" : signal.category === "spread" ? "Spread Play" : "Algorithm Play"}
                  </span>
                  {signal.timeframe === "buy_now" || signal.timeframe === "short_term" ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider">Day Trade</span>
                  ) : signal.timeframe === "swing" ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing Trade</span>
                  ) : null}
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

                  {signal.pricePattern && (
                    <div className="flex items-start gap-2 bg-emerald-500/10 rounded-lg px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Price pattern: </span>
                        <span className="text-emerald-400 font-semibold">{signal.pricePattern}</span>
                      </div>
                    </div>
                  )}

                  {signal.spreadDetails && (
                    <div className="flex items-start gap-2 bg-violet-500/10 rounded-lg px-3 py-2">
                      <Target className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
                      <div>
                        <span className="text-muted-foreground">Strategy: </span>
                        <span className="text-violet-400 font-semibold">{signal.spreadDetails.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                        {signal.spreadDetails.legs && (
                          <span className="text-muted-foreground text-[10px] block mt-0.5">{signal.spreadDetails.legs}</span>
                        )}
                        {(signal.spreadDetails.max_profit || signal.spreadDetails.max_loss) && (
                          <span className="text-[10px] text-muted-foreground block mt-0.5">
                            {signal.spreadDetails.max_profit != null && `Max Profit: $${signal.spreadDetails.max_profit}`}
                            {signal.spreadDetails.max_profit != null && signal.spreadDetails.max_loss != null && ' | '}
                            {signal.spreadDetails.max_loss != null && `Max Loss: $${signal.spreadDetails.max_loss}`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {signal.gammaZone && signal.gammaZone !== 'neutral' && (
                    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                      signal.gammaZone === 'negative' ? 'bg-orange-500/10' : 'bg-blue-500/10'
                    }`}>
                      <Gauge className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                        signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                      }`} />
                      <div>
                        <span className="text-muted-foreground">Gamma zone: </span>
                        <span className={`font-semibold ${
                          signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                        }`}>
                          {signal.gammaZone === 'negative' ? 'Negative' : 'Positive'} — {signal.gammaDescription}
                        </span>
                      </div>
                    </div>
                  )}

                  {signal.gammaLevelLabel && (!signal.gammaZone || signal.gammaZone === 'neutral') && (
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
                  {signal.tags.filter((tag) => {
                    const upper = tag.toUpperCase();
                    if (upper.includes('ACT NOW') && !(signal.priceConfirmed && signal.gammaZone && signal.gammaZone !== 'neutral')) return false;
                    return true;
                  }).map((tag) => {
                    const tagUpper = tag.toUpperCase();
                    const isUrgent = tagUpper.includes('ACT NOW') || tagUpper.includes('HIGH CONVICTION');
                    const isPriceConfirmed = tagUpper.includes('PRICE CONFIRMED');
                    const isGamma = tagUpper.includes('GAMMA');
                    const isWhaleTag = tagUpper.includes('WHALE');
                    let tagStyle = "bg-muted/50 text-muted-foreground";
                    if (isPriceConfirmed) tagStyle = "bg-emerald-500/20 text-emerald-400 animate-pulse";
                    else if (isWhaleTag) tagStyle = "bg-blue-500/20 text-blue-400";
                    else if (isUrgent) tagStyle = "bg-destructive/20 text-destructive animate-pulse";
                    else if (isGamma) tagStyle = "bg-orange-500/20 text-orange-400";
                    return (
                      <span
                        key={tag}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tagStyle}`}
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

                {onTakeTrade && (
                  <div className="pt-2 border-t border-white/5">
                    <button
                      onClick={() => onTakeTrade(signal)}
                      disabled={takingId === signal.id}
                      className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all ${
                        takenSignalIds?.has(signal.id)
                          ? "bg-emerald-500/20 text-emerald-400 hover:bg-red-500/20 hover:text-red-400"
                          : "bg-muted/30 text-muted-foreground hover:bg-primary/20 hover:text-primary"
                      } disabled:opacity-50`}
                    >
                      {takingId === signal.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : takenSignalIds?.has(signal.id) ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          <span>Trade Taken</span>
                        </>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" />
                          <span>I Took This Trade</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SignalFeedPanel;
