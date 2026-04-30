export type ExecutionVerdictTier = "tradeable" | "watch" | "skip" | "not_evaluated";

export interface ExecutionVerdict {
  verdict: ExecutionVerdictTier;
  reason: string;
}

export function evaluateSignal(_signal: unknown): ExecutionVerdict {
  return {
    verdict: "not_evaluated",
    reason: "Execution engine not rebuilt yet",
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
      return { ...s, executionVerdict: { verdict: "not_evaluated" as ExecutionVerdictTier, reason: "Execution engine not rebuilt yet" } };
    }
  });
  return out;
}
