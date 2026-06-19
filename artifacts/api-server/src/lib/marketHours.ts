// ─── Market-Hours Gate ───────────────────────────────────────────────────────
// Single source of truth for "is the US equity options market open right now?"
// Used by:
//   • POST /whale/paper/trades                (gate trade creation)
//   • paperTradeMonitor.processPendingEntries (gate auto-enter / pause triggers)
//   • paperTradeMonitor.processOpenTrades     (gate option-P&L exits; expiry runs 24/7)
//   • signal generation refresh interval      (already gated; deduped here)
//   • a handful of read-only response fields  (marketOpen flag in /whale/* GETs)
//
// Scope: regular session 9:30–16:00 ET, with full-day NYSE holidays excluded
// and early-close days (1:00 PM ET) respected. Weekends are always closed.
//
// The holiday / early-close calendar is seeded with a STATIC table (below) so it
// works offline and fails safe, and is ALSO refreshed at runtime from Polygon's
// official market-status calendar (see refreshMarketCalendarFromPolygon) so it
// self-corrects and automatically extends to future years.
//
// Boundary semantics: open at 09:30:00 ET inclusive, closed at the session end
// (16:00:00 ET normally, 13:00:00 ET on early-close days) — i.e. the last open
// minute is one before the close. This matches whale.ts's prior behavior
// (>= 9.5 && < 16) and how the cash session is conventionally described.

export const MARKET_CLOSED_MESSAGE = "Market closed — trading disabled until next session.";

export type MarketClosedReason =
  | "weekend"
  | "holiday"
  | "before_open"
  | "after_close";

// ─── NYSE / NASDAQ calendar (ET dates as YYYY-MM-DD) ──────────────────────────
// Full-day closures. Seeded statically; augmented at runtime from Polygon.
const STATIC_FULL_CLOSE: string[] = [
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; Jul 4 is Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King Jr. Day
  "2027-02-15", // Washington's Birthday
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed; Jun 19 is Saturday)
  "2027-07-05", // Independence Day (observed; Jul 4 is Sunday)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving Day
  "2027-12-24", // Christmas Day (observed; Dec 25 is Saturday)
];

// Early-close days → regular session ends 13:00 ET (1:00 PM).
const STATIC_EARLY_CLOSE: Record<string, { hour: number; minute: number }> = {
  // 2026
  "2026-11-27": { hour: 13, minute: 0 }, // Day after Thanksgiving
  "2026-12-24": { hour: 13, minute: 0 }, // Christmas Eve
  // 2027
  "2027-11-26": { hour: 13, minute: 0 }, // Day after Thanksgiving
};

// Live, mutable copies (static seed + Polygon refresh merged in at runtime).
const fullCloseDates = new Set<string>(STATIC_FULL_CLOSE);
const earlyCloseDates = new Map<string, { hour: number; minute: number }>(
  Object.entries(STATIC_EARLY_CLOSE),
);

const REGULAR_CLOSE_MINUTES = 16 * 60; // 16:00 ET
const OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET

// Session end (in ET minutes-since-midnight) for a given date: 13:00 on an
// early-close day, otherwise 16:00.
function sessionCloseMinutes(dateStr: string): number {
  const early = earlyCloseDates.get(dateStr);
  return early ? early.hour * 60 + early.minute : REGULAR_CLOSE_MINUTES;
}

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
    const dateStr = currentEtDateString(now);
    if (fullCloseDates.has(dateStr)) return false; // NYSE holiday
    const minutesSinceMidnight = hour * 60 + minute;
    return (
      minutesSinceMidnight >= OPEN_MINUTES &&
      minutesSinceMidnight < sessionCloseMinutes(dateStr) // 13:00 on early-close days
    );
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
    const dateStr = currentEtDateString(now);
    if (fullCloseDates.has(dateStr)) return "holiday";
    const m = hour * 60 + minute;
    if (m < OPEN_MINUTES) return "before_open";
    if (m >= sessionCloseMinutes(dateStr)) return "after_close";
    return null;
  } catch {
    return "after_close";
  }
}

