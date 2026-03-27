import { useState, useEffect, useCallback, useRef } from "react";

interface PriceInfo {
  price: number;
  high: number;
  low: number;
  volume: number;
  trades: number;
  lastUpdate: string;
  age: number;
}

interface RealtimePricesState {
  prices: Record<string, PriceInfo>;
  connected: boolean;
  marketOpen: boolean;
  subscribedTickers: string[];
  tickerCount: number;
}

export function useRealtimePrices(enabled = true, intervalMs = 15000) {
  const [state, setState] = useState<RealtimePricesState>({
    prices: {},
    connected: false,
    marketOpen: false,
    subscribedTickers: [],
    tickerCount: 0,
  });
  const mountedRef = useRef(true);

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch("/api/whale/prices/realtime");
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setState({
          prices: data.prices || {},
          connected: data.connected ?? false,
          marketOpen: data.marketOpen ?? false,
          subscribedTickers: data.subscribedTickers || [],
          tickerCount: data.tickerCount || 0,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    fetchPrices();
    const timer = setInterval(fetchPrices, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [enabled, intervalMs, fetchPrices]);

  const getPrice = useCallback(
    (ticker: string): PriceInfo | null => state.prices[ticker] || null,
    [state.prices]
  );

  return { ...state, getPrice };
}

export type { PriceInfo };
