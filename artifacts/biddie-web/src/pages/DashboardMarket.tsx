import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  Search, TrendingUp, TrendingDown, Activity, Shield, Target,
  Zap, BarChart3, Eye, ArrowUpRight, ArrowDownRight, Crosshair,
  Waves, AlertTriangle, Clock, ChevronRight, Loader2
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface TradeSetup {
  has_play: boolean;
  action: string | null;
  entry: string | null;
  target: string | null;
  stop: string | null;
  timeframe: string | null;
  confidence: string | null;
  reasoning: string | null;
}

interface Analysis {
  verdict: string;
  verdict_summary: string;
  market_structure: string;
  flow_analysis: string;
  dark_pool_analysis: string;
  key_levels_analysis: string;
  trade_setup: TradeSetup;
  watch_for: string;
}

interface AnalysisData {
  key_levels: any;
  price_confirmation: any;
  flow_summary: {
    total_alerts: number;
    call_premium: number;
    put_premium: number;
    sweeps: number;
    avg_aggression: number;
    top_flow: any[];
  };
  dark_pool: {
    trades: number;
    total_volume: number;
    total_notional: number;
    avg_price: number | null;
    recent: any[];
  };
}

interface AnalysisResult {
  ticker: string;
  timestamp: string;
  analysis: Analysis;
  data: AnalysisData;
}

const formatPremium = (val: number) => {
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
};

const popularTickers = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "META", "AMZN", "MSFT", "AMD", "GOOGL"];

