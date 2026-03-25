import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

interface TickerItem {
  symbol: string;
  price: string;
  change: string;
  changePercent: string;
  isUp: boolean;
}

const SYMBOLS = ["SPY", "QQQ", "NVDA", "AAPL", "TSLA", "AMD", "AMZN", "META", "MSFT", "GOOGL"];

const FALLBACK_TICKERS: TickerItem[] = SYMBOLS.map(s => ({
  symbol: s, price: "—", change: "", changePercent: "—", isUp: true,
}));

const TickerTape = () => {
  const [tickers, setTickers] = useState<TickerItem[]>(FALLBACK_TICKERS);

  const fetchPrices = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("stock-quotes", {
        body: { symbols: SYMBOLS },
      });

      if (error) throw error;
      const quotes = data?.quotes || [];
      if (quotes.length > 0) {
        setTickers(quotes);
      }
    } catch (e) {
      console.warn("Ticker fetch failed:", e);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const allTickers = [...tickers, ...tickers];

  return (
    <div className="w-full overflow-hidden border-b border-border/30 bg-card/40 backdrop-blur-sm">
      <motion.div
        className="flex items-center gap-6 py-1.5 px-4 whitespace-nowrap"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, ease: "linear", repeat: Infinity }}
      >
        {allTickers.map((t, i) => (
          <div key={`${t.symbol}-${i}`} className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-bold text-foreground">{t.symbol}</span>
            <span className="text-[11px] text-muted-foreground">{t.price}</span>
            <span className={`text-[10px] font-semibold ${t.isUp ? "text-emerald-400" : "text-destructive"}`}>
              {t.changePercent}
            </span>
            <span className="text-border/30 text-[8px]">|</span>
          </div>
        ))}
      </motion.div>
    </div>
  );
};

export default TickerTape;
