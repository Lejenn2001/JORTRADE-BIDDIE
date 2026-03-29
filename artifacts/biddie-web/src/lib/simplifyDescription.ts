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

function parsePremiumValue(raw: string): number {
  const cleaned = raw.replace(/[,$]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  if (/B$/i.test(raw)) return num * 1_000_000_000;
  if (/M$/i.test(raw)) return num * 1_000_000;
  if (/K$/i.test(raw)) return num * 1_000;
  return num;
}

function premiumColor(val: number): string {
  if (val >= 5_000_000) return "This is a massive bet. This trader means business and is extremely confident";
  if (val >= 2_000_000) return "That's a huge amount of money. This is a very serious, high-conviction play";
  if (val >= 1_000_000) return "Over a million dollars. That's a big bet and worth paying close attention to";
  if (val >= 500_000) return "That's a really significant amount. Someone with deep pockets is making a move";
  if (val >= 100_000) return "That's a solid bet. Enough money to show real conviction";
  return "A noteworthy trade worth keeping an eye on";
}

export function compactDescription(signal: SignalInfo): string {
  const desc = signal.description || "";
  const parts: string[] = [];

  const premiumMatch = desc.match(/\$?([\d,.]+[KMB]?)\s*(?:premium|total)/i);
  if (premiumMatch) {
    const strike = signal.strike ? String(signal.strike).replace(/[^$\d.,]/g, '').replace('$', '') : "";
    const pc = signal.putCall === "put" ? "P" : signal.putCall === "call" ? "C" : "";
    parts.push(`$${premiumMatch[1]} premium${strike ? ` @ $${strike}${pc}` : ""}`);
  }

  const sweepMatch = desc.match(/(\d+)\s*sweep/i);
  if (sweepMatch) {
    parts.push(`${sweepMatch[1]} sweep${parseInt(sweepMatch[1]) > 1 ? "s" : ""}`);
  }

  const aggressionMatch = desc.match(/(\d+)%\s*(?:ask\s*)?aggression/i);
  if (aggressionMatch) {
    parts.push(`${aggressionMatch[1]}% ask aggression`);
  }

  const vwapMatch = desc.match(/(above|below)\s*VWAP\s*\(?\$?([\d,.]+)\)?/i);
  if (vwapMatch) {
    parts.push(`${vwapMatch[1]} VWAP ($${vwapMatch[2]})`);
  }

  if (parts.length === 0) return desc;
  return parts.join(". ") + ".";
}

export function simplifySignalDescription(signal: SignalInfo): string {
  const chunks: string[] = [];

  const ticker = signal.ticker || "this stock";

  const desc = signal.description || "";

  const sweepMatch = desc.match(/(\d+)\s*sweep/i);
  const premiumMatch = desc.match(/\$?([\d,.]+[KMB]?)\s*(?:premium|total)/i);
  const aggressionMatch = desc.match(/(\d+)%\s*(?:ask\s*)?aggression/i);

  if (sweepMatch) {
    const count = parseInt(sweepMatch[1]);
    chunks.push(`A big trader placed ${count} rush order${count > 1 ? 's' : ''} (hitting every exchange at once to get in fast)`);
  } else if (premiumMatch) {
    chunks.push(`A big trader put $${premiumMatch[1]} on the line`);
  } else {
    chunks.push(`Someone made a notable trade on ${ticker}`);
  }

  if (signal.putCall === "put") {
    if (signal.strike) {
      const cleanStrike = String(signal.strike).replace(/[^$\d.,]/g, '').replace('$', '');
      chunks.push(`on a $${cleanStrike} put. They profit if ${ticker} keeps falling`);
    } else {
      chunks.push(`betting ${ticker} goes lower`);
    }
  } else if (signal.putCall === "call") {
    if (signal.strike) {
      const cleanStrike = String(signal.strike).replace(/[^$\d.,]/g, '').replace('$', '');
      chunks.push(`on a $${cleanStrike} call. They profit if ${ticker} keeps rising`);
    } else {
      chunks.push(`betting ${ticker} goes higher`);
    }
  } else {
    const direction = signal.type === "bullish" ? "go UP" : signal.type === "bearish" ? "go DOWN" : "make a move";
    chunks.push(`expecting ${ticker} to ${direction}`);
  }

  if (aggressionMatch) {
    const pct = parseInt(aggressionMatch[1]);
    if (pct >= 90) {
      chunks.push("They paid full asking price. Very urgent, no negotiating");
    } else if (pct >= 70) {
      chunks.push("They paid a high price to get in quick. Shows urgency");
    }
  }

  if (signal.expiry) {
    const exp = signal.expiry;
    if (exp === "0DTE" || exp.includes("0 DTE") || exp.includes("today")) {
      chunks.push("This bet expires TODAY. Same-day play, high risk");
    } else {
      chunks.push(`This bet expires ${exp}`);
    }
  }

  const premiumVal = premiumMatch ? parsePremiumValue(premiumMatch[1]) : 0;

  if (premiumMatch && sweepMatch) {
    chunks.push(`Total money on the line: $${premiumMatch[1]}. ${premiumColor(premiumVal)}`);
  } else if (premiumMatch && premiumVal > 0) {
    chunks.push(premiumColor(premiumVal));
  }

  return chunks.join(", ") + ".";
}
