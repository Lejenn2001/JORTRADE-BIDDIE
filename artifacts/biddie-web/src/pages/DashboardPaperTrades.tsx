import { useEffect, useMemo, useRef, useState } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, AlertTriangle, RefreshCcw, Loader2, TrendingUp, TrendingDown, X, Clock, ChevronUp, ChevronDown, Lock } from "lucide-react";
import { useMarketStatus } from "@/hooks/useMarketStatus";

type PaperTradeStatus = "open" | "closed" | "pending_entry" | "cancelled";

interface PaperTrade {
  id: string;
  signal_id: string;
  ticker: string;
  option_type: "call" | "put";
  strike: string;
  expiry: string;
  contract_symbol: string;
  contracts: number;
  entry_price: string | null;
  entry_fill_source: string | null;
  entry_underlying: string | null;
  entry_iv: string | null;
  entry_delta: string | null;
  signal_target: string | null;
  signal_invalidation: string | null;
  signal_entry: string | null;
  signal_grade: string | null;
  signal_confidence: string | null;
  created_at: string | null;
  opened_at: string | null;
  status: PaperTradeStatus;
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
  source: string | null;
  // Phase 1 / Commit 1 — pending_entry fields
  entry_trigger_price: string | null;
  entry_trigger_direction: "at_or_above" | "at_or_below" | null;
  pending_expires_at: string | null;
  pending_cancel_reason: string | null;
  // Phase 1 / Commit 4 — Exit Strategy Layer fields
  // trailing_active flips false→true once option P&L first crosses +20%.
  // highest_price_after_activation is the peak option fill price observed
  // since trailing_active flipped on (only ever bumped upward).
  trailing_active?: boolean | null;
  highest_price_after_activation?: string | null;
}

interface AutomationSettings {
  paused: boolean;
  pausedReason: string | null;
  maxOpenPending: number;
  userOpenPending: number;
  capRemaining: number;
  isAdmin: boolean;
}

type FilterKey = "all" | "pending" | "open" | "closed" | "cancelled";
const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  pending: "Pending Entry",
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
};

// QuoteState — derived purely from existing columns. No schema change.
//
// Definitions:
//   LIVE        → background monitor has successfully refreshed at least once
//                 (last_quote_underlying differs from entry_underlying), and the
//                 last attempt was within the freshness window.
//   STALE       → monitor previously succeeded but hasn't refreshed recently.
//                 We display the last known quote, clearly labeled.
//   UNAVAILABLE → monitor has NEVER successfully fetched a quote since this
//                 trade was opened (last_quote_underlying === entry_underlying
//                 and the trade is older than the warmup window). The displayed
//                 last_quote_* values are just trade-open snapshots, NOT live
//                 marks, so we suppress P/L to avoid pretending it's real.
//   PENDING     → trade was just opened (< warmup window). The first monitor
//                 cycle hasn't happened yet — this is normal, not a failure.
type QuoteState = "live" | "stale" | "unavailable" | "pending";

const QUOTE_FRESH_SECONDS = 120;     // monitor cycle is 60s; allow 2x for tolerance
const QUOTE_WARMUP_SECONDS = 180;    // give the monitor 3 minutes before flagging UNAVAILABLE

function deriveQuoteState(t: PaperTrade): { state: QuoteState; ageOfQuoteSec: number | null; ageSinceCheckSec: number | null } {
  if (t.status !== "open") {
    return { state: "live", ageOfQuoteSec: null, ageSinceCheckSec: null };
  }
  const now = Date.now();
  const openedMs = t.opened_at ? new Date(t.opened_at).getTime() : now;
  const checkedMs = t.last_checked_at ? new Date(t.last_checked_at).getTime() : null;
  const tradeAgeSec = Math.max(0, (now - openedMs) / 1000);
  const ageSinceCheckSec = checkedMs != null ? Math.max(0, (now - checkedMs) / 1000) : null;

  // Has the monitor produced an update DIFFERENT from the entry snapshot?
  // entry_underlying is captured exactly once at trade open; last_quote_underlying
  // is overwritten on every successful Polygon fetch. If they're still identical
  // many minutes after opening, the monitor has never produced a live mark.
  const entryU = t.entry_underlying != null ? Number(t.entry_underlying) : null;
  const lastU = t.last_quote_underlying != null ? Number(t.last_quote_underlying) : null;
  const hasFreshQuote = entryU != null && lastU != null && Number.isFinite(entryU) && Number.isFinite(lastU) && Math.abs(entryU - lastU) > 0.0001;

  if (!hasFreshQuote) {
    if (tradeAgeSec < QUOTE_WARMUP_SECONDS) {
      return { state: "pending", ageOfQuoteSec: null, ageSinceCheckSec };
    }
    return { state: "unavailable", ageOfQuoteSec: null, ageSinceCheckSec };
  }
  // We have a real refreshed quote. Treat ageSinceCheck as ageOfQuote — when the
  // monitor writes a fresh mark it also bumps last_checked_at, so they're equal
  // for "good" rows.
  const fresh = ageSinceCheckSec != null && ageSinceCheckSec <= QUOTE_FRESH_SECONDS;
  return {
    state: fresh ? "live" : "stale",
    ageOfQuoteSec: ageSinceCheckSec,
    ageSinceCheckSec,
  };
}

function formatAge(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
}

