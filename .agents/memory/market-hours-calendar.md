---
name: Market hours holiday calendar
description: How JORTRADE decides the US equity market is open, incl. holidays and early closes.
---
`lib/marketHours.ts` is the single source of truth for "is the market open" (`isMarketOpenET`, `marketClosedReason`, `getEodPhaseET`). It was originally weekends-only; it now also excludes full-day NYSE holidays and respects early-close days (regular session ends 13:00 ET instead of 16:00).

**Design:** a STATIC table (`STATIC_FULL_CLOSE`, `STATIC_EARLY_CLOSE`, currently 2026–2027) is the offline/fail-safe seed, copied into mutable `fullCloseDates` Set + `earlyCloseDates` Map. `refreshMarketCalendarFromPolygon()` (called from `index.ts` on startup + every 24h) merges Polygon's `/v1/marketstatus/upcoming` into those, so the calendar self-corrects and auto-extends to future years. It only logs when it ADDS something new — so if the static table already covers upcoming holidays, no log line appears (not a bug).

**Why both:** Polygon is authoritative (Jennifer pays for it) and auto-extends, but a network failure must never make the gate wrong, so the static seed always stands alone.

**How to apply:** never reintroduce a separate weekend-only or hardcoded-16:00 market check elsewhere — route through `isMarketOpenET`/`sessionCloseMinutes`. To extend the static fallback, add observed dates (watch weekend→Friday/Monday observance) to the two tables. Polygon `upcoming` returns NYSE+NASDAQ duplicate rows and early-close `close` as a UTC ISO timestamp (18:00Z = 13:00 ET in winter).

## Duplicate market-status logic in the UI (gotcha)
The dashboard sign `biddie-web/src/components/dashboard/MarketStatusSign.tsx` has its OWN
self-contained `getMarketState()` (weekday + ET time-of-day) and does NOT use the backend
`marketOpen` flag or `useMarketStatus`. It was the component still showing "MARKET OPEN" on a
holiday after the gate was already holiday-aware everywhere else.
**Why it matters:** any market-hours change (holidays, early close, hours) must be applied in
THREE places, not two: backend `marketHours.ts`, frontend `marketHours.ts`, AND
`MarketStatusSign.tsx`. The sign now imports `isMarketHolidayET`/`earlyCloseMinutesET`/
`isTradingDayET` from the frontend `marketHours.ts`, so future calendar edits flow through if
you keep using those helpers. Grep the UI for any OTHER local open/closed time math before
assuming a market-hours fix is complete.
