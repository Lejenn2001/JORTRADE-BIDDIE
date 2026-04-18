# JORTRADE — Admin Recovery Instructions

**Keep this private. Treat it like a password.**

---

## Recovery URL

```
https://jortrade.com/admin-recovery
```

This page is reachable from any browser, even when you're locked out of the
dashboard. Bookmark it on your phone and laptop.

---

## What you need

| Item | Where to keep it |
|---|---|
| Your admin email | You already know it (`lejenn2001@yahoo.com`) |
| Recovery secret  | Replit Secrets (env var `ADMIN_RECOVERY_SECRET`) and saved in Discord history + 1Password / paper note |

The recovery secret is a long random string (at least 32 characters). It is
delivered to your Discord channel **once during setup** so you can save it
permanently. After setup, it is never displayed anywhere.

---

## Where things go

| Channel | What you'll receive |
|---|---|
| Discord (via `DISCORD_WEBHOOK_URL`) | Recovery link on success, FAILURE alerts, setup secret (one time only) |
| SMS | Not configured. Add Twilio later if you want phone alerts. |

---

## Step-by-step recovery process

1. Open **https://jortrade.com/admin-recovery** in any browser.
2. Enter your **admin email** in the first field.
3. Enter your **recovery secret** in the second field.
4. Click **Send recovery link**.
5. Open your **Discord channel** — you'll see a new message with a recovery link.
6. Click the recovery link in Discord. It takes you to `/reset-password`.
7. Enter a new password, confirm it, and click **Update password**.
8. You'll be signed out and bounced to the login page.
9. Sign in with your email and the new password. Done.

The link is **single-use** and **expires in roughly 1 hour**.

---

## Security properties

- **Two factors**: the secret (something you know) plus access to your private
  Discord channel (something you have). An attacker needs both.
- **Rate-limited**: 5 attempts per hour per IP. Beyond that, the endpoint
  returns 429.
- **Constant-time secret comparison** — no timing-attack leakage.
- **All attempts logged to Discord**, success or failure. Probing is visible.
- **Generic error messages** — failures don't reveal whether the email or the
  secret was wrong.
- **Admin-only**: even if the secret is correct, the email must belong to an
  admin account or the request is rejected.
- **No passwords ever exposed** — only standard Supabase recovery links.

---

## If you receive a Discord FAILURE notification you didn't trigger

Someone is probing the endpoint. Do this immediately:

1. Open **Replit → Secrets**.
2. Rotate `ADMIN_RECOVERY_SECRET` to a new long random string.
3. Save the new secret in Discord (post it to yourself) and 1Password.
4. Optionally, check Replit logs for the source IP.

Recovery still works after rotation — the page just uses the new value.

---

## Where to find / change the recovery secret

- **Live value**: Replit → Secrets tab → `ADMIN_RECOVERY_SECRET`
- **Backup copy**: your Discord channel (search for "Admin recovery secret")
- **To rotate**: edit the value in Replit Secrets. The change takes effect on
  the next API server restart.

---

## Files / endpoints involved (for reference)

- Page:     `artifacts/biddie-web/src/pages/AdminRecovery.tsx`
- Route:    `artifacts/biddie-web/src/App.tsx` → `/admin-recovery`
- Endpoint: `POST /api/whale/admin-self-recovery` in
            `artifacts/api-server/src/routes/whale.ts`

---

*Last updated: 2026-04-17*
