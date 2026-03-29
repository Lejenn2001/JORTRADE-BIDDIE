import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, TrendingUp, TrendingDown, Gauge, BarChart3,
  Info, Flame, Shield, Zap, ArrowUpRight, ArrowDownRight,
  Loader2, ChevronDown, ChevronUp, HelpCircle
} from "lucide-react";
import BeginnerTooltip from "./BeginnerTooltip";

interface MarketPulseData {
  timestamp: string;
  marketOpen: boolean;
  indices: {
    SPY: { price: number; changePercent: number } | null;
    QQQ: { price: number; changePercent: number } | null;
    IWM: { price: number; changePercent: number } | null;
  };
  vix: {
    price: number | null;
    change: number | null;
    level: string;
    description: string;
  };
  sentiment: {
    putCallRatio: number;
    label: string;
    description: string;
    totalCallPremium: number;
    totalPutPremium: number;
    sweepCount: number;
    callSweeps: number;
    putSweeps: number;
  };
  trending: {
    ticker: string;
    alerts: number;
    totalPremium: number;
    callPremium: number;
    putPremium: number;
    sweeps: number;
    bias: string;
  }[];
}

const formatPremium = (val: number) => {
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
};

const vixColorMap: Record<string, string> = {
  "Very Calm": "text-emerald-400 bg-emerald-500/20",
  Normal: "text-blue-400 bg-blue-500/20",
  Nervous: "text-amber-400 bg-amber-500/20",
  Fear: "text-orange-400 bg-orange-500/20",
  Panic: "text-red-400 bg-red-500/20",
  Unknown: "text-muted-foreground bg-muted/30",
};

const sentimentColorMap: Record<string, string> = {
  "Very Bullish": "text-emerald-400 bg-emerald-500/20",
  "Bullish": "text-emerald-400 bg-emerald-500/20",
  "Neutral": "text-blue-400 bg-blue-500/20",
  "Bearish": "text-red-400 bg-red-500/20",
  "Very Bearish": "text-red-400 bg-red-500/20",
  "Unavailable": "text-muted-foreground bg-muted/30",
};

