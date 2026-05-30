---
name: JORTRADE Polygon live-price feed gap
description: Why live prices are non-functional post-Lovable-migration and what must be provisioned before the LivePriceService work can pass P0.
---

# JORTRADE live price feed (Polygon) is non-functional

The live price feed resolves its API key as `getPolygonKey()` = `POLYGON_API_KEY_DEV ?? POLYGON_API_KEY` (see `artifacts/api-server/src/lib/polygonKey.ts`).

As observed during the post-Lovable migration:
- **Dev**: only `POLYGON_API_KEY_DEV` is set (development scope) and it is being **rejected** — REST returns `Snapshot HTTP 401`, WS returns `Polygon auth failed: authentication failed`, then disconnect `1006` and reconnect every 30s. So the dev key is invalid/expired or on the wrong Polygon tier (real-time WS + snapshot require a paid plan).
- **Production**: there is **no Polygon key at all** — production env scope is empty and there is no `POLYGON_API_KEY` secret anywhere. So in prod `getPolygonKey()` returns `""` and live prices cannot work.

**Why it matters:** live prices/charts are core to the trading app. Publishing does NOT fix this — the live site needs a valid Polygon key provisioned for the production scope, and dev needs a valid key too.

**How to apply:** The `LivePriceService` session plan's P0 is blocked on a *valid* Polygon key. Before doing that work, confirm with the user that a real (paid-tier) Polygon key exists, set it per-scope (dev + production), and verify `priceMonitor.isConnected()` is true with no `1008`/`401` before building on top. Do not assume the dev key works — it currently does not.

Note: `SUPABASE_SERVICE_KEY_OVERRIDE` IS in shared scope (available in prod); the Supabase side is fine. The gap is Polygon-only.
