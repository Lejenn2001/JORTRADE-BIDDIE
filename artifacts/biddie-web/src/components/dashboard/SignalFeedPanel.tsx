import { useState } from "react";
import { Activity, TrendingUp, TrendingDown, Clock, Target, ShieldX, Zap, Crosshair, MapPin, Gauge, CheckCircle2, Flame, Waves, Plus, Check, Loader2, Radio, ChevronDown, ChevronUp, XCircle, HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { MarketSignal } from "@/hooks/useMarketData";
import type { PriceInfo } from "@/hooks/useRealtimePrices";
import SignalLegend from "./SignalLegend";
import ConvictionScoreRing from "./ConvictionScoreRing";
import BeginnerTooltip from "./BeginnerTooltip";
import { simplifySignalDescription, compactDescription } from "@/lib/simplifyDescription";
import biddieRobot from "@/assets/biddie-robot.png";

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
  getPrice?: (ticker: string) => PriceInfo | null;
  wsConnected?: boolean;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.4, delay: i * 0.12, ease: "easeOut" as const },
  }),
};

const SignalFeedPanel = ({ signals, loading, limit, title, subtitle, icon, takenSignalIds, takingId, onTakeTrade, getPrice, wsConnected }: Props) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const displaySignals = limit ? signals.slice(0, limit) : signals;
  const isWhale = icon === "whale";
  const isSpread = icon === "spread";
  const isAlgo = icon === "algorithm";
  const headerTitle = title || "Live Signal Feed";
  const headerIcon = isWhale
    ? <Waves className="h-4 w-4 text-blue-400" />
    : isSpread
    ? <Target className="h-4 w-4 text-violet-400" />
    : isAlgo
    ? <Zap className="h-4 w-4 text-emerald-400" />
    : <Activity className="h-4 w-4 text-primary" />;
  const accentColor = isWhale ? "text-blue-400" : isSpread ? "text-violet-400" : isAlgo ? "text-emerald-400" : "text-primary";
  const accentBg = isWhale ? "bg-blue-400/20" : isSpread ? "bg-violet-400/20" : isAlgo ? "bg-emerald-400/20" : "bg-primary/20";

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`glass-panel rounded-xl p-5 ${isWhale ? "border-blue-500/30 border" : isSpread ? "border-violet-500/30 border" : isAlgo ? "border-emerald-500/30 border" : "border-glow-blue"}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {headerIcon}
          <span className={`font-semibold text-sm ${accentColor}`}>{headerTitle}</span>
          {subtitle && (
            <div className="relative group">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 px-3 py-2 rounded-lg bg-popover border border-border text-[10px] text-muted-foreground w-52 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 shadow-lg leading-relaxed">
                {subtitle}
              </div>
            </div>
          )}
        </div>
        <span className={`text-xs ${accentBg} ${accentColor} px-2.5 py-0.5 rounded-full flex items-center gap-1`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isWhale ? "bg-blue-400" : isSpread ? "bg-violet-400" : isAlgo ? "bg-emerald-400" : "bg-primary"} animate-pulse`} />
          {displaySignals.length} Active
        </span>
      </div>

      {!icon && <SignalLegend />}

      {loading && signals.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-lg bg-muted/20 animate-pulse h-28" />
          ))}
        </div>
      ) : displaySignals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <img src={biddieRobot} alt="Biddie" className="w-16 h-16 mb-3 opacity-40 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-500 drop-shadow-[0_0_12px_hsl(230_85%_60%_/_0.3)]" />
          <p className="text-sm font-semibold text-foreground">No Signals Right Now</p>
          <p className="text-xs text-muted-foreground mt-1">Biddie scans for setups during market hours (9:30 AM – 4 PM ET)</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displaySignals.map((signal, index) => {
            const score = signal.convictionScore ?? Math.round(signal.confidence * 10);
            const isExpanded = expandedIds.has(signal.id);
            const priceInfo = getPrice?.(signal.ticker);
            const categoryLabel = signal.category === "whale" ? "WHALE PLAY" : signal.category === "spread" ? "SPREAD PLAY" : "TOP SIGNAL";
            const catColor = signal.category === "whale" ? "text-blue-400" : signal.category === "spread" ? "text-violet-400" : "text-emerald-400";
            const hasDetails = signal.pricePattern || signal.gammaZone || signal.spreadDetails;

            const isWhaleCard = signal.category === "whale";
            const isSpreadCard = signal.category === "spread";
            const isCall = signal.type === "bullish";
            const glowClass = signal.aiEvaluated
              ? "shadow-[0_0_12px_-3px_rgba(16,185,129,0.35)] border-emerald-400/50"
              : isWhaleCard
              ? score >= 85
                ? "shadow-[0_0_10px_-3px_rgba(59,130,246,0.3)] border-blue-500/35"
                : "border-blue-500/25"
              : isSpreadCard
              ? score >= 85
                ? "shadow-[0_0_10px_-3px_rgba(139,92,246,0.3)] border-violet-500/35"
                : "border-violet-500/25"
              : score >= 85
              ? "shadow-[0_0_10px_-3px_hsl(var(--primary)/0.3)] border-primary/35"
              : score >= 70
              ? "border-primary/25"
              : isCall
              ? "border-primary/20"
              : "border-destructive/20";

            const bgClass = isWhaleCard ? "bg-blue-500/5" : isSpreadCard ? "bg-violet-500/5" : isCall ? "bg-primary/5" : "bg-destructive/5";

            const is0DTE = (() => {
              if (!signal.expiry) return false;
              const exp = new Date(signal.expiry);
              return !isNaN(exp.getTime()) && exp.toISOString().split("T")[0] === new Date().toISOString().split("T")[0];
            })();
            const mfe = signal.mfePercent ?? null;
            const showBuyNow = score >= 80 && !is0DTE && (mfe == null || mfe < 70);
            const showMoveOver = !is0DTE && mfe != null && mfe >= 70;

            return (
              <motion.div
                key={signal.id}
                custom={index}
                initial="hidden"
                animate="visible"
                variants={cardVariants}
                className={`rounded-xl border overflow-visible transition-all ${glowClass} ${bgClass}`}
              >
                {(() => {
                  try {
                    if (!signal.createdAt) return null;
                    const signalDate = new Date(signal.createdAt);
                    if (isNaN(signalDate.getTime())) return null;
                    const todayStr = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
                    const signalStr = signalDate.toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
                    if (signalStr >= todayStr) return null;
                    const dayName = signalDate.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
                    const dateStr = signalDate.toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "America/New_York" });
                    return (
                      <div className="px-4 py-1 bg-amber-500/15 border-b border-amber-500/20 flex items-center gap-2">
                        <Clock className="h-3 w-3 text-amber-400" />
                        <span className="text-[9px] font-bold tracking-widest text-amber-400 uppercase">Signal from {dayName} {dateStr}</span>
                      </div>
                    );
                  } catch { return null; }
                })()}
                {signal.priceConfirmed && (
                  <div className="px-4 py-1 bg-emerald-500/15 border-b border-emerald-500/20 flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    <span className="text-[9px] font-bold tracking-widest text-emerald-400 uppercase">
                      Price Confirmed
                    </span>
                    {signal.gammaZone && signal.gammaZone !== 'neutral' && (
                      <>
                        <Flame className="h-3 w-3 text-orange-400 animate-pulse" />
                        <span className="text-[9px] font-bold tracking-widest text-orange-400 uppercase">
                          ACT NOW
                        </span>
                      </>
                    )}
                  </div>
                )}

                <div className={`px-3 sm:px-4 py-2 flex items-center justify-between ${
                  isWhaleCard ? "bg-blue-500/15" : isSpreadCard ? "bg-violet-500/15" : "bg-emerald-500/15"
                }`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    {signal.category === "whale" ? (
                      <Waves className="h-3 w-3 text-blue-400" />
                    ) : signal.category === "spread" ? (
                      <Target className="h-3 w-3 text-violet-400" />
                    ) : (
                      <Zap className="h-3 w-3 text-emerald-400" />
                    )}
                    <span className={`text-[11px] font-bold tracking-widest uppercase ${catColor}`}>
                      {categoryLabel}
                    </span>
                    {is0DTE ? (
                      <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider">Day Trade</span>
                    ) : (
                      <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing Trade</span>
                    )}
                    {showMoveOver ? (
                      <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-orange-500/20 text-orange-400 uppercase tracking-wider">Move Almost Over</span>
                    ) : showBuyNow ? (
                      <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider animate-pulse">Buy Now</span>
                    ) : null}
                    {signal.aiEvaluated && (
                      <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-emerald-500/30 text-emerald-300 uppercase tracking-wider animate-pulse border border-emerald-400/30">
                        Biddie Pick
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {priceInfo && (
                      <span className="flex items-center gap-1 text-xs font-mono">
                        <Radio className="h-2.5 w-2.5 text-emerald-400 animate-pulse" />
                        <span className="text-foreground font-semibold">${priceInfo.price.toFixed(2)}</span>
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {signal.timestamp}
                    </span>
                  </div>
                </div>

                <div className="px-4 py-3 space-y-3">

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        {signal.type === "bullish" ? (
                          <TrendingUp className="h-5 w-5 text-primary" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-destructive" />
                        )}
                        <span className="font-bold text-foreground text-lg tracking-tight">{signal.ticker}</span>
                        <span
                          className={`inline-flex items-center h-5 text-[10px] font-bold uppercase px-2 rounded-full ${
                            signal.putCall === "put"
                              ? "bg-destructive/20 text-destructive"
                              : "bg-primary/20 text-primary"
                          }`}
                        >
                          {signal.putCall === "call" ? "CALL" : signal.putCall === "put" ? "PUT" : signal.type?.toUpperCase()}
                        </span>
                        {signal.timeframe === "buy_now" || signal.timeframe === "short_term" ? (
                          <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-amber-500/20 text-amber-400 uppercase tracking-wider">0DTE</span>
                        ) : signal.timeframe === "swing" ? (
                          <span className="inline-flex items-center h-5 text-[10px] font-bold px-2 rounded-full bg-blue-500/20 text-blue-400 uppercase tracking-wider">Swing</span>
                        ) : null}
                        {(() => {
                          let ts = signal.tradeStatus || "watching";
                          if (ts === "watching") {
                            if (signal.outcome === "hit" || signal.outcome === "win") ts = "hit";
                            else if (signal.outcome === "partial_hit") ts = "partial";
                            else if (signal.outcome === "near_miss") ts = "near_miss";
                            else if (signal.outcome === "missed" || signal.outcome === "loss") ts = "miss";
                            else if (signal.outcome === "expired") ts = "expired";
                          }
                          const statusInfo: Record<string, { label: string; desc: string; color: string; icon: React.ReactNode }> = {
                            hit: { label: "WIN", desc: "Price reached 75%+ of the target — full hit, real profit opportunity", color: "text-emerald-400 bg-emerald-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                            partial: { label: "WIN", desc: "Price moved 50-74% toward target — partial hit, tradeable and counts as a win", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                            partial_hit: { label: "WIN", desc: "Price moved 50-74% toward target — partial hit, tradeable and counts as a win", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                            near_miss: { label: "LOSS", desc: "Price moved 30-49% toward target — right idea but below 50% threshold", color: "text-orange-400 bg-orange-400/15", icon: <Target className="h-3 w-3" /> },
                            miss: { label: "LOSS", desc: "Signal didn't produce a tradeable move — MFE below 50% or invalidation breached", color: "text-red-400 bg-red-400/15", icon: <XCircle className="h-3 w-3" /> },
                            expired: { label: "EXPIRED", desc: "Time ran out before the signal played out", color: "text-red-400 bg-red-400/15", icon: <XCircle className="h-3 w-3" /> },
                            active: { label: "ACTIVE", desc: "We're in! The price hit our entry — this trade is live right now", color: "text-cyan-400 bg-cyan-400/15 animate-pulse", icon: <Zap className="h-3 w-3" /> },
                            watching: { label: "WATCHING", desc: "Waiting for the price to come to us — like fishing, we don't chase!", color: "text-yellow-400 bg-yellow-400/15", icon: <Clock className="h-3 w-3" /> },
                          };
                          const info = statusInfo[ts] || statusInfo.watching;
                          return (
                            <span className="relative group inline-flex">
                              <span className={`inline-flex items-center gap-0.5 h-5 text-[10px] font-bold px-2 rounded-full cursor-help ${info.color}`}>
                                {info.icon} {info.label}
                              </span>
                              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                                {info.desc}
                              </span>
                            </span>
                          );
                        })()}
                        {signal.mfePercent != null && (
                          <span className="relative group inline-flex">
                            <span className={`inline-flex items-center gap-1 h-5 text-[10px] font-bold px-2 rounded-full cursor-help ${
                              signal.mfePercent >= 75 ? "bg-emerald-400/15 text-emerald-400" :
                              signal.mfePercent >= 50 ? "bg-blue-400/15 text-blue-400" :
                              signal.mfePercent >= 30 ? "bg-orange-400/15 text-orange-400" :
                              "bg-red-400/15 text-red-400"
                            }`}>
                              MFE {signal.mfePercent.toFixed(0)}%
                              <span className="opacity-70">
                                {signal.mfePercent >= 75 ? "HIT" :
                                 signal.mfePercent >= 50 ? "PARTIAL" :
                                 signal.mfePercent >= 30 ? "NEAR" :
                                 "MISS"}
                              </span>
                            </span>
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg max-w-[200px] text-wrap">
                              {signal.mfePercent >= 75 ? "Full hit — price reached 75%+ of target" :
                               signal.mfePercent >= 50 ? "Partial hit — 50-74% of target, tradeable" :
                               signal.mfePercent >= 30 ? "Near miss — 30-49% of target, right idea" :
                               "Miss — below 30% of target"}
                              {signal.maxFavorablePrice ? ` (best: $${signal.maxFavorablePrice.toFixed(2)})` : ""}
                            </span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-1.5">
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">
                          {compactDescription(signal)}
                        </p>
                        {signal.description && (
                          <div className="mt-0.5">
                            <BeginnerTooltip content={simplifySignalDescription(signal)} maxWidth={300} />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <ConvictionScoreRing
                        score={score}
                        label={signal.convictionLabel ?? ""}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {signal.suggestedTrade && (
                      <div className="flex items-center gap-1.5 bg-muted/30 rounded-lg px-3 py-1.5 text-xs">
                        <Target className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-muted-foreground">Trade:</span>
                        <span className="text-foreground font-semibold">{signal.suggestedTrade}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-1.5 bg-muted/20 rounded-lg px-3 py-1.5 text-xs">
                        <TrendingUp className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="text-muted-foreground">Entry: </span>
                          <span className={`font-semibold ${signal.entryTrigger ? 'text-foreground' : 'text-muted-foreground/60 italic'}`}>{signal.entryTrigger || 'Level data not available'}</span>
                        </div>
                      </div>
                    <div className="flex items-center gap-1.5 bg-primary/10 rounded-lg px-3 py-1.5 text-xs">
                        <MapPin className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-muted-foreground">Target:</span>
                        {signal.targetZone ? (() => {
                          const tn = signal.targetNear;
                          const tz = signal.targetZone;
                          if (!tn || tn === tz) return <span className="text-primary font-semibold">{tz}</span>;
                          const tzVal = parseFloat((tz || '').replace(/[^0-9.]/g, '')) || 0;
                          const tnVal = parseFloat((tn || '').replace(/[^0-9.]/g, '')) || 0;
                          const isCall = signal.putCall === 'call' || signal.type === 'bullish';
                          const first = isCall ? (tzVal < tnVal ? tz : tn) : (tzVal > tnVal ? tz : tn);
                          const second = isCall ? (tzVal < tnVal ? tn : tz) : (tzVal > tnVal ? tn : tz);
                          const firstLabel = first === tz ? "Strike target" : "Extended target";
                          const secondLabel = second === tz ? "Strike target" : "Extended target";
                          return (
                            <>
                              <span className="text-primary font-semibold">{first} – {second}</span>
                              <span className="relative group">
                                <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-primary/20 text-primary text-[8px] font-bold cursor-help">i</span>
                                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                                  {first}: {firstLabel} · {second}: {secondLabel}
                                </span>
                              </span>
                            </>
                          );
                        })() : <span className="text-muted-foreground/60 italic font-semibold">Level data not available</span>}
                      </div>
                    <div className="flex items-center gap-1.5 bg-destructive/10 rounded-lg px-3 py-1.5 text-xs">
                        <ShieldX className="h-3 w-3 text-destructive shrink-0" />
                        <span className="text-muted-foreground">Invalidation:</span>
                        <span className={`font-semibold ${signal.invalidation ? 'text-destructive' : 'text-muted-foreground/60 italic'}`}>{signal.invalidation || 'Level data not available'}</span>
                      </div>
                    <div className="flex items-center gap-1.5 bg-primary/10 rounded-lg px-3 py-1.5 text-xs">
                        <Crosshair className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-muted-foreground">Key level:</span>
                        <span className={`font-semibold ${signal.keyLevel ? 'text-primary' : 'text-muted-foreground/60 italic'}`}>{signal.keyLevel || 'Level data not available'}</span>
                      </div>
                    <div className="flex items-center gap-1.5 bg-accent/10 rounded-lg px-3 py-1.5 text-xs">
                        <Gauge className="h-3 w-3 text-accent shrink-0" />
                        <span className="text-muted-foreground">S/R:</span>
                        <span className={`font-semibold ${signal.srLevel ? 'text-accent' : 'text-muted-foreground/60 italic'}`}>{signal.srLevel || 'Level data not available'}</span>
                      </div>
                  </div>

                  {hasDetails && (
                    <>
                      <button
                        onClick={() => toggleExpanded(signal.id)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden space-y-1.5"
                          >
                            {signal.pricePattern && (
                              <div className="flex items-start gap-2 bg-emerald-500/10 rounded-lg px-3 py-1.5 text-xs">
                                <CheckCircle2 className="h-3 w-3 text-emerald-400 mt-0.5 shrink-0" />
                                <span className="text-muted-foreground">Pattern: </span>
                                <span className="text-emerald-400 font-semibold">{signal.pricePattern}</span>
                              </div>
                            )}

                            {signal.spreadDetails && (
                              <div className="flex items-start gap-2 bg-violet-500/10 rounded-lg px-3 py-1.5 text-xs">
                                <Target className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
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
                              <div className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-xs ${
                                signal.gammaZone === 'negative' ? 'bg-orange-500/10' : 'bg-blue-500/10'
                              }`}>
                                <Gauge className={`h-3 w-3 mt-0.5 shrink-0 ${
                                  signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                                }`} />
                                <div>
                                  <span className="text-muted-foreground">Gamma: </span>
                                  <span className={`font-semibold ${
                                    signal.gammaZone === 'negative' ? 'text-orange-400' : 'text-blue-400'
                                  }`}>
                                    {signal.gammaZone === 'negative' ? 'Negative' : 'Positive'} — {signal.gammaDescription}
                                  </span>
                                </div>
                              </div>
                            )}

                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
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
                    </div>

                    {onTakeTrade && (
                      <button
                        onClick={() => onTakeTrade(signal)}
                        disabled={takingId === signal.id}
                        className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all shrink-0 ${
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
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SignalFeedPanel;
