import { useEffect, useMemo, useState } from "react";
import { X, FlaskConical, Loader2, AlertTriangle, TrendingUp, TrendingDown, Target, ShieldOff, Crosshair, CheckCircle2 } from "lucide-react";
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
  // "chat" indicates the contract was extracted from a Biddie chat message
  // (no execution verdict, no signal plan). Renders an unverified banner
  // and hides the "Plan from this signal" section. Default = "signal".
  source?: "signal" | "chat";
}

interface ContractOption {
  ticker: string;
  optionType: "call" | "put";
  strike: number;
  expiry: string;
  contractSymbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  entry: number | null;
  entrySource: string | null;
  underlying: number | null;
  iv: number | null;
  delta: number | null;
  costPer1: number | null;
  label: string;
  isRecommended: boolean;
}

interface AlternativesResponse {
  contracts: ContractOption[];
  asOf: string;
}

const fmtMoney = (v: number | null | undefined) => v == null ? "—" : `$${Number(v).toFixed(2)}`;
const fmtCost = (v: number | null | undefined) => v == null ? "—" : `$${Number(v).toFixed(2)}`;

function formatExpiryShort(expiry: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry);
  if (!m) return expiry;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

function contractName(c: ContractOption): string {
  const cp = c.optionType === "call" ? "C" : "P";
  const strike = Number.isInteger(c.strike) ? `${c.strike}` : c.strike.toFixed(2);
  return `${c.ticker} ${strike}${cp} ${formatExpiryShort(c.expiry)}`;
}

