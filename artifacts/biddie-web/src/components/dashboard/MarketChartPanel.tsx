import { useState, useCallback, useMemo, useRef } from "react";
import { TrendingUp, Search, Info, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const quickTickers = ["NQ", "SPX", "PLTR", "TSLA", "NVDA", "AAPL"];

const popularTickers = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA", "AMD", "INTC", "NFLX",
  "SPY", "QQQ", "IWM", "DIA", "SPX", "NQ", "ES", "VIX",
  "BA", "DIS", "PYPL", "SQ", "SHOP", "ROKU", "SNAP", "UBER", "LYFT", "COIN",
  "PLTR", "SOFI", "NIO", "RIVN", "LCID", "F", "GM", "AAL", "UAL", "DAL",
  "JPM", "BAC", "GS", "MS", "WFC", "C", "V", "MA", "AXP",
  "XOM", "CVX", "COP", "OXY", "SLB", "HAL",
  "JNJ", "PFE", "MRNA", "ABBV", "LLY", "UNH", "BMY",
  "WMT", "TGT", "COST", "HD", "LOW", "SBUX", "MCD", "KO", "PEP",
  "CRM", "ORCL", "NOW", "SNOW", "PANW", "CRWD", "ZS", "NET", "DDOG",
  "ARM", "SMCI", "AVGO", "MU", "QCOM", "TSM", "MRVL", "LRCX", "AMAT",
];

interface TickerInsight {
  bias: string;
  targetZone: string;
  keyLevel: string;
  invalidation: string;
  strategy: string;
  contract?: string;
  expiration: string;
  score: string;
  description: string;
  strategyExplanation: string;
}

const defaultInsight: TickerInsight = {
  bias: "Select a ticker ↗",
  targetZone: "—",
  keyLevel: "—",
  invalidation: "—",
  strategy: "—",
  expiration: "—",
  score: "— / 10",
  description: "Hey Trader, select a ticker above to get a live AI-powered market structure analysis with entry signals, strategy recommendations, and confidence scoring.",
  strategyExplanation: "Biddie will analyze real-time options flow data to recommend the best strategy for the current market conditions.",
};

// Generate candlesticks based on bias direction — matches homepage style
function generateCandles(isBearish: boolean) {
  const candles = [];
  const count = 19;
  const startX = 30;
  const spacingX = 25;

  // Bullish: price goes from high y (bottom) to low y (top) — uptrend
  // Bearish: price goes from low y (top) to high y (bottom) — downtrend
  let price = isBearish ? 60 : 160;

  for (let i = 0; i < count; i++) {
    const x = startX + i * spacingX;
    // Alternate bull/bear candles with overall trend
    const isBullCandle = isBearish
      ? (i % 3 !== 1) // mostly bearish (red), every 3rd is blue
      : (i % 3 !== 1); // mostly bullish (blue), every 3rd is red

    const bodySize = 8 + Math.random() * 10;
    const wickUp = 3 + Math.random() * 5;
    const wickDown = 3 + Math.random() * 5;

    let open, close;
    if (isBearish) {
      // Downtrend: price increases in y (moves down visually)
      if (isBullCandle) {
        // Bear candle (red) — price drops (y increases)
        open = price;
        close = price + bodySize;
      } else {
        // Bull candle (blue) — small retracement up
        open = price;
        close = price - bodySize * 0.6;
      }
    } else {
      // Uptrend: price decreases in y (moves up visually)
      if (isBullCandle) {
        // Bull candle (blue) — price rises (y decreases)
        open = price;
        close = price - bodySize;
      } else {
        // Bear candle (red) — small retracement down
        open = price;
        close = price + bodySize * 0.6;
      }
    }

    const top = Math.min(open, close);
    const bottom = Math.max(open, close);
    const high = top - wickUp;
    const low = bottom + wickDown;

    candles.push({ x, o: open, c: close, h: high, l: low, bull: close < open });
    price = close;
  }
  return candles;
}

