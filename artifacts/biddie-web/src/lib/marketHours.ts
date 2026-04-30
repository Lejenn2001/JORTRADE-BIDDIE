// ─── Market-Hours Gate (frontend mirror) ─────────────────────────────────────
// Mirrors artifacts/api-server/src/lib/marketHours.ts so we can disable
// trade-submit buttons preemptively and show the closed-market banner.
//
// The backend remains AUTHORITATIVE — POST /api/whale/paper/trades returns
// 409 { code: "market_closed" } when the server's clock says the market is
// shut, regardless of what the client thinks. This file exists purely so the
// UI can mirror that state without round-tripping.
//
// Phase 1 scope (Apr 2026): regular session 9:30–16:00 ET, weekends excluded.
// NYSE holidays / early-close days are intentionally NOT modeled yet — that
// is a planned follow-up. Keep this file in sync with the server util.
//
// Boundary semantics: open at 09:30:00 ET inclusive, closed at 16:00:00 ET
// (so the last open minute is 15:59).

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
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
  };
}

export function isMarketOpenET(now: Date = new Date()): boolean {
  try {
    const { weekday, hour, minute } = nowEtParts(now);
    if (weekday === "Sat" || weekday === "Sun") return false;
    const m = hour * 60 + minute;
    return m >= 9 * 60 + 30 && m < 16 * 60;
  } catch {
    // Fail closed — treat unreadable timezone as closed so the user sees the
    // banner rather than a misleading enabled button.
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
