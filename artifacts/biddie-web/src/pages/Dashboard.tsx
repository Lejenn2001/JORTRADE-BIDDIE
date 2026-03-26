import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import SignalFeedPanel from "@/components/dashboard/SignalFeedPanel";
import AIChatPanel from "@/components/dashboard/AIChatPanel";
import PortfolioPanel from "@/components/dashboard/PortfolioPanel";
import MarketStatusSign from "@/components/dashboard/MarketStatusSign";
import TickerTape from "@/components/dashboard/TickerTape";
import PerformanceSnapshot from "@/components/dashboard/PerformanceSnapshot";
import { useMarketData, type MarketSignal, type SignalCategory } from "@/hooks/useMarketData";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type SignalOutcomeRow = Tables<"signal_outcomes">;

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

const recordToDashboardSignal = (record: SignalOutcomeRow): MarketSignal => {
  const confidence = Number(record.confidence) || 0;
  const convictionScore = Math.round(confidence * 10);
  const isBullish = record.signal_type === "bullish";
  const tags = [record.put_call === "call" ? "Call Flow" : "Put Flow"];

  if (convictionScore >= 85) tags.push("🔥 ACT NOW");
  else if (convictionScore >= 70) tags.push("⚡ HIGH CONVICTION");

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
      record.description ||
      `${record.put_call === "call" ? "Call" : "Put"} flow on ${record.ticker}${record.strike ? ` at ${record.strike}` : ""}.`,
    timestamp: formatRelativeTimestamp(record.created_at),
    tags,
    strike: record.strike ?? undefined,
    expiry: record.expiry ?? undefined,
    premium: record.premium ?? undefined,
    putCall: (record.put_call as "call" | "put" | null) ?? undefined,
    suggestedTrade: `Buy ${record.ticker}${record.strike ? ` ${record.strike}` : ""} ${record.put_call === "put" ? "Puts" : "Calls"}${record.expiry ? ` exp ${record.expiry}` : ""}`,
    targetZone: record.target_zone ?? undefined,
    createdAt: record.created_at,
    source: "live",
  };
};

const Dashboard = () => {
  const { signals, whaleAlerts, loading } = useMarketData();
  const [persistedSignals, setPersistedSignals] = useState<MarketSignal[]>([]);
  const [persistedLoading, setPersistedLoading] = useState(true);

  useEffect(() => {
    const loadTodaysLiveSignals = async () => {
      setPersistedLoading(true);

      try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        todayStart.setHours(todayStart.getHours() - 4);

        const { data, error } = await supabase
          .from("signal_outcomes")
          .select("*")
          .eq("signal_source", "replit")
          .gte("created_at", todayStart.toISOString())
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        setPersistedSignals((data ?? []).map(recordToDashboardSignal));
      } catch (error) {
        console.warn("Failed to load persisted dashboard signals:", error);
        setPersistedSignals([]);
      } finally {
        setPersistedLoading(false);
      }
    };

    loadTodaysLiveSignals();
  }, []);

  // Realtime: new inserts into signal_outcomes appear instantly
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-signals-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "signal_outcomes",
          filter: "signal_source=eq.replit",
        },
        (payload) => {
          const row = payload.new as SignalOutcomeRow;
          const mapped = recordToDashboardSignal(row);
          setPersistedSignals((prev) => {
            // Deduplicate by ticker|strike|expiry
            const key = `${mapped.ticker}|${mapped.strike}|${mapped.expiry}`;
            const exists = prev.some(
              (s) => `${s.ticker}|${s.strike}|${s.expiry}` === key
            );
            if (exists) return prev;
            return [mapped, ...prev];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

    return Array.from(mergedSignals.values())
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : Date.now();
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : Date.now();
        if (timeB !== timeA) return timeB - timeA;
        return getSignalScore(b) - getSignalScore(a);
      });
  }, [persistedSignals, signals]);

  const algorithmPlays = useMemo(() =>
    allMergedSignals
      .filter(s => s.category === 'algorithm' || (s.category !== 'whale' && s.category !== 'spread'))
      .filter(s => getSignalScore(s) >= 70)
      .sort((a, b) => getSignalScore(b) - getSignalScore(a))
      .slice(0, 5),
    [allMergedSignals]
  );

  const whalePlays = useMemo(() =>
    allMergedSignals
      .filter(s => s.category === 'whale')
      .sort((a, b) => getSignalScore(b) - getSignalScore(a))
      .slice(0, 5),
    [allMergedSignals]
  );

  const spreadPlays = useMemo(() =>
    allMergedSignals
      .filter(s => s.category === 'spread')
      .sort((a, b) => getSignalScore(b) - getSignalScore(a))
      .slice(0, 5),
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
        const { data: existing } = await supabase
          .from("signal_outcomes" as any)
          .select("id, ticker, strike, expiry, signal_source")
          .in("ticker", tickers)
          .eq("signal_source", "replit")
          .eq("outcome", "pending");

        if (!existing || existing.length === 0) return;

        const featuredKeys = new Set(dashboardFeatured.map(s => `${s.ticker}|${s.strike}|${s.expiry}`));
        const toUpdate = existing.filter((e: any) => featuredKeys.has(`${e.ticker}|${e.strike}|${e.expiry}`));

        if (toUpdate.length > 0) {
          const ids = toUpdate.map((e: any) => e.id);
          await supabase
            .from("signal_outcomes" as any)
            .update({ signal_source: "dashboard" })
            .in("id", ids);
        }
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
                limit={3}
              />
              <SignalFeedPanel
                signals={whalePlays}
                loading={signalFeedLoading}
                title="Whale Plays"
                subtitle="Institutional flow — swing positioning"
                icon="whale"
                limit={3}
              />
              <SignalFeedPanel
                signals={spreadPlays}
                loading={signalFeedLoading}
                title="Spreads & Butterflies"
                subtitle="Multi-leg strategies — defined risk plays"
                icon="spread"
                limit={3}
              />
              <PortfolioPanel whaleAlerts={whaleAlerts} loading={loading} limit={6} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
