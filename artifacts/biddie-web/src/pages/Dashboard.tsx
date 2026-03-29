import { useEffect, useMemo, useState, useCallback } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import SignalFeedPanel from "@/components/dashboard/SignalFeedPanel";
import AIChatPanel from "@/components/dashboard/AIChatPanel";
import MarketStatusSign from "@/components/dashboard/MarketStatusSign";
import TickerTape from "@/components/dashboard/TickerTape";

import { useMarketData, type MarketSignal } from "@/hooks/useMarketData";
import { useRealtimePrices } from "@/hooks/useRealtimePrices";
import { useAuth } from "@/hooks/useAuth";
import MarketPulse from "@/components/dashboard/MarketPulse";
import { HelpCircle, X, Sparkles, Bot } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import biddieRobot from "@/assets/biddie-robot.png";

const getSignalScore = (signal: Pick<MarketSignal, "convictionScore" | "confidence">) =>
  signal.convictionScore ?? Math.round(signal.confidence * 10);

const formatRelativeTimestamp = (isoString: string) => {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Today";

  const eastern = new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const month = eastern.getMonth() + 1;
  const day = eastern.getDate();
  const year = eastern.getFullYear();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
  return `${month}/${day}/${year} ${time}`;
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
    description: (() => {
      let desc = record.description || record.reason ||
        `${putCall === "call" ? "Call" : "Put"} flow on ${record.ticker}${record.strike ? ` at ${record.strike}` : ""}.`;
      if (record.price_at_signal && !desc.includes('Price at $')) {
        desc += ` Price at $${Number(record.price_at_signal).toFixed(2)}.`;
      }
      return desc;
    })(),
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
    keyLevel: record.key_level,
    srLevel: record.sr_level,
    targetNear: record.target_near || undefined,
    tradeStatus: record.trade_status || null,
    aiEvaluated: !!record.is_biddie_pick,
    priceAtSignal: record.price_at_signal ? Number(record.price_at_signal) : undefined,
    outcome: record.outcome || null,
    mfePercent: record.mfe_percent != null ? Number(record.mfe_percent) : null,
    maxFavorablePrice: record.max_favorable_price != null ? Number(record.max_favorable_price) : null,
  };
};

