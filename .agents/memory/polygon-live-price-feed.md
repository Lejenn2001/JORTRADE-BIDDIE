---
name: JORTRADE Polygon live-price feed key
description: How the Polygon key is resolved, the override that fixed the 401 outage, and which feed each subscription powers.
---

# JORTRADE live price feed (Polygon)

The live price feed resolves its API key via `getPolygonKey()` in `artifacts/api-server/src/lib/polygonKey.ts`, which is the SINGLE read site (all consumers route through it — grep confirms no other `process.env["POLYGON*"]` reads). Resolution order: `POLYGON_API_KEY_OVERRIDE` (wins everywhere) → then prod uses `POLYGON_API_KEY`, dev uses `POLYGON_API_KEY_DEV ?? POLYGON_API_KEY`.

**The 401 outage + fix:** Both stored secrets (`POLYGON_API_KEY` and `POLYGON_API_KEY_DEV`) were stale/expired → REST `401`, WS `authentication failed` + `1006` reconnect loops. This killed the ticker tape, market pulse, price dots, win/loss grading, AND option contract enrichment all at once. Fixed by routing through a fresh override secret `POLYGON_API_KEY_OVERRIDE` (the locked-secret override pattern — see secret-override-pattern.md) and having the user paste a current valid key from their Polygon account. After restart, verified `[price-monitor] Authenticated`, live prices flowing, and `Polygon options enrichment: 6/7 contracts found`.

**Why the override (not in-place edit):** this repl has duplicate/locked Polygon secret entries; a brand-new name the agent controls is deterministic. To swap the key again, just update `POLYGON_API_KEY_OVERRIDE`.

**Index options gap:** SPX/SPXW/NDX option enrichment returns `IV=null/delta=null` because index options need a SEPARATE Polygon **Indices** entitlement; a standard Stocks+Options account does not cover them. Stocks and regular equity options work fine. Flag this if the user needs SPX contract pricing — it's an add-on, not a bug.

**Which subscription powers what** (user pays for both Stocks + Options, ~$500/mo, confirmed both are NEEDED): Stocks feed = signal generation (key levels/candles/VWAP), real-time price dots, breakout scanner, AND win/loss grading (grader compares the UNDERLYING STOCK price vs target/invalidation, not the option). Options feed = paper trading P/L + EOD close, Biddie `/paper/alternatives` contract pricing (user calls this a BIG need), and live premium/Greeks on signal cards. Contract details (strike/expiry/type) come from Unusual Whales flow, so cards survive an options-feed outage (graceful fallback); only live premium/Greeks drop.

Note: `SUPABASE_SERVICE_KEY_OVERRIDE` is in shared scope (available in prod); Supabase side is fine.
