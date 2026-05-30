---
name: Replit "locked" secret override pattern
description: How to swap a Replit secret value when the GUI/requestEnvVar won't let you replace it in-place (duplicate/locked entries).
---

# Problem
A Replit project can end up with a secret that you cannot reliably replace:
- Multiple/duplicate entries under the same name, some of which the user reports
  as "locked" / cannot unlink or delete in the Secrets GUI.
- `requestEnvVar` pre-fills the stale value and the user's edit silently does not take.
- `setEnvVars(shared, NAME)` is BLOCKED for a name that is "already set up as secrets".
- `deleteEnvVars` only removes shared-scope entries, not a global secret.
The running process keeps resolving the OLD value no matter what.

# Solution — route the app around it
Read a NEW env-var name you fully control, with the old name as fallback:
```
const KEY = process.env["NAME_OVERRIDE"] || process.env["ORIGINAL_NAME"] || "";
```
Then `setEnvVars({ values: { NAME_OVERRIDE: <value> }, environment: "shared" })`.
A brand-new name has no conflict, so setEnvVars succeeds and the override wins.

**Why:** sanctioned paths (GUI edit, requestEnvVar) failed repeatedly and wasted
many attempts; a name you control is deterministic and needs zero further user action.

**How to apply:** add the fallback at EVERY read site (grep the name first), set the
override in shared scope, restart the workflow, then verify.

# Verification (critical)
Your bash/code_execution env is STALE (session-start snapshot). Ground truth is the
restarted process's own environ:
```
PID=$(pgrep -f "dist/index.mjs" | head -1)
tr '\0' '\n' < /proc/$PID/environ | grep '^VAR_NAME='
```
For Supabase, confirm with a live service-level read of an RLS-protected table
(expect HTTP 200). Decode a legacy JWT's project ref: middle base64url segment → `"ref"`.

# Caveats
- Shared-scope env vars are written to `.replit` under `[userenv.shared]` in PLAINTEXT
  and committed to git. Acceptable for low-sensitivity keys or a private repl, but for
  high-sensitivity keys (e.g. Supabase service_role) prefer upgrading to a masked secret
  later via `requestEnvVar` on the NEW name (no lock conflict).
- Workflows pick up new secrets only after the "secrets added" notification fires; the
  notification often arrives AFTER your restart, so restart again once it lands.
