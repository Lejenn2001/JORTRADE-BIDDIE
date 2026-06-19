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

**Polygon WS limit is per-ACCOUNT, not per-key (critical):** Polygon allows only ONE live WebSocket connection per account *per cluster* (stocks cluster, options cluster). Giving dev a DIFFERENT key from the same account does NOT get a second slot — empirically still got code `1008` ("connection limit exceeded") after swapping keys. Symptom: connect→auth→subscribe→`1008` disconnect loop every ~1-2s, on BOTH dev and the deployed prod app, each kicking the other off → neither streams. Multiple keys do not help; the limit is account-wide.

**Fix = dev never opens the WS (REST-only):** `priceMonitor.ts` and `optionPriceMonitor.ts` each have `const REST_ONLY = NODE_ENV !== "production" && POLYGON_WS_FORCE !== "1"`. In dev, `connect()` early-returns instead of opening the socket; the stocks monitor falls back to REST snapshot polling (10s in dev vs 30s as WS-fallback), the options monitor relies on callers' REST option-quote fallback. Production (NODE_ENV=production) is the SOLE owner of the single real-time connection. Escape hatch: set `POLYGON_WS_FORCE=1` to allow WS in dev (only safe when prod is down). This is why the dev ticker is `source:"rest"`/`connected:false` — expected, not a bug.

**Closed-market snapshot fallback:** snapshot JSON returns zeros (`lastTrade.p`, `day.c`, `updated` = 0) on weekends/holidays (e.g. Juneteenth Jun 19) — only `prevDay.c` has data. Must use `||` not `??` (zeros are present, not null, so `??` won't fall through): `t.lastTrade?.p || t.day?.c || t.prevDay?.c`. Otherwise the price goes blank when the market is closed instead of showing last close. There are TWO independent snapshot parsers that each needed this fix: `priceMonitor.fetchSnapshotForTickers` (powers `/whale/prices/realtime`) AND `whale.ts fetchPremarketSnapshot` (powers `/whale/stock-quotes`, the dashboard **ticker tape** + premarket). The ticker tape (`TickerTape.tsx`) reads `/whale/stock-quotes` with a HARDCODED symbol list (SPY,QQQ,NVDA,AAPL,TSLA,AMD,AMZN,META,MSFT,GOOGL) — these are NOT the WS-subscribed tickers, so the ticker always sourced from REST snapshots, never the WS cache.

**Two dev override keys exist:** `POLYGON_API_KEY_OVERRIDE` (used by prod via deployed code + as dev fallback) and `POLYGON_API_KEY_DEV_OVERRIDE` (dev-preferred). Both are valid keys from the same Polygon account, so they share the account WS limit — the REST-only split (not the key split) is what actually resolves the 1008 conflict.

Note: `SUPABASE_SERVICE_KEY_OVERRIDE` is in shared scope (available in prod); Supabase side is fine.
