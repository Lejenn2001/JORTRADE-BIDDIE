export type ExecutionVerdictTier = "tradeable" | "watch" | "skip" | "not_evaluated";

export interface ExecutionVerdict {
  verdict: ExecutionVerdictTier;
  reason: string;
}

const EXECUTION_UNIVERSE = new Set(["SPY", "QQQ", "IWM", "SPX", "SPXW"]);

function extractPrice(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input) && input > 0) return input;
  const str = String(input);
  const m = str.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseExpiryYMD(input: unknown): string | null {
  if (input == null) return null;
  const str = String(input).trim();
  if (!str) return null;

  const iso = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  const t = Date.parse(str);
  if (!isNaN(t)) {
    const dt = new Date(t);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }

  const mon = str.match(/^([A-Za-z]{3,9})\s+(\d{1,2})/);
  if (mon) {
    const yr = new Date().getUTCFullYear();
    const dt2 = new Date(`${mon[1]} ${mon[2]}, ${yr}`);
    if (!isNaN(dt2.getTime())) {
      if (dt2.getTime() < Date.now() - 7 * 86400000) {
        dt2.setUTCFullYear(yr + 1);
      }
      return `${dt2.getUTCFullYear()}-${String(dt2.getUTCMonth() + 1).padStart(2, "0")}-${String(dt2.getUTCDate()).padStart(2, "0")}`;
    }
  }

  return null;
}

function computeDTE(expiryYMD: string): number {
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const todayET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
  const [y, m, d] = expiryYMD.split("-").map(Number);
  const exp = new Date(y, m - 1, d);
  return Math.round((exp.getTime() - todayET.getTime()) / 86400000);
}

export function evaluateSignal(signal: any): ExecutionVerdict {
  if (!signal || typeof signal !== "object") {
    return { verdict: "not_evaluated", reason: "Invalid signal payload" };
  }

  const ticker = String(signal.ticker || "").toUpperCase();
  const rawType = signal.putCall ?? signal.option_type ?? signal.optionType ?? null;
  const optionType = rawType === "call" || rawType === "put" ? rawType : null;
  const strike = extractPrice(signal.strike);
  const expiryYMD = parseExpiryYMD(signal.expiry);
  const entry =
    extractPrice(signal.priceAtSignal ?? signal.price_at_signal) ??
    extractPrice(signal.entryTrigger ?? signal.entry_trigger);
  const target = extractPrice(
    signal.targetZone ?? signal.target_zone ?? signal.targetNear ?? signal.target_near ?? signal.target,
  );
  const invalidation = extractPrice(signal.invalidation);

  const missing: string[] = [];
  if (!ticker) missing.push("ticker");
  if (!optionType) missing.push("option type");
  if (strike == null) missing.push("strike");
  if (!expiryYMD) missing.push("expiry");
  if (entry == null) missing.push("entry");
  if (target == null) missing.push("target");
  if (invalidation == null) missing.push("invalidation");
  if (missing.length) {
    return { verdict: "not_evaluated", reason: `Missing ${missing.join(", ")}` };
  }

  const dte = computeDTE(expiryYMD!);
  if (dte < 0) {
    return { verdict: "skip", reason: `Contract expired ${Math.abs(dte)}d ago` };
  }

  const isExecTicker = EXECUTION_UNIVERSE.has(ticker);

  if (dte === 0 && !isExecTicker) {
    return { verdict: "skip", reason: `0DTE only allowed on SPY/QQQ/IWM/SPX/SPXW (this is ${ticker})` };
  }

  const isCall = optionType === "call";
  const reward = isCall ? target! - entry! : entry! - target!;
  const risk = isCall ? entry! - invalidation! : invalidation! - entry!;

  if (reward <= 0 || risk <= 0) {
    return {
      verdict: "skip",
      reason: isCall
        ? `Invalid call setup — need target > entry > invalidation`
        : `Invalid put setup — need target < entry < invalidation`,
    };
  }

  const rr = reward / risk;
  if (rr < 1.0) {
    return { verdict: "skip", reason: `Poor risk/reward (${rr.toFixed(2)}:1, need ≥ 1:1)` };
  }

  const mfeRaw = signal.mfePercent;
  const mfe = typeof mfeRaw === "number" && Number.isFinite(mfeRaw) ? mfeRaw : null;
  if (mfe != null && mfe >= 75) {
    return { verdict: "skip", reason: `Late move — ${Math.round(mfe)}% of target already covered` };
  }
  if (mfe != null && mfe >= 50) {
    return { verdict: "watch", reason: `Move ${Math.round(mfe)}% complete — already past halfway` };
  }

  if (!isExecTicker) {
    return { verdict: "watch", reason: `${ticker} outside execution universe — intelligence only` };
  }

  return {
    verdict: "tradeable",
    reason: `R:R ${rr.toFixed(2)}:1 · ${dte}DTE · ${ticker} ${optionType.toUpperCase()} ${strike}`,
  };
}

export function attachExecutionVerdicts<T extends { signals?: any[] } | null | undefined>(data: T): T {
  if (!data || !Array.isArray((data as any).signals)) return data;
  const out: any = { ...(data as any) };
  out.signals = (data as any).signals.map((s: any) => {
    if (!s || typeof s !== "object") return s;
    if (s.executionVerdict) return s;
    try {
      return { ...s, executionVerdict: evaluateSignal(s) };
    } catch {
      return {
        ...s,
        executionVerdict: { verdict: "not_evaluated" as ExecutionVerdictTier, reason: "Evaluator threw — defaulting to Not Evaluated" },
      };
    }
  });
  return out;
}