const TICKER_DB: { symbol: string; name: string }[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF" },
  { symbol: "QQQ", name: "Invesco Nasdaq 100 ETF" },
  { symbol: "IWM", name: "iShares Russell 2000 ETF" },
  { symbol: "DIA", name: "SPDR Dow Jones ETF" },
  { symbol: "SPX", name: "S&P 500 Index" },
  { symbol: "VIX", name: "CBOE Volatility Index" },
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corporation" },
  { symbol: "NVDA", name: "NVIDIA Corporation" },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "GOOG", name: "Alphabet Inc. Class C" },
  { symbol: "META", name: "Meta Platforms Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "AMD", name: "Advanced Micro Devices" },
  { symbol: "AVGO", name: "Broadcom Inc." },
  { symbol: "NFLX", name: "Netflix Inc." },
  { symbol: "CRM", name: "Salesforce Inc." },
  { symbol: "ORCL", name: "Oracle Corporation" },
  { symbol: "ADBE", name: "Adobe Inc." },
  { symbol: "INTC", name: "Intel Corporation" },
  { symbol: "QCOM", name: "Qualcomm Inc." },
  { symbol: "MU", name: "Micron Technology" },
  { symbol: "ARM", name: "ARM Holdings" },
  { symbol: "MRVL", name: "Marvell Technology" },
  { symbol: "SMCI", name: "Super Micro Computer" },
  { symbol: "PLTR", name: "Palantir Technologies" },
  { symbol: "SNOW", name: "Snowflake Inc." },
  { symbol: "COIN", name: "Coinbase Global" },
  { symbol: "UBER", name: "Uber Technologies" },
  { symbol: "SHOP", name: "Shopify Inc." },
  { symbol: "SQ", name: "Block Inc." },
  { symbol: "ROKU", name: "Roku Inc." },
  { symbol: "JPM", name: "JPMorgan Chase & Co." },
  { symbol: "BAC", name: "Bank of America" },
  { symbol: "GS", name: "Goldman Sachs Group" },
  { symbol: "MS", name: "Morgan Stanley" },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "MA", name: "Mastercard Inc." },
  { symbol: "PYPL", name: "PayPal Holdings" },
  { symbol: "WFC", name: "Wells Fargo & Co." },
  { symbol: "C", name: "Citigroup Inc." },
  { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "UNH", name: "UnitedHealth Group" },
  { symbol: "PFE", name: "Pfizer Inc." },
  { symbol: "ABBV", name: "AbbVie Inc." },
  { symbol: "MRK", name: "Merck & Co." },
  { symbol: "LLY", name: "Eli Lilly and Co." },
  { symbol: "XOM", name: "Exxon Mobil" },
  { symbol: "CVX", name: "Chevron Corporation" },
  { symbol: "COP", name: "ConocoPhillips" },
  { symbol: "HD", name: "Home Depot Inc." },
  { symbol: "WMT", name: "Walmart Inc." },
  { symbol: "COST", name: "Costco Wholesale" },
  { symbol: "NKE", name: "Nike Inc." },
  { symbol: "SBUX", name: "Starbucks Corp." },
  { symbol: "DIS", name: "Walt Disney Co." },
  { symbol: "BA", name: "Boeing Company" },
  { symbol: "CAT", name: "Caterpillar Inc." },
  { symbol: "GE", name: "General Electric" },
  { symbol: "UPS", name: "United Parcel Service" },
  { symbol: "HON", name: "Honeywell International" },
  { symbol: "DE", name: "Deere & Company" },
  { symbol: "PANW", name: "Palo Alto Networks" },
  { symbol: "CRWD", name: "CrowdStrike Holdings" },
  { symbol: "ZS", name: "Zscaler Inc." },
  { symbol: "NET", name: "Cloudflare Inc." },
  { symbol: "DDOG", name: "Datadog Inc." },
  { symbol: "GLD", name: "SPDR Gold Shares ETF" },
  { symbol: "SLV", name: "iShares Silver Trust" },
  { symbol: "TLT", name: "iShares 20+ Year Treasury" },
  { symbol: "XLF", name: "Financial Select Sector ETF" },
  { symbol: "XLK", name: "Technology Select Sector ETF" },
  { symbol: "XLE", name: "Energy Select Sector ETF" },
  { symbol: "XLV", name: "Health Care Select Sector ETF" },
  { symbol: "ARKK", name: "ARK Innovation ETF" },
  { symbol: "SOXX", name: "iShares Semiconductor ETF" },
  { symbol: "SMH", name: "VanEck Semiconductor ETF" },
  { symbol: "RIVN", name: "Rivian Automotive" },
  { symbol: "LCID", name: "Lucid Group" },
  { symbol: "NIO", name: "NIO Inc." },
  { symbol: "BABA", name: "Alibaba Group" },
  { symbol: "TSM", name: "Taiwan Semiconductor" },
  { symbol: "ASML", name: "ASML Holding" },
  { symbol: "SOFI", name: "SoFi Technologies" },
  { symbol: "HOOD", name: "Robinhood Markets" },
  { symbol: "RBLX", name: "Roblox Corporation" },
  { symbol: "SNAP", name: "Snap Inc." },
  { symbol: "PINS", name: "Pinterest Inc." },
  { symbol: "SPOT", name: "Spotify Technology" },
  { symbol: "SE", name: "Sea Limited" },
  { symbol: "MARA", name: "Marathon Digital" },
  { symbol: "RIOT", name: "Riot Platforms" },
  { symbol: "IREN", name: "Iris Energy" },
  { symbol: "BE", name: "Bloom Energy" },
  { symbol: "ENPH", name: "Enphase Energy" },
  { symbol: "FSLR", name: "First Solar Inc." },
  { symbol: "T", name: "AT&T Inc." },
  { symbol: "VZ", name: "Verizon Communications" },
  { symbol: "TMUS", name: "T-Mobile US" },
  { symbol: "PG", name: "Procter & Gamble" },
  { symbol: "KO", name: "Coca-Cola Company" },
  { symbol: "PEP", name: "PepsiCo Inc." },
  { symbol: "MCD", name: "McDonald's Corporation" },
  { symbol: "F", name: "Ford Motor Company" },
  { symbol: "GM", name: "General Motors" },
  { symbol: "UAL", name: "United Airlines" },
  { symbol: "DAL", name: "Delta Air Lines" },
  { symbol: "AAL", name: "American Airlines" },
  { symbol: "LUV", name: "Southwest Airlines" },
  { symbol: "CMG", name: "Chipotle Mexican Grill" },
  { symbol: "ABNB", name: "Airbnb Inc." },
  { symbol: "ZM", name: "Zoom Video Communications" },
  { symbol: "DELL", name: "Dell Technologies" },
  { symbol: "HPE", name: "Hewlett Packard Enterprise" },
  { symbol: "IBM", name: "International Business Machines" },
  { symbol: "NOW", name: "ServiceNow Inc." },
  { symbol: "WDAY", name: "Workday Inc." },
  { symbol: "TTD", name: "The Trade Desk" },
  { symbol: "ANET", name: "Arista Networks" },
  { symbol: "ON", name: "ON Semiconductor" },
  { symbol: "LRCX", name: "Lam Research" },
  { symbol: "AMAT", name: "Applied Materials" },
  { symbol: "KLAC", name: "KLA Corporation" },
  { symbol: "SNDK", name: "SanDisk Corporation" },
  { symbol: "CRCL", name: "Circle Logistics" },
  { symbol: "CAVA", name: "CAVA Group Inc." },
  { symbol: "CRWV", name: "CrowdStrike Holdings (Warrants)" },
  { symbol: "AAOI", name: "Applied Optoelectronics" },
  { symbol: "ACHR", name: "Archer Aviation" },
  { symbol: "ACN", name: "Accenture plc" },
  { symbol: "AFRM", name: "Affirm Holdings" },
  { symbol: "AI", name: "C3.ai Inc." },
  { symbol: "ALAB", name: "Astera Labs" },
  { symbol: "ALGN", name: "Align Technology" },
  { symbol: "ALIT", name: "Alight Inc." },
  { symbol: "AMC", name: "AMC Entertainment" },
  { symbol: "AMGN", name: "Amgen Inc." },
  { symbol: "AMPX", name: "Amprius Technologies" },
  { symbol: "APLD", name: "Applied Digital" },
  { symbol: "APP", name: "AppLovin Corporation" },
  { symbol: "RDTI", name: "Radar Technologies Intl" },
  { symbol: "AXTI", name: "AXT Inc." },
  { symbol: "BB", name: "BlackBerry Limited" },
  { symbol: "BBAI", name: "BigBear.ai Holdings" },
  { symbol: "BIDU", name: "Baidu Inc." },
  { symbol: "BIIB", name: "Biogen Inc." },
  { symbol: "BITF", name: "Bitfarms Ltd." },
  { symbol: "BKNG", name: "Booking Holdings" },
  { symbol: "BLNK", name: "Blink Charging" },
  { symbol: "BMNR", name: "Bitmine Immersion Technologies" },
  { symbol: "BP", name: "BP plc" },
  { symbol: "BROS", name: "Dutch Bros Inc." },
  { symbol: "BULL", name: "Bull Horn Holdings" },
  { symbol: "BX", name: "Blackstone Inc." },
  { symbol: "BYND", name: "Beyond Meat Inc." },
  { symbol: "CAKE", name: "Cheesecake Factory" },
  { symbol: "CAN", name: "Canaan Inc." },
  { symbol: "CART", name: "Instacart (Maplebear)" },
  { symbol: "CCCX", name: "C4 Therapeutics" },
  { symbol: "CCJ", name: "Cameco Corporation" },
  { symbol: "CCL", name: "Carnival Corporation" },
  { symbol: "CDNS", name: "Cadence Design Systems" },
  { symbol: "CEG", name: "Constellation Energy" },
  { symbol: "CELH", name: "Celsius Holdings" },
  { symbol: "CFLT", name: "Confluent Inc." },
  { symbol: "CHWY", name: "Chewy Inc." },
  { symbol: "CIEN", name: "Ciena Corporation" },
  { symbol: "CIFR", name: "Cipher Mining" },
  { symbol: "CLOU", name: "Global X Cloud Computing ETF" },
  { symbol: "CLOV", name: "Clover Health" },
  { symbol: "CLSK", name: "CleanSpark Inc." },
  { symbol: "CMCSA", name: "Comcast Corporation" },
  { symbol: "DJT", name: "Trump Media & Technology" },
  { symbol: "DKNG", name: "DraftKings Inc." },
  { symbol: "DKS", name: "Dick's Sporting Goods" },
  { symbol: "DNUT", name: "Krispy Kreme Inc." },
  { symbol: "DOCN", name: "DigitalOcean Holdings" },
  { symbol: "DOCU", name: "DocuSign Inc." },
  { symbol: "DPZ", name: "Domino's Pizza" },
  { symbol: "DUOL", name: "Duolingo Inc." },
  { symbol: "DXCM", name: "DexCom Inc." },
  { symbol: "EA", name: "Electronic Arts" },
  { symbol: "EBAY", name: "eBay Inc." },
  { symbol: "EL", name: "Estee Lauder" },
  { symbol: "ELF", name: "e.l.f. Beauty" },
  { symbol: "EOSE", name: "Eos Energy Enterprises" },
  { symbol: "ETHA", name: "iShares Ethereum Trust ETF" },
  { symbol: "ETSY", name: "Etsy Inc." },
  { symbol: "EXPE", name: "Expedia Group" },
  { symbol: "FCX", name: "Freeport-McMoRan" },
  { symbol: "FDX", name: "FedEx Corporation" },
  { symbol: "FIG", name: "Simplify Macro Strategy ETF" },
  { symbol: "FIVE", name: "Five Below Inc." },
  { symbol: "FRSH", name: "Freshworks Inc." },
  { symbol: "FUBO", name: "fuboTV Inc." },
  { symbol: "FUTU", name: "Futu Holdings" },
  { symbol: "FVRR", name: "Fiverr International" },
  { symbol: "FXI", name: "iShares China Large-Cap ETF" },
  { symbol: "GDX", name: "VanEck Gold Miners ETF" },
  { symbol: "GEV", name: "GE Vernova" },
  { symbol: "GILD", name: "Gilead Sciences" },
  { symbol: "GLW", name: "Corning Inc." },
  { symbol: "GLXY", name: "Galaxy Digital" },
  { symbol: "GME", name: "GameStop Corp." },
  { symbol: "GPRO", name: "GoPro Inc." },
  { symbol: "GRAB", name: "Grab Holdings" },
  { symbol: "GTLB", name: "GitLab Inc." },
  { symbol: "HAL", name: "Halliburton Company" },
  { symbol: "HIMS", name: "Hims & Hers Health" },
  { symbol: "HPQ", name: "HP Inc." },
  { symbol: "HTZ", name: "Hertz Global Holdings" },
  { symbol: "HUT", name: "Hut 8 Mining" },
  { symbol: "HYG", name: "iShares High Yield Corporate Bond ETF" },
  { symbol: "IBIT", name: "iShares Bitcoin Trust ETF" },
  { symbol: "IBRX", name: "ImmunityBio Inc." },
  { symbol: "INTU", name: "Intuit Inc." },
  { symbol: "IONQ", name: "IonQ Inc." },
  { symbol: "ISRG", name: "Intuitive Surgical" },
  { symbol: "IVV", name: "iShares Core S&P 500 ETF" },
  { symbol: "JD", name: "JD.com Inc." },
  { symbol: "JKS", name: "JinkoSolar Holding" },
  { symbol: "JOBY", name: "Joby Aviation" },
];

