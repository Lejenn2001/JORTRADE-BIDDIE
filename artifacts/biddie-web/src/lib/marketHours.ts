// ─── Market-Hours Gate (frontend mirror) ─────────────────────────────────────
// Mirrors artifacts/api-server/src/lib/marketHours.ts so we can disable
// trade-submit buttons preemptively and show the closed-market banner.
//
// The backend remains AUTHORITATIVE — POST /api/whale/paper/trades returns
// 409 { code: "market_closed" } when the server's clock says the market is
// shut, regardless of what the client thinks. This file exists purely so the
// UI can mirror that state without round-tripping.
//
// Scope: regular session 9:30–16:00 ET, with full-day NYSE holidays excluded
// and early-close days (1:00 PM ET) respected. Weekends are always closed.
//
// NOTE: the server augments its copy of this calendar at runtime from Polygon's
// official feed; this client mirror only carries the STATIC table, so keep the
// dates below in sync with the server util's STATIC_FULL_CLOSE / STATIC_EARLY_CLOSE.
//
// Boundary semantics: open at 09:30:00 ET inclusive, closed at the session end
// (16:00:00 ET normally, 13:00:00 ET on early-close days).

export const MARKET_CLOSED_MESSAGE = "Market closed — trading disabled until next session.";

export type MarketClosedReason = "weekend" | "holiday" | "before_open" | "after_close";

// Full-day NYSE/NASDAQ closures (ET dates as YYYY-MM-DD).
const FULL_CLOSE = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

// Early-close days → regular session ends 13:00 ET (1:00 PM).
const EARLY_CLOSE = new Map<string, { hour: number; minute: number }>([
  ["2026-11-27", { hour: 13, minute: 0 }], // Day after Thanksgiving
  ["2026-12-24", { hour: 13, minute: 0 }], // Christmas Eve
  ["2027-11-26", { hour: 13, minute: 0 }], // Day after Thanksgiving
]);

const OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET
const REGULAR_CLOSE_MINUTES = 16 * 60; // 16:00 ET

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

// YYYY-MM-DD in ET.
function etDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sessionCloseMinutes(dateStr: string): number {
  const early = EARLY_CLOSE.get(dateStr);
  return early ? early.hour * 60 + early.minute : REGULAR_CLOSE_MINUTES;
}

export function isMarketOpenET(now: Date = new Date()): boolean {
  try {
    const { weekday, hour, minute } = nowEtParts(now);
    if (weekday === "Sat" || weekday === "Sun") return false;
    const dateStr = etDateString(now);
    if (FULL_CLOSE.has(dateStr)) return false; // NYSE holiday
    const m = hour * 60 + minute;
    return m >= OPEN_MINUTES && m < sessionCloseMinutes(dateStr);
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
    const dateStr = etDateString(now);
    if (FULL_CLOSE.has(dateStr)) return "holiday";
    const m = hour * 60 + minute;
    if (m < OPEN_MINUTES) return "before_open";
    if (m >= sessionCloseMinutes(dateStr)) return "after_close";
    return null;
  } catch {
    return "after_close";
  }
}

// True if the given date is a full-day NYSE holiday (cash session does not run).
export function isMarketHolidayET(now: Date = new Date()): boolean {
  try {
    return FULL_CLOSE.has(etDateString(now));
  } catch {
    return false;
  }
}

// Minutes-since-ET-midnight of an early close (e.g. 780 = 13:00), or null if the
// given date is not an early-close day.
export function earlyCloseMinutesET(now: Date = new Date()): number | null {
  try {
    const e = EARLY_CLOSE.get(etDateString(now));
    return e ? e.hour * 60 + e.minute : null;
  } catch {
    return null;
  }
}

// True if the given date is a normal trading day (a weekday that is not a
// full-day holiday). Early-close days are still trading days.
export function isTradingDayET(now: Date = new Date()): boolean {
  try {
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(now);
    if (wd === "Sat" || wd === "Sun") return false;
    return !isMarketHolidayET(now);
  } catch {
    return false;
  }
}
