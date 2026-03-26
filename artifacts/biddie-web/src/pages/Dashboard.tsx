import { useEffect, useMemo, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import SignalFeedPanel from "@/components/dashboard/SignalFeedPanel";
import AIChatPanel from "@/components/dashboard/AIChatPanel";
import MarketStatusSign from "@/components/dashboard/MarketStatusSign";
import TickerTape from "@/components/dashboard/TickerTape";
import PerformanceSnapshot from "@/components/dashboard/PerformanceSnapshot";
import { useMarketData, type MarketSignal } from "@/hooks/useMarketData";

const getSignalScore = (signal: Pick<MarketSignal, "convictionScore" | "confidence">) =>
  signal.convictionScore ?? Math.round(signal.confidence * 10);

const formatRelativeTimestamp = (isoString: string) => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Today";

  const now = Date.now();
  const diffMinutes = Math.floor((now - date.getTime()) / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 12) return `${diffHours}h ago`;

  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const recordToDashboardSignal = (record: any): MarketSignal => {
  const confidence = Number(record.confidence) || 0;
  const convictionScore = Math.round(confidence * 10);
  const isBullish = record.signal_type === "bullish";
  const putCall = record.put_call || record.option_type || "call";
  const tags = [putCall === "call" ? "Call Flow" : "Put Flow"];

  if (convictionScore >= 85) tags.push("🔥 ACT NOW");
  else if (convictionScore >= 70) tags.push("⚡ HIGH CONVICTION");

  const createdAt = record.detected_at || record.created_at;

  return {
    id: record.id,
    ticker: record.ticker,
    type: isBullish ? "bullish" : "bearish",
    confidence,
    convictionScore,
    convictionLabel: convictionScore >= 90
      ? "Extreme Conviction"
      : convictionScore >= 75
        ? "Very High Conviction"
        : convictionScore >= 60
          ? "High Conviction"
          : convictionScore >= 40
            ? "Moderate Conviction"
            : "Low Conviction",
    description:
      record.description || record.reason ||
      `${putCall === "call" ? "Call" : "Put"} flow on ${record.ticker}${record.strike ? ` at ${record.strike}` : ""}.`,
    timestamp: formatRelativeTimestamp(createdAt),
    tags,
    strike: record.strike ?? undefined,
    expiry: record.expiry ?? undefined,
    premium: record.premium ?? undefined,
    putCall: (putCall as "call" | "put") ?? undefined,
    suggestedTrade: `Buy ${record.ticker}${record.strike ? ` ${record.strike}` : ""} ${putCall === "put" ? "Puts" : "Calls"}${record.expiry ? ` exp ${record.expiry}` : ""}`,
    targetZone: record.target_zone || record.target || undefined,
    createdAt,
    source: "live",
    category: record.category,
    reason: record.reason,
    entryTrigger: record.entry_trigger,
    invalidation: record.invalidation,
  };
};

const Dashboard = () => {
  const { signals, loading } = useMarketData();
  const [persistedSignals, setPersistedSignals] = useState<MarketSignal[]>([]);
  const [persistedLoading, setPersistedLoading] = useState(true);

  useEffect(() => {
    const loadTodaysLiveSignals = async () => {
      setPersistedLoading(true);

      try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        todayStart.setHours(todayStart.getHours() - 4);

        const resp = await fetch('/api/whale/signals/history?limit=50');
        if (!resp.ok) throw new Error('Failed to fetch signal history');
        const result = await resp.json();

        setPersistedSignals((result.signals ?? []).map(recordToDashboardSignal));
      } catch (error) {
        console.warn("Failed to load persisted dashboard signals:", error);
        setPersistedSignals([]);
      } finally {
        setPersistedLoading(false);
      }
    };

    loadTodaysLiveSignals();
  }, []);


  const allMergedSignals = useMemo(() => {
    const mergedSignals = new Map<string, MarketSignal>();

    for (const signal of persistedSignals) {
      const key = `${signal.ticker}|${signal.strike}|${signal.expiry}`;
      mergedSignals.set(key, signal);
    }

    for (const signal of signals) {
      const key = `${signal.ticker}|${signal.strike}|${signal.expiry}`;
      const existing = mergedSignals.get(key);

      mergedSignals.set(key, {
        ...existing,
        ...signal,
        createdAt: existing?.createdAt ?? signal.createdAt,
      });
    }

    const all = Array.from(mergedSignals.values());
    const hasLive = all.some(s => s.source === 'live');
    const filtered = hasLive ? all.filter(s => s.source !== 'example') : all;
    return filtered
      .sort((a, b) => {
        const timeA = a.detectedAtMs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.detectedAtMs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        if (timeB !== timeA) return timeB - timeA;
        return getSignalScore(b) - getSignalScore(a);
      });
  }, [persistedSignals, signals]);

  const sortSignals = (list: MarketSignal[]) => {
    return [...list].sort((a, b) => {
      const aIs0DTE = a.timeframe === 'buy_now' || a.timeframe === 'short_term' ? 0 : 1;
      const bIs0DTE = b.timeframe === 'buy_now' || b.timeframe === 'short_term' ? 0 : 1;
      if (aIs0DTE !== bIs0DTE) return aIs0DTE - bIs0DTE;
      return getSignalScore(b) - getSignalScore(a);
    });
  };

  const algorithmPlays = useMemo(() =>
    sortSignals(
      allMergedSignals
        .filter(s => s.category === 'algorithm' || (s.category !== 'whale' && s.category !== 'spread'))
    ).slice(0, 5),
    [allMergedSignals]
  );

  const whalePlays = useMemo(() =>
    sortSignals(
      allMergedSignals
        .filter(s => s.category === 'whale')
    ).slice(0, 5),
    [allMergedSignals]
  );

  const spreadPlays = useMemo(() =>
    sortSignals(
      allMergedSignals
        .filter(s => s.category === 'spread')
    ).slice(0, 5),
    [allMergedSignals]
  );

  const dashboardFeatured = useMemo(() => [
    ...algorithmPlays.slice(0, 3),
    ...whalePlays.slice(0, 3),
    ...spreadPlays.slice(0, 3),
  ], [algorithmPlays, whalePlays, spreadPlays]);

  useEffect(() => {
    if (dashboardFeatured.length === 0) return;
    const markDashboardSignals = async () => {
      try {
        const tickers = dashboardFeatured.map(s => s.ticker);
        // Signal persistence is handled by the API server pipeline
      } catch (e) {
        console.warn("Failed to mark dashboard signals:", e);
      }
    };
    markDashboardSignals();
  }, [dashboardFeatured]);

  const signalFeedLoading = loading || persistedLoading;

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <DashboardSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <TickerTape />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
          <MarketStatusSign />
          <PerformanceSnapshot />

          <div className="grid lg:grid-cols-5 gap-4 lg:gap-6">
            <div className="lg:col-span-2 max-h-[600px]">
              <AIChatPanel />
            </div>
            <div className="lg:col-span-3 grid grid-cols-1 gap-4 lg:gap-6">
              <SignalFeedPanel
                signals={algorithmPlays}
                loading={signalFeedLoading}
                title="Algorithm Plays"
                subtitle="Price action confirmed + gamma analysis — intraday entries"
                icon="algorithm"
                limit={5}
              />
              <SignalFeedPanel
                signals={whalePlays}
                loading={signalFeedLoading}
                title="Whale Plays"
                subtitle="Institutional flow — swing positioning"
                icon="whale"
                limit={5}
              />
              <SignalFeedPanel
                signals={spreadPlays}
                loading={signalFeedLoading}
                title="Spreads & Butterflies"
                subtitle="Multi-leg strategies — defined risk plays"
                icon="spread"
                limit={5}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
