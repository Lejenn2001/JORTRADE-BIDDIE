---
name: Biddie admin check & auth quirks
description: How JORTRADE/biddie-web determines admin, the two user_roles stores, and the misleading signup email toast
---

# Admin determination (biddie-web + api-server)

- Frontend `useAuth()` sets `isAdmin` by calling server endpoint `GET /api/whale/admin/check?userId=<uuid>` → `{isAdmin}`. It does NOT read roles directly for the gate.
- Server `isAdminUser(userId)` in `whale.ts`:
  1. Checks the **Replit Postgres** `user_roles` table FIRST (`dbQuery`, columns: id serial, user_id text, role text, UNIQUE(user_id,role)).
  2. Falls back to **Supabase** `user_roles` via the *anon/publishable* `SUPABASE_KEY` — this is RLS-gated, so it may return nothing even when a row exists.
  3. If Supabase has the row, it caches it into the Replit Postgres table.

**There are TWO separate `user_roles` stores**: the Supabase project table (what the admin panel and RLS use) and a Replit Postgres table (what the admin gate checks first).

**How to reliably make someone admin:** add their auth UUID to `SEED_ADMIN_IDS` in `whale.ts` (seeds the Replit Postgres table on startup) — deterministic, RLS-independent. Optionally also insert into Supabase `user_roles` for the admin panel UI. The seed loop only does `ON CONFLICT DO NOTHING`; it never deletes, so stale UUIDs linger harmlessly.

# Auth quirk: misleading "check your email" toast
- The cuyj Supabase project has email confirmation effectively OFF (signups are auto-confirmed: `email_confirmed_at` is set immediately without clicking a link).
- Despite that, the signup screen still shows a "check your email" message. It is a stale/misleading frontend toast — users can log in immediately. Consider fixing the message if confirm stays off.

# Verifying without the proxy
- The api-server listens on `PORT` (read live from `/proc/<pid>/environ`). Hit it directly: `curl http://localhost:$PORT/api/whale/admin/check?userId=...`. The frontend's `/api/...` path is proxied through biddie-web's dev server.
