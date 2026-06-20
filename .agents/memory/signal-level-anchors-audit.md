---
name: Signal level anchors (PDH/PDL/VWAP/Pivot) audit
description: Where the card's Key Level / Support / target lines come from, and how predictive each anchor is
---

# Card levels are VWAP/Pivot/psychological first; prior-day high/low is a minor anchor

The SignalCard level rows map to generated text fields (see signal generation in api-server `routes/whale.ts`):
- **Area of Interest** = `entry_trigger` → anchored to VWAP ("Holding/Needs to reclaim VWAP at $X"), whale sweep, or "Near $X (no VWAP data)".
- **Range** = `target_near` / `target` → candidates VWAP/Strike/PDH/R1/Pivot.
- **Key Level** = `key_level` → **VWAP** (Pivot fallback). NOT prior day high.
- **Support / Resistance** = `sr_level` → psychological round-$10 level, or R1.
- **Support/Resistance (bad tone)** = `invalidation` → "Below {PDL/S1/Pivot} at $X" (calls) / "Above {PDH/R1/Pivot} at $X" (puts).

So PDH/PDL only appear as ONE candidate among several for the target and invalidation lines — never as the source of Key Level.

## Validity audit (signal_outcomes, 1,565 signals, Mar–Jun 2026, Replit Postgres via executeSql)
Prevalence in target/invalidation text: VWAP 768, Pivot 574, PDH/PDL 145 (~9%), R1/S1 81; psychological in sr_level 1,303.

Resolved win% (hit+partial vs miss+near_miss) by dominant anchor:
- VWAP 86.2% (expired 0.6%)
- R1/S1 76.9% (n=15, tiny)
- PDH/PDL 76.6% (expired 1.4%)
- Pivot 70.1% (expired 16.4%)
- plain $ / "no VWAP data" 72.8% (expired 42%)

**CAUTION — the per-anchor win% is mostly a slicing artifact, NOT proof a given level is more accurate.** The "VWAP 86%" slice (VWAP in target/invalidation, n=175) had ~0% expiration — the tell that it's selection bias toward signals that had complete intraday data, not the level's own predictive power. A cleaner split by `entry_trigger` flattens everything out:
- VWAP confirmed (price already on right side): 70.9% resolved win, 10% expired
- VWAP needs reclaim/reject: 73.5%, 28% expired
- whale sweep: 80.3%, 41% expired
- other: 73.5%, 0% expired

So resolved win rate sits ~71–80% **regardless of which level is shown** — consistent with the conviction audit's flat ~73% direction accuracy. The level LABEL (VWAP vs pivot vs PDH/PDL) does not meaningfully change accuracy. What presence-of-VWAP really signals is that the signal had live market data when created (so less likely to fizzle/expire), not a higher win probability.

**How to apply:** Don't tell the user a listed VWAP (or any level) means higher accuracy — it doesn't. Anchor Key Level to VWAP for *fidelity* (that's what the code does), but never frame any anchor as more predictive. Per conviction/duration audits, resolved win% hides expirations and is flat across anchors; the real variable is whether the move happens at all (expiration), driven by required-move-% and time-of-day, not the level type.
