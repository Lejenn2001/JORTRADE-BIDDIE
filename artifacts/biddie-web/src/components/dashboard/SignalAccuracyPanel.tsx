import { useState, useEffect } from "react";
import { Target, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, RefreshCw, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import type { MarketSignal } from "@/hooks/useMarketData";

interface SignalOutcome {
  id: string;
  created_at: string;
  ticker: string;
  signal_type: string;
  put_call: string | null;
  confidence: number;
  strike: string | null;
  expiry: string | null;
  target_zone: string | null;
  entry_price: number | null;
  outcome: string;
  outcome_price: number | null;
  resolved_at: string | null;
  description: string | null;
  premium: string | null;
  signal_source: string | null;
}

const outcomeIcon = (outcome: string) => {
  switch (outcome) {
    case "hit": return <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />;
    case "missed": return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "expired": return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    case "live": return <Zap className="h-3.5 w-3.5 text-primary animate-pulse" />;
    default: return <Clock className="h-3.5 w-3.5 text-amber-400 animate-pulse" />;
  }
};

const outcomeLabel = (outcome: string) => {
  switch (outcome) {
    case "live": return "DAY TRADE";
    case "pending": return "SWING";
    case "hit": return "HIT";
    case "missed": return "MISSED";
    case "expired": return "EXPIRED";
    default: return outcome.toUpperCase();
  }
};

const outcomeBadge = (outcome: string) => {
  const styles: Record<string, string> = {
    hit: "text-emerald-400 bg-emerald-400/10",
    missed: "text-destructive bg-destructive/10",
    expired: "text-muted-foreground bg-muted/20",
    pending: "text-amber-400 bg-amber-400/10",
    live: "text-primary bg-primary/10",
  };
  return styles[outcome] || styles.pending;
};

interface Props {
  isAdmin: boolean;
  liveSignals?: MarketSignal[];
}

const SignalAccuracyPanel = ({ isAdmin, liveSignals = [] }: Props) => {
  const [outcomes, setOutcomes] = useState<SignalOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);

  const fetchOutcomes = async () => {
    const { data, error } = await supabase
      .from("signal_outcomes" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) setOutcomes(data as any);
    setLoading(false);
  };

  useEffect(() => { fetchOutcomes(); }, []);

  const totalResolved = outcomes.filter((o) => o.outcome === "hit" || o.outcome === "missed").length;
  const hits = outcomes.filter((o) => o.outcome === "hit").length;
  const misses = outcomes.filter((o) => o.outcome === "missed").length;
  const pending = outcomes.filter((o) => o.outcome === "pending").length;
  const winRate = totalResolved > 0 ? ((hits / totalResolved) * 100).toFixed(1) : "—";

  // Stats by ticker
  const tickerStats = outcomes.reduce<Record<string, { hits: number; total: number }>>((acc, o) => {
    if (o.outcome !== "hit" && o.outcome !== "missed") return acc;
    if (!acc[o.ticker]) acc[o.ticker] = { hits: 0, total: 0 };
    acc[o.ticker].total++;
    if (o.outcome === "hit") acc[o.ticker].hits++;
    return acc;
  }, {});

  const verifySignals = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-signals");
      if (error) throw error;
      const remaining = data.remaining_pending || 0;
      toast({
        title: "Signals Verified",
        description: `${data.verified} checked — ${data.hits} hits, ${data.misses} misses${data.expired ? `, ${data.expired} expired` : ''}${remaining > 0 ? `. ${remaining} still pending — click again to verify more.` : ''}`,
      });
      fetchOutcomes();
    } catch (e) {
      toast({ title: "Error", description: "Failed to verify signals. Try again.", variant: "destructive" });
    }
    setVerifying(false);
  };

  // Convert live signals to table rows
  const liveRows: SignalOutcome[] = liveSignals.map((s) => ({
    id: s.id,
    created_at: new Date().toISOString(),
    ticker: s.ticker,
    signal_type: s.type,
    put_call: s.putCall || null,
    confidence: s.confidence,
    strike: s.strike || null,
    expiry: s.expiry || null,
    target_zone: s.targetZone || null,
    entry_price: null,
    outcome: "live",
    outcome_price: null,
    resolved_at: null,
    description: s.description,
    premium: s.premium || null,
    signal_source: "live_feed",
  }));

  // Deduplicate: exclude live signals that already exist in outcomes by ticker+confidence
  const existingKeys = new Set(outcomes.map((o) => `${o.ticker}-${o.confidence}`));
  const uniqueLive = liveRows.filter((l) => !existingKeys.has(`${l.ticker}-${l.confidence}`));
  const allSignals = [...uniqueLive, ...outcomes];

  return (
    <div className="glass-panel rounded-xl border-border/40 overflow-hidden mb-6">
      <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2 flex-wrap">
        <Target className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Signal Accuracy Tracker</h2>
        {uniqueLive.length > 0 && (
          <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            {uniqueLive.length} Day Trade
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{allSignals.length} tracked</span>
        {isAdmin && (
          <Button
            size="sm" variant="outline"
            className="text-xs h-7 px-3 ml-2"
            disabled={verifying}
            onClick={verifySignals}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${verifying ? "animate-spin" : ""}`} />
            {verifying ? "Checking..." : "Verify Now"}
          </Button>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Win Rate</p>
          <p className={`text-2xl font-bold ${winRate !== "—" && parseFloat(winRate as string) >= 50 ? "text-emerald-400" : winRate !== "—" ? "text-destructive" : "text-foreground"}`}>
            {winRate}{winRate !== "—" && "%"}
          </p>
          <p className="text-[9px] text-muted-foreground mt-1">Overall accuracy</p>
        </motion.div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Hits</p>
          <p className="text-2xl font-bold text-emerald-400">{hits}</p>
          <p className="text-[9px] text-muted-foreground mt-1">Played out as called</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Misses</p>
          <p className="text-2xl font-bold text-destructive">{misses}</p>
          <p className="text-[9px] text-muted-foreground mt-1">Didn't hit target</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Swing</p>
          <p className="text-2xl font-bold text-amber-400">{pending}</p>
          <p className="text-[9px] text-muted-foreground mt-1">Whale activity — did it play out?</p>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Day Trade</p>
          <p className="text-2xl font-bold text-primary">{uniqueLive.length}</p>
          <p className="text-[9px] text-muted-foreground mt-1">Live flow — what's moving now</p>
        </div>
      </div>

      {/* Per-Ticker Accuracy */}
      {Object.keys(tickerStats).length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Accuracy by Ticker</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(tickerStats)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([ticker, stats]) => {
                const rate = ((stats.hits / stats.total) * 100).toFixed(0);
                return (
                  <span key={ticker} className="inline-flex items-center gap-1.5 text-xs bg-muted/20 px-2.5 py-1.5 rounded-lg">
                    <span className="font-bold text-foreground">{ticker}</span>
                    <span className={`font-semibold ${parseInt(rate) >= 50 ? "text-emerald-400" : "text-destructive"}`}>{rate}%</span>
                    <span className="text-muted-foreground">({stats.hits}/{stats.total})</span>
                  </span>
                );
              })}
          </div>
        </div>
      )}

      {/* Signals Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-b border-border/30">
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">Status</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">Ticker</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">Direction</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">Score</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">Strike</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-muted-foreground uppercase">Resolved</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">Loading...</td></tr>
            )}
            {!loading && allSignals.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs">
                No signals tracked yet. Signals are auto-logged when detected from live flow data.
              </td></tr>
            )}
            {allSignals.slice(0, 30).map((o) => (
              <tr key={o.id} className={`border-b border-border/20 hover:bg-muted/20 transition-colors ${o.outcome === "live" ? "bg-primary/5" : ""}`}>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${outcomeBadge(o.outcome)}`}>
                    {outcomeIcon(o.outcome)}
                    {outcomeLabel(o.outcome)}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-bold text-foreground">{o.ticker}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1 text-xs">
                    {o.signal_type === "bullish" ? <TrendingUp className="h-3 w-3 text-primary" /> : <TrendingDown className="h-3 w-3 text-destructive" />}
                    <span className={o.signal_type === "bullish" ? "text-primary" : "text-destructive"}>
                      {o.put_call ? o.put_call.toUpperCase() : o.signal_type}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs font-semibold text-foreground">{o.confidence}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{o.strike || "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {o.outcome === "live" ? (
                    <span className="text-primary flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      active
                    </span>
                  ) : o.outcome_price ? (
                    <span>${o.outcome_price.toFixed(2)}</span>
                  ) : o.outcome === "pending" ? (
                    <span className="text-amber-400">awaiting</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SignalAccuracyPanel;
