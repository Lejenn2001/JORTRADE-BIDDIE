---
name: Polygon WebSocket is one-connection-per-account (not per-key)
description: Why a dedicated dev Polygon key still 1008-collides with prod, and how dev WS is gated.
---

# Rule
Polygon's real-time WebSocket allows only ONE simultaneous connection per
ACCOUNT per cluster (stocks / options) — NOT per API key. A second key string
created under the SAME Polygon account does NOT get its own slot.

# Symptom
With a dedicated dev key, the dev WS authenticates fine (`auth_success`) and then
Polygon immediately drops it with **close code 1008** in a tight reconnect loop.
Auth success + 1008 = "max connections exceeded" = another live connection on the
same account (the deployed prod app). While this loops, dev and prod cross-kick
each other every ~1s, degrading the LIVE feed paying members see.

**Why:** auth_failed would mean a bad/under-entitled key; 1008 AFTER auth means
the key is valid but the account's single slot is already taken.

# How WS is gated
WS auto-opens for production AND for an UNSET `NODE_ENV` — the GCE deployment does
NOT export `NODE_ENV`, so treating unset as prod is required or the live feed dies.
REST-only is forced only for KNOWN non-prod values (`development`/`test`/`staging`).
A known-non-prod env opens its own WS ONLY when ALL of: known-non-prod NODE_ENV, a
dedicated dev key (`isUsingDevKey()`), AND explicit opt-in `POLYGON_DEV_WS=1` (a
human assertion the key is a SEPARATE Polygon account). Default non-prod = REST
polling, which never steals prod's slot. Flags live in `priceMonitor.ts` /
`optionPriceMonitor.ts` (`IS_KNOWN_NON_PROD` / `DEV_WS_ENABLED` / `REST_ONLY`).
`POLYGON_WS_FORCE=1` overrides everything; `POLYGON_REST_ONLY=1` forces REST.

**Why unset=prod:** flipping unset→REST-only (a tempting "stricter" hardening) would
silently kill the live feed if the deploy runtime ever drops NODE_ENV. The
collision risk only exists with a SECOND live env, which always carries a known
non-prod NODE_ENV here, so gating those is sufficient.

**How to apply:** never enable dev WS on a same-account key — it harms prod. Only
set `POLYGON_DEV_WS=1` once a truly separate Polygon account/plan funds the dev key.
The rest of the price-service consolidation (single service, live/rest/stale tags)
works fine with dev on REST; dev WS is only needed to exercise live dots in dev.
