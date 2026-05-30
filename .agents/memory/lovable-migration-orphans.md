---
name: Lovable migration orphans (JORTRADE / biddie-web)
description: Features that silently broke when JORTRADE moved off Lovable Cloud onto its own Supabase, because their server side lived in Lovable
---

# What didn't come over from Lovable

When functionality used to live in a Lovable **edge function** (server-side), migrating off Lovable leaves the frontend UI intact but the server side gone. Symptom: the settings/toggle still appear, but nothing actually happens.

- **Telegram notifications**: The frontend (`NotificationSettings.tsx`, `profiles.telegram_enabled` / `telegram_chat_id`) lets users opt in, but there is **no backend Telegram sender** in `api-server` and **no `TELEGRAM_BOT_TOKEN`** set. The actual send was a Lovable edge function. To restore: copy `TELEGRAM_BOT_TOKEN` out of Lovable (bot is @BiddieAIBot) before cancelling Lovable, set it as a secret, and re-implement the send in `api-server`.
- **Other former edge functions** were ported into `api-server` routes (e.g., the dashboard ticker-tape replaced the Supabase `stock-quotes` edge function — see comment near the stock-quotes route in `whale.ts`).

**How to apply:** before cancelling a Lovable project, audit every Lovable edge function / server secret the app relied on and confirm each has an equivalent in `api-server`. A working-looking UI does NOT mean the server side survived.
