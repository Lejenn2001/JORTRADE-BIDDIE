#!/usr/bin/env node
// Dev-only helper for testing the Paper Automation Engine (Phase 1, pending_entry).
// NEVER deployed. Hits the live dev API exactly the way the future UI will.
//
// Quick start:
//   1. Open the dev preview in your browser, log in.
//   2. DevTools (F12) → Network tab → click any /api/whale/... request →
//      copy the value AFTER "Bearer " from the Authorization request header.
//   3. In the shell:
//        export BIDDIE_BEARER='eyJhbGciOi...'
//        node artifacts/api-server/scripts/paper-test.mjs trigger
//
// Commands:
//   trigger              Queue a SPY 720c that fills on the very next monitor cycle.
//   no-fire              Queue a SPY 600p with an unreachable trigger (stays pending).
//   expire               Queue a pending row that expires in 60s; monitor cancels it.
//   queue [opts]         Custom queue. Flags: --ticker --side --strike --expiry
//                        --trigger --direction --expires-in --contracts
//   cancel <id>          User-cancel a pending_entry row.
//   list [--status x]    List your trades. status = open|closed|pending (default: pending).
//   watch <id>           Poll one trade every 5s, print state on each change. Ctrl-C to stop.
//   cleanup              Cancel + hide every TEST-PT-* signal_id you queued via this script.

import process from "node:process";

const DEV_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const BEARER = process.env.BIDDIE_BEARER;

if (!DEV_DOMAIN) {
  console.error("REPLIT_DEV_DOMAIN env var missing. Run from inside the Replit shell.");
  process.exit(1);
}
if (!BEARER) {
  console.error("BIDDIE_BEARER env var missing.\n");
  console.error("How to get one:");
  console.error("  1. Open the dev preview, log in to Biddie.");
  console.error("  2. DevTools (F12) → Network → click any /api/whale/... request.");
  console.error("  3. Copy the value AFTER 'Bearer ' in the Authorization request header.");
  console.error("  4. export BIDDIE_BEARER='paste-the-token-here'");
  console.error("  5. Re-run this command.");
  process.exit(1);
}

const BASE = `https://${DEV_DOMAIN}/api`;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${BEARER}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${path}:`, json);
    process.exit(1);
  }
  return json;
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith("--")) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function fmtTrade(t) {
  const tag = t.signal_id?.startsWith("TEST-PT-") ? "[TEST] " : "";
  const trig = t.entry_trigger_price != null
    ? ` trigger=${t.entry_trigger_direction}@${t.entry_trigger_price}`
    : "";
  const fill = t.entry_price != null ? ` fill=${t.entry_price}` : "";
  const reason = t.pending_cancel_reason ? ` reason=${t.pending_cancel_reason}` : "";
  const lq = t.last_quote_price != null
    ? ` lastQuote=${t.last_quote_price}/${t.last_quote_source} u=${t.last_quote_underlying_price}`
    : "";
  return `${tag}${t.id} ${t.status.padEnd(13)} ${t.ticker} ${t.option_type} $${t.strike} ${String(t.expiry).slice(0, 10)}${trig}${fill}${reason}${lq}`;
}

function defaultExpiry() {
  // Default to first Friday on or after today + 1 (best-effort; pass --expiry to override).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function queue(opts) {
  const ticker = opts.ticker || "SPY";
  const side = opts.side || "call";
  const strike = Number(opts.strike);
  if (!Number.isFinite(strike) || strike <= 0) throw new Error("--strike required and > 0");
  const expiry = opts.expiry || defaultExpiry();
  const trigger = Number(opts.trigger);
  if (!Number.isFinite(trigger) || trigger <= 0) throw new Error("--trigger required and > 0");
  const direction = opts.direction || "at_or_above";
  if (direction !== "at_or_above" && direction !== "at_or_below") {
    throw new Error("--direction must be at_or_above or at_or_below");
  }
  const contracts = Math.max(1, Math.min(10, Math.floor(Number(opts.contracts) || 1)));

  let pendingExpiresAt;
  if (opts["expires-in"]) {
    const m = String(opts["expires-in"]).match(/^(\d+)\s*(s|m|h|d)?$/i);
    if (!m) throw new Error("--expires-in format: e.g. 60s, 30m, 2h, 1d");
    const n = Number(m[1]);
    const unit = (m[2] || "s").toLowerCase();
    const ms = n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
    pendingExpiresAt = new Date(Date.now() + ms).toISOString();
  }

  const body = {
    signalId: `TEST-PT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ticker, optionType: side, strike, expiry, contracts,
    mode: "pending_entry",
    entryTriggerPrice: trigger,
    entryTriggerDirection: direction,
    ...(pendingExpiresAt ? { pendingExpiresAt } : {}),
  };
  console.log(`POST /whale/paper/trades  body:`, body);
  const res = await api("POST", "/whale/paper/trades", body);
  console.log(`✓ queued: ${fmtTrade(res.trade)}`);
  return res.trade;
}

