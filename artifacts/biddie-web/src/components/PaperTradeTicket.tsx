import { useEffect, useState } from "react";
import { X, FlaskConical, Loader2, AlertTriangle, TrendingUp, TrendingDown, Target, ShieldOff, Crosshair } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface PaperTradeSignalInput {
  signalId: string;
  ticker: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string;
  signalEntry?: number | null;
  signalTarget?: number | null;
  signalInvalidation?: number | null;
  signalGrade?: string | null;
  signalConfidence?: string | null;
}

interface QuoteResponse {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  underlying_price: number | null;
  asOf: string;
  iv: number | null;
  delta: number | null;
  contractSymbol: string;
  suggestedEntry: { price: number; source: string } | null;
}

const fmtMoney = (v: number | null | undefined) => v == null ? "—" : `$${Number(v).toFixed(2)}`;

export default function PaperTradeTicket({ signal, onClose, onOpened }: { signal: PaperTradeSignalInput; onClose: () => void; onOpened?: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  async function authHeader(): Promise<HeadersInit> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  async function loadQuote() {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whale/paper/quote", {
        method: "POST",
        headers,
        body: JSON.stringify({ ticker: signal.ticker, optionType: signal.optionType, strike: signal.strike, expiry: signal.expiry }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to fetch quote");
      setQuote(data);
    } catch (e: any) {
      setError(e?.message || "Failed to fetch quote");
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQuote();
    const t = setInterval(loadQuote, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal.signalId, signal.ticker, signal.strike, signal.expiry, signal.optionType]);

  async function submit() {
    if (!quote?.suggestedEntry) {
      toast({ title: "No tradeable price", description: "Wait for a live quote and try again.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whale/paper/trades", {
        method: "POST",
        headers,
        body: JSON.stringify({
          signalId: signal.signalId,
          ticker: signal.ticker,
          optionType: signal.optionType,
          strike: signal.strike,
          expiry: signal.expiry,
          contracts,
          signalEntry: signal.signalEntry ?? null,
          signalTarget: signal.signalTarget ?? null,
          signalInvalidation: signal.signalInvalidation ?? null,
          signalGrade: signal.signalGrade ?? null,
          signalConfidence: signal.signalConfidence ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to open paper trade");
      toast({ title: "Paper trade opened", description: `${signal.ticker} ${signal.optionType.toUpperCase()} $${signal.strike} @ ${fmtMoney(data.trade.entry_price)} (${data.trade.entry_fill_source})` });
      onOpened?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Could not open", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const entry = quote?.suggestedEntry?.price ?? null;
  const cost = entry != null ? entry * contracts * 100 : null;
  const isCall = signal.optionType === "call";
  const hasPlan = signal.signalEntry != null || signal.signalTarget != null || signal.signalInvalidation != null || signal.signalGrade != null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/60 shadow-2xl overflow-hidden max-h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 bg-gradient-to-r from-violet-500/10 to-blue-500/10 shrink-0">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-violet-400" />
            <div>
              <h3 className="text-sm font-bold text-foreground">Review Trade · Paper</h3>
              <p className="text-[10px] text-muted-foreground">Simulated · No real money</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          <div className="flex gap-2 items-start">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] leading-snug text-amber-200/90">
              Paper trades enter at the <strong>ask</strong> and exit at the <strong>bid</strong>. Intentionally conservative — real fills could be better on liquid contracts or worse on illiquid ones. Results are simulated, not real.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <div className="flex items-center gap-2">
              {isCall ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />}
              <span className="text-base font-bold text-foreground">{signal.ticker}</span>
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isCall ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                {signal.optionType.toUpperCase()} ${signal.strike}
              </span>
              {signal.signalGrade && (
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30">
                  {signal.signalGrade}
                </span>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">Exp {signal.expiry}</span>
          </div>

          {hasPlan && (
            <div className="rounded-lg bg-muted/20 border border-border/40 p-3 space-y-1.5">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Plan from this signal</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Crosshair className="h-3 w-3" />Entry trigger</div>
                  <div className="text-xs font-mono font-bold text-foreground">{fmtMoney(signal.signalEntry)}</div>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400"><Target className="h-3 w-3" />Target</div>
                  <div className="text-xs font-mono font-bold text-emerald-300">{fmtMoney(signal.signalTarget)}</div>
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1 text-[10px] text-red-400"><ShieldOff className="h-3 w-3" />Stop</div>
                  <div className="text-xs font-mono font-bold text-red-300">{fmtMoney(signal.signalInvalidation)}</div>
                </div>
              </div>
              {signal.signalConfidence && (
                <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/30 mt-1">
                  Confidence: <span className="text-foreground font-medium">{signal.signalConfidence}</span>
                </div>
              )}
            </div>
          )}

          {loading && !quote && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching live quote…
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-300">
              {error}
              <button onClick={loadQuote} className="ml-2 underline">Retry</button>
            </div>
          )}

          {quote && (
            <>
              {(() => {
                const fillSrc = quote.suggestedEntry?.source ?? "ask";
                const tile = (label: string, value: number | null, isFill: boolean, neutralColor: string) => (
                  <div className={`rounded-lg p-2 ${isFill
                    ? "bg-emerald-500/10 border border-emerald-500/40 ring-1 ring-emerald-500/30"
                    : `bg-muted/30 border border-border/40`}`}>
                    <div className={`text-[9px] uppercase ${isFill ? "text-emerald-400" : "text-muted-foreground"}`}>
                      {label}{isFill ? " · Fill" : ""}
                    </div>
                    <div className={`text-xs font-mono font-bold ${isFill ? "text-emerald-300" : neutralColor}`}>{fmtMoney(value)}</div>
                  </div>
                );
                return (
                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {tile("Bid", quote.bid, fillSrc === "bid", "text-red-300")}
                    {tile("Mid", quote.mid, fillSrc === "mid", "text-foreground")}
                    {tile("Ask", quote.ask, fillSrc === "ask", "text-foreground")}
                    {tile("Last", quote.last, fillSrc === "last", "text-foreground")}
                  </div>
                );
              })()}

              <div className="flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-2">
                <span>Underlying: <span className="font-mono text-foreground">{fmtMoney(quote.underlying_price)}</span></span>
                {quote.iv != null && <span>IV: <span className="font-mono text-foreground">{quote.iv}%</span></span>}
                {quote.delta != null && <span>Δ: <span className="font-mono text-foreground">{quote.delta}</span></span>}
              </div>

              <div className="space-y-2 pt-2 border-t border-border/30">
                <label className="text-[11px] text-muted-foreground uppercase">Contracts (1 = 100 shares)</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setContracts(Math.max(1, contracts - 1))} className="w-8 h-8 rounded-lg bg-muted/40 border border-border/40 text-foreground hover:bg-muted/60">−</button>
                  <input type="number" min={1} max={10} value={contracts} onChange={(e) => setContracts(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="w-16 text-center bg-muted/30 border border-border/40 rounded-lg py-1.5 text-sm font-bold" />
                  <button onClick={() => setContracts(Math.min(10, contracts + 1))} className="w-8 h-8 rounded-lg bg-muted/40 border border-border/40 text-foreground hover:bg-muted/60">+</button>
                  <span className="ml-auto text-[11px] text-muted-foreground">Max 10</span>
                </div>
              </div>

              <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Entry fill source</span>
                  <span className="font-mono text-foreground">{quote.suggestedEntry?.source ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Entry price / contract</span>
                  <span className="font-mono font-bold text-foreground">{fmtMoney(entry)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-violet-500/20">
                  <span className="text-muted-foreground">Total cost (paper)</span>
                  <span className="font-mono font-bold text-violet-300">{fmtMoney(cost)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border/40 bg-card flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs font-bold text-muted-foreground bg-muted/30 hover:bg-muted/50">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || loading || !quote?.suggestedEntry}
            className="flex-[2] py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-violet-500 to-blue-500 text-white shadow-lg shadow-violet-500/30 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : entry != null ? `Paper Submit @ ${fmtMoney(entry)}` : "Waiting for quote…"}
          </button>
        </div>
      </div>
    </div>
  );
}