const MarketPulse = () => {
  const [data, setData] = useState<MarketPulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedTip, setExpandedTip] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetch("/api/whale/market-pulse");
        if (resp.ok) {
          setData(await resp.json());
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      }
      setLoading(false);
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="glass-panel rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary animate-pulse" />
          <span className="text-sm font-semibold text-primary">Market Pulse</span>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="glass-panel rounded-xl p-4 border border-white/10">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Market Pulse</span>
        </div>
        <p className="text-xs text-muted-foreground">Unable to load market data. Will retry automatically.</p>
      </div>
    );
  }

  if (!data) return null;

  const toggleTip = (key: string) => {
    setExpandedTip(prev => prev === key ? null : key);
  };

  return (
    <div className="glass-panel rounded-xl p-4 border border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Market Pulse</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${data.marketOpen ? "bg-emerald-500/20 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
          {data.marketOpen ? "Market Open" : "After Hours"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(["SPY", "QQQ", "IWM"] as const).map(ticker => {
          const d = data.indices[ticker];
          if (!d) return (
            <div key={ticker} className="bg-muted/20 rounded-lg px-3 py-2 text-center">
              <span className="text-[10px] text-muted-foreground block">{ticker}</span>
              <span className="text-xs text-muted-foreground">—</span>
            </div>
          );
          const isUp = d.changePercent >= 0;
          return (
            <div key={ticker} className={`rounded-lg px-3 py-2 text-center border ${isUp ? "bg-emerald-500/8 border-indigo-400/30" : "bg-white/[0.04] border-violet-400/30"}`}>
              <span className="text-[10px] text-muted-foreground block">{ticker}</span>
              <span className="text-sm font-bold text-foreground">${d.price.toFixed(2)}</span>
              <div className={`flex items-center justify-center gap-0.5 text-[10px] font-semibold ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                {isUp ? "+" : ""}{d.changePercent?.toFixed(2) ?? "0.00"}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="rounded-lg px-3 py-2.5 bg-muted/20 text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Volatility (VIX)</span>
              </div>
              <BeginnerTooltip
                content="The VIX is like a fear meter for the market. When it's low, everything is calm. When it's high, things get wild and scary. Low = safe to play bigger. High = be careful and play small!"
                maxWidth={260}
              />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-foreground">
                {data.vix.price?.toFixed(2) ?? "—"}
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${vixColorMap[data.vix.level] || vixColorMap.Unknown}`}>
                {data.vix.level}
              </span>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-muted/10">
            <p className="text-[10px] text-foreground/70 leading-relaxed">
              {data.vix.description}
            </p>
          </div>
          <button
            onClick={() => toggleTip("vix")}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-3"
          >
            {expandedTip === "vix" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expandedTip === "vix" ? "Hide levels" : "View VIX levels"}
          </button>
          <AnimatePresence>
            {expandedTip === "vix" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 bg-muted/10 rounded-lg border border-white/5 space-y-0.5">
                  <p className="text-[10px] leading-relaxed"><span className="text-emerald-400 font-bold">10–15:</span> <span className="text-foreground/70">Very low volatility — favorable for position sizing up.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-blue-400 font-bold">15–20:</span> <span className="text-foreground/70">Normal range — standard risk parameters.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-amber-400 font-bold">20–30:</span> <span className="text-foreground/70">Elevated — reduce size, widen stops.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-orange-400 font-bold">30–40:</span> <span className="text-foreground/70">High fear — minimal exposure, quick scalps only.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">40+:</span> <span className="text-foreground/70">Extreme — consider sitting out or hedging only.</span></p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-1">
          <div className="rounded-lg px-3 py-2.5 bg-muted/20 text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Put/Call Ratio</span>
              </div>
              <BeginnerTooltip
                content="Think of it like a classroom vote. Calls = kids voting prices go UP, Puts = kids voting prices go DOWN. This number tells you which side has more votes. Below 1.0 = more bullish votes. Above 1.0 = more bearish votes!"
                maxWidth={260}
              />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-foreground">
                {data.sentiment.putCallRatio.toFixed(2)}
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${sentimentColorMap[data.sentiment.label] || "text-muted-foreground bg-muted/30"}`}>
                {data.sentiment.label}
              </span>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-muted/10">
            <p className="text-[10px] text-foreground/70 leading-relaxed">
              {data.sentiment.description} Put premium: {formatPremium(data.sentiment.totalPutPremium)} vs Call premium: {formatPremium(data.sentiment.totalCallPremium)}. Sweeps: {data.sentiment.sweepCount} total ({data.sentiment.callSweeps} call / {data.sentiment.putSweeps} put).
            </p>
          </div>
          <button
            onClick={() => toggleTip("sentiment")}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-3"
          >
            {expandedTip === "sentiment" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expandedTip === "sentiment" ? "Hide levels" : "View P/C levels"}
          </button>
          <AnimatePresence>
            {expandedTip === "sentiment" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 bg-muted/10 rounded-lg border border-white/5 space-y-0.5">
                  <p className="text-[10px] leading-relaxed"><span className="text-emerald-400 font-bold">Below 0.7:</span> <span className="text-foreground/70">Very bullish — heavy call skew, strong upside conviction.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-emerald-400 font-bold">0.7–0.9:</span> <span className="text-foreground/70">Bullish — call premium dominates, favorable bias.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-blue-400 font-bold">0.9–1.1:</span> <span className="text-foreground/70">Neutral — balanced flow, no clear directional edge.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">1.1–1.3:</span> <span className="text-foreground/70">Bearish — put premium elevated, hedging activity rising.</span></p>
                  <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">Above 1.3:</span> <span className="text-foreground/70">Very bearish — heavy put skew, significant downside protection.</span></p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

    </div>
  );
};

export default MarketPulse;