const Dashboard = () => {
  const { signals, loading } = useMarketData();
  const { getPrice, connected: wsConnected } = useRealtimePrices();
  const { user, profile } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] || "Trader";
  const [persistedSignals, setPersistedSignals] = useState<MarketSignal[]>([]);
  const [persistedLoading, setPersistedLoading] = useState(true);
  const [takenSignalIds, setTakenSignalIds] = useState<Set<string>>(new Set());
  const [takingId, setTakingId] = useState<string | null>(null);

  const welcomeKey = user?.id ? `biddie_welcomed_${user.id}` : null;
  const [showWelcome, setShowWelcome] = useState(() => {
    if (!welcomeKey) return false;
    if (welcomeKey) localStorage.removeItem(welcomeKey);
    return true;
  });
  const dismissWelcome = () => {
    setShowWelcome(false);
    if (welcomeKey) localStorage.setItem(welcomeKey, "true");
  };

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
        const livePrice = getPrice(signal.ticker);
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
            entryPrice: livePrice?.price || signal.priceAtSignal || null,
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
      const timeA = a.detectedAtMs || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const timeB = b.detectedAtMs || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return timeB - timeA;
    });
  };

  const algorithmPlays = useMemo(() =>
    sortSignals(
      allMergedSignals
        .filter(s => (s.category === 'algorithm' || (s.category !== 'whale' && s.category !== 'spread')) && getSignalScore(s) >= 85)
    ).slice(0, 5),
    [allMergedSignals]
  );

  const whalePlays = useMemo(() =>
    sortSignals(
      allMergedSignals
        .filter(s => s.category === 'whale' && getSignalScore(s) >= 85)
    ).slice(0, 5),
    [allMergedSignals]
  );

  const spreadPlays = useMemo(() =>
    sortSignals(
      allMergedSignals
        .filter(s => s.category === 'spread' && getSignalScore(s) >= 85)
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
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[hsl(232,30%,7%)]">
            <svg className="absolute inset-0 w-full h-full opacity-[0.35]" viewBox="0 0 1000 200" preserveAspectRatio="none">
              {[40, 95, 150, 205, 260, 315, 370, 425, 480, 535, 590, 645, 700, 755, 810, 865, 920].map((x, i) => {
                const heights = [60, 45, 80, 35, 70, 90, 50, 65, 40, 85, 55, 75, 30, 60, 45, 70, 55];
                const tops = [70, 85, 50, 95, 60, 30, 80, 65, 90, 45, 75, 55, 100, 70, 85, 50, 75];
                const green = i % 3 !== 0;
                return (
                  <g key={i}>
                    <line x1={x} y1={tops[i] - 15} x2={x} y2={tops[i] + heights[i] + 15} stroke={green ? "#818cf8" : "#a78bfa"} strokeWidth="1" />
                    <rect x={x - 8} y={tops[i]} width="16" height={heights[i]} fill={green ? "#818cf8" : "#a78bfa"} rx="1" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-900/15 via-purple-900/8 to-cyan-900/10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[hsl(232,30%,7%)] via-[hsl(232,30%,7%)]/30 to-transparent" />

            <div className="relative px-6 py-7 lg:py-8">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-10 rounded-full bg-gradient-to-b from-[hsl(var(--glow-blue))] via-[hsl(var(--glow-purple))] to-[hsl(var(--glow-cyan))]" />
                  <div>
                    <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-[0.15em] uppercase bg-gradient-to-r from-white via-white to-white/50 bg-clip-text text-transparent">
                      DECISION ENGINE
                    </h1>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-[hsl(var(--glow-blue))]/80 font-semibold mt-0.5">
                      Flow · Insight · Execution
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <MarketStatusSign />

          <AnimatePresence>
            {showWelcome && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.3 }}
                className="relative overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/60 via-[hsl(232,30%,10%)] to-purple-950/40"
              >
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-indigo-500/5 via-transparent to-transparent" />
                <button
                  onClick={dismissWelcome}
                  className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/10 transition-colors z-10"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
                <div className="relative flex flex-col items-center text-center px-5 py-5 gap-3">
                  <div className="w-12 h-12 rounded-full border-2 border-indigo-500/30 shadow-lg shadow-indigo-500/10 overflow-hidden">
                    <img src={biddieRobot} alt="Biddie" className="w-[180%] h-auto -ml-[40%] -mt-[5%]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-400" />
                    <span className="text-sm font-bold text-foreground">Welcome to JORTRADE, {firstName}!</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                    Great to have you! This dashboard is filled with goodies. Real-time whale flow, AI signals, alerts, and so much more.
                    Take your time and look around, there's a lot to explore.
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                    Beginners, hover over the{" "}
                    <span className="inline-flex items-center gap-0.5 align-middle">
                      <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
                    </span>
                    {" "}icons next to signals for quick tips that explain everything in plain English. I'm here to help you learn and grow!
                  </p>
                  <button
                    onClick={dismissWelcome}
                    className="mt-1 px-5 py-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-sm font-bold text-indigo-300 hover:text-indigo-200 transition-all uppercase tracking-wider"
                  >
                    Got it, let's trade!
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <MarketPulse />

          <div className="grid lg:grid-cols-5 gap-4 lg:gap-6">
            <div className="lg:col-span-2 max-h-[600px]">
              <AIChatPanel />
            </div>
            <div className="lg:col-span-3 grid grid-cols-1 gap-4 lg:gap-6">
              <SignalFeedPanel
                signals={algorithmPlays}
                loading={signalFeedLoading}
                title="Algorithm Plays"
                subtitle="AI detected setups using price action and options flow analysis. Short to mid term entries with confirmed momentum."
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
                subtitle="Tracks large volume trades from institutions and hedge funds. Multi day swing setups following smart money."
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
                subtitle="Multi leg options strategies with defined risk. Built to cap your downside while keeping upside potential."
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
