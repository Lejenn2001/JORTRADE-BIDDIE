---
name: Conviction score predictive audit
description: How predictive JORTRADE's conviction_score actually is of winners (data audit, ~1.5k signals)
---

# Conviction score is an EXPIRATION filter, not a win predictor

Audited `signal_outcomes` (Replit Postgres via `DATABASE_URL`), 1,565 scored signals, 2026-03-26 → 2026-06-19.

`conviction_score` is 0–100 (sibling `confidence` is 0–10, ~conviction/10; both behave identically). Scores cluster hard at 60/70/80 (~94% of all rows); 90/95/100 are tiny noisy samples.

**Finding 1 — among RESOLVED signals (hit/partial vs missed/near_miss), conviction barely matters.**
Pearson corr(conviction, win) = **-0.04** (essentially zero, slightly negative). Win rate is flat ~70–78% across every score. A 60 wins 78%, an 80 wins 70%. Higher conviction does NOT mean higher hit-rate once a move happens.

**Finding 2 — but conviction strongly predicts whether the move HAPPENS before expiry.**
Counting `expired` as a non-win, win% climbs monotonically with score: 60→48.7%, 70→54.0%, 80→62.8%, 90→70.8%, 100→78.6%. Low-conviction signals expire ~38% of the time; 80+ expire ~11%; 90+ ~4%.

**Takeaway:** conviction reads as "will this actually move/resolve?" not "will it win?". Direction accuracy (~73%) is roughly constant regardless of score; conviction filters out the fizzle-outs (expirations).

**Biddie picks:** avg conviction 81.5 vs 66.0 for non-picks, yet resolved win rate 72.1% vs 75.2% — picks do NOT out-win on resolved basis (consistent with Finding 1), though their higher scores mean fewer expirations.

**Why this matters / how to apply:** don't sell the score as a win-probability. If presenting it, frame as likelihood the setup plays out before expiry. The app's official win-rate formula excludes `expired` (only hit/partial vs missed/near_miss) — that view hides conviction's real value, which only shows when expirations are counted.
