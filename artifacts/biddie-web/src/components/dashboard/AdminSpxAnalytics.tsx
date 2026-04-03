import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, TrendingUp, TrendingDown, Target, Zap, Flame, Shield, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, BarChart3, Crosshair, Gauge, Clock, CheckCircle2, XCircle, Eye, Calendar } from "lucide-react";

interface SpxSignal {
  id: string;
  ticker: string;
  signal_type: string;
  direction: string;
  confidence: number;
  conviction_score: number;
  category: string;
  option_type: string;
  strike: number | null;
  premium: number | null;
  entry_trigger: string;
  target: string;
  target_near: string;
  invalidation: string;
  trade_status: string;
  is_biddie_pick: boolean;
  gamma_zone: string;
  gamma_description: string;
  detected_at: string;
  price_at_signal: number | null;
  reason: string;
  tags: string[];
  expiry: string;
  signal_quality: string;
  key_level: string;
  sr_level: string;
  mfe_percent: number | null;
  max_favorable_price: number | null;
}

interface VwapData {
  vwap: number;
  currentPrice: number;
  priceVsVwap: string;
  recentCross: { direction: string; price: number; barsAgo: number } | null;
  retest: { type: string } | null;
  swingHigh: number;
  swingLow: number;
  allSwingHighs: number[];
  allSwingLows: number[];
  barCount: number;
  dayDate: string;
  updatedAt: string;
}

interface GexData {
  gammaFlip: number | null;
  callWall: { price: number; gex: number } | null;
  putWall: { price: number; gex: number } | null;
  keyMagnet: { price: number; gex: number };
  dealerPositioning: string;
  currentPrice: number;
  updatedAt: string;
}

interface FlowArchiveDate {
  flow_date: string;
  flow_count: string;
}

