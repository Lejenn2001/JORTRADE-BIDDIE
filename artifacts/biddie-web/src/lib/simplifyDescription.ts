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
}

function cleanLevel(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.match(/[0-9][0-9,]*\.?[0-9]*/);
  if (!m) return null;
  return `$${m[0].replace(/,/g, "")}`;
}

function cleanPremium(raw?: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.startsWith("$") ? t : `$${t}`;
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
  const betClause = isCall ? "a bet it climbs" : "a bet it drifts lower";
  const strike = signal.strike ? cleanLevel(String(signal.strike)) : null;
  const strikeRef = strike ? `the ${strike} ${contract}` : `the ${contract}`;
  const premium = cleanPremium(signal.premium);
  const sweep = /sweep/i.test(desc);
  const reinforce =
    signal.reinforcementCount && signal.reinforcementCount > 1
      ? signal.reinforcementCount
      : 0;

  // --- Paragraph 1: what's happening in the flow ---
  let lead: string;
  if (sweep) {
    lead = `A large sweep hit ${strikeRef} — ${betClause}`;
  } else if (reinforce) {
    lead = `Demand keeps coming back to ${strikeRef} — ${betClause}`;
  } else {
    lead = `Notable flow came through on ${strikeRef} — ${betClause}`;
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

  // --- Paragraph 2: the levels story (ties the card's rows together) ---
  const area = cleanLevel(signal.entryTrigger);
  const tn = cleanLevel(signal.targetNear);
  const tz = cleanLevel(signal.targetZone);
  const guard =
    cleanLevel(signal.invalidation) ||
    cleanLevel(signal.srLevel) ||
    cleanLevel(signal.keyLevel);

  let rangeText: string | null = null;
  if (tn && tz && tn !== tz) {
    const a = parseFloat(tn.slice(1));
    const b = parseFloat(tz.slice(1));
    if (!isNaN(a) && !isNaN(b)) {
      const lo = a <= b ? tn : tz;
      const hi = a <= b ? tz : tn;
      rangeText = isCall ? `${lo} to ${hi}` : `${hi} down to ${lo}`;
    } else {
      rangeText = tz;
    }
  } else if (tz) {
    rangeText = tz;
  }

  const sentences: string[] = [];
  if (area) sentences.push(`Right now the action is centered around ${area}.`);

  if (isCall) {
    if (rangeText && guard) {
      sentences.push(
        `If the bulls stay in control, the move could stretch toward ${rangeText}, while ${guard} is the floor holding it up — as long as it stays above there, the climb stays in focus.`
      );
    } else if (rangeText) {
      sentences.push(
        `If the bulls stay in control, the move could stretch toward ${rangeText}.`
      );
    } else if (guard) {
      sentences.push(
        `${guard} is the floor to watch — as long as it stays above there, the upside stays in focus.`
      );
    }
  } else {
    if (rangeText && guard) {
      sentences.push(
        `If the bears keep the upper hand, the slide could reach toward ${rangeText}, with ${guard} as the ceiling overhead — as long as it stays below there, the move lower stays in focus.`
      );
    } else if (rangeText) {
      sentences.push(
        `If the bears keep the upper hand, the slide could reach toward ${rangeText}.`
      );
    } else if (guard) {
      sentences.push(
        `${guard} is the ceiling to watch — as long as it stays below there, the move lower stays in focus.`
      );
    }
  }

  const p2 = sentences.join(" ");
  return p2 ? `${p1}\n\n${p2}` : p1;
}
