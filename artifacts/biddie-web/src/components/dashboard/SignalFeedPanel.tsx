import { useState } from "react";
import { Activity, TrendingUp, TrendingDown, Clock, Target, Zap, CheckCircle2, Flame, Waves, ChevronDown, XCircle, HelpCircle, Sparkles, Gauge } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { MarketSignal } from "@/hooks/useMarketData";
import type { PriceInfo, PriceSourceLabel } from "@/hooks/useRealtimePrices";
import SignalLegend from "./SignalLegend";
import ConvictionScoreRing from "./ConvictionScoreRing";
import { simplifySignalDescription } from "@/lib/simplifyDescription";
import biddieRobot from "@/assets/biddie-robot.png";

// P2: freshness dot — single visual that reflects the unified source label
// served by /api/whale/prices/realtime (LivePriceService).
//   live  = green  (WS update within 60s — real-time tape)
//   rest  = amber  (REST snapshot, or WS lagging 60–120s — degraded)
//   stale = gray   (>120s old or never received — do not trust)
//   anything else (missing field, legacy "ws"/"snapshot" values from a stale
//   payload during a rolling restart, future label additions) → neutral dot.
//   Lookup is hardened: we ONLY accept the three known labels and fall through
//   to DOT_UNKNOWN otherwise. Without this guard, a legacy value like "ws"
//   would index `SOURCE_DOT["ws" as any]` to undefined and crash on `dot.tip`.
const SOURCE_DOT: Record<PriceSourceLabel, { cls: string; tip: string }> = {
  live:  { cls: "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.7)]", tip: "Live (WS, <60s)" },
  rest:  { cls: "bg-amber-400",                                          tip: "REST snapshot (degraded)" },
  stale: { cls: "bg-zinc-500",                                           tip: "Stale (>120s)" },
};
const DOT_UNKNOWN = { cls: "bg-zinc-600", tip: "Unknown source" };
const KNOWN_SOURCES: ReadonlySet<string> = new Set<PriceSourceLabel>(["live", "rest", "stale"]);
const sourceDot = (src: string | undefined): { cls: string; tip: string } =>
  (src && KNOWN_SOURCES.has(src)) ? SOURCE_DOT[src as PriceSourceLabel] : DOT_UNKNOWN;

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const fmtExpiry = (e?: string) => {
  if (!e) return "";
  const d = new Date(e);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  }
  return e;
};

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

