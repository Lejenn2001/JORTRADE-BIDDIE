export function simplifySignalDescription(desc: string): string {
  if (!desc || desc.length < 10) return "";

  let simple = desc;

  simple = simple.replace(
    /\$?([\d,.]+[KMB]?)\s*premium\s*sweep/gi,
    (_, amt) => `A big trader rushed to spend $${amt}`
  );

  simple = simple.replace(
    /(\d+)%\s*ask\s*aggression/gi,
    (_, pct) => {
      const n = parseInt(pct);
      if (n >= 90) return "and paid full price to get in fast (very urgent)";
      if (n >= 70) return "and paid a high price to get in quickly (urgent)";
      return `and showed ${pct}% urgency getting in`;
    }
  );

  simple = simple.replace(
    /at\s*\$?([\d,.]+)\s*(puts?|calls?)/gi,
    (_, strike, type) => {
      const dir = type.toLowerCase().startsWith("put")
        ? "betting the price drops below"
        : "betting the price goes above";
      return `${dir} $${strike}`;
    }
  );

  simple = simple.replace(
    /(\d+)\s*(put|call)\s*trades?\s*detected/gi,
    (_, count, type) => {
      const dir = type.toLowerCase() === "put" ? "bearish (price going down)" : "bullish (price going up)";
      return `${count} ${dir} trades spotted`;
    }
  );

  simple = simple.replace(
    /volume\/oi\s*ratio:?\s*([\d.]+)x/gi,
    (_, ratio) => {
      const n = parseFloat(ratio);
      if (n >= 5) return `Trading volume is ${ratio}x higher than normal (very unusual activity)`;
      if (n >= 2) return `Trading volume is ${ratio}x above normal (something's brewing)`;
      return `Trading volume is ${ratio}x vs normal`;
    }
  );

  simple = simple.replace(
    /conviction:?\s*(\d+)\/100\s*\(([^)]+)\)/gi,
    (_, score, label) => `Confidence score: ${score}/100 (${label})`
  );

  simple = simple.replace(
    /total\s*premium:?\s*\$?([\d,.]+[KMB]?)/gi,
    (_, amt) => `Total money bet: $${amt}`
  );

  simple = simple.replace(/\bsweep\b/gi, "rush order");
  simple = simple.replace(/\bsweeps\b/gi, "rush orders");
  simple = simple.replace(/\bpremium\b/gi, "money spent");
  simple = simple.replace(/\bopen interest\b/gi, "existing bets");
  simple = simple.replace(/\bimplied volatility\b/gi, "expected price movement");
  simple = simple.replace(/\bIV\b/g, "expected movement");
  simple = simple.replace(/\bdelta\b/gi, "chance of profit");
  simple = simple.replace(/\bgamma\b/gi, "speed of price change");
  simple = simple.replace(/\btheta\b/gi, "time decay (cost of waiting)");
  simple = simple.replace(/\bvega\b/gi, "volatility sensitivity");
  simple = simple.replace(/\bVWAP\b/g, "average traded price today");
  simple = simple.replace(/\bOTM\b/g, "out-of-the-money (hasn't reached the target yet)");
  simple = simple.replace(/\bITM\b/g, "in-the-money (already profitable)");
  simple = simple.replace(/\bATM\b/g, "at-the-money (right at the current price)");
  simple = simple.replace(/\b0DTE\b/g, "expires today (same-day trade)");
  simple = simple.replace(/\bDTE\b/g, "days until it expires");

  if (simple === desc) {
    return `In simple terms: ${desc}`;
  }

  return simple;
}
