import { useEffect, useMemo, useState, useCallback } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import SignalFeedPanel from "@/components/dashboard/SignalFeedPanel";
import AIChatPanel from "@/components/dashboard/AIChatPanel";
import MarketStatusSign from "@/components/dashboard/MarketStatusSign";
import TickerTape from "@/components/dashboard/TickerTape";
import PerformanceCalendar from "@/components/dashboard/PerformanceCalendar";

import { useMarketData, type MarketSignal } from "@/hooks/useMarketData";
import { useRealtimePrices } from "@/hooks/useRealtimePrices";
import { useAuth } from "@/hooks/useAuth";

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
  let convictionScore = Math.round(confidence * 10);
  if (confidence >= 9) convictionScore = Math.max(convictionScore, 92);
  else if (confidence >= 8) convictionScore = Math.max(convictionScore, 85);
  else if (confidence >= 7) convictionScore = Math.max(convictionScore, 78);
  else if (confidence >= 6) convictionScore = Math.max(convictionScore, 70);
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
      : convictionScore >= 80
        ? "Very High Conviction"
        : convictionScore >= 68
          ? "High Conviction"
          : convictionScore >= 50
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
    aiEvaluated: true,
    outcome: record.outcome || null,
  };
};

const Dashboard = () => {
  const { signals, loading } = useMarketData();
  const { getPrice, connected: wsConnected } = useRealtimePrices();
  const { user } = useAuth();
  const [persistedSignals, setPersistedSignals] = useState<MarketSignal[]>([]);
  const [persistedLoading, setPersistedLoading] = useState(true);
  const [takenSignalIds, setTakenSignalIds] = useState<Set<string>>(new Set());
  const [takingId, setTakingId] = useState<string | null>(null);

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


  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/whale/trades?userId=${user.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.trades) {
          setTakenSignalIds(new Set(data.trades.map((t: any) => t.signal_id)));
        }
      })
      .catch(() => {});
  }, [user?.id]);

  const handleTakeTrade = useCallback(async (signal: MarketSignal) => {
    if (!user?.id) return;
    const isTaken = takenSignalIds.has(signal.id);
    setTakingId(signal.id);
    try {
      if (isTaken) {
        await fetch(`/api/whale/trades/${signal.id}?userId=${user.id}`, { method: "DELETE" });
        setTakenSignalIds(prev => { const next = new Set(prev); next.delete(signal.id); return next; });
      } else {
        await fetch("/api/whale/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            signalId: signal.id,
            ticker: signal.ticker,
            direction: signal.type,
            category: signal.category || "algorithm",
            strike: signal.strike,
            expiry: signal.expiry,
            optionType: signal.putCall,
            entryTrigger: signal.entryTrigger,
            target: signal.targetZone,
            invalidation: signal.invalidation,
            convictionScore: signal.convictionScore ?? Math.round(signal.confidence * 10),
          }),
        });
        setTakenSignalIds(prev => new Set(prev).add(signal.id));
      }
    } catch (e) {
      console.error("Trade toggle error:", e);
    } finally {
      setTakingId(null);
    }
  }, [user?.id, takenSignalIds]);

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
    const filtered = all;
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

          <PerformanceCalendar compact />

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
                takenSignalIds={takenSignalIds}
                takingId={takingId}
                onTakeTrade={handleTakeTrade}
                getPrice={getPrice}
                wsConnected={wsConnected}
              />
              <SignalFeedPanel
                signals={whalePlays}
                loading={signalFeedLoading}
                title="Whale Plays"
                subtitle="Institutional flow — swing positioning"
                icon="whale"
                limit={5}
                takenSignalIds={takenSignalIds}
                takingId={takingId}
                onTakeTrade={handleTakeTrade}
                getPrice={getPrice}
                wsConnected={wsConnected}
              />
              <SignalFeedPanel
                signals={spreadPlays}
                loading={signalFeedLoading}
                title="Spreads & Butterflies"
                subtitle="Multi-leg strategies — defined risk plays"
                icon="spread"
                limit={5}
                takenSignalIds={takenSignalIds}
                takingId={takingId}
                onTakeTrade={handleTakeTrade}
                getPrice={getPrice}
                wsConnected={wsConnected}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