const fmtMoney = (v: string | number | null | undefined) => v == null || v === "" ? "—" : `$${Number(v).toFixed(2)}`;
const fmtPct = (v: string | number | null | undefined) => v == null || v === "" ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  } catch { return "—"; }
};
const exitReasonLabel = (r: string | null): string => {
  if (!r) return "—";
  if (r === "closed_manual" || r === "manual") return "Closed manually";
  if (r === "target_hit") return "🎯 Target hit";
  if (r === "stop_hit" || r === "invalidated") return "🛑 Stop hit";
  if (r === "closed_expired" || r === "expired") return "⏰ Expired";
  // Phase 1 / Commit 4 — Exit Strategy Layer reasons
  if (r === "profit_target") return "💰 Profit target";
  if (r === "hard_stop") return "🚨 Hard stop";
  if (r === "trailing_stop") return "🛡️ Trailing stop";
  if (r.endsWith("_pending_quote")) return `${exitReasonLabel(r.replace("_pending_quote", ""))} (waiting for quote)`;
  return r;
};
const exitReasonStyle = (r: string | null) => {
  if (r === "target_hit") return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
  if (r === "stop_hit" || r === "invalidated") return "bg-red-500/15 text-red-300 border border-red-500/30";
  if (r === "closed_expired" || r === "expired") return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
  if (r === "closed_manual" || r === "manual") return "bg-muted/40 text-muted-foreground border border-border/40";
  // Phase 1 / Commit 4 — Exit Strategy Layer styling
  // profit_target = strong green (clean win); hard_stop = strong red (capital
  // preservation hit); trailing_stop = amber (protective lock-in, neither
  // pure win nor pure loss — always positive realized P/L by construction).
  if (r === "profit_target") return "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40";
  if (r === "hard_stop") return "bg-red-500/20 text-red-200 border border-red-400/40";
  if (r === "trailing_stop") return "bg-amber-500/20 text-amber-200 border border-amber-400/40";
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
const cancelReasonLabel = (r: string | null) => {
  if (!r) return "Cancelled";
  if (r === "user_cancelled") return "Cancelled by you";
  if (r === "expired_unfilled") return "Expired (unfilled)";
  if (r === "contract_expired") return "Contract expired";
  return r;
};
const triggerDirectionLabel = (d: string | null) => {
  if (d === "at_or_above") return "at or above";
  if (d === "at_or_below") return "at or below";
  return d ?? "—";
};
// ─── "View Original Signal" panel ───────────────────────────────────────
//
// UI-only feature. Renders an expandable section under each trade row showing
// the full context that produced the trade. Pulls from two sources:
//
//   1. Fields already on the PaperTrade row (no fetch): selected contract,
//      signal_entry/target/invalidation, signal_grade/confidence, created_at,
//      opened_at, entry_trigger_*, etc.
//
//   2. The existing public read endpoint GET /whale/signals/detail/:signal_id
//      for fields that live on signal_outcomes only: detected_at (= original
//      signal time), reason, conviction_score, reinforcement_count,
//      is_biddie_pick, signal_type/direction/category, target_near, etc.
//
// Source inference (no `source` column exists on paper_trades):
//   - 200 OK from /signals/detail → "Verified Signal"
//   - 404 → "Unverified" (no row in signal_outcomes — usually a Biddie chat
//             trade since POST /whale/chat is stateless, but could also be a
//             signal whose history record was removed; we hedge in copy)
//   - network error → "Unknown"
//
// Things that are explicitly NOT stored anywhere and therefore always render
// as "Not available" (no API change can produce them):
//   - Original Biddie chat message + timestamp (POST /whale/chat is stateless,
//     it does not persist 1-on-1 chat history).
//   - Execution verdict at the moment the trade was placed (executionEvaluator
//     produces a verdict on signals but the result is not snapshotted onto
//     paper_trades at insert time).

interface OriginalSignalDetail {
  id: string;
  ticker?: string | null;
  signal_type?: string | null;
  option_type?: string | null;
  strike?: string | number | null;
  expiry?: string | null;
  confidence?: string | number | null;
  conviction_score?: string | number | null;
  outcome?: string | null;
  detected_at?: string | null;
  created_at?: string | null;
  category?: string | null;
  direction?: string | null;
  reason?: string | null;
  entry_trigger?: string | null;
  target?: string | null;
  target_near?: string | null;
  invalidation?: string | null;
  reinforcement_count?: string | number | null;
  last_reinforced_at?: string | null;
  is_biddie_pick?: boolean | null;
  signal_source?: string | null;
  suggested_trade?: string | null;
  tags?: string[] | null;
  price_at_signal?: string | number | null;
}

type DetailFetchState =
  | { status: "loading" }
  | { status: "loaded"; data: OriginalSignalDetail }
  | { status: "not_found" }
  | { status: "error"; message: string };

function fmtDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH > 0 ? `${d}d ${remH}h` : `${d}d`;
}

// "Original contract" vs "Selected contract" comparison. For verified-signal
// trades these are usually the same. For chat trades the "original" side
// will be missing from the detail fetch.
function contractLabel(opt: string | null | undefined, strike: string | number | null | undefined, expiry: string | null | undefined): string {
  if (!opt && strike == null && !expiry) return "Not available";
  const o = (opt || "").toUpperCase() || "?";
  const s = strike != null && strike !== "" ? `$${Number(strike)}` : "—";
  const e = expiry ? String(expiry).slice(0, 10) : "—";
  return `${o} ${s} exp ${e}`;
}

function naOr(v: string | number | null | undefined, fmt?: (n: number) => string): string {
  if (v == null || v === "") return "Not available";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return fmt ? fmt(n) : String(v);
}

function inferSourceLabel(t: PaperTrade, fetchState: DetailFetchState | undefined): { label: string; cls: string; title?: string } {
  // Trust the fetch result first — that's the authoritative signal-vs-not check.
  if (fetchState?.status === "loaded") {
    return {
      label: "Verified Signal",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      title: "A matching signal was found in the signal history for this trade.",
    };
  }
  if (fetchState?.status === "not_found") {
    // We don't know it's *definitively* a chat trade — it could also be a
    // signal whose history row was deleted, archived, or never recorded.
    // Hedge the label rather than assert the origin.
    return {
      label: "Unverified",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      title: "No matching signal was found in the signal history. Most often this means the trade originated from a Biddie chat (which is stateless), but it could also be a signal whose history record was removed.",
    };
  }
  // Before we've fetched, fall back to a heuristic on local data.
  const planFieldsPresent = (t.signal_entry != null) || (t.signal_target != null) || (t.signal_invalidation != null);
  if (!planFieldsPresent) {
    return {
      label: "Unverified",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      title: "No plan (entry/target/stop) is stored for this trade — likely from a Biddie chat. Click to confirm against the signal history.",
    };
  }
  return {
    label: "Signal (probably verified)",
    cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    title: "Plan fields are present locally; click to confirm a matching record exists in the signal history.",
  };
}

