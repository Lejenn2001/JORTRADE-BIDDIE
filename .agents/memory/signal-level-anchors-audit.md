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

**Takeaway:** PDH/PDL are legitimate and perform fine (~77% resolved, basically tied with the field, slightly above), but they are NOT specially predictive and NOT the main anchor — VWAP is both the most common and the best. The low expiration rate of VWAP/PDH/PDL signals mostly reflects that those signals had complete level data (captured during active market hours), a proxy for data availability rather than the level's own magic.

**How to apply:** when mocking or describing the card, anchor Key Level to VWAP, not "prior day high." Don't single out PDH/PDL as if they're the system's basis — they're a ~9% minority candidate. Per conviction/duration audits, resolved win% hides expirations; report both views.
