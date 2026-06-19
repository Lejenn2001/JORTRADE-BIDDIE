---
name: Signal pipeline runtime & data gaps
description: Why signal_outcomes has multi-day gaps and why win/loss grading is frozen — runtime + Polygon dependency, not a logic bug.
---

# Signal pipeline runtime & the frozen win-rate

**Two independent feeds power the signal system:**
- **Unusual Whales** (`UNUSUAL_WHALES_API_KEY`) → `fetchFlowAlerts()` → generates NEW plays/signals. Works fine on its own.
- **Polygon** (`getPolygonKey()`) → price enrichment + `realtimeVerifySignals` (the grader that marks a signal hit/missed). 

**Gap in new plays = the api-server process wasn't running.**
The signal pipeline runs on `setInterval` inside the api-server. In DEV that process only runs while the Replit workspace is awake. So multi-day gaps in `signal_outcomes.detected_at` (observed e.g. June 6–18, 2026 = zero signals; resumed the moment the workspace was reopened June 19) are **workspace downtime, not a code bug.** To get plays 24/7 the api-server must run as an always-on deployment.
**How to apply:** before debugging "no signals" as a logic problem, check whether the backend was even running for that window (gap starts/ends align with workspace open/close).

**Frozen win rate = Polygon key rejected (HTTP 401 / "authentication failed").**
The grader needs Polygon price history (`fetchPriceHistory` → `fetchPolygonAggs`) to decide hit vs miss. Polygon has been returning 401 since ~Apr 30, 2026, so every signal since May 1 only ever becomes `expired` or stays `pending` — no new hits/misses. The dashboard "win rate today / wins today" is therefore frozen on the last graded day (late Apr, ~80%). Also causes `Polygon options enrichment: 0/N contracts found` log spam and WS code 1006 reconnect loops.
**Why:** symptom looks like "signals stopped winning" but it's a dead data feed, not strategy.
**Fix needs a valid Polygon key from Jennifer's Polygon.io account** (likely lapsed/regenerated). Agent cannot self-fix.

**Two scoreboards — don't confuse them:** dashboard "win rate"/"wins" = `signal_outcomes` (hundreds of alert hits). `paper_trades` = user's actual practice trades (only ~9, Apr 29–30). Auditing paper_trades to answer a "win rate" question is the wrong table.
