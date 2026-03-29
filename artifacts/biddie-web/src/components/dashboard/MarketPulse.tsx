import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, TrendingUp, TrendingDown, Gauge, BarChart3,
  Info, Flame, Shield, Zap, ArrowUpRight, ArrowDownRight,
  Loader2, ChevronDown, ChevronUp
} from "lucide-react";

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
  "Very Bullish": "text-emerald-400",
  "Bullish": "text-emerald-400",
  "Neutral": "text-blue-400",
  "Bearish": "text-red-400",
  "Very Bearish": "text-red-400",
  "Unavailable": "text-muted-foreground",
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
            <div key={ticker} className={`rounded-lg px-3 py-2 text-center ${isUp ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
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
          <button
            onClick={() => toggleTip("vix")}
            className="w-full rounded-lg px-3 py-2.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Volatility (VIX)</span>
              </div>
              <Info className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-foreground">
                {data.vix.price?.toFixed(2) ?? "—"}
              </span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${vixColorMap[data.vix.level] || vixColorMap.Unknown}`}>
                {data.vix.level}
              </span>
            </div>
          </button>
          <div className="px-3 py-1.5 rounded-lg bg-muted/10">
            <p className="text-[10px] text-foreground/70 leading-relaxed">
              {data.vix.description}
            </p>
          </div>
          <AnimatePresence>
            {expandedTip === "vix" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 bg-primary/5 rounded-lg border border-primary/10 space-y-1.5">
                  <p className="text-[10px] text-foreground/80 leading-relaxed">
                    The VIX is like a "fear meter" for the market — when it's low, everything is calm and easy, and when it's high, things get wild and scary. When the market falls, VIX usually goes up, meaning more fear and bigger, faster moves.
                  </p>
                  <div className="space-y-0.5">
                    <p className="text-[10px] leading-relaxed"><span className="text-emerald-400 font-bold">10–15 Very Calm:</span> <span className="text-foreground/70">Market is smooth — size up, nothing crazy happening.</span></p>
                    <p className="text-[10px] leading-relaxed"><span className="text-blue-400 font-bold">15–20 Normal:</span> <span className="text-foreground/70">Regular day — play normal size.</span></p>
                    <p className="text-[10px] leading-relaxed"><span className="text-amber-400 font-bold">20–30 Nervous:</span> <span className="text-foreground/70">Getting shaky — play smaller, be careful.</span></p>
                    <p className="text-[10px] leading-relaxed"><span className="text-orange-400 font-bold">30–40 Fear:</span> <span className="text-foreground/70">Jumpy and fast — play small, no big risks.</span></p>
                    <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">40+ Panic:</span> <span className="text-foreground/70">Chaos — play very small or don't play at all.</span></p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-1">
          <button
            onClick={() => toggleTip("sentiment")}
            className="w-full rounded-lg px-3 py-2.5 bg-muted/20 hover:bg-muted/30 transition-colors text-left"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Put/Call Ratio</span>
              </div>
              <Info className="h-3 w-3 text-muted-foreground/50" />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-foreground">
                {data.sentiment.putCallRatio.toFixed(2)}
              </span>
              <span className={`text-[9px] font-bold ${sentimentColorMap[data.sentiment.label] || "text-muted-foreground"}`}>
                {data.sentiment.label}
              </span>
            </div>
          </button>
          <div className="px-3 py-1.5 rounded-lg bg-muted/10">
            <p className="text-[10px] text-foreground/70 leading-relaxed">
              {data.sentiment.description} Right now {formatPremium(data.sentiment.totalPutPremium)} is betting prices go DOWN vs {formatPremium(data.sentiment.totalCallPremium)} betting they go UP. Out of {data.sentiment.sweepCount} urgent "rush" orders, {data.sentiment.callSweeps} are bullish and {data.sentiment.putSweeps} are bearish. The money and the urgency can tell different stories — watch both!
            </p>
          </div>
          <AnimatePresence>
            {expandedTip === "sentiment" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 bg-primary/5 rounded-lg border border-primary/10 space-y-2">
                  <div className="space-y-1">
                    <p className="text-[10px] text-foreground/80 leading-relaxed">
                      Imagine a classroom voting. Calls = kids voting "prices go UP!" and Puts = kids voting "prices go DOWN!" The Put/Call Ratio tells you which side has more votes.
                    </p>
                    <div className="space-y-0.5">
                      <p className="text-[10px] leading-relaxed"><span className="text-emerald-400 font-bold">Below 0.7 Very Bullish:</span> <span className="text-foreground/70">Almost everyone is voting UP — the class is super confident!</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-emerald-400 font-bold">0.7–0.9 Bullish:</span> <span className="text-foreground/70">More kids voting UP than DOWN — feeling good.</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-blue-400 font-bold">0.9–1.1 Neutral:</span> <span className="text-foreground/70">About half and half — nobody knows what's next.</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">1.1–1.3 Bearish:</span> <span className="text-foreground/70">More kids voting DOWN — getting worried.</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">Above 1.3 Very Bearish:</span> <span className="text-foreground/70">Almost everyone is voting DOWN — the class is scared!</span></p>
                    </div>
                  </div>
                  <div className="border-t border-primary/10 pt-1.5 space-y-1">
                    <p className="text-[10px] text-foreground/80 leading-relaxed">
                      <span className="text-primary font-bold">Money vs Rush Orders:</span> Think of it like this — the MONEY (premium) shows you who brought the most lunch money to bet. The SWEEPS show you who is running to place their bet first. Sometimes the kid with the most money bets DOWN, but the kids rushing to the front are all betting UP — that's why you watch both!
                    </p>
                  </div>
                  <div className="border-t border-primary/10 pt-1.5">
                    <p className="text-[10px] text-foreground/80 leading-relaxed">
                      <span className="text-amber-400 font-bold">What are sweeps?</span> Imagine a kid who wants ALL the candy at every store in the mall at the same time. A sweep is when a big trader sends orders to every exchange at once because they want in RIGHT NOW. It means someone with a lot of money is in a hurry!
                    </p>
                    <div className="space-y-0.5 mt-1">
                      <p className="text-[10px] leading-relaxed"><span className="text-foreground/50 font-bold">Under 20:</span> <span className="text-foreground/70">Quiet — the big kids are sitting down, nothing urgent.</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-blue-400 font-bold">20–50:</span> <span className="text-foreground/70">Normal — some big kids are moving around, regular activity.</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-amber-400 font-bold">50–100:</span> <span className="text-foreground/70">Busy — the big kids are running around, pay attention!</span></p>
                      <p className="text-[10px] leading-relaxed"><span className="text-red-400 font-bold">100+:</span> <span className="text-foreground/70">Chaos — everyone is sprinting, something BIG is happening!</span></p>
                    </div>
                  </div>
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