async function list(opts) {
  const status = opts.status || "pending";
  const res = await api("GET", `/whale/paper/trades?status=${encodeURIComponent(status)}`);
  console.log(`status=${status}  count=${res.trades.length}`);
  for (const t of res.trades) console.log("  " + fmtTrade(t));
}

async function cancel(id) {
  if (!id) throw new Error("usage: cancel <trade_id>");
  const res = await api("POST", `/whale/paper/trades/${id}/cancel`, {});
  console.log(`✓ cancelled: ${fmtTrade(res.trade)}`);
}

async function watch(id) {
  if (!id) throw new Error("usage: watch <trade_id>");
  let lastSig = "";
  console.log(`Watching ${id} every 5s. Ctrl-C to stop.`);
  while (true) {
    // No single-trade GET; reuse list and find. Cheap enough for dev.
    const all = await api("GET", "/whale/paper/trades?status=pending");
    const open = await api("GET", "/whale/paper/trades?status=open");
    const closed = await api("GET", "/whale/paper/trades?status=closed");
    const t = [...all.trades, ...open.trades, ...closed.trades].find(x => x.id === id);
    if (!t) { console.log("(not found — was it deleted?)"); return; }
    const sig = `${t.status}|${t.entry_price}|${t.last_quote_price}|${t.pending_cancel_reason}|${t.closed_at}`;
    if (sig !== lastSig) {
      console.log(`${new Date().toISOString()}  ${fmtTrade(t)}`);
      lastSig = sig;
      if (t.status === "open" || t.status === "closed" || t.status === "cancelled") {
        console.log(`(terminal state: ${t.status}) — done.`);
        return;
      }
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function cleanup() {
  const pending = await api("GET", "/whale/paper/trades?status=pending");
  const tests = pending.trades.filter(t => String(t.signal_id || "").startsWith("TEST-PT-"));
  console.log(`Found ${tests.length} pending TEST-PT-* rows.`);
  for (const t of tests) {
    try {
      await api("POST", `/whale/paper/trades/${t.id}/cancel`, {});
      console.log(`  cancelled ${t.id}`);
    } catch (e) {
      console.log(`  skip ${t.id}: ${e.message}`);
    }
  }
}

// ── Convenience flows ────────────────────────────────────────────────────────

async function flowTrigger() {
  console.log("\n=== FLOW: pending → open (will fire on next monitor cycle) ===\n");
  const t = await queue({ ticker: "SPY", side: "call", strike: 720, trigger: 0.01, direction: "at_or_above" });
  console.log("\nQueued. Now waiting for monitor sweep (runs every ~60s)...");
  await watch(t.id);
}

async function flowNoFire() {
  console.log("\n=== FLOW: pending stays pending (unreachable trigger) ===\n");
  const t = await queue({ ticker: "SPY", side: "put", strike: 600, trigger: 99999, direction: "at_or_above" });
  console.log("\nQueued. Will stay pending. Use:");
  console.log(`  node artifacts/api-server/scripts/paper-test.mjs cancel ${t.id}`);
  console.log(`  node artifacts/api-server/scripts/paper-test.mjs watch ${t.id}`);
}

async function flowExpire() {
  console.log("\n=== FLOW: pending → cancelled (expired_unfilled, ~60s) ===\n");
  const t = await queue({
    ticker: "SPY", side: "call", strike: 999, trigger: 99999, direction: "at_or_above",
    "expires-in": "60s",
  });
  console.log("\nQueued with 60s expiry. Monitor will cancel it on the next sweep.");
  await watch(t.id);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;
const flags = parseFlags(rest);

(async () => {
  try {
    switch (cmd) {
      case "trigger":  return await flowTrigger();
      case "no-fire":  return await flowNoFire();
      case "expire":   return await flowExpire();
      case "queue":    { await queue(flags); return; }
      case "cancel":   return await cancel(rest[0]);
      case "list":     return await list(flags);
      case "watch":    return await watch(rest[0]);
      case "cleanup":  return await cleanup();
      default:
        console.log("Usage: node artifacts/api-server/scripts/paper-test.mjs <command>");
        console.log("  trigger | no-fire | expire | queue | cancel <id> | list [--status x] | watch <id> | cleanup");
        process.exit(1);
    }
  } catch (e) {
    console.error("ERROR:", e.message || e);
    process.exit(1);
  }
})();