const verdictColors: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  BULLISH: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/40", glow: "shadow-emerald-500/20" },
  BEARISH: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/40", glow: "shadow-red-500/20" },
  NEUTRAL: { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/40", glow: "shadow-yellow-500/20" },
  "NO PLAY": { bg: "bg-zinc-500/15", text: "text-zinc-400", border: "border-zinc-500/40", glow: "shadow-zinc-500/20" },
};

const DashboardMarket = () => {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLFormElement>(null);

  const suggestions = useMemo(() => {
    const q = ticker.trim().toUpperCase();
    if (!q) return [];
    return TICKER_DB.filter(
      t => t.symbol.startsWith(q) || t.name.toUpperCase().includes(q)
    ).slice(0, 8);
  }, [ticker]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const analyzeCallback = useCallback(async (t: string) => {
    const clean = t.toUpperCase().replace(/[^A-Z]/g, "");
    if (!clean || clean.length > 5) return;

    setShowDropdown(false);
    setLoading(true);
    setError(null);
    setResult(null);
    setTicker(clean);

    try {
      const resp = await fetch(`/api/whale/analyze/${clean}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || "Analysis failed");
      }
      const data = await resp.json();
      setResult(data);
      setSearchHistory(prev => {
        const filtered = prev.filter(x => x !== clean);
        return [clean, ...filtered].slice(0, 8);
      });
    } catch (err: any) {
      setError(err.message || "Failed to analyze ticker");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) analyzeCallback(ticker.trim());
  };

  const v = result?.analysis?.verdict || "";
  const vc = verdictColors[v] || verdictColors["NEUTRAL"];

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          <div className="max-w-5xl mx-auto space-y-5">

            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
                <Crosshair className="h-6 w-6 text-primary" />
                Market View
              </h1>
              <p className="text-sm text-muted-foreground">
                Type any ticker for a full AI-powered breakdown — flow, dark pool, key levels, and trade setup
              </p>
            </div>

            <form onSubmit={handleSubmit} className="relative" ref={dropdownRef}>
              <div className="glass-panel rounded-2xl border-glow-purple p-1.5 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={inputRef}
                    value={ticker}
                    onChange={e => { setTicker(e.target.value.toUpperCase()); setShowDropdown(true); }}
                    onFocus={() => { if (suggestions.length > 0 && ticker.length > 0) setShowDropdown(true); }}
                    onKeyDown={e => {
                      if (!showDropdown || suggestions.length === 0) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHighlightIndex(prev => Math.max(prev - 1, 0));
                      } else if (e.key === "Enter" && highlightIndex >= 0) {
                        e.preventDefault();
                        const selected = suggestions[highlightIndex];
                        setTicker(selected.symbol);
                        setShowDropdown(false);
                        analyzeCallback(selected.symbol);
                      } else if (e.key === "Escape") {
                        setShowDropdown(false);
                      } else if (e.key === "Tab" && suggestions.length > 0) {
                        const idx = highlightIndex >= 0 ? highlightIndex : 0;
                        setTicker(suggestions[idx].symbol);
                        setShowDropdown(false);
                      }
                    }}
                    placeholder="Enter ticker symbol (e.g. SPY, NVDA, AAPL)"
                    className="pl-12 pr-4 h-14 text-lg font-bold bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50 uppercase"
                    maxLength={5}
                    disabled={loading}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !ticker.trim()}
                  className="h-12 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Analyze
                    </>
                  )}
                </button>
              </div>

              <AnimatePresence>
                {showDropdown && suggestions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-50 left-0 right-0 top-full mt-1 glass-panel rounded-xl border border-white/10 overflow-hidden shadow-2xl"
                  >
                    {suggestions.map((s, i) => (
                      <button
                        key={s.symbol}
                        type="button"
                        onMouseDown={() => {
                          setTicker(s.symbol);
                          setShowDropdown(false);
                          analyzeCallback(s.symbol);
                        }}
                        onMouseEnter={() => setHighlightIndex(i)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          i === highlightIndex
                            ? "bg-primary/15 text-primary"
                            : "hover:bg-white/5 text-foreground"
                        }`}
                      >
                        <span className="font-bold text-sm w-14 shrink-0">{s.symbol}</span>
                        <span className="text-xs text-muted-foreground truncate">{s.name}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </form>

            <div className="flex flex-wrap gap-2">
              {searchHistory.length > 0 && (
                <>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold self-center mr-1">Recent:</span>
                  {searchHistory.map(t => (
                    <button
                      key={t}
                      onClick={() => analyzeCallback(t)}
                      disabled={loading}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors border border-primary/20 disabled:opacity-50"
                    >
                      {t}
                    </button>
                  ))}
                  <span className="mx-2 text-border">|</span>
                </>
              )}
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold self-center mr-1">Popular:</span>
              {popularTickers.filter(t => !searchHistory.includes(t)).slice(0, 6).map(t => (
                <button
                  key={t}
                  onClick={() => analyzeCallback(t)}
                  disabled={loading}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {loading && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="glass-panel rounded-2xl border-glow-purple p-8"
                >
                  <div className="flex flex-col items-center gap-5">
                    <div className="relative">
                      <div className="h-20 w-20 rounded-full border-2 border-primary/30 flex items-center justify-center">
                        <Loader2 className="h-10 w-10 text-primary animate-spin" />
                      </div>
                      <div className="absolute inset-0 rounded-full border-2 border-primary/10 animate-ping" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-lg font-bold text-foreground">Analyzing {ticker}</p>
                      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                        <p className="flex items-center gap-2 justify-center">
                          <Activity className="h-3 w-3 text-emerald-400 animate-pulse" /> Scanning live options flow
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <Eye className="h-3 w-3 text-blue-400 animate-pulse" /> Checking dark pool activity
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <BarChart3 className="h-3 w-3 text-violet-400 animate-pulse" /> Computing key levels & VWAP
                        </p>
                        <p className="flex items-center gap-2 justify-center">
                          <Zap className="h-3 w-3 text-yellow-400 animate-pulse" /> Running AI analysis
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {error && !loading && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-panel rounded-2xl border border-red-500/30 p-6"
                >
                  <div className="flex items-center gap-3 text-red-400">
                    <AlertTriangle className="h-5 w-5 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                </motion.div>
              )}

              {result && !loading && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className={`glass-panel rounded-2xl ${vc.border} border p-5 shadow-lg ${vc.glow}`}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-4">
                        <div className={`${vc.bg} ${vc.border} border rounded-xl px-4 py-2`}>
                          <p className={`text-2xl font-black ${vc.text}`}>{result.ticker}</p>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${vc.bg} ${vc.text} ${vc.border} border`}>
                              {v === "BULLISH" && <TrendingUp className="h-3 w-3 inline mr-1" />}
                              {v === "BEARISH" && <TrendingDown className="h-3 w-3 inline mr-1" />}
                              {v}
                            </span>
                            {result.data.price_confirmation?.confirmed && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                PRICE CONFIRMED
                              </span>
                            )}
                            {result.data.price_confirmation?.gamma_zone === "negative" && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                                NEG GAMMA
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{result.analysis.verdict_summary}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {result.data.key_levels?.current_price && (
                          <p className="text-2xl font-black text-foreground">${result.data.key_levels.current_price.toFixed(2)}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          <Clock className="h-3 w-3" /> {result.timestamp}
                        </p>
                      </div>
                    </div>
                  </div>

                  {result.analysis.trade_setup?.has_play && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="glass-panel rounded-2xl border border-primary/40 p-5 bg-primary/5"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Target className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-foreground uppercase tracking-wider">Trade Setup</h3>
                          {result.analysis.trade_setup.confidence && (
                            <span className={`text-[10px] font-bold uppercase ${
                              result.analysis.trade_setup.confidence === "High" ? "text-emerald-400"
                                : result.analysis.trade_setup.confidence === "Medium" ? "text-yellow-400"
                                : "text-muted-foreground"
                            }`}>
                              {result.analysis.trade_setup.confidence} Confidence
                            </span>
                          )}
                        </div>
                        {result.analysis.trade_setup.timeframe && (
                          <span className="ml-auto text-[10px] font-bold uppercase px-2.5 py-1 rounded-md bg-violet-500/20 text-violet-400 border border-violet-500/30">
                            {result.analysis.trade_setup.timeframe}
                          </span>
                        )}
                      </div>

                      {result.analysis.trade_setup.action && (
                        <div className="mb-4 p-3 rounded-xl bg-primary/10 border border-primary/20">
                          <p className="text-lg font-black text-primary">{result.analysis.trade_setup.action}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {result.analysis.trade_setup.entry && (
                          <div className="rounded-xl bg-background/60 p-3 border border-border/30">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                              <ArrowUpRight className="h-3 w-3 text-blue-400" /> Entry
                            </p>
                            <p className="text-sm font-bold text-foreground">{result.analysis.trade_setup.entry}</p>
                          </div>
                        )}
                        {result.analysis.trade_setup.target && (
                          <div className="rounded-xl bg-background/60 p-3 border border-emerald-500/20">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                              <Target className="h-3 w-3 text-emerald-400" /> Target
                            </p>
                            <p className="text-sm font-bold text-emerald-400">{result.analysis.trade_setup.target}</p>
                          </div>
                        )}
                        {result.analysis.trade_setup.stop && (
                          <div className="rounded-xl bg-background/60 p-3 border border-red-500/20">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
                              <Shield className="h-3 w-3 text-red-400" /> Stop / Invalidation
                            </p>
                            <p className="text-sm font-bold text-red-400">{result.analysis.trade_setup.stop}</p>
                          </div>
                        )}
                      </div>

                      {result.analysis.trade_setup.reasoning && (
                        <p className="mt-3 text-xs text-muted-foreground italic">{result.analysis.trade_setup.reasoning}</p>
                      )}
                    </motion.div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <BarChart3 className="h-4 w-4 text-violet-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Market View</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{result.analysis.market_structure}</p>
                    </div>

                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Waves className="h-4 w-4 text-blue-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Options Flow</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{result.analysis.flow_analysis}</p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Calls: {formatPremium(result.data.flow_summary.call_premium)}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                          Puts: {formatPremium(result.data.flow_summary.put_premium)}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                          Sweeps: {result.data.flow_summary.sweeps}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                          Aggression: {result.data.flow_summary.avg_aggression}%
                        </span>
                      </div>
                    </div>

                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Eye className="h-4 w-4 text-amber-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Dark Pool</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{result.analysis.dark_pool_analysis}</p>
                      <div className="flex gap-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {result.data.dark_pool.trades} Trades
                        </span>
                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {formatPremium(result.data.dark_pool.total_notional)} Notional
                        </span>
                        {result.data.dark_pool.avg_price && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Avg: ${result.data.dark_pool.avg_price.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="glass-panel rounded-xl p-4 border border-border/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Crosshair className="h-4 w-4 text-cyan-400" />
                        <h3 className="text-xs font-black text-foreground uppercase tracking-wider">Key Levels</h3>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed mb-3">{result.analysis.key_levels_analysis}</p>
                      {result.data.key_levels && (
                        <div className="grid grid-cols-2 gap-2">
                          {result.data.key_levels.vwap && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">VWAP</p>
                              <p className="text-xs font-bold text-cyan-400">${result.data.key_levels.vwap}</p>
                            </div>
                          )}
                          {result.data.key_levels.pivot_points?.pivot && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">Pivot</p>
                              <p className="text-xs font-bold text-foreground">${result.data.key_levels.pivot_points.pivot}</p>
                            </div>
                          )}
                          {result.data.key_levels.prior_day?.high && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">PDH</p>
                              <p className="text-xs font-bold text-emerald-400">${result.data.key_levels.prior_day.high}</p>
                            </div>
                          )}
                          {result.data.key_levels.prior_day?.low && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">PDL</p>
                              <p className="text-xs font-bold text-red-400">${result.data.key_levels.prior_day.low}</p>
                            </div>
                          )}
                          {result.data.key_levels.pivot_points?.r1 && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">R1</p>
                              <p className="text-xs font-bold text-emerald-400">${result.data.key_levels.pivot_points.r1}</p>
                            </div>
                          )}
                          {result.data.key_levels.pivot_points?.s1 && (
                            <div className="rounded-lg bg-background/50 px-2.5 py-1.5">
                              <p className="text-[10px] text-muted-foreground">S1</p>
                              <p className="text-xs font-bold text-red-400">${result.data.key_levels.pivot_points.s1}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {result.analysis.watch_for && (
                    <div className="glass-panel rounded-xl p-4 border border-yellow-500/20 bg-yellow-500/5">
                      <div className="flex items-start gap-3">
                        <div className="h-7 w-7 rounded-lg bg-yellow-500/20 flex items-center justify-center shrink-0 mt-0.5">
                          <Eye className="h-3.5 w-3.5 text-yellow-400" />
                        </div>
                        <div>
                          <p className="text-xs font-black text-foreground uppercase tracking-wider mb-1">Watch For</p>
                          <p className="text-sm text-muted-foreground">{result.analysis.watch_for}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="glass-panel rounded-xl p-3 border border-border/20">
                    <p className="text-[10px] text-muted-foreground/60 text-center">
                      JORTRADE is an AI-powered analysis tool using data analysis and probabilistic models. This is not financial advice.
                      Trading options involves substantial risk. You are solely responsible for your trading decisions.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!result && !loading && !error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-panel rounded-2xl border-glow-purple p-8 text-center"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Search className="h-8 w-8 text-primary/50" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-lg font-bold text-foreground">Your Personal Trade Assistant</h2>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      Enter any ticker above to get a full AI-powered breakdown including live options flow,
                      dark pool activity, key support/resistance levels, and actionable trade setups.
                    </p>
                  </div>
                  <div className="flex items-center gap-6 mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Activity className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Live Flow</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="h-3.5 w-3.5 text-amber-400" />
                      <span>Dark Pool</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Key Levels</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span>AI Analysis</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardMarket;
