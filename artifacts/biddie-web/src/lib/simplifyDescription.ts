interface SignalInfo {
  ticker?: string;
  type?: "bullish" | "bearish" | "neutral";
  putCall?: "call" | "put";
  strike?: string;
  expiry?: string;
  premium?: string;
  description?: string;
  tags?: string[];
}

export function simplifySignalDescription(signal: SignalInfo): string {
  const parts: string[] = [];

  const ticker = signal.ticker || "this stock";
  const direction = signal.type === "bullish"
    ? "go UP"
    : signal.type === "bearish"
      ? "go DOWN"
      : "make a move";

  const desc = signal.description || "";

  const sweepMatch = desc.match(/(\d+)\s*sweep/i);
  const premiumMatch = desc.match(/\$?([\d,.]+[KMB]?)\s*(?:premium|total)/i);
  const aggressionMatch = desc.match(/(\d+)%\s*(?:ask\s*)?aggression/i);

  if (sweepMatch) {
    parts.push(`A big trader placed ${sweepMatch[1]} rush order${parseInt(sweepMatch[1]) > 1 ? 's' : ''} (hitting every exchange at once to get in fast)`);
  } else if (premiumMatch) {
    parts.push(`A big trader put $${premiumMatch[1]} on the line`);
  } else {
    parts.push(`Someone made a notable trade on ${ticker}`);
  }

  if (signal.putCall === "put") {
    if (signal.strike) {
      const cleanStrike = signal.strike.replace(/[^$\d.,]/g, '').replace('$', '');
      parts.push(`on a $${cleanStrike} put — they profit if ${ticker} keeps falling`);
    } else {
      parts.push(`betting ${ticker} goes lower`);
    }
  } else if (signal.putCall === "call") {
    if (signal.strike) {
      const cleanStrike = signal.strike.replace(/[^$\d.,]/g, '').replace('$', '');
      parts.push(`on a $${cleanStrike} call — they profit if ${ticker} keeps rising`);
    } else {
      parts.push(`betting ${ticker} goes higher`);
    }
  } else {
    parts.push(`expecting ${ticker} to ${direction}`);
  }

  if (aggressionMatch) {
    const pct = parseInt(aggressionMatch[1]);
    if (pct >= 90) {
      parts.push("They paid full asking price — very urgent, no negotiating");
    } else if (pct >= 70) {
      parts.push("They paid a high price to get in quick — shows urgency");
    }
  }

  if (signal.expiry) {
    const exp = signal.expiry;
    if (exp === "0DTE" || exp.includes("0 DTE") || exp.includes("today")) {
      parts.push("This bet expires TODAY — same-day play, high risk");
    } else {
      parts.push(`This bet expires ${exp}`);
    }
  }

  if (premiumMatch && !sweepMatch) {
    // already mentioned
  } else if (premiumMatch && sweepMatch) {
    parts.push(`Total money on the line: $${premiumMatch[1]}`);
  }

  return parts.join(". ") + ".";
}
