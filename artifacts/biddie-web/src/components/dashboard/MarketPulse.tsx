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
  Low: "text-emerald-400 bg-emerald-500/20",
  Normal: "text-blue-400 bg-blue-500/20",
  Elevated: "text-amber-400 bg-amber-500/20",
  High: "text-orange-400 bg-orange-500/20",
  Extreme: "text-red-400 bg-red-500/20",
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
  const [showTrending, setShowTrending] = useState(false);

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
                <span className="text-[10px] text-muted-foreground">Volatility (VIXY)</span>
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
          <AnimatePresence>
            {expandedTip === "vix" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 bg-primary/5 rounded-lg border border-primary/10">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    <span className="text-primary font-bold">What is VIXY?</span> Think of it like a scared-o-meter for the stock market! VIXY goes UP when traders are scared and expect big price swings. When it's LOW, the market is calm like a quiet lake.
                  </p>
                  <p className="text-[10px] text-foreground/80 mt-1 leading-relaxed">
                    {data.vix.description}
                  </p>
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
                <span className="text-[10px] text-muted-foreground">Put/Call</span>
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
          <AnimatePresence>
            {expandedTip === "sentiment" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 bg-primary/5 rounded-lg border border-primary/10">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    <span className="text-primary font-bold">What is Put/Call Ratio?</span> Compares bearish bets (puts) to bullish bets (calls). Below 0.8 = bullish sentiment. Above 1.2 = bearish sentiment.
                  </p>
                  <p className="text-[10px] text-foreground/80 mt-1 leading-relaxed">
                    {data.sentiment.description}
                  </p>
                  <div className="flex gap-3 mt-1.5 text-[9px]">
                    <span className="text-emerald-400">Calls: {formatPremium(data.sentiment.totalCallPremium)}</span>
                    <span className="text-red-400">Puts: {formatPremium(data.sentiment.totalPutPremium)}</span>
                    <span className="text-amber-400">{data.sentiment.sweepCount} sweeps</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {data.trending.length > 0 && (
        <>
          <button
            onClick={() => setShowTrending(!showTrending)}
            className="w-full flex items-center justify-between px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-semibold">Trending Tickers</span>
              <span className="text-[9px] text-muted-foreground/60">
                Where the big money is flowing right now
              </span>
            </div>
            {showTrending ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          <AnimatePresence>
            {showTrending && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-1.5">
                  {data.trending.map((t, i) => (
                    <div
                      key={t.ticker}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                        t.bias === "bullish" ? "bg-emerald-500/5 border border-emerald-500/10"
                        : t.bias === "bearish" ? "bg-red-500/5 border border-red-500/10"
                        : "bg-muted/20 border border-white/5"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-foreground">{t.ticker}</span>
                          {t.bias === "bullish" ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : t.bias === "bearish" ? (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          ) : (
                            <Activity className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground">{t.alerts} alerts</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-semibold text-foreground block">{formatPremium(t.totalPremium)}</span>
                        {t.sweeps > 0 && (
                          <span className="text-[9px] text-amber-400 flex items-center gap-0.5 justify-end">
                            <Zap className="h-2.5 w-2.5" />{t.sweeps}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 mt-1.5 bg-primary/5 rounded-lg border border-primary/10">
                  <p className="text-[9px] text-muted-foreground leading-relaxed">
                    <span className="text-primary font-bold">What are Trending Tickers?</span> These are the stocks seeing the most unusual options activity right now. High premium + sweeps often signals that big institutions are making moves. This doesn't mean you should trade them — it means they're worth watching.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
};

export default MarketPulse;
