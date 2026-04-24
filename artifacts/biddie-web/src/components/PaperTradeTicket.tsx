import { useEffect, useState } from "react";
import { X, FlaskConical, Loader2, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface PaperTradeSignalInput {
  signalId: string;
  ticker: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string;
  signalTarget?: number | null;
  signalInvalidation?: number | null;
}

interface QuoteData {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  underlying: number | null;
  iv: number | null;
  delta: number | null;
  contractSymbol: string;
}

interface QuoteResponse {
  quote: QuoteData;
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
          signalTarget: signal.signalTarget ?? null,
          signalInvalidation: signal.signalInvalidation ?? null,
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

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/60 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 bg-gradient-to-r from-violet-500/10 to-blue-500/10">
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

        <div className="px-5 py-3 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex gap-2 items-start">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] leading-snug text-amber-200/90">
              Paper trades enter at the <strong>ask</strong> and exit at the <strong>bid</strong>. Intentionally conservative — real fills could be better on liquid contracts or worse on illiquid ones. Results are simulated, not real.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isCall ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />}
              <span className="text-base font-bold text-foreground">{signal.ticker}</span>
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isCall ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                {signal.optionType.toUpperCase()} ${signal.strike}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground">Exp {signal.expiry}</span>
          </div>

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
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Bid</div>
                  <div className="text-sm font-mono font-bold text-red-300">{fmtMoney(quote.quote.bid)}</div>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/40 p-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Mid</div>
                  <div className="text-sm font-mono font-bold text-foreground">{fmtMoney(quote.quote.mid)}</div>
                </div>
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/30 p-2 ring-1 ring-emerald-500/20">
                  <div className="text-[10px] text-emerald-400 uppercase">Ask · Fill</div>
                  <div className="text-sm font-mono font-bold text-emerald-300">{fmtMoney(quote.quote.ask)}</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Underlying: <span className="font-mono text-foreground">{fmtMoney(quote.quote.underlying)}</span></span>
                {quote.quote.iv != null && <span>IV: <span className="font-mono text-foreground">{quote.quote.iv}%</span></span>}
                {quote.quote.delta != null && <span>Δ: <span className="font-mono text-foreground">{quote.quote.delta}</span></span>}
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

        <div className="px-5 py-3 border-t border-border/40 bg-card flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs font-bold text-muted-foreground bg-muted/30 hover:bg-muted/50">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || loading || !quote?.suggestedEntry}
            className="flex-[2] py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-violet-500 to-blue-500 text-white shadow-lg shadow-violet-500/30 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Opening…" : entry != null ? `Open Paper Trade @ ${fmtMoney(entry)}` : "Waiting for quote…"}
          </button>
        </div>
      </div>
    </div>
  );
}