function OriginalSignalPanel({ t, fetchState }: { t: PaperTrade; fetchState: DetailFetchState | undefined }) {
  const detail = fetchState?.status === "loaded" ? fetchState.data : null;
  const source = inferSourceLabel(t, fetchState);

  const signalTimeIso = detail?.detected_at || detail?.created_at || null;
  const signalTimeMs = signalTimeIso ? new Date(signalTimeIso).getTime() : null;
  const queuedMs = t.created_at ? new Date(t.created_at).getTime() : null;
  const openedMs = t.opened_at ? new Date(t.opened_at).getTime() : null;
  const refMs = openedMs ?? queuedMs;
  const delayMs = signalTimeMs != null && refMs != null ? refMs - signalTimeMs : null;

  // Selected contract (always available — these are required columns on paper_trades)
  const selectedContract = contractLabel(t.option_type, t.strike, t.expiry);

  // Original contract from the signal_outcomes row, if loaded.
  const originalContract = detail
    ? contractLabel(detail.option_type, detail.strike, detail.expiry)
    : (fetchState?.status === "loading" ? "Loading…" : "Not available");

  return (
    <div className="mt-3 pt-3 border-t border-border/40 bg-muted/10 -mx-3 -mb-3 px-3 pb-3 rounded-b-xl">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Original Signal</span>
          <span title={source.title} className={`text-[10px] uppercase font-bold border px-1.5 py-0.5 rounded ${source.cls}`}>{source.label}</span>
          {detail?.is_biddie_pick && (
            <span className="text-[10px] uppercase font-bold border px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30">Biddie Pick</span>
          )}
        </div>
      </div>

      {fetchState?.status === "loading" && (
        <div className="text-[11px] text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Loading original signal…</div>
      )}
      {fetchState?.status === "error" && (
        <div className="text-[11px] text-red-300">Could not load original signal: {fetchState.message}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        {/* Timing */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground uppercase text-[9px]">Timing</div>
          <div><span className="text-muted-foreground">Signal published: </span><span className="text-foreground">{signalTimeIso ? new Date(signalTimeIso).toLocaleString() : "Not available"}</span></div>
          <div><span className="text-muted-foreground">Trade queued: </span><span className="text-foreground">{t.created_at ? new Date(t.created_at).toLocaleString() : "Not available"}</span></div>
          <div><span className="text-muted-foreground">Trade opened: </span><span className="text-foreground">{t.opened_at ? new Date(t.opened_at).toLocaleString() : (t.status === "pending_entry" ? "Awaiting trigger" : t.status === "cancelled" ? "Never (cancelled)" : "Not available")}</span></div>
          <div><span className="text-muted-foreground">Delay signal → trade: </span><span className="text-foreground">{delayMs != null ? fmtDurationMs(delayMs) : "Not available"}</span></div>
        </div>

        {/* Contracts */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground uppercase text-[9px]">Contract</div>
          <div><span className="text-muted-foreground">Ticker: </span><span className="text-foreground font-medium">{t.ticker}</span></div>
          <div><span className="text-muted-foreground">Original contract: </span><span className="font-mono text-foreground">{originalContract}</span></div>
          <div><span className="text-muted-foreground">Selected contract: </span><span className="font-mono text-foreground">{selectedContract}</span></div>
          {detail?.signal_type && (
            <div><span className="text-muted-foreground">Signal type: </span><span className="text-foreground capitalize">{detail.signal_type}{detail.direction ? ` · ${detail.direction}` : ""}</span></div>
          )}
        </div>

        {/* Plan: entry / target / stop */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground uppercase text-[9px]">Plan</div>
          <div>
            <span className="text-muted-foreground">Entry: </span>
            <span className="font-mono text-foreground">
              {t.signal_entry != null ? fmtMoney(t.signal_entry)
                : detail?.entry_trigger ? detail.entry_trigger
                : "Not available"}
            </span>
            {t.entry_price != null && (
              <span className="text-muted-foreground"> · filled at <span className="font-mono text-foreground">{fmtMoney(t.entry_price)}</span></span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">🎯 Target: </span>
            <span className="font-mono text-emerald-300">
              {t.signal_target != null ? fmtMoney(t.signal_target)
                : detail?.target ? detail.target
                : "Not available"}
            </span>
            {detail?.target_near && detail.target_near !== detail.target && (
              <span className="text-muted-foreground"> · near <span className="text-foreground">{detail.target_near}</span></span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">🛑 Stop / invalidation: </span>
            <span className="font-mono text-red-300">
              {t.signal_invalidation != null ? fmtMoney(t.signal_invalidation)
                : detail?.invalidation ? detail.invalidation
                : "Not available"}
            </span>
          </div>
          {detail?.price_at_signal != null && (
            <div><span className="text-muted-foreground">Underlying at signal: </span><span className="font-mono text-foreground">{fmtMoney(detail.price_at_signal)}</span></div>
          )}
        </div>

        {/* Conviction & reinforcement */}
        <div className="space-y-0.5">
          <div className="text-muted-foreground uppercase text-[9px]">Conviction</div>
          <div><span className="text-muted-foreground">Confidence: </span><span className="text-foreground font-medium">{t.signal_confidence ?? naOr(detail?.confidence)}</span></div>
          <div><span className="text-muted-foreground">Grade: </span><span className="text-foreground font-medium">{t.signal_grade ?? "Not available"}</span></div>
          <div><span className="text-muted-foreground">Conviction score: </span><span className="text-foreground font-medium">{naOr(detail?.conviction_score)}</span></div>
          <div>
            <span className="text-muted-foreground">Reinforcement count: </span>
            <span className="text-foreground font-medium">{naOr(detail?.reinforcement_count)}</span>
            {detail?.last_reinforced_at && (
              <span className="text-muted-foreground"> · last reinforced {new Date(detail.last_reinforced_at).toLocaleString()}</span>
            )}
          </div>
        </div>

        {/* Execution verdict — explicitly not stored */}
        <div className="space-y-0.5 sm:col-span-2">
          <div className="text-muted-foreground uppercase text-[9px]">Execution verdict at time of trade</div>
          <div className="text-muted-foreground italic">Not available — execution verdict is not snapshotted onto the paper trade at insert time. Current signal outcome: <span className="text-foreground not-italic">{detail?.outcome ?? "Not available"}</span></div>
        </div>

        {/* Reason / explanation from the signal */}
        {detail?.reason && (
          <div className="space-y-0.5 sm:col-span-2">
            <div className="text-muted-foreground uppercase text-[9px]">Reason / thesis</div>
            <div className="text-foreground/90 leading-snug whitespace-pre-wrap">{detail.reason}</div>
          </div>
        )}
        {detail?.suggested_trade && (
          <div className="space-y-0.5 sm:col-span-2">
            <div className="text-muted-foreground uppercase text-[9px]">Suggested trade (from signal)</div>
            <div className="text-foreground/90 leading-snug whitespace-pre-wrap">{detail.suggested_trade}</div>
          </div>
        )}

        {/* Chat message — explicitly not stored for Biddie 1-on-1 */}
        {fetchState?.status === "not_found" && (
          <div className="space-y-0.5 sm:col-span-2">
            <div className="text-muted-foreground uppercase text-[9px]">Original chat message</div>
            <div className="text-muted-foreground italic">Not available — Biddie chat history is not stored on the server (POST /whale/chat is stateless).</div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatRelativeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "expiring now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `in ${Math.floor(s / 86400)}d`;
}

export default function DashboardPaperTrades() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("open");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [automation, setAutomation] = useState<AutomationSettings | null>(null);
  // Phase 1 market-hours status (Apr 2026). Drives a small badge next to the
  // Automation badge so the user can see at a glance why pending entries
  // aren't being evaluated and why exits are paused after-hours. Re-checks
  // every 30s; weekends-only (no NYSE holiday calendar yet).
  const { isOpen: marketOpen } = useMarketStatus();

  // "View Original Signal" panel state. Only one row's panel is expanded at
  // a time. Detail fetches are cached by signal_id so re-opening is instant.
  // `signalDetailsInFlight` is a ref (not state) because we need an
  // up-to-the-microtask check for "is a request currently in flight" to
  // prevent duplicate fetches across rapid toggles — reading from state would
  // see a stale value due to React's render batching.
  const [expandedSignalRow, setExpandedSignalRow] = useState<string | null>(null);
  const [signalDetails, setSignalDetails] = useState<Record<string, DetailFetchState>>({});
  const signalDetailsInFlight = useRef<Set<string>>(new Set());

  async function authHeader(): Promise<HeadersInit> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  // Read-only fetch of the kill-switch + cap settings. Drives the
  // ON / PAUSED badge at the top of the page. No write controls in
  // this commit — admins still manage state via the dev script.
  async function loadAutomationSettings() {
    if (!user) return;
    try {
      const headers = await authHeader();
      const res = await fetch("/api/whale/paper/automation-settings", { headers });
      if (!res.ok) return;
      const data = await res.json();
      setAutomation(data);
    } catch {
      // silent — badge is purely informational; never block trades view
    }
  }

  // load() supports two modes:
  //  - withRefresh=false (default): plain GET, returns stored rows. Used for
  //    initial mount, filter changes, and post-action reloads.
  //  - withRefresh=true: POST refresh-all, which recomputes quotes for every
  //    open trade server-side BEFORE returning the list. Used by the 30s
  //    foreground poll so visible marks/P&L stay fresh between background-
  //    monitor cycles (60s market hours / 5min off-hours).
  async function load(withRefresh = false) {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await authHeader();
      // Always fetch the full trade set (server-side LIMIT 200) so the stats
      // cards (Realized P/L, Closed count, Wins/Losses, Win Rate) stay correct
      // regardless of which tab is active. The visible row list is filtered
      // client-side via `filteredTrades` below. Previously the URL passed
      // `?status=${filter}`, which meant that when the user clicked Force
      // Close while on the Open tab, the post-close refetch returned only
      // status='open' rows — excluding the freshly closed trade — so
      // `stats.totalPl` (sum of `realized_pl` over `status==='closed'`) was
      // always $0.00. Same root cause produced 0/0 W/L and 0% Win Rate any
      // time the active filter wasn't "all".
      const url = `/api/whale/paper/trades${withRefresh ? "/refresh-all" : ""}?status=all`;
      const res = await fetch(url, { method: withRefresh ? "POST" : "GET", headers });
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
    loadAutomationSettings();
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (t) return;
      t = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          // Foreground 30s tick: recompute quotes server-side so visible
          // marks/P&L stay fresh between background-monitor cycles.
          load(true);
          loadAutomationSettings();
        }
      }, 30_000);
    };
    const stop = () => {
      if (t) { clearInterval(t); t = null; }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        load(true); // immediate server-side refresh on return-to-tab
        start();
      } else {
        stop();
      }
    };
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start();
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
    // load() no longer depends on `filter` (the URL is always
    // ?status=all and the visible row list is filtered client-side
    // via `filteredTrades`), so we deliberately omit `filter` from
    // the deps array — including it would cause the polling
    // interval and visibility listener to tear down + re-setup
    // (and trigger an extra load) on every tab change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function refreshOne(id: string) {
    setRefreshingId(id);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/whale/paper/trades/${id}/refresh`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) {
        // 503 "Quote unavailable" is a transient upstream timeout (Polygon) — the
        // background paper-trade-monitor (every 60s) and tab polling (30s) will
        // catch the next cycle. Show a soft, non-destructive toast so a single
        // failed manual click doesn't look like the page is broken. The trade row
        // itself is unchanged on the server when this happens.
        const errMsg = String(data?.error ?? "");
        if (res.status === 503 && /quote unavailable/i.test(errMsg)) {
          toast({
            title: "Quote temporarily unavailable",
            description: "Retrying in background.",
          });
          return;
        }
        throw new Error(data?.error);
      }
      // Replace with the full server-returned trade so that auto-close side effects
      // (status, exit_*, realized_pl, closed_at, exit_reason) flow into the UI on the
      // same tick — otherwise a refresh that triggers an auto-close would leave the
      // row visually "open" until the next polling cycle or page reload.
      if (data?.trade) {
        const fresh = data.trade;
        setTrades((prev) => prev.map((t) => t.id === id ? { ...t, ...fresh } : t));
      }
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

  async function cancelPending(id: string) {
    if (!confirm("Cancel this pending entry? It will not fill.")) return;
    setCancellingId(id);
    try {
      const headers = await authHeader();
      const res = await fetch(`/api/whale/paper/trades/${id}/cancel`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Cancel failed");
      toast({ title: "Cancelled", description: "Pending entry will not fill." });
      load();
    } catch (e: any) {
      toast({ title: "Cancel failed", description: e?.message, variant: "destructive" });
    } finally {
      setCancellingId(null);
    }
  }

  // Toggle the "Original Signal" panel. Lazy-fetches the detail on first
  // expand and caches per signal_id. Auth is not required by
  // /whale/signals/detail/:id (it's a public read endpoint).
  //
  // Caching/retry policy:
  //   - "loaded" / "not_found" → cached forever (cheap re-open).
  //   - "error"                → NOT cached; the next expand retries, so a
  //                              transient 5xx/network blip doesn't become
  //                              permanently sticky.
  //   - in-flight              → deduped via `signalDetailsInFlight` (a ref,
  //                              so rapid double-clicks see an up-to-date
  //                              value rather than React's batched state).
  async function toggleSignalPanel(t: PaperTrade) {
    const newId = expandedSignalRow === t.id ? null : t.id;
    setExpandedSignalRow(newId);
    if (newId == null) return;

    const cacheKey = t.signal_id;
    if (!cacheKey) return; // nothing to fetch

    const existing = signalDetails[cacheKey];
    // Honor positive cache (success or definitive 404) — but allow retry on prior error.
    if (existing && (existing.status === "loaded" || existing.status === "not_found")) return;
    // Dedupe concurrent requests for the same signal across rapid toggles.
    if (signalDetailsInFlight.current.has(cacheKey)) return;
    signalDetailsInFlight.current.add(cacheKey);

    setSignalDetails((prev) => ({ ...prev, [cacheKey]: { status: "loading" } }));
    try {
      const res = await fetch(`/api/whale/signals/detail/${encodeURIComponent(cacheKey)}`);
      if (res.status === 404) {
        setSignalDetails((prev) => ({ ...prev, [cacheKey]: { status: "not_found" } }));
        return;
      }
      if (!res.ok) {
        setSignalDetails((prev) => ({ ...prev, [cacheKey]: { status: "error", message: `HTTP ${res.status}` } }));
        return;
      }
      const data = await res.json();
      // The endpoint returns { signal: {...}, priceHistory, ... }. We only
      // care about `signal` for the panel.
      const sig = data?.signal ?? data;
      setSignalDetails((prev) => ({ ...prev, [cacheKey]: { status: "loaded", data: sig } }));
    } catch (e: any) {
      setSignalDetails((prev) => ({ ...prev, [cacheKey]: { status: "error", message: e?.message ?? "Network error" } }));
    } finally {
      signalDetailsInFlight.current.delete(cacheKey);
    }
  }

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.status === "closed");
    const open = trades.filter((t) => t.status === "open");
    const pending = trades.filter((t) => t.status === "pending_entry");
    const wins = closed.filter((t) => Number(t.realized_pl ?? 0) > 0).length;
    const losses = closed.filter((t) => Number(t.realized_pl ?? 0) < 0).length;
    const totalPl = closed.reduce((s, t) => s + Number(t.realized_pl ?? 0), 0);
    // Only sum unrealized P/L for trades whose quote is genuinely LIVE or STALE
    // (i.e., the monitor has produced at least one fresh mark). Trades whose
    // quote is UNAVAILABLE or PENDING contribute 0 — using their entry-snapshot
    // values would falsely report "0 unrealized" as if the position were exactly
    // flat. We also count how many trades are excluded so the UI can disclose it.
    let openUnrealized = 0;
    let unavailableCount = 0;
    for (const t of open) {
      const { state } = deriveQuoteState(t);
      if (state === "unavailable" || state === "pending") {
        unavailableCount++;
        continue;
      }
      const last = t.last_quote_price != null ? Number(t.last_quote_price) : null;
      const entry = Number(t.entry_price);
      if (last == null) { unavailableCount++; continue; }
      openUnrealized += (last - entry) * Number(t.contracts) * 100;
    }
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    return { openCount: open.length, closedCount: closed.length, pendingCount: pending.length, wins, losses, totalPl, openUnrealized, winRate, unavailableCount };
  }, [trades]);

  // Client-side filter for the visible row list. The full trade set is always
  // loaded (see `load()` above) so the stats cards above this list stay
  // correct; this memo just narrows what's rendered to the active tab.
  const filteredTrades = useMemo(() => {
    if (filter === "all") return trades;
    if (filter === "pending") return trades.filter((t) => t.status === "pending_entry");
    return trades.filter((t) => t.status === filter);
  }, [trades, filter]);

  return (
    <div className="min-h-screen flex bg-background">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardHeader />
        <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full">
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <FlaskConical className="h-5 w-5 text-violet-400" />
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Paper Trades</h1>
            <span className="text-[10px] uppercase tracking-wider text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded">Simulated</span>
            {automation && (
              <span
                className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded inline-flex items-center gap-1.5 border ${
                  automation.paused
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                }`}
                title={
                  automation.paused
                    ? `Automation is paused${automation.pausedReason ? `: ${automation.pausedReason}` : ""}. New pending entries will not fire until an admin resumes.`
                    : `Automation is ON. Pending entries will fire when their trigger condition is met. Cap: ${automation.userOpenPending}/${automation.maxOpenPending} active.`
                }
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${automation.paused ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`} />
                Automation: {automation.paused ? "PAUSED" : "ON"}
              </span>
            )}
            {/* Phase 1 market-hours indicator. Distinct from the Automation
                badge above: the kill switch is admin-controlled, while this
                follows the wall clock. Both must be ON for pending entries
                to be evaluated. After-hours, only contract-expiry exits and
                pending-expiry cancellations run; option-P&L exits and
                trigger evaluation pause until the next session. */}
            <span
              className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded inline-flex items-center gap-1.5 border ${
                marketOpen
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40"
              }`}
              title={
                marketOpen
                  ? "US equity options market is open (9:30 AM – 4:00 PM ET, weekdays). Trade execution and exit monitoring are active."
                  : "Market closed — trading disabled until next session. Buy Now / Queue at Entry are disabled and option-P&L exits are paused. Contract-expiry handling continues."
              }
            >
              {marketOpen ? (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ) : (
                <Lock className="h-2.5 w-2.5" />
              )}
              Market: {marketOpen ? "OPEN" : "CLOSED"}
            </span>
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
              <div className="text-[10px] text-muted-foreground">
                unrealized {fmtMoney(stats.openUnrealized)}
                {stats.pendingCount > 0 && (
                  <span className="block text-sky-300/80">
                    + {stats.pendingCount} pending {stats.pendingCount === 1 ? "entry" : "entries"}
                  </span>
                )}
                {stats.unavailableCount > 0 && (
                  <span className="block text-amber-300/80">
                    ({stats.unavailableCount} excluded — quote unavailable)
                  </span>
                )}
              </div>
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

          <div className="flex gap-1 mb-3 flex-wrap">
            {(Object.keys(FILTER_LABELS) as FilterKey[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "bg-muted/30 text-muted-foreground border border-transparent hover:text-foreground"
                }`}
              >
                {FILTER_LABELS[f]}
                {f === "pending" && stats.pendingCount > 0 && (
                  <span className="ml-1.5 text-[10px] px-1 rounded bg-sky-500/20 text-sky-300">{stats.pendingCount}</span>
                )}
              </button>
            ))}
          </div>

          {loading && filteredTrades.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : filteredTrades.length === 0 ? (
            <div className="rounded-xl border border-border/40 bg-card p-8 text-center">
              <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {trades.length === 0
                  ? <>No paper trades yet. Open one from any signal card using the <strong className="text-foreground">Review Trade</strong> button.</>
                  : <>No {FILTER_LABELS[filter].toLowerCase()} trades.</>}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTrades.map((t) => {
                const isCall = t.option_type === "call";

                // ── Pending entry rows ────────────────────────────────────
                // Pending trades have no entry_price yet (NULL until trigger fires)
                // and no quote/P&L to show. Display the trigger condition, queued
                // time, expiration countdown, and a Cancel button. The Buy Now /
                // Queue toggle on PaperTradeTicket creates these rows.
                if (t.status === "pending_entry") {
                  const trig = t.entry_trigger_price != null ? Number(t.entry_trigger_price) : null;
                  return (
                    <div key={t.id} className="rounded-xl border p-3 bg-sky-500/5 border-sky-500/30">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isCall ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />}
                          <span className="text-base font-bold text-foreground">{t.ticker}</span>
                          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isCall ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>{t.option_type.toUpperCase()} ${Number(t.strike)}</span>
                          <span className="text-[10px] text-muted-foreground">{String(t.expiry).slice(0, 10)}</span>
                          <span className="text-[10px] text-muted-foreground">× {t.contracts}</span>
                          <span className="text-[10px] uppercase font-bold border px-1.5 py-0.5 rounded inline-flex items-center gap-1 bg-sky-500/15 text-sky-300 border-sky-500/30">
                            <Clock className="h-3 w-3" />
                            PENDING ENTRY
                          </span>
                          {t.signal_grade && (
                            <span className="text-[10px] uppercase font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">{t.signal_grade}</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => toggleSignalPanel(t)}
                            className="px-2 py-1 rounded text-[11px] font-bold bg-muted/40 text-foreground/80 border border-border/50 hover:bg-muted/60 inline-flex items-center gap-1"
                            title="Show the original signal that produced this trade"
                          >
                            {expandedSignalRow === t.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            View Original Signal
                          </button>
                          <button
                            onClick={() => cancelPending(t.id)}
                            disabled={cancellingId === t.id}
                            className="px-2 py-1 rounded text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50"
                            title="Cancel this pending entry — it will not fill"
                          >
                            {cancellingId === t.id ? "Cancelling…" : "Cancel"}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Trigger</div>
                          <div className="text-foreground font-medium">
                            {isCall ? <ChevronUp className="inline h-3 w-3 text-emerald-400" /> : <ChevronDown className="inline h-3 w-3 text-red-400" />}
                            {" "}
                            Underlying {triggerDirectionLabel(t.entry_trigger_direction)}{" "}
                            <span className="font-mono text-sky-200">{trig != null ? `$${trig.toFixed(2)}` : "—"}</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Queued</div>
                          <div className="text-foreground">{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Expires</div>
                          <div className="text-foreground">{formatRelativeUntil(t.pending_expires_at)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Source</div>
                          <div className="text-foreground capitalize">{t.source ?? "signal"}</div>
                        </div>
                      </div>

                      <div className="mt-2 text-[11px] text-sky-200/80 leading-snug">
                        Waiting for the underlying to reach the trigger. When it does, we'll fill at the live ask and this becomes an open trade. If it doesn't trigger before expiration, it auto-cancels.
                      </div>
                      {expandedSignalRow === t.id && (
                        <OriginalSignalPanel t={t} fetchState={t.signal_id ? signalDetails[t.signal_id] : undefined} />
                      )}
                    </div>
                  );
                }

                // ── Cancelled rows ───────────────────────────────────────
                // Cancelled trades never filled. Show why they were cancelled
                // (user, expired unfilled, contract expired) — no P/L exists.
                if (t.status === "cancelled") {
                  const trig = t.entry_trigger_price != null ? Number(t.entry_trigger_price) : null;
                  return (
                    <div key={t.id} className="rounded-xl border p-3 bg-muted/20 border-border/40 opacity-90">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isCall ? <TrendingUp className="h-4 w-4 text-emerald-400/60" /> : <TrendingDown className="h-4 w-4 text-red-400/60" />}
                          <span className="text-base font-bold text-foreground/80">{t.ticker}</span>
                          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isCall ? "bg-emerald-500/10 text-emerald-300/70" : "bg-red-500/10 text-red-300/70"}`}>{t.option_type.toUpperCase()} ${Number(t.strike)}</span>
                          <span className="text-[10px] text-muted-foreground">{String(t.expiry).slice(0, 10)}</span>
                          <span className="text-[10px] text-muted-foreground">× {t.contracts}</span>
                          <span className="text-[10px] uppercase font-bold border px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground border-border/40">
                            {cancelReasonLabel(t.pending_cancel_reason)}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => toggleSignalPanel(t)}
                            className="px-2 py-1 rounded text-[11px] font-bold bg-muted/40 text-foreground/70 border border-border/40 hover:bg-muted/60 inline-flex items-center gap-1"
                            title="Show the original signal that produced this trade"
                          >
                            {expandedSignalRow === t.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            View Original Signal
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Was watching</div>
                          <div className="text-foreground/80">
                            {triggerDirectionLabel(t.entry_trigger_direction)}{" "}
                            <span className="font-mono">{trig != null ? `$${trig.toFixed(2)}` : "—"}</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Queued</div>
                          <div className="text-foreground/80">{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground uppercase text-[9px]">Source</div>
                          <div className="text-foreground/80 capitalize">{t.source ?? "signal"}</div>
                        </div>
                      </div>
                      {expandedSignalRow === t.id && (
                        <OriginalSignalPanel t={t} fetchState={t.signal_id ? signalDetails[t.signal_id] : undefined} />
                      )}
                    </div>
                  );
                }

                const entry = Number(t.entry_price);
                const last = t.last_quote_price != null ? Number(t.last_quote_price) : null;
                const realized = t.realized_pl != null ? Number(t.realized_pl) : null;
                const realizedPct = t.realized_pl_pct != null ? Number(t.realized_pl_pct) : null;
                const target = t.signal_target != null ? Number(t.signal_target) : null;
                const inval = t.signal_invalidation != null ? Number(t.signal_invalidation) : null;

                // Quote freshness — derived from existing columns. When the quote is
                // UNAVAILABLE or PENDING we MUST NOT show P/L based on the entry-snapshot
                // value, because that would falsely report 0 unrealized as if the position
                // were exactly flat.
                const { state: quoteState, ageSinceCheckSec } = deriveQuoteState(t);
                const quoteIsUsable = t.status === "closed" || quoteState === "live" || quoteState === "stale";

                const unrealized = quoteIsUsable && last != null && t.status === "open" ? (last - entry) * Number(t.contracts) * 100 : null;
                const unrealizedPct = quoteIsUsable && last != null && t.status === "open" && entry > 0 ? ((last - entry) / entry) * 100 : null;
                const plToShow = t.status === "open" ? unrealized : realized;
                const plPctToShow = t.status === "open" ? unrealizedPct : realizedPct;

                // State badge — visible on every OPEN row.
                const stateBadge = t.status !== "open" ? null : (() => {
                  if (quoteState === "live") return { label: "LIVE", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400" };
                  if (quoteState === "stale") return { label: "STALE", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", dot: "bg-amber-400" };
                  if (quoteState === "pending") return { label: "PENDING QUOTE", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30", dot: "bg-sky-400" };
                  return { label: "QUOTE UNAVAILABLE", cls: "bg-red-500/15 text-red-300 border-red-500/30", dot: "bg-red-400" };
                })();

                return (
                  <div key={t.id} className={`rounded-xl border p-3 ${t.status === "open" ? (quoteState === "unavailable" ? "bg-red-500/5 border-red-500/30" : "bg-card border-border/50") : (realized ?? 0) >= 0 ? "bg-emerald-500/5 border-emerald-500/30" : "bg-red-500/5 border-red-500/30"}`}>
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
                        {/* Phase 1 / Commit 4 — Trailing Armed badge.
                            Visible on OPEN rows whose option P/L has crossed
                            +20% at least once. Stays visible (latched) even if
                            price pulls back, until the trade closes. Peak shown
                            so the trader sees how close we are to the trailing
                            stop trigger (peak × 0.90). */}
                        {t.status === "open" && t.trailing_active && (
                          <span
                            className="text-[10px] uppercase font-bold text-amber-200 bg-amber-500/15 border border-amber-400/40 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                            title={
                              t.highest_price_after_activation != null
                                ? `Trailing stop armed. Peak option price $${Number(t.highest_price_after_activation).toFixed(2)}. Will close if price drops 10% from peak (≤ $${(Number(t.highest_price_after_activation) * 0.9).toFixed(2)}).`
                                : "Trailing stop armed. Will close if price drops 10% from peak."
                            }
                          >
                            🛡️ Trailing armed
                            {t.highest_price_after_activation != null && (
                              <span className="font-mono normal-case">@ ${Number(t.highest_price_after_activation).toFixed(2)}</span>
                            )}
                          </span>
                        )}
                        {stateBadge && (
                          <span className={`text-[10px] uppercase font-bold border px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${stateBadge.cls}`}>
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${stateBadge.dot}`} />
                            {stateBadge.label}
                          </span>
                        )}
                        {t.signal_grade && (
                          <span className="text-[10px] uppercase font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">{t.signal_grade}</span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => toggleSignalPanel(t)}
                          className="px-2 py-1 rounded text-[11px] font-bold bg-muted/40 text-foreground/80 border border-border/50 hover:bg-muted/60 inline-flex items-center gap-1"
                          title="Show the original signal that produced this trade"
                        >
                          {expandedSignalRow === t.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          View Original Signal
                        </button>
                        {t.status === "open" && (
                          <>
                            <button onClick={() => refreshOne(t.id)} disabled={refreshingId === t.id} className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50" title="Refresh quote">
                              {refreshingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                            </button>
                            <button onClick={() => closeOne(t.id)} disabled={closingId === t.id} className="px-2 py-1 rounded text-[11px] font-bold bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-50">
                              {closingId === t.id ? "Closing…" : "Force close"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* When the monitor has never produced a live quote, be explicit
                        about what the user is looking at. Do NOT pretend P/L is real. */}
                    {t.status === "open" && quoteState === "unavailable" && (
                      <div className="mb-2 rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-[11px] text-red-200/90 leading-snug">
                        <strong>Live quote not available.</strong> The background monitor has not been able to refresh this contract since the trade was opened. P/L is hidden because we will not show a number we can't verify. Underlying shown below is the snapshot at trade open, not a live price.
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px]">
                      <div><span className="text-muted-foreground">Entry: </span><span className="font-mono text-foreground">{fmtMoney(entry)} <span className="text-muted-foreground">(at {sourceLabel(t.entry_fill_source)})</span></span></div>
                      {t.status === "open" ? (
                        quoteIsUsable ? (
                          <div><span className="text-muted-foreground">Current: </span><span className="font-mono text-foreground">{fmtMoney(last)} <span className="text-muted-foreground">(at {sourceLabel(t.last_quote_source)})</span></span></div>
                        ) : (
                          <div><span className="text-muted-foreground">Current: </span><span className="font-mono text-muted-foreground">—</span></div>
                        )
                      ) : (
                        <div><span className="text-muted-foreground">Exit: </span><span className="font-mono text-foreground">{fmtMoney(t.exit_price)} <span className="text-muted-foreground">(at {sourceLabel(t.exit_fill_source)})</span></span></div>
                      )}
                      <div className={`font-mono font-bold ${plToShow != null && plToShow >= 0 ? "text-emerald-400" : plToShow != null ? "text-red-400" : "text-muted-foreground"}`}>
                        P/L: {plToShow != null ? fmtMoney(plToShow) : "—"} {plPctToShow != null && <span className="text-[10px]">({fmtPct(plPctToShow)})</span>}
                      </div>
                      <div className="text-muted-foreground">Opened {fmtTime(t.opened_at)}</div>
                      {t.signal_entry != null && <div className="text-muted-foreground">Plan entry: <span className="font-mono text-foreground">{fmtMoney(t.signal_entry)}</span></div>}
                      {target != null && <div className="text-muted-foreground">🎯 Target: <span className="font-mono text-emerald-300">{fmtMoney(target)}</span></div>}
                      {inval != null && <div className="text-muted-foreground">🛑 Stop: <span className="font-mono text-red-300">{fmtMoney(inval)}</span></div>}
                      {t.status === "open" && t.last_quote_underlying && (
                        <div className="text-muted-foreground">
                          Underlying: <span className="font-mono text-foreground">{fmtMoney(t.last_quote_underlying)}</span>
                          {quoteState === "unavailable" && <span className="text-amber-300/80"> (entry snapshot)</span>}
                        </div>
                      )}
                      {t.status === "open" && (
                        <div className={
                          quoteState === "live" ? "text-muted-foreground"
                          : quoteState === "stale" ? "text-amber-300"
                          : quoteState === "unavailable" ? "text-red-300"
                          : "text-sky-300"
                        }>
                          {quoteState === "live" && <>Last quote {formatAge(ageSinceCheckSec)}</>}
                          {quoteState === "stale" && <>Last quote {formatAge(ageSinceCheckSec)}</>}
                          {quoteState === "unavailable" && <>No live quote since open · last attempted {formatAge(ageSinceCheckSec)}</>}
                          {quoteState === "pending" && <>Waiting for first quote…</>}
                        </div>
                      )}
                      {t.closed_at && <div className="text-muted-foreground">Closed {fmtTime(t.closed_at)}</div>}
                    </div>
                    {(t.signal_grade || t.signal_confidence) && (
                      <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground flex gap-3 flex-wrap">
                        {t.signal_grade && <span>Grade: <span className="text-foreground font-medium">{t.signal_grade}</span></span>}
                        {t.signal_confidence && <span>Confidence: <span className="text-foreground font-medium">{t.signal_confidence}</span></span>}
                      </div>
                    )}
                    {expandedSignalRow === t.id && (
                      <OriginalSignalPanel t={t} fetchState={t.signal_id ? signalDetails[t.signal_id] : undefined} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-4 text-center max-w-3xl mx-auto leading-relaxed">
            Quotes refresh every 30s on this page. Open trades are also auto-monitored on the server (every 60s during market hours, every 5 min off-hours).
            Auto-close rules, in priority order: contract expired · option P/L ≤ −25% (hard stop) · option P/L ≥ +40% (profit target) · trailing stop (arms at +20%, closes if price drops 10% from peak) · underlying invalidation · underlying target.
          </p>
        </main>
      </div>
    </div>
  );
}