// ─── EOD Auto-Close Phase Helpers ────────────────────────────────────────────
// Used by the EOD close engine (eodCloseEngine.ts) to determine which sweep
// phase, if any, is active right now. ET-aware via the same Intl.DateTimeFormat
// pattern as isMarketOpenET above. Holiday-aware: on a full-day NYSE holiday no
// session runs, so the engine returns immediately ("before"). On early-close
// days the cash session ends at 13:00 ET, so "force" extends to 13:00 and the
// engine is done ("after") thereafter.
//
// Phases:
//   "before" → before EOD_CLOSE_TIME (or weekend/holiday) → engine returns immediately
//   "soft"   → [EOD_CLOSE_TIME, EOD_FORCE_CLOSE_TIME) → fresh quote only;
//              if no quote, leave open and retry next monitor tick
//   "force"  → [EOD_FORCE_CLOSE_TIME, session close) → fresh quote first, fall
//              back to last stored quote if no fresh quote available
//   "after"  → ≥ session close ET (or weekend/holiday) → engine returns immediately

export type EodPhase = "before" | "soft" | "force" | "after";

export function getEodPhaseET(
  closeTime: { hour: number; minute: number },
  forceCloseTime: { hour: number; minute: number },
  now: Date = new Date(),
): EodPhase {
  try {
    const { weekday, hour, minute } = nowEtParts(now);
    if (weekday === "Sat" || weekday === "Sun") return "before";
    const dateStr = currentEtDateString(now);
    if (fullCloseDates.has(dateStr)) return "before"; // holiday → no sweep
    const m = hour * 60 + minute;
    const sessionCloseM = sessionCloseMinutes(dateStr); // 13:00 on early-close days
    let closeM = closeTime.hour * 60 + closeTime.minute;
    let forceM = forceCloseTime.hour * 60 + forceCloseTime.minute;
    if (sessionCloseM < REGULAR_CLOSE_MINUTES) {
      // Early-close day: shift the configured EOD windows earlier by the same
      // number of minutes they normally sit before the 16:00 bell, so the full
      // soft → force → close sequence still runs before the (earlier) 13:00 end.
      // (Config guarantees close < force < 16:00, so this preserves
      // closeM < forceM < sessionCloseM.)
      closeM = sessionCloseM - (REGULAR_CLOSE_MINUTES - closeM);
      forceM = sessionCloseM - (REGULAR_CLOSE_MINUTES - forceM);
    }
    if (m < closeM) return "before";
    if (m < forceM) return "soft";
    if (m < sessionCloseM) return "force";
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

// ─── Runtime calendar refresh (Polygon) ──────────────────────────────────────
// Pulls the official upcoming market-status calendar from Polygon and merges it
// into the in-memory holiday / early-close tables. This keeps us correct even
// if the static table above drifts, and auto-extends coverage to future years.
// Never throws — on any failure the static seed remains in effect.

// Extract the ET hour/minute from an ISO timestamp (Polygon returns the early
// close as a UTC timestamp, e.g. "...T18:00:00Z" = 13:00 ET in winter).
function etHourMinuteFromISO(iso: string): { hour: number; minute: number } | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { hour: parseInt(get("hour"), 10) % 24, minute: parseInt(get("minute"), 10) };
  } catch {
    return null;
  }
}

interface PolygonUpcomingEntry {
  date?: string;
  status?: string; // "closed" | "early-close" | "open"
  exchange?: string;
  close?: string; // ISO timestamp on early-close days
}

export async function refreshMarketCalendarFromPolygon(): Promise<void> {
  let apiKey = "";
  try {
    // Imported lazily so this module stays dependency-free for pure date logic.
    const { getPolygonKey } = await import("./polygonKey");
    apiKey = getPolygonKey();
  } catch {
    return;
  }
  if (!apiKey) return;

  try {
    const res = await fetch(
      `https://api.polygon.io/v1/marketstatus/upcoming?apiKey=${apiKey}`,
    );
    if (!res.ok) return;
    const entries = (await res.json()) as PolygonUpcomingEntry[];
    if (!Array.isArray(entries)) return;

    let added = 0;
    for (const e of entries) {
      const date = e?.date;
      if (!date) continue;
      // Restrict to the equity exchanges we actually trade against.
      const ex = (e.exchange || "").toUpperCase();
      if (ex && ex !== "NYSE" && ex !== "NASDAQ") continue;

      if (e.status === "closed") {
        if (!fullCloseDates.has(date)) added++;
        fullCloseDates.add(date);
      } else if (e.status === "early-close") {
        const t = e.close ? etHourMinuteFromISO(e.close) : null;
        earlyCloseDates.set(date, t ?? { hour: 13, minute: 0 });
        added++;
      }
    }
    if (added > 0) {
      console.log(
        `[marketHours] calendar refreshed from Polygon — ${fullCloseDates.size} full closures, ${earlyCloseDates.size} early closes known`,
      );
    }
  } catch {
    // Keep the static seed; never let a calendar fetch failure break startup.
  }
}
