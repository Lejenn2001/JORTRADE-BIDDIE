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
  simple = simple.replace(/\bIV\s*rank\b/gi, "how volatile compared to its history");
  simple = simple.replace(/\bIV\s*percentile\b/gi, "volatility ranking vs past year");
  simple = simple.replace(/\bIV\b/g, "expected movement");
  simple = simple.replace(/\bdelta\b/gi, "chance of profit");
  simple = simple.replace(/\bgamma\b/gi, "speed of price change");
  simple = simple.replace(/\btheta\b/gi, "time decay (cost of waiting)");
  simple = simple.replace(/\bvega\b/gi, "volatility sensitivity");
  simple = simple.replace(/\bVWAP\b/g, "average traded price today");
  simple = simple.replace(/\bOTM\b/g, "out-of-the-money (hasn't hit the target yet)");
  simple = simple.replace(/\bITM\b/g, "in-the-money (already profitable)");
  simple = simple.replace(/\bATM\b/g, "at-the-money (right at the current price)");
  simple = simple.replace(/\b0DTE\b/g, "expires today (same-day bet)");
  simple = simple.replace(/\bDTE\b/g, "days until it expires");
  simple = simple.replace(/\bblock\s*trade\b/gi, "large private deal between big players");
  simple = simple.replace(/\bfloor\s*trade\b/gi, "trade made on the actual exchange floor (big money)");
  simple = simple.replace(/\bmulti[- ]?leg\b/gi, "combo trade (multiple bets at once)");
  simple = simple.replace(/\bspread\b/gi, "combo bet (buy one, sell another)");
  simple = simple.replace(/\bstraddle\b/gi, "bet on a big move in either direction");
  simple = simple.replace(/\bstrangle\b/gi, "bet on a big move, but cheaper than a straddle");
  simple = simple.replace(/\biron\s*condor\b/gi, "bet that the price stays in a range");
  simple = simple.replace(/\bbutterfly\b/gi, "bet on the price landing at a specific spot");
  simple = simple.replace(/\bcovered\s*call\b/gi, "selling upside for income while holding the stock");
  simple = simple.replace(/\bprotective\s*put\b/gi, "insurance against the stock dropping");
  simple = simple.replace(/\bexercise\b/gi, "using the option to buy/sell the actual stock");
  simple = simple.replace(/\bassignment\b/gi, "being forced to buy/sell the stock");
  simple = simple.replace(/\bexpir(ation|y|es?)\b/gi, "when the bet runs out");
  simple = simple.replace(/\bcontract(s)?\b/gi, (_, s) => s ? "bets" : "bet");
  simple = simple.replace(/\bstrike\s*price\b/gi, "target price of the bet");
  simple = simple.replace(/\bstrike\b/gi, "target price");
  simple = simple.replace(/\bbearish\b/gi, "expecting price to go DOWN");
  simple = simple.replace(/\bbullish\b/gi, "expecting price to go UP");
  simple = simple.replace(/\bsentiment\b/gi, "overall mood");
  simple = simple.replace(/\bhedg(e|ing)\b/gi, "protection against losses");
  simple = simple.replace(/\bshort\s*interest\b/gi, "how many people are betting against this stock");
  simple = simple.replace(/\bshort\s*squeeze\b/gi, "when people betting against get forced to buy (price rockets up)");
  simple = simple.replace(/\bmarket\s*maker\b/gi, "the big middleman who keeps trades flowing");
  simple = simple.replace(/\bdark\s*pool\b/gi, "private exchange where big trades happen out of sight");
  simple = simple.replace(/\bunusual\s*activity\b/gi, "trading that's way outside normal patterns");
  simple = simple.replace(/\bflow\b/gi, "stream of trades coming in");
  simple = simple.replace(/\bliquidity\b/gi, "how easy it is to buy/sell");
  simple = simple.replace(/\bvolatility\b/gi, "how wild the price swings are");
  simple = simple.replace(/\bconsolidat(ion|ing)\b/gi, "price taking a breather (moving sideways)");
  simple = simple.replace(/\bbreakout\b/gi, "price bursting through a level");
  simple = simple.replace(/\bbreakdown\b/gi, "price crashing through support");
  simple = simple.replace(/\bsupport\b/gi, "price floor (where it tends to bounce)");
  simple = simple.replace(/\bresistance\b/gi, "price ceiling (where it tends to stop)");
  simple = simple.replace(/\bmomentum\b/gi, "speed & strength of the move");
  simple = simple.replace(/\breversal\b/gi, "the price changing direction");
  simple = simple.replace(/\bcontinuation\b/gi, "the price keeping its current direction");
  simple = simple.replace(/\baccumulation\b/gi, "smart money quietly buying up shares");
  simple = simple.replace(/\bdistribution\b/gi, "smart money quietly selling off shares");

  if (simple === desc) {
    return `In simple terms: ${desc}`;
  }

  return simple;
}
