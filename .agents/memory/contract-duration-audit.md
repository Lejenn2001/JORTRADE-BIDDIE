---
name: Contract duration / time-to-hit audit
description: How fast JORTRADE winners hit and whether shorter-dated contracts pay off (data + BS model)
---

# Winners hit fast; short-dated contracts win on cost AND leverage

Audit of `signal_outcomes` winners (hit/partial_hit), ~848 winners, Mar–Jun 2026. Uses `time_at_target`/`resolved_at` − `detected_at` for speed; `expiry` (text "Month DD, YYYY", parse with `to_date(expiry,'Month DD, YYYY')`) for DTE; `mfe_percent` = the OPTION contract's peak % gain (NOT underlying; not capped — has 13000%+ outliers).

**Speed:** 74.7% of winners hit SAME DAY, median ~3 hours; 91% within 2 days; ~0% need 6+ days.

**Already short-dated:** 92% of winners were on contracts ≤7 DTE (26.6% at 0-2 DTE, 65.9% at 3-7 DTE). System already favors weeklies. These short contracts realized median +156% peak on full hits, +58% on partials.

**Cost/decay tradeoff (transparent BS model: $200 ATM call, IV 40%, +1% same-day move):**
| DTE | cost/contract | same-day return on +1% | overnight decay if no move |
|---|---|---|---|
| 0DTE | $119 | +96% | -100% |
| 1 | $168 | +65% | -100% |
| 3 | $293 | +37% | -19% |
| 7 | $449 | +24% | -8% |
| 30 | $946 | +11% | -2% |

Shorter = cheaper (30d ≈ 8× a 0DTE) AND bigger % payoff on the same move (gamma leverage). Catch: ultra-short gets crushed overnight if it doesn't move that day — bites the ~25% that aren't same-day.

**Takeaway / how to apply:** sweet spot is ~2-7 DTE weeklies (cheap + high leverage + cushion for next-day movers), which is roughly what the system already picks. True 0DTE = cheapest/highest payoff but punishing on misses. Reinforces that for this product, SPEED/timing matters more than the conviction number. Caveats: model assumes fixed IV (real IV varies/crush), ignores bid-ask spread; mfe_percent is PEAK not exit price.