const AdminSpxAnalytics = () => {
  const [signals, setSignals] = useState<SpxSignal[]>([]);
  const [vwap, setVwap] = useState<VwapData | null>(null);
  const [gex, setGex] = useState<GexData | null>(null);
  const [archiveDates, setArchiveDates] = useState<FlowArchiveDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  const fetchAll = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [sigRes, vwapRes, gexRes, archRes] = await Promise.all([
        fetch("/api/whale/spx-signals"),
        fetch("/api/whale/spx-vwap"),
        fetch("/api/whale/gex/spx"),
        fetch("/api/whale/flow-archive/dates"),
      ]);

      if (sigRes.ok) {
        const d = await sigRes.json();
        setSignals(d.signals || []);
      }
      if (vwapRes.ok) {
        const d = await vwapRes.json();
        if (d.vwap) setVwap(d);
      }
      if (gexRes.ok) {
        const d = await gexRes.json();
        if (d.gex) setGex(d.gex);
        else if (d.gammaFlip !== undefined) setGex(d);
      }
      if (archRes.ok) {
        const d = await archRes.json();
        setArchiveDates(d.dates || []);
      }
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  const forceVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/whale/verify-signals", { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setVerifyResult(`Verified ${d.verified}: ${d.hits}H / ${d.partial_hits || 0}P / ${d.misses}M / ${d.expired}E`);
        await fetchAll(true);
      } else {
        setVerifyResult("Verify failed");
      }
    } catch {
      setVerifyResult("Verify error");
    }
    setVerifying(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtK = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const resolveStatus = (s: SpxSignal): string => {
    let ts = s.trade_status || "watching";
    if (ts === "watching" || ts === "active") {
      const isExpired = s.expiry ? new Date(s.expiry) < new Date() : false;
      const mfe = s.mfe_percent ?? 0;
      if (isExpired && mfe >= 75) ts = "hit";
      else if (isExpired && mfe >= 50) ts = "partial";
      else if (isExpired && mfe >= 30) ts = "near_miss";
      else if (isExpired) ts = "miss";
    }
    return ts;
  };

  const resolved_signals = signals.map(s => ({ ...s, trade_status: resolveStatus(s) }));
  const totalSignals = resolved_signals.length;
  const biddiePickCount = resolved_signals.filter(s => s.is_biddie_pick).length;
  const bullish = resolved_signals.filter(s => s.direction === "bullish").length;
  const bearish = resolved_signals.filter(s => s.direction === "bearish").length;
  const neutral = totalSignals - bullish - bearish;

  const hits = resolved_signals.filter(s => s.trade_status === "hit").length;
  const misses = resolved_signals.filter(s => s.trade_status === "miss").length;
  const partials = resolved_signals.filter(s => ["partial", "partial_hit"].includes(s.trade_status)).length;
  const nearMisses = resolved_signals.filter(s => s.trade_status === "near_miss").length;
  const active = resolved_signals.filter(s => s.trade_status === "active").length;
  const watching = resolved_signals.filter(s => s.trade_status === "watching").length;
  const expired = resolved_signals.filter(s => s.trade_status === "expired").length;
  const resolved = hits + partials + misses + nearMisses;
  const winRate = resolved > 0 ? (((hits + partials) / resolved) * 100).toFixed(1) : "—";

  const avgConfidence = totalSignals > 0
    ? (resolved_signals.reduce((sum, s) => sum + (s.confidence || 0), 0) / totalSignals).toFixed(1)
    : "—";

  const totalPremium = resolved_signals.reduce((sum, s) => sum + (s.premium || 0), 0);

  const byCategory: Record<string, SpxSignal[]> = {};
  resolved_signals.forEach(s => {
    const cat = s.category || "unknown";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(s);
  });

  const byOptionType: Record<string, number> = {};
  resolved_signals.forEach(s => {
    const ot = s.option_type || "unknown";
    byOptionType[ot] = (byOptionType[ot] || 0) + 1;
  });

  const gammaZones: Record<string, number> = {};
  resolved_signals.forEach(s => {
    if (s.gamma_zone) {
      gammaZones[s.gamma_zone] = (gammaZones[s.gamma_zone] || 0) + 1;
    }
  });

  const byExpiry: Record<string, number> = {};
  resolved_signals.forEach(s => {
    const exp = s.expiry || "unknown";
    byExpiry[exp] = (byExpiry[exp] || 0) + 1;
  });

  const byQuality: Record<string, number> = {};
  resolved_signals.forEach(s => {
    const q = s.signal_quality || "standard";
    byQuality[q] = (byQuality[q] || 0) + 1;
  });

  const totalArchiveFlows = archiveDates.reduce((s, d) => s + parseInt(d.flow_count || "0"), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">SPX Analytics</h2>
            <p className="text-xs text-muted-foreground">Live SPX/SPXW signal data, VWAP, and GEX levels</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={forceVerify}
            disabled={verifying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            <CheckCircle2 className={`h-3.5 w-3.5 ${verifying ? "animate-pulse" : ""}`} />
            {verifying ? "Verifying..." : "Force Verify"}
          </button>
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium hover:bg-cyan-500/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {verifyResult && (
        <div className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
          {verifyResult}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="SPX Signals" value={totalSignals} sub={`${biddiePickCount} Biddie Picks`} color="cyan" icon={<Activity className="h-4 w-4" />} />
        <MetricCard label="Win Rate" value={winRate === "—" ? "—" : `${winRate}%`} sub={`${hits}H / ${partials}P / ${nearMisses}NM / ${misses}M`} color={winRate !== "—" && parseFloat(winRate) >= 60 ? "emerald" : winRate !== "—" && parseFloat(winRate) >= 40 ? "yellow" : winRate !== "—" ? "red" : "cyan"} icon={<Target className="h-4 w-4" />} />
        <MetricCard label="Avg Confidence" value={avgConfidence} sub="out of 10" color="violet" icon={<Flame className="h-4 w-4" />} />
        <MetricCard label="Total Premium" value={fmtK(totalPremium)} sub={`across ${totalSignals} signals`} color="blue" icon={<Zap className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatusPill label="Watching" count={watching} icon={<Eye className="h-3 w-3" />} color="text-muted-foreground" bg="bg-muted/20" />
        <StatusPill label="Active" count={active} icon={<Zap className="h-3 w-3" />} color="text-blue-400" bg="bg-blue-500/10" />
        <StatusPill label="Hit (≥75%)" count={hits} icon={<CheckCircle2 className="h-3 w-3" />} color="text-emerald-400" bg="bg-emerald-500/10" />
        <StatusPill label="Partial (50-74%)" count={partials} icon={<CheckCircle2 className="h-3 w-3" />} color="text-blue-400" bg="bg-blue-500/10" />
        <StatusPill label="Near Miss (30-49%)" count={nearMisses} icon={<Target className="h-3 w-3" />} color="text-orange-400" bg="bg-orange-500/10" />
        <StatusPill label="Miss (<30%)" count={misses} icon={<XCircle className="h-3 w-3" />} color="text-red-400" bg="bg-red-500/10" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-cyan-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp className="h-3.5 w-3.5 text-cyan-400" />
            Direction Bias
          </h3>
          <div className="space-y-2">
            <DirectionBar label="Bullish" count={bullish} total={totalSignals} color="emerald" />
            <DirectionBar label="Bearish" count={bearish} total={totalSignals} color="red" />
            <DirectionBar label="Neutral" count={neutral} total={totalSignals} color="yellow" />
          </div>
        </div>

        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-violet-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-violet-400" />
            By Category
          </h3>
          <div className="space-y-2">
            {Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length).map(([cat, sigs]) => {
              const catHits = sigs.filter(s => s.trade_status === "hit").length;
              const catMisses = sigs.filter(s => s.trade_status === "miss").length;
              const catResolved = catHits + catMisses;
              const catWr = catResolved > 0 ? ((catHits / catResolved) * 100).toFixed(0) : "—";
              return (
                <div key={cat} className="flex items-center justify-between text-xs">
                  <span className="capitalize text-muted-foreground">{cat}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{sigs.length}</span>
                    <span className={`font-medium ${catWr !== "—" && parseFloat(catWr) >= 60 ? "text-emerald-400" : catWr !== "—" && parseFloat(catWr) >= 40 ? "text-yellow-400" : catWr !== "—" ? "text-red-400" : "text-muted-foreground"}`}>
                      {catWr !== "—" ? `${catWr}%` : "pending"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-blue-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Crosshair className="h-3.5 w-3.5 text-blue-400" />
            Option Types
          </h3>
          <div className="space-y-2">
            {Object.entries(byOptionType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <span className="uppercase text-muted-foreground">{type}</span>
                <span className="font-bold text-foreground">{count}</span>
              </div>
            ))}
          </div>
          {Object.keys(gammaZones).length > 0 && (
            <>
              <div className="border-t border-white/5 my-2 pt-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Gamma Zones</p>
                {Object.entries(gammaZones).map(([zone, count]) => (
                  <div key={zone} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground capitalize">{zone.replace(/_/g, " ")}</span>
                    <span className="font-bold text-foreground">{count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {Object.keys(byExpiry).length > 0 && (
        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-yellow-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-yellow-400" />
            By Expiry Date
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byExpiry).sort().map(([exp, count]) => (
              <div key={exp} className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs">
                <span className="text-yellow-400 font-medium">{exp}</span>
                <span className="text-muted-foreground ml-1.5">{count} signal{count > 1 ? "s" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-emerald-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 text-emerald-400" />
            SPX VWAP (Polygon I:SPX)
          </h3>
          {vwap ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">VWAP</p>
                  <p className="text-xl font-black text-emerald-400">${fmt(vwap.vwap)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Current Price</p>
                  <p className="text-xl font-black text-foreground">${fmt(vwap.currentPrice)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full font-medium ${
                  vwap.priceVsVwap === "above" ? "bg-emerald-500/15 text-emerald-400" :
                  vwap.priceVsVwap === "below" ? "bg-red-500/15 text-red-400" :
                  "bg-yellow-500/15 text-yellow-400"
                }`}>
                  {vwap.priceVsVwap === "above" ? <ArrowUpRight className="h-3 w-3 inline mr-1" /> :
                   vwap.priceVsVwap === "below" ? <ArrowDownRight className="h-3 w-3 inline mr-1" /> :
                   <Minus className="h-3 w-3 inline mr-1" />}
                  {vwap.priceVsVwap.charAt(0).toUpperCase() + vwap.priceVsVwap.slice(1)} VWAP
                </span>
                {vwap.recentCross && (
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-[10px]">
                    Cross {vwap.recentCross.direction} ({vwap.recentCross.barsAgo} bars ago)
                  </span>
                )}
                {vwap.retest && (
                  <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 text-[10px]">
                    Retest: {vwap.retest.type}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[10px] text-muted-foreground">Swing Highs</p>
                  <p className="font-bold text-foreground">
                    {vwap.allSwingHighs?.length > 0 ? vwap.allSwingHighs.map(h => `$${fmt(h)}`).join(", ") : `$${fmt(vwap.swingHigh)}`}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Swing Lows</p>
                  <p className="font-bold text-foreground">
                    {vwap.allSwingLows?.length > 0 ? vwap.allSwingLows.map(l => `$${fmt(l)}`).join(", ") : `$${fmt(vwap.swingLow)}`}
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">{vwap.barCount} bars loaded · {vwap.dayDate} · Updated {new Date(vwap.updatedAt).toLocaleTimeString()}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">VWAP data not yet available — market may be closed or still loading</p>
          )}
        </div>

        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-orange-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Flame className="h-3.5 w-3.5 text-orange-400" />
            SPX GEX Levels
          </h3>
          {gex ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Gamma Flip</p>
                  <p className="text-xl font-black text-orange-400">
                    {gex.gammaFlip ? `$${fmt(gex.gammaFlip)}` : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">SPX Price</p>
                  <p className="text-xl font-black text-foreground">${fmt(gex.currentPrice)}</p>
                </div>
              </div>
              <div className={`px-3 py-2 rounded-lg text-xs font-medium ${
                gex.dealerPositioning.includes("Long") ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                gex.dealerPositioning.includes("Short") ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                "bg-muted/20 text-muted-foreground border border-white/10"
              }`}>
                {gex.dealerPositioning.includes("Long") ? <Shield className="h-3 w-3 inline mr-1.5" /> :
                 gex.dealerPositioning.includes("Short") ? <Zap className="h-3 w-3 inline mr-1.5" /> : null}
                {gex.dealerPositioning}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                  <p className="text-[10px] text-muted-foreground">Call Wall</p>
                  <p className="font-bold text-emerald-400">{gex.callWall ? `$${fmt(gex.callWall.price)}` : "—"}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
                  <p className="text-[10px] text-muted-foreground">Key Magnet</p>
                  <p className="font-bold text-blue-400">${fmt(gex.keyMagnet.price)}</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                  <p className="text-[10px] text-muted-foreground">Put Wall</p>
                  <p className="font-bold text-red-400">{gex.putWall ? `$${fmt(gex.putWall.price)}` : "—"}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Updated {new Date(gex.updatedAt).toLocaleTimeString()}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">GEX data not available — Unusual Whales feed may be offline</p>
          )}
        </div>
      </div>

      <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-indigo-500/5 via-background to-background">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-indigo-400" />
          Flow Archive History
        </h3>
        {archiveDates.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {archiveDates.length} trading days archived · {totalArchiveFlows.toLocaleString()} total SPX/SPXW flows saved
            </p>
            <div className="flex flex-wrap gap-2">
              {archiveDates.slice(0, 14).map(d => (
                <div key={d.flow_date} className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs">
                  <span className="text-indigo-400 font-medium">{new Date(d.flow_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <span className="text-muted-foreground ml-1.5">{d.flow_count} flows</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No archive data yet — flows archive daily at 4:15 PM ET</p>
        )}
      </div>

      {signals.length > 0 && (
        <div className="rounded-xl p-4 border border-white/10 bg-gradient-to-br from-cyan-500/5 via-background to-background">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            SPX Signals ({signals.length})
          </h3>
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
            {signals.map(s => (
              <div key={s.id}>
                <div
                  onClick={() => setExpandedSignal(expandedSignal === s.id ? null : s.id)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 text-xs cursor-pointer hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      s.trade_status === "hit" ? "bg-emerald-400" : s.trade_status === "miss" ? "bg-red-400" :
                      s.direction === "bullish" ? "bg-emerald-400/50" : s.direction === "bearish" ? "bg-red-400/50" : "bg-yellow-400/50"
                    }`} />
                    <span className="font-bold text-cyan-400">{s.ticker}</span>
                    <span className="text-muted-foreground uppercase">{s.option_type}</span>
                    {s.strike && <span className="text-foreground font-medium">${s.strike}</span>}
                    <span className="text-muted-foreground capitalize truncate">{s.category}</span>
                    {s.is_biddie_pick && <span className="px-1 py-0.5 rounded text-[9px] bg-cyan-500/15 text-cyan-400 font-medium">PICK</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-violet-400 text-[10px]">{s.confidence}/10</span>
                    {s.premium && <span className="text-blue-400">{fmtK(s.premium)}</span>}
                    {s.mfe_percent != null && (
                      <span className={`text-[10px] font-bold ${
                        s.mfe_percent >= 75 ? "text-emerald-400" :
                        s.mfe_percent >= 50 ? "text-blue-400" :
                        s.mfe_percent >= 30 ? "text-orange-400" :
                        "text-red-400"
                      }`}>
                        {s.mfe_percent.toFixed(0)}%
                      </span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      s.trade_status === "hit" ? "bg-emerald-500/15 text-emerald-400" :
                      s.trade_status === "miss" ? "bg-red-500/15 text-red-400" :
                      ["partial", "partial_hit"].includes(s.trade_status) ? "bg-blue-500/15 text-blue-400" :
                      s.trade_status === "near_miss" ? "bg-orange-500/15 text-orange-400" :
                      s.trade_status === "active" ? "bg-cyan-500/15 text-cyan-400" :
                      s.trade_status === "expired" ? "bg-yellow-500/15 text-yellow-400" :
                      "bg-muted/20 text-muted-foreground"
                    }`}>
                      {s.trade_status === "hit" ? "WIN" : s.trade_status === "partial_hit" ? "WIN" : s.trade_status === "near_miss" ? "LOSS" : s.trade_status === "missed" ? "LOSS" : (s.trade_status || "watching").toUpperCase()}
                    </span>
                    <span className="text-muted-foreground w-16 text-right">
                      {new Date(s.detected_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
                {expandedSignal === s.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mx-3 mb-1 px-3 py-2.5 rounded-b-lg bg-white/[0.03] border border-t-0 border-white/5 text-[11px] space-y-2"
                  >
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <span className="text-muted-foreground">Entry:</span>
                        <span className="ml-1 text-foreground font-medium">{s.entry_trigger || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Target:</span>
                        <span className="ml-1 text-emerald-400 font-medium">{s.target || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Invalidation:</span>
                        <span className="ml-1 text-red-400 font-medium">{s.invalidation || "—"}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <span className="text-muted-foreground">Price@Signal:</span>
                        <span className="ml-1 text-foreground">{s.price_at_signal ? `$${fmt(s.price_at_signal)}` : "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Expiry:</span>
                        <span className="ml-1 text-yellow-400">{s.expiry || "—"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Quality:</span>
                        <span className="ml-1 text-foreground capitalize">{s.signal_quality || "standard"}</span>
                      </div>
                    </div>
                    {s.mfe_percent != null && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">MFE:</span>
                        <span className={`font-bold ${
                          s.mfe_percent >= 75 ? "text-emerald-400" :
                          s.mfe_percent >= 50 ? "text-blue-400" :
                          s.mfe_percent >= 30 ? "text-orange-400" :
                          "text-red-400"
                        }`}>
                          {s.mfe_percent.toFixed(1)}%
                        </span>
                        {(() => {
                          const isResolved = ["hit", "miss", "partial", "partial_hit", "near_miss", "expired"].includes(s.trade_status);
                          const isExp = s.expiry ? new Date(s.expiry) < new Date() : false;
                          const showV = isResolved || isExp;
                          return showV ? (
                            <span className={`inline-flex items-center h-4 text-[9px] font-bold px-1.5 rounded-full ${
                              s.mfe_percent >= 50 ? "bg-emerald-400/15 text-emerald-400" :
                              s.mfe_percent >= 30 ? "bg-orange-400/15 text-orange-400" :
                              "bg-red-400/15 text-red-400"
                            }`}>
                              {s.mfe_percent >= 50 ? "WIN" : s.mfe_percent >= 30 ? "NEAR" : "LOSS"}
                            </span>
                          ) : null;
                        })()}
                        {s.max_favorable_price && (
                          <span className="text-muted-foreground">(best: ${fmt(s.max_favorable_price)})</span>
                        )}
                      </div>
                    )}
                    {s.gamma_zone && (
                      <div>
                        <span className="text-muted-foreground">Gamma:</span>
                        <span className="ml-1 text-orange-400 capitalize">{s.gamma_zone.replace(/_/g, " ")}</span>
                        {s.gamma_description && <span className="ml-1 text-muted-foreground">— {s.gamma_description}</span>}
                      </div>
                    )}
                    {s.reason && (
                      <div>
                        <span className="text-muted-foreground">Reason:</span>
                        <span className="ml-1 text-foreground">{s.reason}</span>
                      </div>
                    )}
                    {s.tags && s.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {s.tags.map((tag, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[9px]">{tag}</span>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};

const colorMap: Record<string, { border: string; bg: string; text: string }> = {
  cyan: { border: "border-cyan-500/20", bg: "from-cyan-500/5", text: "text-cyan-400" },
  emerald: { border: "border-emerald-500/20", bg: "from-emerald-500/5", text: "text-emerald-400" },
  yellow: { border: "border-yellow-500/20", bg: "from-yellow-500/5", text: "text-yellow-400" },
  red: { border: "border-red-500/20", bg: "from-red-500/5", text: "text-red-400" },
  violet: { border: "border-violet-500/20", bg: "from-violet-500/5", text: "text-violet-400" },
  blue: { border: "border-blue-500/20", bg: "from-blue-500/5", text: "text-blue-400" },
};

const barColorMap: Record<string, string> = {
  emerald: "bg-emerald-400",
  red: "bg-red-400",
  yellow: "bg-yellow-400",
};

const MetricCard = ({ label, value, sub, color, icon }: { label: string; value: string | number; sub: string; color: string; icon: React.ReactNode }) => {
  const c = colorMap[color] || colorMap.cyan;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-4 border ${c.border} bg-gradient-to-br ${c.bg} via-background to-background`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={c.text}>{icon}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-black ${c.text}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
    </motion.div>
  );
};

const StatusPill = ({ label, count, icon, color, bg }: { label: string; count: number; icon: React.ReactNode; color: string; bg: string }) => (
  <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${bg} border border-white/5 text-xs`}>
    <div className={`flex items-center gap-1.5 ${color}`}>
      {icon}
      <span className="font-medium">{label}</span>
    </div>
    <span className={`font-bold ${color}`}>{count}</span>
  </div>
);

const DirectionBar = ({ label, count, total, color }: { label: string; count: number; total: number; color: string }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const barColor = barColorMap[color] || "bg-cyan-400";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-muted/20 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-bold text-foreground w-6 text-right">{count}</span>
      <span className="text-muted-foreground w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
};

export default AdminSpxAnalytics;
