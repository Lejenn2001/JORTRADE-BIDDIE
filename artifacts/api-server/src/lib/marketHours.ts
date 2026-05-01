// ─── Market-Hours Gate (Phase 1, weekends-only) ──────────────────────────────
// Single source of truth for "is the US equity options market open right now?"
// Used by:
//   • POST /whale/paper/trades                (gate trade creation)
//   • paperTradeMonitor.processPendingEntries (gate auto-enter / pause triggers)
//   • paperTradeMonitor.processOpenTrades     (gate option-P&L exits; expiry runs 24/7)
//   • signal generation refresh interval      (already gated; deduped here)
//   • a handful of read-only response fields  (marketOpen flag in /whale/* GETs)
//
// Phase 1 scope (Apr 2026): regular session 9:30–16:00 ET, weekends excluded.
// NYSE holidays / early-close days are intentionally NOT modeled yet — that is
// a planned follow-up. Behavior matches the previous two duplicate utilities
// (whale.ts isMarketHours + paperTradeMonitor.ts isMarketHoursET) which both
// excluded only weekends.
//
// Boundary semantics: open at 09:30:00 ET inclusive, closed at 16:00:00 ET
// (i.e. last open minute is 15:59). This matches whale.ts's prior behavior
// (>= 9.5 && < 16) and aligns with how the cash session is conventionally
// described to the user. The previous paperTradeMonitor variant treated
// 16:00:00 as still-open by one minute; consolidating to the stricter cutoff
// is the safer choice for a trading gate.

export const MARKET_CLOSED_MESSAGE = "Market closed — trading disabled until next session.";

export type MarketClosedReason = "weekend" | "before_open" | "after_close";

function nowEtParts(now: Date): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    // Intl can return "24" for midnight in some locales; normalize to 0.
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
  };
}

export function isMarketOpenET(now: Date = new Date()): boolean {
  try {
    const { weekday, hour, minute } = nowEtParts(now);
    if (weekday === "Sat" || weekday === "Sun") return false;
    const minutesSinceMidnight = hour * 60 + minute;
    return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
  } catch {
    // Fail closed — if the clock/timezone is unreadable, treat as closed so
    // we never accidentally permit a trade we cannot price honestly.
    return false;
  }
}

export function marketClosedReason(now: Date = new Date()): MarketClosedReason | null {
  try {
    const { weekday, hour, minute } = nowEtParts(now);
    if (weekday === "Sat" || weekday === "Sun") return "weekend";
    const m = hour * 60 + minute;
    if (m < 9 * 60 + 30) return "before_open";
    if (m >= 16 * 60) return "after_close";
    return null;
  } catch {
    return "after_close";
  }
}

// ─── EOD Auto-Close Phase Helpers ────────────────────────────────────────────
// Used by the EOD close engine (eodCloseEngine.ts) to determine which sweep
// phase, if any, is active right now. ET-aware via the same Intl.DateTimeFormat
// pattern as isMarketOpenET above. Holiday calendar NOT modeled — same Phase 1
// limitation as the rest of marketHours (weekends-only). On a holiday weekday
// the phase will still progress through the EOD window; the engine's
// fetchOpenTrades will simply return [] because Buy Paper was gated all day,
// so the sweep is a silent no-op.
//
// Phases:
//   "before" → before EOD_CLOSE_TIME (or weekend) → engine returns immediately
//   "soft"   → [EOD_CLOSE_TIME, EOD_FORCE_CLOSE_TIME) → fresh quote only;
//              if no quote, leave open and retry next monitor tick
//   "force"  → [EOD_FORCE_CLOSE_TIME, 16:00) → fresh quote first, fall back
//              to last stored quote if no fresh quote available
//   "after"  → ≥ 16:00 ET (or weekend) → engine returns immediately

export type EodPhase = "before" | "soft" | "force" | "after";

export function getEodPhaseET(
  closeTime: { hour: number; minute: number },
  forceCloseTime: { hour: number; minute: number },
  now: Date = new Date(),
): EodPhase {
  try {
    const { weekday, hour, minute } = nowEtParts(now);
    if (weekday === "Sat" || weekday === "Sun") return "before";
    const m = hour * 60 + minute;
    const closeM = closeTime.hour * 60 + closeTime.minute;
    const forceM = forceCloseTime.hour * 60 + forceCloseTime.minute;
    if (m < closeM) return "before";
    if (m < forceM) return "soft";
    if (m < 16 * 60) return "force";
    return "after";
  } catch {
    // Fail-safe: if clock unreadable, do nothing (no EOD sweep).
    return "before";
  }
}

// Returns YYYY-MM-DD in ET. Used by the EOD sentinel so "today" rolls over
// at ET midnight regardless of server timezone.
export function currentEtDateString(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