const SignalFeedPanel = ({ signals, loading, limit, title, subtitle, icon, getPrice }: Props) => {
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
            const hasDetails = signal.pricePattern || signal.gammaZone || signal.spreadDetails;

            const bull = signal.type === "bullish";
            const accent = bull
              ? "bg-emerald-400/80 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
              : "bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.5)]";
            const flowColor = bull ? "text-emerald-400" : "text-rose-400";
            const flowLabel = signal.putCall === "put" ? "PUT FLOW" : "CALL FLOW";

            const is0DTE = (() => {
              if (!signal.expiry) return false;
              const exp = new Date(signal.expiry);
              return !isNaN(exp.getTime()) && exp.toISOString().split("T")[0] === new Date().toISOString().split("T")[0];
            })();
            const mfe = signal.mfePercent ?? null;
            const showBuyNow = score >= 80 && !is0DTE && (mfe == null || mfe < 70);
            const showMoveOver = !is0DTE && mfe != null && mfe >= 70;

            const contractLine = (() => {
              const parts = [
                fmtExpiry(signal.expiry),
                signal.strike ? `$${signal.strike}` : "",
                signal.putCall === "put" ? "Puts" : signal.putCall === "call" ? "Calls" : "",
              ].filter(Boolean);
              if (parts.length > 0) return parts.join(" ");
              return signal.suggestedTrade || "";
            })();

            const levelRows: { label: string; value: string; tone?: "flow" | "bad" }[] = [];
            if (signal.entryTrigger) levelRows.push({ label: "Entry", value: signal.entryTrigger });
            if (signal.targetZone) {
              const tn = signal.targetNear;
              const tz = signal.targetZone;
              levelRows.push({ label: "Target", value: tn && tn !== tz ? `${tn} – ${tz}` : tz, tone: "flow" });
            }
            if (signal.keyLevel) levelRows.push({ label: "Key level", value: signal.keyLevel });
            if (signal.srLevel) levelRows.push({ label: "S/R", value: signal.srLevel });
            if (signal.invalidation) levelRows.push({ label: "Invalidation", value: signal.invalidation, tone: "bad" });

            const biddieParagraphs = simplifySignalDescription(signal).split("\n\n").filter(Boolean);

            return (
              <motion.div
                key={signal.id}
                custom={index}
                initial="hidden"
                animate="visible"
                variants={cardVariants}
                className="group relative overflow-hidden rounded-2xl border border-[hsl(230_85%_62%/0.16)] bg-gradient-to-b from-[hsl(230_70%_55%/0.09)] via-white/[0.012] to-[hsl(232_40%_20%/0.04)] shadow-[0_8px_30px_-14px_rgba(0,0,0,0.9),inset_0_0_20px_hsl(230_85%_60%/0.05),0_0_24px_-10px_hsl(230_85%_60%/0.38),inset_0_1px_0_0_hsl(230_90%_72%/0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[hsl(230_85%_62%/0.28)] hover:shadow-[0_14px_38px_-12px_rgba(0,0,0,0.95),inset_0_0_24px_hsl(230_85%_60%/0.08),0_0_34px_-8px_hsl(230_85%_60%/0.55),inset_0_1px_0_0_hsl(230_90%_72%/0.18)]"
              >
                {/* Banner: signal from a previous day */}
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
                {/* Banner: price confirmed / act now */}
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

                <div className="relative px-4 py-3.5">
                  <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full ${accent}`} />

                  <div className="pl-2.5">
                    {/* Header: ticker + put/call (left) · live price + time (right) */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {bull
                          ? <TrendingUp className="h-4 w-4 text-emerald-400 shrink-0" />
                          : <TrendingDown className="h-4 w-4 text-rose-400 shrink-0" />}
                        <span className="text-base font-bold tracking-tight text-foreground">{signal.ticker}</span>
                        <span className={`inline-flex items-center h-5 text-[10px] font-bold uppercase px-2 rounded-full ${
                          signal.putCall === "put" ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"
                        }`}>
                          {signal.putCall === "call" ? "CALL" : signal.putCall === "put" ? "PUT" : signal.type?.toUpperCase()}
                        </span>
                      </div>
                      <span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                        {priceInfo && (() => {
                          const dot = sourceDot(priceInfo.source);
                          const ageLabel = `${Math.max(0, Math.round(priceInfo.age))}s ago`;
                          return (
                            <span className="flex items-center gap-1 text-[12px] font-semibold text-foreground" title={`${dot.tip} · last update ${ageLabel}`}>
                              <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot.cls}`} aria-label={dot.tip} />
                              ${priceInfo.price.toFixed(2)}
                            </span>
                          );
                        })()}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {signal.timestamp}
                        </span>
                      </span>
                    </div>

                    {/* Flow label (left) · win/loss status (right) */}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${flowColor}`}>
                        {flowLabel}
                      </span>
                      {(() => {
                        let ts: string = signal.tradeStatus || "watching";
                        const o: string | null | undefined = signal.outcome;
                        const isExpired = signal.expiry ? new Date(signal.expiry) < new Date() : false;
                        const m = signal.mfePercent ?? 0;
                        if (o === "hit" || o === "win") ts = "hit";
                        else if (o === "partial_hit") ts = "partial";
                        else if (o === "near_miss") ts = "near_miss";
                        else if (o === "missed" || o === "loss") ts = "miss";
                        else if (o === "expired") ts = "expired";
                        if (isExpired && m >= 50) {
                          if (m >= 75) ts = "hit";
                          else ts = "partial";
                        } else if (isExpired && !o && m >= 30) {
                          ts = "near_miss";
                        } else if (isExpired && !o && m < 30) {
                          ts = "miss";
                        }
                        const statusInfo: Record<string, { label: string; desc: string; color: string; icon: React.ReactNode }> = {
                          hit: { label: "WIN", desc: "Price reached 75%+ of the target — full hit, real profit opportunity", color: "text-emerald-400 bg-emerald-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                          partial: { label: "WIN", desc: "Price moved 50-74% toward target — partial hit, tradeable and counts as a win", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                          partial_hit: { label: "WIN", desc: "Price moved 50-74% toward target — partial hit, tradeable and counts as a win", color: "text-blue-400 bg-blue-400/15", icon: <CheckCircle2 className="h-3 w-3" /> },
                          near_miss: { label: "LOSS", desc: "Price moved 30-49% toward target — right idea but below 50% threshold", color: "text-orange-400 bg-orange-400/15", icon: <Target className="h-3 w-3" /> },
                          miss: { label: "LOSS", desc: "Signal didn't produce a tradeable move — MFE below 50% or invalidation breached", color: "text-red-400 bg-red-400/15", icon: <XCircle className="h-3 w-3" /> },
                          expired: { label: "EXPIRED", desc: "Time ran out before the signal played out", color: "text-red-400 bg-red-400/15", icon: <XCircle className="h-3 w-3" /> },
                          active: { label: "ACTIVE", desc: "We're in! The price hit our entry — this trade is live right now", color: "text-cyan-400 bg-cyan-400/15 animate-pulse", icon: <Zap className="h-3 w-3" /> },
                          ran_without_entry: { label: "RAN WITHOUT ENTRY", desc: "Price moved 15%+ toward target but never hit our entry — the trade ran without us", color: "text-amber-400 bg-amber-400/15", icon: <Target className="h-3 w-3" /> },
                          watching: { label: "WATCHING", desc: "Waiting for the price to come to us — like fishing, we don't chase!", color: "text-yellow-400 bg-yellow-400/15", icon: <Clock className="h-3 w-3" /> },
                        };
                        const info = statusInfo[ts] || statusInfo.watching;
                        return (
                          <span className="relative group/status inline-flex shrink-0">
                            <span className={`inline-flex items-center gap-0.5 h-5 text-[10px] font-bold px-2 rounded-full cursor-help ${info.color}`}>
                              {info.icon} {info.label}
                            </span>
                            <span className="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground w-48 text-wrap opacity-0 group-hover/status:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg leading-relaxed">
                              {info.desc}
                            </span>
                          </span>
                        );
                      })()}
                    </div>

                    {/* Secondary pills (kept) */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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

                    {/* Contract + premium */}
                    {contractLine && (
                      <div className="mt-1.5">
                        <div className="text-[13px] font-semibold text-foreground">{contractLine}</div>
                        {signal.premium && <div className="text-[12px] text-muted-foreground">{signal.premium} Premium</div>}
                      </div>
                    )}

                    {/* Levels */}
                    {levelRows.length > 0 && (
                      <>
                        <div className="my-3 border-t border-white/10" />
                        <div className="space-y-1.5 text-[12px]">
                          {levelRows.map((lvl, i) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground shrink-0">{lvl.label}</span>
                              <span className={`font-semibold text-right ${lvl.tone === "flow" ? flowColor : lvl.tone === "bad" ? "text-destructive" : "text-foreground"}`}>{lvl.value}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Divider */}
                    <div className="my-3 border-t border-white/10" />

                    {/* Biddie toggle (left) · reinforcement + MFE + conviction ring (right) */}
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => toggleExpanded(signal.id)}
                        aria-label="Biddie's take"
                        className="flex shrink-0 items-center gap-1.5 text-left"
                      >
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/20">
                          <Sparkles className="h-2.5 w-2.5 text-primary" />
                        </span>
                        <span className="text-[11px] font-bold text-primary">Biddie</span>
                        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {(signal.reinforcementCount ?? 0) > 1 && (
                          <span className="inline-flex shrink-0 items-center gap-1 h-5 rounded-full bg-emerald-400/15 px-2 text-[10px] font-bold text-emerald-300" title="How many times buyers have re-added to this position">
                            <TrendingUp className="h-3 w-3" /> {ordinal(signal.reinforcementCount!)} reinforcement
                          </span>
                        )}
                        {signal.mfePercent != null && (() => {
                          const oc: string | null | undefined = signal.outcome;
                          const isResolved = oc === "hit" || oc === "win" || oc === "partial_hit" || oc === "near_miss" || oc === "missed" || oc === "loss" || oc === "expired";
                          const isExpiredDate = signal.expiry ? new Date(signal.expiry) < new Date() : false;
                          const isDone = isResolved || isExpiredDate;
                          return (
                            <span className="relative group/mfe inline-flex">
                              <span className={`inline-flex items-center gap-1 h-5 text-[10px] font-bold px-2 rounded-full cursor-help ${
                                signal.mfePercent >= 75 ? "bg-emerald-400/15 text-emerald-400" :
                                signal.mfePercent >= 50 ? "bg-blue-400/15 text-blue-400" :
                                signal.mfePercent >= 30 ? "bg-orange-400/15 text-orange-400" :
                                isDone ? "bg-red-400/15 text-red-400" :
                                "bg-muted/20 text-muted-foreground"
                              }`}>
                                MFE {signal.mfePercent.toFixed(0)}%
                              </span>
                              <span className="absolute bottom-full right-0 mb-1.5 px-2.5 py-1.5 bg-popover border border-border rounded-md text-[10px] text-muted-foreground w-[200px] text-wrap opacity-0 group-hover/mfe:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg leading-relaxed">
                                {!isDone ? `Best move so far: ${signal.mfePercent.toFixed(0)}% of target — still active` :
                                 signal.mfePercent >= 75 ? "Full hit — price reached 75%+ of target" :
                                 signal.mfePercent >= 50 ? "Partial hit — 50-74% of target, tradeable" :
                                 signal.mfePercent >= 30 ? "Near miss — 30-49% of target, right idea" :
                                 "Miss — below 50% of target"}
                                {signal.maxFavorablePrice ? ` (best: $${signal.maxFavorablePrice.toFixed(2)})` : ""}
                              </span>
                            </span>
                          );
                        })()}
                        <ConvictionScoreRing
                          score={score}
                          label={signal.convictionLabel ?? ""}
                        />
                      </div>
                    </div>

                    {/* Expanded: Biddie's take + details + tags */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 space-y-2">
                            {biddieParagraphs.map((p, i) => (
                              <p key={i} className="text-[12px] text-foreground/75 leading-relaxed">{p}</p>
                            ))}
                          </div>

                          {hasDetails && (
                            <div className="mt-2 space-y-1.5">
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
                            </div>
                          )}

                          {signal.tags.filter((tag) => {
                            const upper = tag.toUpperCase();
                            if (upper.includes('ACT NOW') && !(signal.priceConfirmed && signal.gammaZone && signal.gammaZone !== 'neutral')) return false;
                            return true;
                          }).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
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
                                  <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${tagStyle}`}>
                                    {tag}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
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