function labelTone(label: string): { bg: string; text: string; border: string } {
  if (label === "Recommended Contract") return { bg: "bg-violet-500/15", text: "text-violet-300", border: "border-violet-500/40" };
  if (label === "Budget Option (≤ $300)") return { bg: "bg-teal-500/15", text: "text-teal-300", border: "border-teal-500/40" };
  if (label === "Lowest Cost Available (Above Budget)") return { bg: "bg-teal-500/10", text: "text-teal-300", border: "border-teal-500/30" };
  if (label === "Budget Alternative") return { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-500/30" };
  if (label === "Lower Cost · Higher Risk") return { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-500/30" };
  if (label === "Safer · Higher Cost") return { bg: "bg-blue-500/15", text: "text-blue-300", border: "border-blue-500/30" };
  return { bg: "bg-muted/40", text: "text-muted-foreground", border: "border-border/40" };
}

function isBudgetLabel(label: string): boolean {
  return label === "Budget Option (≤ $300)" || label === "Lowest Cost Available (Above Budget)";
}

function helperTextFor(label: string): string | null {
  if (label === "Recommended Contract") return "Highest-probability / higher cost";
  if (label === "Budget Option (≤ $300)") return "Lower cost, higher risk";
  if (label === "Lowest Cost Available (Above Budget)") return "Cheapest available — above $300";
  if (label === "Lower Cost · Higher Risk") return "Cheaper than recommended, but more aggressive";
  return null;
}

// Lower Cost is hidden when its entry price is within ~30% of the Budget Option,
// since it would just duplicate the same trade thesis at a similar cost.
function meaningfullyDifferentFromBudget(other: ContractOption, budget: ContractOption | null): boolean {
  if (!budget) return true;
  if (other.contractSymbol === budget.contractSymbol) return false;
  const oe = other.entry ?? 0;
  const be = budget.entry ?? 0;
  if (oe <= 0 || be <= 0) return true;
  const ratio = Math.abs(oe - be) / Math.max(oe, be);
  return ratio >= 0.30;
}

// Build the visible list explicitly so it ALWAYS contains at most 3 rows in this order:
//   1. Recommended Contract                                 (always, if present)
//   2. Budget Option (≤ $300)                               (always, if present)
//      — or its fallback label "Lowest Cost Available (Above Budget)"
//   3. Lower Cost · Higher Risk                             (at most ONE, only if meaningfully different)
//
// The backend can emit multiple rows with the same "Lower Cost · Higher Risk" label
// (the candidates loop picks up to 2 OTM contracts that can both fall in that band),
// plus rows labeled "Safer · Higher Cost", "Budget Alternative", and "Alternative".
// All of those are excluded from display to keep the choice list short and clear.
// Backend logic is NOT modified — this is purely a UI cap.
function computeVisibleContracts(contracts: ContractOption[]): ContractOption[] {
  const recommended = contracts.find((c) => c.isRecommended) ?? null;
  const budget = contracts.find((c) => isBudgetLabel(c.label)) ?? null;

  // Among ALL "Lower Cost · Higher Risk" rows from the backend, keep only ones that:
  //  - aren't a duplicate of Recommended or Budget by contractSymbol
  //  - differ from Budget Option by ≥ 30% on entry price (meaningfully different thesis)
  // Then pick exactly ONE — the cheapest — so users see a single clear "more aggressive" option.
  const lowerCostCandidates = contracts.filter((c) =>
    c.label === "Lower Cost · Higher Risk"
    && (!recommended || c.contractSymbol !== recommended.contractSymbol)
    && (!budget || c.contractSymbol !== budget.contractSymbol)
    && meaningfullyDifferentFromBudget(c, budget)
  );
  let lowerCostPick: ContractOption | null = null;
  if (lowerCostCandidates.length > 0) {
    const sorted = [...lowerCostCandidates].sort(
      (a, b) => (a.entry ?? Number.POSITIVE_INFINITY) - (b.entry ?? Number.POSITIVE_INFINITY),
    );
    lowerCostPick = sorted[0];
  }

  const out: ContractOption[] = [];
  if (recommended) out.push(recommended);
  if (budget && (!recommended || budget.contractSymbol !== recommended.contractSymbol)) {
    out.push(budget);
  }
  if (
    lowerCostPick
    && (!recommended || lowerCostPick.contractSymbol !== recommended.contractSymbol)
    && (!budget || lowerCostPick.contractSymbol !== budget.contractSymbol)
  ) {
    out.push(lowerCostPick);
  }

  // Defensive hard cap: under no circumstances render more than 3 rows.
  return out.slice(0, 3);
}

export default function PaperTradeTicket({ signal, onClose, onOpened }: { signal: PaperTradeSignalInput; onClose: () => void; onOpened?: () => void }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AlternativesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState(1);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Buy Now (default) = fill at the live ask immediately.
  // Queue at Signal Entry = create a pending_entry row that auto-fills when
  //   the underlying touches the signal's published entry price. Only offered
  //   for verified signals (NOT chat trades) that include a signal.signalEntry.
  // Mode is signal-only by design — chat trades never see the toggle.
  const canQueueAtEntry =
    signal.source !== "chat" && signal.signalEntry != null && Number.isFinite(Number(signal.signalEntry));
  const [mode, setMode] = useState<"buy_now" | "queue_at_entry">("buy_now");
  // Defensive: if the signal has no entry price (or props change), force back
  // to buy_now so we never submit a queue request without a trigger.
  useEffect(() => {
    if (!canQueueAtEntry && mode !== "buy_now") setMode("buy_now");
  }, [canQueueAtEntry, mode]);

  async function authHeader(): Promise<HeadersInit> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  async function loadAlternatives() {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whale/paper/alternatives", {
        method: "POST",
        headers,
        body: JSON.stringify({ ticker: signal.ticker, optionType: signal.optionType, strike: signal.strike, expiry: signal.expiry }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to fetch contracts");
      const ar = json as AlternativesResponse;
      setData(ar);
      // Default selection: recommended on first load; otherwise keep prior selection if still
      // visible after filtering. If the user's prior pick is now hidden, fall back to recommended.
      const visible = computeVisibleContracts(ar.contracts);
      setSelectedSymbol((prev) => {
        if (prev && visible.some((c) => c.contractSymbol === prev)) return prev;
        const rec = visible.find((c) => c.isRecommended);
        return rec?.contractSymbol ?? visible[0]?.contractSymbol ?? null;
      });
    } catch (e: any) {
      setError(e?.message || "Failed to fetch contracts");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAlternatives();
    const t = setInterval(loadAlternatives, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal.signalId, signal.ticker, signal.strike, signal.expiry, signal.optionType]);

  const visibleContracts = useMemo<ContractOption[]>(() => {
    if (!data) return [];
    return computeVisibleContracts(data.contracts);
  }, [data]);

  const selected = useMemo<ContractOption | null>(() => {
    if (!data || !selectedSymbol) return null;
    return data.contracts.find((c) => c.contractSymbol === selectedSymbol) ?? null;
  }, [data, selectedSymbol]);

  const totalCost = selected?.entry != null ? selected.entry * contracts * 100 : null;
  const isCall = signal.optionType === "call";
  const isChatTrade = signal.source === "chat";
  // Chat trades have no verified plan — never render the plan card for them,
  // even if optional plan fields somehow get passed in.
  const hasPlan = !isChatTrade && (
    signal.signalEntry != null || signal.signalTarget != null || signal.signalInvalidation != null || signal.signalGrade != null
  );

  async function submit() {
    // Buy Now requires a live ask; Queue does not (we will fill later when the
    // trigger condition is met).
    if (mode === "buy_now" && (!selected || selected.entry == null)) {
      toast({ title: "No tradeable price", description: "Wait for a live quote and try again.", variant: "destructive" });
      return;
    }
    if (!selected) {
      toast({ title: "Select a contract", description: "Pick a contract first.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const headers = await authHeader();

      // Build the queue-mode extras only when the toggle is on AND the signal
      // has a usable entry price. Direction follows the option side: a CALL
      // breakout fills when underlying ≥ entry, a PUT breakdown fills when
      // underlying ≤ entry. This matches signalEvaluator's intent.
      const triggerExtras = (() => {
        if (mode !== "queue_at_entry" || !canQueueAtEntry) return null;
        const triggerPx = Number(signal.signalEntry);
        const direction: "at_or_above" | "at_or_below" =
          selected.optionType === "call" ? "at_or_above" : "at_or_below";
        // Default expiration: end of US trading day (4 PM ET) today, or +6h
        // from now if past 4 PM ET. Backend will further clamp to option expiry.
        const now = new Date();
        const etNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const eod = new Date(etNow);
        eod.setHours(16, 0, 0, 0);
        const eodMsET = eod.getTime();
        const driftMs = now.getTime() - etNow.getTime();
        const eodWallClockMs = eodMsET + driftMs;
        const expiresMs = eodWallClockMs > now.getTime() ? eodWallClockMs : now.getTime() + 6 * 60 * 60 * 1000;
        return {
          mode: "pending_entry" as const,
          entryTriggerPrice: triggerPx,
          entryTriggerDirection: direction,
          pendingExpiresAt: new Date(expiresMs).toISOString(),
        };
      })();

      const res = await fetch("/api/whale/paper/trades", {
        method: "POST",
        headers,
        body: JSON.stringify({
          signalId: signal.signalId,
          ticker: selected.ticker,
          optionType: selected.optionType,
          strike: selected.strike,
          expiry: selected.expiry,
          contracts,
          signalEntry: signal.signalEntry ?? null,
          signalTarget: signal.signalTarget ?? null,
          signalInvalidation: signal.signalInvalidation ?? null,
          signalGrade: signal.signalGrade ?? null,
          signalConfidence: signal.signalConfidence ?? null,
          ...(triggerExtras ?? {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        // Surface the per-user cap as a clear, actionable toast rather than a
        // generic failure. Backend returns 409 {code:"TRADE_CAP_REACHED",cap,current}.
        if (res.status === 409 && json?.code === "TRADE_CAP_REACHED") {
          const cap = json.cap ?? "?";
          const cur = json.current ?? "?";
          toast({
            title: "Trade cap reached",
            description: `You have ${cur}/${cap} active paper positions (open + pending). Cancel a pending entry or close an open trade to free a slot.`,
            variant: "destructive",
          });
          return;
        }
        throw new Error(json?.error || "Failed to open paper trade");
      }
      if (mode === "queue_at_entry") {
        const dirLabel = selected.optionType === "call" ? "≥" : "≤";
        toast({
          title: "Pending entry queued",
          description: `${selected.ticker} ${selected.optionType.toUpperCase()} $${selected.strike} — will fill when underlying ${dirLabel} $${Number(signal.signalEntry).toFixed(2)}.`,
        });
      } else {
        toast({
          title: "Paper trade opened",
          description: `${selected.ticker} ${selected.optionType.toUpperCase()} $${selected.strike} @ ${fmtMoney(json.trade.entry_price)} (${json.trade.entry_fill_source})`,
        });
      }
      onOpened?.();
      onClose();
    } catch (e: any) {
      toast({ title: "Could not open", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border/60 shadow-2xl overflow-hidden max-h-[95vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 bg-gradient-to-r from-violet-500/10 to-blue-500/10 shrink-0">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-violet-400" />
            <div>
              <h3 className="text-sm font-bold text-foreground">Review Trade</h3>
              <p className="text-[10px] text-muted-foreground">Simulated · No real money</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isChatTrade && (
          <div className="px-5 py-3 bg-amber-500/15 border-b border-amber-500/30 shrink-0">
            <div className="flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200">Chat Trade (Unverified)</p>
                <p className="text-[11px] leading-snug text-amber-200/80 mt-0.5">
                  This contract came from a Biddie chat message — no execution verdict applied, no signal plan, no entry/target/stop. You're acting on a chat idea. Paper-only.
                </p>
              </div>
            </div>
          </div>
        )}

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

          {/* Buy Now vs. Queue at Signal Entry — only offered for verified
              signals with a published entry price. Chat trades never see this
              toggle (canQueueAtEntry guards both visibility and submit behavior). */}
          {canQueueAtEntry && (
            <div className="rounded-lg bg-muted/20 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1.5">Entry mode</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode("buy_now")}
                  className={`text-left p-2 rounded-lg border transition-colors ${
                    mode === "buy_now"
                      ? "bg-violet-500/15 border-violet-500/50 text-foreground"
                      : "bg-card/50 border-border/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wide">Buy Now</div>
                  <div className="text-[10px] mt-0.5 leading-snug opacity-90">Fill at the live ask immediately.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("queue_at_entry")}
                  className={`text-left p-2 rounded-lg border transition-colors ${
                    mode === "queue_at_entry"
                      ? "bg-sky-500/15 border-sky-500/50 text-foreground"
                      : "bg-card/50 border-border/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-wide">Queue at Entry</div>
                  <div className="text-[10px] mt-0.5 leading-snug opacity-90">
                    Wait until underlying {selected?.optionType === "put" ? "≤" : "≥"} <span className="font-mono">${Number(signal.signalEntry).toFixed(2)}</span>, then auto-fill.
                  </div>
                </button>
              </div>
              {mode === "queue_at_entry" && (
                <div className="mt-2 text-[10px] leading-snug text-sky-200/80">
                  Counts against your active-position cap while pending. Auto-cancels at end of trading day if not triggered. You can cancel anytime from Paper Trades.
                </div>
              )}
            </div>
          )}

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

          {loading && !data && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching contracts…
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-300">
              {error}
              <button onClick={loadAlternatives} className="ml-2 underline">Retry</button>
            </div>
          )}

          {data && visibleContracts.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Choose a contract</div>
              {visibleContracts.map((c) => {
                const isSel = selectedSymbol === c.contractSymbol;
                // Chat trades are unverified — strip backend recommendation
                // language ("Recommended Contract" / "Highest-probability ...")
                // so the modal never implies execution approval for ideas
                // pulled out of a chat message. Budget Option labels are kept
                // because they describe a price filter, not a verdict.
                const isMatchToChat = isChatTrade
                  && c.ticker === signal.ticker
                  && c.strike === signal.strike
                  && c.expiry === signal.expiry
                  && c.optionType === signal.optionType;
                const displayLabel = isChatTrade
                  ? (isMatchToChat
                      ? "As Quoted in Chat"
                      : (isBudgetLabel(c.label) ? c.label : "Alternate Contract"))
                  : c.label;
                const tone = isChatTrade && !isBudgetLabel(c.label)
                  ? { bg: "bg-muted/30", text: "text-foreground", border: "border-border/50" }
                  : labelTone(c.label);
                const fillSrc = c.entrySource ?? "ask";
                const helper = isChatTrade ? null : helperTextFor(c.label);
                return (
                  <button
                    key={c.contractSymbol}
                    type="button"
                    onClick={() => setSelectedSymbol(c.contractSymbol)}
                    className={`w-full text-left rounded-lg border p-3 transition-all ${isSel
                      ? "bg-violet-500/10 border-violet-500/50 ring-2 ring-violet-500/30"
                      : "bg-muted/20 border-border/40 hover:bg-muted/30 hover:border-border/60"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSel ? "border-violet-400 bg-violet-500" : "border-border"}`}>
                          {isSel && <CheckCircle2 className="h-3 w-3 text-white" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-mono font-bold text-foreground truncate">{contractName(c)}</div>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${tone.bg} ${tone.text} ${tone.border}`}>
                              {displayLabel}
                            </span>
                            {c.expiry !== signal.expiry && (
                              <span className="text-[9px] italic text-blue-300/80" title="Same direction but a slightly later expiration. Pays off if the underlying makes the move within the extended window.">
                                Different expiry: {formatExpiryShort(c.expiry)}
                              </span>
                            )}
                          </div>
                          {helper && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{helper}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[9px] text-muted-foreground uppercase">Cost / 1</div>
                        <div className="text-xs font-mono font-bold text-foreground">{fmtCost(c.costPer1)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center">
                      {[
                        { k: "bid", v: c.bid, color: "text-red-300" },
                        { k: "mid", v: c.mid, color: "text-foreground" },
                        { k: "ask", v: c.ask, color: "text-foreground" },
                        { k: "last", v: c.last, color: "text-foreground" },
                      ].map((t) => {
                        const isFill = fillSrc === t.k;
                        return (
                          <div key={t.k} className={`rounded p-1 ${isFill ? "bg-emerald-500/15 border border-emerald-500/40" : "bg-muted/20 border border-border/30"}`}>
                            <div className={`text-[8px] uppercase ${isFill ? "text-emerald-400" : "text-muted-foreground"}`}>
                              {t.k}{isFill ? "·fill" : ""}
                            </div>
                            <div className={`text-[10px] font-mono font-bold ${isFill ? "text-emerald-300" : t.color}`}>{fmtMoney(t.v)}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1.5 pt-1.5 border-t border-border/30">
                      <span>Entry @ <span className="font-mono text-foreground">{fmtMoney(c.entry)}</span> ({c.entrySource ?? "—"})</span>
                      {c.delta != null && <span>Δ <span className="font-mono text-foreground">{c.delta}</span></span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <>
              {selected.underlying != null && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span>Underlying: <span className="font-mono text-foreground">{fmtMoney(selected.underlying)}</span></span>
                  {selected.iv != null && <span>IV: <span className="font-mono text-foreground">{selected.iv}%</span></span>}
                </div>
              )}

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
                  <span className="text-muted-foreground">Selected</span>
                  <span className="font-mono text-foreground truncate ml-2">{contractName(selected)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Entry / contract ({selected.entrySource ?? "—"})</span>
                  <span className="font-mono font-bold text-foreground">{fmtMoney(selected.entry)}</span>
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-violet-500/20">
                  <span className="text-muted-foreground">Total cost (paper)</span>
                  <span className="font-mono font-bold text-violet-300">{fmtMoney(totalCost)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border/40 bg-card flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2 rounded-lg text-xs font-bold text-muted-foreground bg-muted/30 hover:bg-muted/50">Cancel</button>
          <button
            onClick={submit}
            disabled={
              submitting ||
              loading ||
              !selected ||
              // Buy Now requires a live ask; Queue mode does not.
              (mode === "buy_now" && selected?.entry == null)
            }
            className={`flex-[2] py-2 rounded-lg text-xs font-bold text-white shadow-lg hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === "queue_at_entry"
                ? "bg-gradient-to-r from-sky-500 to-blue-500 shadow-sky-500/30"
                : "bg-gradient-to-r from-violet-500 to-blue-500 shadow-violet-500/30"
            }`}
          >
            {submitting
              ? mode === "queue_at_entry" ? "Queueing…" : "Submitting…"
              : mode === "queue_at_entry"
                ? `Queue @ $${Number(signal.signalEntry).toFixed(2)}`
                : selected?.entry != null
                  ? `Paper Submit @ ${fmtMoney(selected.entry)}`
                  : "Waiting for quote…"}
          </button>
        </div>
      </div>
    </div>
  );
}
