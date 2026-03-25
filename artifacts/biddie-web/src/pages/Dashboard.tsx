import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import SignalFeedPanel from "@/components/dashboard/SignalFeedPanel";
import AIChatPanel from "@/components/dashboard/AIChatPanel";
import PortfolioPanel from "@/components/dashboard/PortfolioPanel";
import MarketStatusSign from "@/components/dashboard/MarketStatusSign";
import TickerTape from "@/components/dashboard/TickerTape";
import PerformanceSnapshot from "@/components/dashboard/PerformanceSnapshot";
import { useMarketData, type MarketSignal } from "@/hooks/useMarketData";
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

  // Dashboard only shows the latest extreme live signals from today.
  const topSignals = useMemo(() => {
    const mergedSignals = new Map<string, MarketSignal>();

    for (const signal of persistedSignals) {
      const key = `${signal.ticker}|${signal.strike}|${signal.expiry}`;
      mergedSignals.set(key, signal);
    }

    for (const signal of signals) {
      if (signal.source !== "live") continue;
      if (getSignalScore(signal) < 90) continue;

      const key = `${signal.ticker}|${signal.strike}|${signal.expiry}`;
      const existing = mergedSignals.get(key);

      mergedSignals.set(key, {
        ...existing,
        ...signal,
        createdAt: existing?.createdAt ?? signal.createdAt,
      });
    }

    return Array.from(mergedSignals.values())
      .filter((signal) => getSignalScore(signal) >= 90)
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : Date.now();
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : Date.now();

        if (timeB !== timeA) return timeB - timeA;

        return getSignalScore(b) - getSignalScore(a);
      })
      .slice(0, 3);
  }, [persistedSignals, signals]);

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
              <SignalFeedPanel signals={topSignals} loading={signalFeedLoading} />
              <PortfolioPanel whaleAlerts={whaleAlerts} loading={loading} limit={6} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Dashboard;
