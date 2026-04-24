import { useEffect, useMemo, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, AlertTriangle, RefreshCcw, Loader2, TrendingUp, TrendingDown, X, Trash2 } from "lucide-react";

interface PaperTrade {
  id: string;
  signal_id: string;
  ticker: string;
  option_type: "call" | "put";
  strike: string;
  expiry: string;
  contract_symbol: string;
  contracts: number;
  entry_price: string;
  entry_fill_source: string;
  entry_underlying: string | null;
  entry_iv: string | null;
  entry_delta: string | null;
  signal_target: string | null;
  signal_invalidation: string | null;
  signal_entry: string | null;
  signal_grade: string | null;
  signal_confidence: string | null;
  opened_at: string;
  status: "open" | "closed";
  exit_price: string | null;
  exit_fill_source: string | null;
  exit_underlying: string | null;
  exit_reason: string | null;
  closed_at: string | null;
  realized_pl: string | null;
  realized_pl_pct: string | null;
  last_quote_price: string | null;
  last_quote_source: string | null;
  last_quote_underlying: string | null;
  last_checked_at: string | null;
}

const fmtMoney = (v: string | number | null | undefined) => v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`;
const fmtPct = (v: string | number | null | undefined) => v == null || v === "" ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  } catch { return "—"; }
};
const exitReasonLabel = (r: string | null) => {
  if (!r) return "—";
  if (r === "manual") return "Closed manually";
  if (r === "target_hit") return "🎯 Target hit";
  if (r === "stop_hit") return "🛑 Stop hit";
  if (r === "invalidated") return "🛑 Stop hit"; // legacy
  if (r === "expired") return "⏰ Expired";
  if (r.endsWith("_pending_quote")) return `${exitReasonLabel(r.replace("_pending_quote", ""))} (waiting for quote)`;
  return r;
};
const exitReasonStyle = (r: string | null) => {
  if (r === "target_hit") return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
  if (r === "stop_hit" || r === "invalidated") return "bg-red-500/15 text-red-300 border border-red-500/30";
  if (r === "expired") return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
  if (r === "manual") return "bg-muted/40 text-muted-foreground border border-border/40";
  return "bg-muted/30 text-muted-foreground";
};
const sourceLabel = (s: string | null | undefined) => {
  if (!s) return "—";
  if (s === "ask") return "ask";
  if (s === "bid") return "bid";
  if (s === "mid") return "mid";
  if (s === "last") return "last";
  if (s === "expired_otm") return "0 (OTM expired)";
  return s;
};

export default function DashboardPaperTrades() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  async function authHeader(): Promise<HeadersInit> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/whale/paper/trades?status=${filter}`, { headers });
      const data = await res.json();
      if (res.ok) setTrades(data.trades || []);
    } catch (e: any) {
      toast({ title: "Failed to load", description: e?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filter]);

  async function refreshOne(id: string) {
    setRefreshingId(id);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/whale/paper/trades/${id}/refresh`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setTrades((prev) => prev.map((t) => t.id === id ? { ...t, last_quote_price: data.trade.last_quote_price, last_quote_underlying: data.trade.last_quote_underlying, last_checked_at: new Date().toISOString() } : t));
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e?.message, variant: "destructive" });
    } finally {
      setRefreshingId(null);
    }
  }

  async function closeOne(id: string) {
    if (!confirm("Close this paper trade at the current bid?")) return;
    setClosingId(id);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/whale/paper/trades/${id}/close`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      toast({ title: "Closed", description: `Realized P/L ${fmtMoney(data.realizedPl)} (${fmtPct(data.realizedPlPct)})` });
      load();
    } catch (e: any) {
      toast({ title: "Close failed", description: e?.message, variant: "destructive" });
    } finally {
      setClosingId(null);
    }
  }

  async function deleteOne(id: string) {
    if (!confirm("Permanently delete this paper trade from your history?")) return;
    try {
      const headers = await authHeader();
      await fetch(`/api/whale/paper/trades/${id}`, { method: "DELETE", headers });
      load();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message, variant: "destructive" });
    }
  }

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.status === "closed");
    const open = trades.filter((t) => t.status === "open");
    const wins = closed.filter((t) => Number(t.realized_pl ?? 0) > 0).length;
    const losses = closed.filter((t) => Number(t.realized_pl ?? 0) < 0).length;
    const totalPl = closed.reduce((s, t) => s + Number(t.realized_pl ?? 0), 0);
    const openUnrealized = open.reduce((s, t) => {
      const last = t.last_quote_price != null ? Number(t.last_quote_price) : null;
      const entry = Number(t.entry_price);
      if (last == null) return s;
      return s + (last - entry) * Number(t.contracts) * 100;
    }, 0);
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    return { openCount: open.length, closedCount: closed.length, wins, losses, totalPl, openUnrealized, winRate };
  }, [trades]);

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
          <div className="mb-4 flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-violet-400" />
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Paper Trades</h1>
            <span className="text-[10px] uppercase tracking-wider text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded">Simulated</span>
          </div>

          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 mb-4 flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-200/90 leading-snug">
              <strong>These are simulated trades, not real money.</strong> Paper trades enter at the <strong>ask</strong> and exit at the <strong>bid</strong>. We do this on purpose so the results are conservative — real fills could be a little better on liquid contracts or a little worse on illiquid ones. Use this to practice and measure your edge before risking real capital.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="rounded-lg bg-card border border-border/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Open</div>
              <div className="text-lg font-bold text-foreground">{stats.openCount}</div>
              <div className="text-[10px] text-muted-foreground">unrealized {fmtMoney(stats.openUnrealized)}</div>
            </div>
            <div className="rounded-lg bg-card border border-border/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Closed</div>
              <div className="text-lg font-bold text-foreground">{stats.closedCount}</div>
              <div className="text-[10px] text-muted-foreground">{stats.wins}W / {stats.losses}L</div>
            </div>
            <div className="rounded-lg bg-card border border-border/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Win Rate</div>
              <div className="text-lg font-bold text-foreground">{stats.winRate.toFixed(0)}%</div>
            </div>
            <div className="rounded-lg bg-card border border-border/40 p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Realized P/L</div>
              <div className={`text-lg font-bold ${stats.totalPl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtMoney(stats.totalPl)}</div>
            </div>
          </div>

          <div className="flex gap-1 mb-3">
            {(["open", "closed", "all"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? "bg-primary/15 text-primary border border-primary/30" : "bg-muted/30 text-muted-foreground border border-transparent hover:text-foreground"}`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {loading && trades.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : trades.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
              <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No paper trades yet. Open one from any signal card using the <strong className="text-foreground">Review Trade</strong> button.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trades.map((t) => {
                const isCall = t.option_type === "call";
                const entry = Number(t.entry_price);
                const last = t.last_quote_price != null ? Number(t.last_quote_price) : null;
                const unrealized = last != null && t.status === "open" ? (last - entry) * Number(t.contracts) * 100 : null;
                const unrealizedPct = last != null && t.status === "open" && entry > 0 ? ((last - entry) / entry) * 100 : null;
                const realized = t.realized_pl != null ? Number(t.realized_pl) : null;
                const realizedPct = t.realized_pl_pct != null ? Number(t.realized_pl_pct) : null;
                const plToShow = t.status === "open" ? unrealized : realized;
                const plPctToShow = t.status === "open" ? unrealizedPct : realizedPct;
                const target = t.signal_target != null ? Number(t.signal_target) : null;
                const inval = t.signal_invalidation != null ? Number(t.signal_invalidation) : null;
                return (
                  <div key={t.id} className={`rounded-xl border p-3 ${t.status === "open" ? "bg-card border-border/50" : (realized ?? 0) >= 0 ? "bg-emerald-500/5 border-emerald-500/30" : "bg-red-500/5 border-red-500/30"}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isCall ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />}
                        <span className="text-base font-bold text-foreground">{t.ticker}</span>
                        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isCall ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{t.option_type.toUpperCase()} ${Number(t.strike)}</span>
                        <span className="text-[10px] text-muted-foreground">{String(t.expiry).slice(0, 10)}</span>
                        <span className="text-[10px] text-muted-foreground">× {t.contracts}</span>
                        {t.status === "open" ? (
                          <span className="text-[10px] uppercase font-bold text-violet-300 bg-violet-500/15 border border-violet-500/30 px-1.5 py-0.5 rounded">OPEN</span>
                        ) : (
                          <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${exitReasonStyle(t.exit_reason)}`}>{exitReasonLabel(t.exit_reason)}</span>
                        )}
                        {t.signal_grade && (
                          <span className="text-[10px] uppercase font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">{t.signal_grade}</span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {t.status === "open" && (
                          <>
                            <button onClick={() => refreshOne(t.id)} disabled={refreshingId === t.id} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50" title="Refresh quote">
                              {refreshingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => closeOne(t.id)} disabled={closingId === t.id} className="px-2 py-1 rounded text-[11px] font-bold bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50">
                              {closingId === t.id ? "Closing…" : "Close at bid"}
                            </button>
                          </>
                        )}
                        {t.status !== "open" && (
                          <button onClick={() => deleteOne(t.id)} className="p-1.5 rounded text-muted-foreground hover:text-red-300 hover:bg-red-500/10" title="Delete from history">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px]">
                      <div><span className="text-muted-foreground">Entry: </span><span className="font-mono text-foreground">{fmtMoney(entry)} <span className="text-muted-foreground">(at {sourceLabel(t.entry_fill_source)})</span></span></div>
                      {t.status === "open" ? (
                        <div><span className="text-muted-foreground">Current: </span><span className="font-mono text-foreground">{fmtMoney(last)} <span className="text-muted-foreground">(at {sourceLabel(t.last_quote_source)})</span></span></div>
                      ) : (
                        <div><span className="text-muted-foreground">Exit: </span><span className="font-mono text-foreground">{fmtMoney(t.exit_price)} <span className="text-muted-foreground">(at {sourceLabel(t.exit_fill_source)})</span></span></div>
                      )}
                      <div className={`font-mono font-bold ${plToShow != null && plToShow >= 0 ? "text-emerald-400" : plToShow != null ? "text-red-400" : "text-muted-foreground"}`}>
                        P/L: {fmtMoney(plToShow)} {plPctToShow != null && <span className="text-[10px]">({fmtPct(plPctToShow)})</span>}
                      </div>
                      <div className="text-muted-foreground">Opened {fmtTime(t.opened_at)}</div>
                      {t.signal_entry != null && <div className="text-muted-foreground">Plan entry: <span className="font-mono text-foreground">{fmtMoney(t.signal_entry)}</span></div>}
                      {target != null && <div className="text-muted-foreground">🎯 Target: <span className="font-mono text-emerald-300">{fmtMoney(target)}</span></div>}
                      {inval != null && <div className="text-muted-foreground">🛑 Stop: <span className="font-mono text-red-300">{fmtMoney(inval)}</span></div>}
                      {t.status === "open" && t.last_quote_underlying && <div className="text-muted-foreground">Underlying: <span className="font-mono text-foreground">{fmtMoney(t.last_quote_underlying)}</span></div>}
                      {t.last_checked_at && t.status === "open" && <div className="text-muted-foreground">Updated {fmtTime(t.last_checked_at)}</div>}
                      {t.closed_at && <div className="text-muted-foreground">Closed {fmtTime(t.closed_at)}</div>}
                    </div>
                    {(t.signal_grade || t.signal_confidence) && (
                      <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground flex gap-3 flex-wrap">
                        {t.signal_grade && <span>Grade: <span className="text-foreground font-medium">{t.signal_grade}</span></span>}
                        {t.signal_confidence && <span>Confidence: <span className="text-foreground font-medium">{t.signal_confidence}</span></span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-4 text-center">
            Quotes refresh every 30s on this page. Open trades are also auto-monitored on the server (every 60s during market hours, every 5 min off-hours) and auto-close when the underlying hits the signal's target or invalidation, or when the contract expires.
          </p>
        </main>
      </div>
    </div>
  );
}
