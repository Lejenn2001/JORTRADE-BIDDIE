interface SignalInfo {
  ticker?: string;
  type?: "bullish" | "bearish" | "neutral";
  putCall?: "call" | "put";
  strike?: string;
  expiry?: string;
  premium?: string;
  description?: string;
  tags?: string[];
  entryTrigger?: string;
  invalidation?: string;
  keyLevel?: string;
  srLevel?: string;
  targetZone?: string;
  targetNear?: string;
  gammaLevelLabel?: string;
  reinforcementCount?: number;
  priceAtSignal?: number;
}

function levelNum(raw?: string | number | null): number | null {
  if (raw == null) return null;
  const s = String(raw);
  // Prefer the number right after a "$" so labels like "R1 at $1092.08" don't
  // get misread as 1 (from "R1"). Fall back to the first number otherwise.
  const m = s.match(/\$\s*([0-9][0-9,]*\.?[0-9]*)/) || s.match(/([0-9][0-9,]*\.?[0-9]*)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function fmtLevel(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function cleanPremium(raw?: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  // Already abbreviated (e.g. "$500K", "1.2M") — keep as-is.
  if (/[KMB]\s*$/i.test(t.replace(/premium/gi, "").trim())) {
    return t.startsWith("$") ? t : `$${t}`;
  }
  const n = Number(t.replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || n <= 0) return t.startsWith("$") ? t : `$${t}`;
  const abbr =
    n >= 1e9 ? `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B` :
    n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M` :
    n >= 1e3 ? `${Math.round(n / 1e3)}K` :
    `${n}`;
  return `$${abbr}`;
}

export function isSweep(signal: SignalInfo): boolean {
  const desc = signal.description || "";
  return /sweep/i.test(desc);
}

export function compactDescription(signal: SignalInfo): string {
  const desc = signal.description || "";
  const parts: string[] = [];

  const sweep = isSweep(signal);
  const sweepMatch = desc.match(/(\d+)\s*sweep/i);

  const premiumMatch = desc.match(/\$?([\d,.]+[KMB]?)\s*(?:premium|total)/i);
  if (premiumMatch) {
    const strike = signal.strike ? String(signal.strike).replace(/[^$\d.,]/g, '').replace('$', '') : "";
    const pc = signal.putCall === "put" ? "P" : signal.putCall === "call" ? "C" : "";
    const label = sweep
      ? `${sweepMatch ? sweepMatch[1] + "x " : ""}sweep`
      : "flow";
    parts.push(`$${premiumMatch[1]} ${label}${strike ? ` → $${strike}${pc}` : ""}`);
  } else {
    parts.push(sweep ? "Sweep order" : "Options flow");
  }

  const aggressionMatch = desc.match(/(\d+)%\s*(?:ask\s*)?aggression/i);
  if (aggressionMatch) {
    parts.push(`${aggressionMatch[1]}% ask aggression`);
  }

  const priceAtMatch = desc.match(/Price at \$([\d,.]+)/i);
  const vwapMatch = desc.match(/(above|below)\s*VWAP\s*\(?\$?([\d,.]+)\)?/i);
  if (priceAtMatch && vwapMatch) {
    parts.push(`Price @ $${priceAtMatch[1]}, ${vwapMatch[1]} VWAP ($${vwapMatch[2]})`);
  } else if (priceAtMatch) {
    parts.push(`Price @ $${priceAtMatch[1]}`);
  } else if (vwapMatch) {
    parts.push(`${vwapMatch[1]} VWAP ($${vwapMatch[2]})`);
  }

  if (parts.length === 0) return desc;
  return parts.join(". ") + ".";
}

export function simplifySignalDescription(signal: SignalInfo): string {
  const desc = signal.description || "";
  const isCall =
    signal.putCall === "call" ||
    (signal.putCall !== "put" && signal.type === "bullish");
  const contract = isCall ? "calls" : "puts";
  const strikeN = levelNum(signal.strike);
  const strikeRef = strikeN ? `the ${fmtLevel(strikeN)} ${contract}` : `the ${contract}`;
  const premium = cleanPremium(signal.premium);
  const sweep = /sweep/i.test(desc);
  const reinforce =
    signal.reinforcementCount && signal.reinforcementCount > 1
      ? signal.reinforcementCount
      : 0;

  // --- Paragraph 1: what's happening in the flow ---
  let lead: string;
  if (sweep) {
    lead = `A large sweep hit ${strikeRef}`;
  } else if (reinforce) {
    lead = `Demand keeps coming back to ${strikeRef}`;
  } else {
    lead = `Notable flow came through on ${strikeRef}`;
  }
  if (premium) lead += `, with about ${premium} flowing in`;
  lead += ".";

  let color: string;
  if (reinforce) {
    color = `That demand has come back ${reinforce} times now, the kind of repeated interest that tends to stand out.`;
  } else if (sweep) {
    color = `That's a fast, urgent push rather than nibbling at the edges.`;
  } else {
    color = `It's a single larger order worth keeping an eye on.`;
  }
  const p1 = `${lead} ${color}`;

  // --- Paragraph 2: the levels story ---
  // Field NAMES in the data are unreliable (e.g. "target" can just be the strike,
  // "target_near" can be the resistance above). So we ignore the names: pull every
  // number, then pick the nearest level BELOW the center as the floor and the
  // nearest ABOVE as the ceiling. This guarantees floor < center < ceiling and
  // can never produce "moves toward the level it's already at."
  const center =
    levelNum(signal.entryTrigger) ?? strikeN ?? signal.priceAtSignal ?? null;

  const candidates = [
    signal.targetZone,
    signal.targetNear,
    signal.keyLevel,
    signal.srLevel,
    signal.invalidation,
    signal.gammaLevelLabel,
  ]
    .map(levelNum)
    .filter((n): n is number => n != null);

  let floorN: number | null = null;
  let ceilN: number | null = null;
  if (center != null) {
    for (const n of candidates) {
      if (n < center && (floorN == null || n > floorN)) floorN = n;
      if (n > center && (ceilN == null || n < ceilN)) ceilN = n;
    }
  }

  const sentences: string[] = [];
  if (center != null) sentences.push(`Right now it's centered around ${fmtLevel(center)}.`);

  if (isCall) {
    if (floorN != null && ceilN != null) {
      sentences.push(
        `${fmtLevel(floorN)} is the floor underneath, and there's room toward ${fmtLevel(ceilN)} overhead — as long as it holds above ${fmtLevel(floorN)}, the upside stays in focus.`
      );
    } else if (ceilN != null) {
      sentences.push(`If demand stays in control, there's room toward ${fmtLevel(ceilN)} overhead.`);
    } else if (floorN != null) {
      sentences.push(
        `${fmtLevel(floorN)} is the floor underneath — as long as it holds above there, the upside stays in focus.`
      );
    }
  } else {
    if (floorN != null && ceilN != null) {
      sentences.push(
        `${fmtLevel(ceilN)} is the ceiling overhead, with room toward ${fmtLevel(floorN)} below — as long as it stays under ${fmtLevel(ceilN)}, the move lower stays in focus.`
      );
    } else if (floorN != null) {
      sentences.push(`If the pressure stays on, there's room toward ${fmtLevel(floorN)} below.`);
    } else if (ceilN != null) {
      sentences.push(
        `${fmtLevel(ceilN)} is the ceiling overhead — as long as it stays under there, the move lower stays in focus.`
      );
    }
  }

  const p2 = sentences.join(" ");
  return p2 ? `${p1}\n\n${p2}` : p1;
}
