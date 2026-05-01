// ─── EOD Auto-Close Configuration ────────────────────────────────────────────
// Single source of truth for the four EOD env-var flags. Read once at startup,
// validated, and frozen — runtime changes require a server restart by design
// (intentional: prevents accidental mid-session toggles).
//
// Env vars (all optional, all have safe defaults):
//   PAPER_EOD_CLOSE_ENABLED   bool  default true   — master switch for paper EOD sweep
//   LIVE_EOD_CLOSE_ENABLED    bool  default false  — future broker integration; stays false
//                                                    until live trading is explicitly wired
//   EOD_CLOSE_TIME            HH:MM default 15:50  — soft phase start (ET)
//   EOD_FORCE_CLOSE_TIME      HH:MM default 15:59  — force phase start (ET); must be
//                                                    > EOD_CLOSE_TIME and < 16:00, else
//                                                    falls back to default with a warning

export interface EodConfig {
  paperEnabled: boolean;
  liveEnabled: boolean;
  closeTime: { hour: number; minute: number };
  forceCloseTime: { hour: number; minute: number };
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  return fallback;
}

function parseHHMM(v: string | undefined, fallback: { hour: number; minute: number }): { hour: number; minute: number } {
  if (v == null) return fallback;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return fallback;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return fallback;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return fallback;
  return { hour, minute };
}

const DEFAULT_CLOSE = { hour: 15, minute: 50 };
const DEFAULT_FORCE = { hour: 15, minute: 59 };

function pad(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

function load(): EodConfig {
  const closeTime = parseHHMM(process.env.EOD_CLOSE_TIME, DEFAULT_CLOSE);
  let forceCloseTime = parseHHMM(process.env.EOD_FORCE_CLOSE_TIME, DEFAULT_FORCE);
  // Force close time must be strictly after close time and strictly before
  // 16:00 ET (the cash-session bell). If misconfigured, fall back to defaults
  // rather than silently breaking the sweep.
  const closeMin = closeTime.hour * 60 + closeTime.minute;
  const forceMin = forceCloseTime.hour * 60 + forceCloseTime.minute;
  if (forceMin <= closeMin || forceMin >= 16 * 60) {
    console.warn(`[eod-config] EOD_FORCE_CLOSE_TIME (${pad(forceCloseTime)}) must be > EOD_CLOSE_TIME (${pad(closeTime)}) and < 16:00 — falling back to ${pad(DEFAULT_FORCE)}`);
    forceCloseTime = DEFAULT_FORCE;
  }
  return {
    paperEnabled: parseBool(process.env.PAPER_EOD_CLOSE_ENABLED, true),
    liveEnabled: parseBool(process.env.LIVE_EOD_CLOSE_ENABLED, false),
    closeTime,
    forceCloseTime,
  };
}

let cached: EodConfig | null = null;

export function getEodConfig(): EodConfig {
  if (cached == null) {
    cached = load();
    console.log(`[eod-config] paper=${cached.paperEnabled} live=${cached.liveEnabled} close=${pad(cached.closeTime)}ET force=${pad(cached.forceCloseTime)}ET`);
  }
  return cached;
}

// Test-only: reset cache so unit tests can re-read modified env.
export function __resetEodConfigForTests(): void { cached = null; }