const MarketChartPanel = () => {
  const { profile } = useAuth();
  const traderName = profile?.full_name?.split(" ")[0] || "Trader";

  const [activeTicker, setActiveTicker] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [insight, setInsight] = useState<TickerInsight>(defaultInsight);
  const [loading, setLoading] = useState(false);

  const isBearish = insight.bias.toLowerCase().includes("bearish");
  const isBullish = insight.bias.toLowerCase().includes("bullish");

  const candles = useMemo(() => {
    if (!activeTicker) return generateCandles(false);
    return generateCandles(isBearish);
  }, [activeTicker, isBearish]);

  const fetchAnalysis = useCallback(async (ticker: string) => {
    setActiveTicker(ticker);
    setLoading(true);
    setInsight({
      ...defaultInsight,
      bias: "Analyzing...",
      description: `Hey ${traderName}, Biddie is analyzing real-time flow data for ${ticker}. Pulling sweep activity, volume, and market sentiment...`,
    });

    try {
      const { data, error } = await supabase.functions.invoke('ticker-analysis', {
        body: { ticker, traderName },
      });
      if (error) throw error;
      if (data && data.bias) {
        setInsight(data as TickerInsight);
      }
    } catch (e) {
      console.error('Failed to fetch analysis:', e);
      setInsight({
        ...defaultInsight,
        bias: "Error",
        description: `Hey ${traderName}, we couldn't pull live data for ${ticker} right now. Please try again in a moment.`,
        strategyExplanation: "Analysis unavailable — the data feed may be temporarily down.",
      });
    } finally {
      setLoading(false);
    }
  }, [traderName]);

  const filteredTickers = useMemo(() => {
    if (!searchValue.trim()) return [];
    const query = searchValue.toUpperCase();
    return popularTickers.filter(t => t.startsWith(query) && t !== query).slice(0, 8);
  }, [searchValue]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      fetchAnalysis(searchValue.trim().toUpperCase());
      setSearchValue("");
      setShowSuggestions(false);
    }
  };

  const handleSelectTicker = (ticker: string) => {
    setSearchValue("");
    setShowSuggestions(false);
    fetchAnalysis(ticker);
  };

  return (
    <div className="glass-panel rounded-xl border-glow-purple p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Market Structure</span>
        </div>
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
          loading ? "bg-muted/50 text-muted-foreground" :
          isBearish ? "bg-destructive/20 text-destructive" :
          isBullish ? "bg-primary/20 text-primary" :
          "bg-muted/50 text-muted-foreground"
        }`}>
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          {insight.bias}
        </span>
      </div>

      {/* Ticker search + quick picks */}
      <div className="mb-5 flex flex-col gap-3">
        <div ref={searchRef} className="relative w-full sm:max-w-[260px]">
          <form onSubmit={handleSearch}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
            <Input
              value={searchValue}
              onChange={(e) => {
                setSearchValue(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => searchValue && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Search ticker..."
              className="h-10 rounded-xl border-border/50 bg-muted/30 pl-8 text-sm"
            />
          </form>
          {showSuggestions && filteredTickers.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
              {filteredTickers.map((ticker) => (
                <button
                  key={ticker}
                  onMouseDown={() => handleSelectTicker(ticker)}
                  className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-muted/50 transition-colors"
                >
                  {ticker}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
          {quickTickers.map((ticker) => (
            <button
              key={ticker}
              onClick={() => fetchAnalysis(ticker)}
              disabled={loading}
              className={`shrink-0 rounded-full px-3.5 py-2 text-xs transition-colors ${
                activeTicker === ticker
                  ? "bg-primary/20 text-primary font-medium"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              } disabled:opacity-50`}
            >
              {ticker}
            </button>
          ))}
        </div>
      </div>

      {/* AI Market Insight */}
      <div className="mb-5 rounded-xl border border-border/30 bg-muted/20 p-4">
        <div className="flex items-start gap-2">
          <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            {insight.description}
          </p>
        </div>
      </div>

      {/* Chart - matching reference image exactly */}
      <div className="relative mb-5 h-52 w-full sm:h-56">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        <svg viewBox="0 0 500 200" className="w-full h-full" preserveAspectRatio="none">
          {/* Key Level dashed line across full width */}
          <line x1="0" y1="90" x2="500" y2="90"
            stroke="hsl(230 85% 60%)"
            strokeWidth="1" strokeDasharray="6 4" opacity="0.4"
          />

          {/* Target zone shaded rectangle */}
          {isBearish ? (
            <rect x="150" y="150" width="250" height="30" fill="hsl(var(--destructive))" opacity="0.06" rx="4" />
          ) : (
            <rect x="250" y="30" width="250" height="40" fill="hsl(var(--primary))" opacity="0.06" rx="4" />
          )}

          {/* Invalidation zone shaded rectangle */}
          {isBearish ? (
            <rect x="250" y="30" width="250" height="40" fill="hsl(var(--primary))" opacity="0.03" rx="4" />
          ) : (
            <rect x="150" y="150" width="250" height="30" fill="hsl(var(--destructive))" opacity="0.06" rx="4" />
          )}

          {/* Candlesticks */}
          {candles.map((c, i) => {
            const top = Math.min(c.o, c.c);
            const bottom = Math.max(c.o, c.c);
            const color = c.bull ? "hsl(var(--primary))" : "hsl(var(--destructive))";
            return (
              <g key={i}>
                <line x1={c.x} y1={c.h} x2={c.x} y2={c.l} stroke={color} strokeWidth="2" />
                <rect x={c.x - 8} y={top} width="16" height={Math.max(bottom - top, 3)} fill={color} rx="1" />
              </g>
            );
          })}
        </svg>

        {/* Target Zone label */}
        {insight.targetZone !== "—" && (
          <div className={`absolute right-3 z-20 rounded bg-background/80 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm sm:right-4 sm:text-xs ${
            isBearish
              ? "bottom-3 text-destructive sm:bottom-4"
              : "top-3 text-primary sm:top-4"
          }`}>
            {insight.targetZone}
          </div>
        )}

        {/* Key Level label - middle right */}
        {insight.keyLevel !== "—" && (
          <div className="absolute right-3 top-[45%] z-20 rounded bg-background/80 px-2 py-0.5 text-[10px] text-primary backdrop-blur-sm sm:right-4 sm:text-xs">
            {insight.keyLevel}
          </div>
        )}

        {/* Invalidation label */}
        {insight.invalidation !== "—" && (
          <div className={`absolute right-3 z-20 rounded bg-background/80 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm sm:right-4 sm:text-xs ${
            isBearish
              ? "top-3 text-muted-foreground sm:top-4"
              : "bottom-3 text-destructive sm:bottom-4"
          }`}>
            {insight.invalidation}
          </div>
        )}
      </div>

      {/* Stats + Contract */}
      <div className="mb-4 space-y-3 border-t border-border/40 pt-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Asset", value: activeTicker || "—" },
            { label: "Strategy", value: insight.strategy },
            { label: "Expiration", value: insight.expiration },
            { label: "AI Score", value: insight.score },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-border/40 bg-muted/10 p-3 text-left sm:text-center">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{stat.label}</div>
              <div className="mt-1 text-sm font-bold text-foreground break-words">{stat.value}</div>
            </div>
          ))}
        </div>

        {insight.contract && insight.contract !== "—" && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Contract</div>
            <div className="text-sm font-bold text-primary break-words">{insight.contract}</div>
          </div>
        )}
      </div>

      {/* Strategy Explanation */}
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
        <div className="text-[10px] font-semibold text-accent uppercase tracking-wider mb-1">Why this strategy?</div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {insight.strategyExplanation}
        </p>
      </div>
    </div>
  );
};

export default MarketChartPanel;
