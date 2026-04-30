// Pure utility for extracting option-contract mentions from free-form chat text.
// Recognized format examples:
//   "GOOGL 330C 5/1"
//   "INTC 90C 5/8"
//   "SPY 580.5P 6/21"
//   "NVDA 212.5C 5/8/26"   (explicit 2-digit year)
//   "AAPL 200C 12/19/2025"  (explicit 4-digit year)
//
// This is UI/parsing-only. It never calls the backend, never runs the
// execution evaluator, and never modifies a signal. It only powers the
// optional inline action row attached to Biddie chat messages so users
// can act on a chat-mentioned contract via the existing Paper Trade flow.

export interface ChatContract {
  raw: string;                       // exact substring matched in the message
  ticker: string;                    // uppercase ticker symbol
  strike: number;                    // numeric strike (supports decimals like 212.5)
  optionType: "call" | "put";        // derived from C / P suffix
  expiry: string;                    // ISO yyyy-mm-dd
}

// Stricter than a generic ticker regex: requires the strike+C/P pair AND an
// M/D date right after, which makes accidental matches on plain prose
// (like "I A 1C 5/8" — nonsense) virtually impossible.
const CONTRACT_RE =
  /\b([A-Z]{1,6})\s+(\d{1,5}(?:\.\d{1,2})?)([CP])\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;

// Tickers we should never treat as a contract even if they happen to match
// the regex shape (extremely rare; the strike+date suffix already filters
// most prose, but a defensive deny-list keeps it bullet-proof).
const TICKER_DENY = new Set<string>(["AM", "PM", "AT", "BY", "OR", "AN", "IS", "IT", "OF", "ON", "TO", "DO", "ME", "MY", "WE", "BE", "GO", "SO", "NO", "IN"]);

export function extractContractsFromText(text: string, now: Date = new Date()): ChatContract[] {
  const out: ChatContract[] = [];
  const seen = new Set<string>();
  if (!text || typeof text !== "string") return out;

  CONTRACT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTRACT_RE.exec(text)) !== null) {
    const raw = m[0];
    const ticker = m[1];
    const strikeStr = m[2];
    const cp = m[3];
    const monthStr = m[4];
    const dayStr = m[5];
    const yearStrRaw = m[6];

    if (TICKER_DENY.has(ticker)) continue;

    const strike = Number(strikeStr);
    if (!Number.isFinite(strike) || strike <= 0) continue;

    const month = Number(monthStr);
    const day = Number(dayStr);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    let year: number;
    if (yearStrRaw) {
      const y = Number(yearStrRaw);
      year = y < 100 ? 2000 + y : y;
    } else {
      year = now.getUTCFullYear();
      // If the resulting date is more than ~14 days in the past, roll forward
      // to next year (a Biddie chat message saying "5/1" in late December
      // almost certainly means May 1 of next year, not 11 months ago).
      const candidate = Date.UTC(year, month - 1, day);
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      if (candidate < today - 14 * 24 * 3600 * 1000) {
        year += 1;
      }
    }

    // Validate the assembled date actually exists (e.g. "2/30" → invalid).
    const checkDate = new Date(Date.UTC(year, month - 1, day));
    if (
      checkDate.getUTCFullYear() !== year ||
      checkDate.getUTCMonth() !== month - 1 ||
      checkDate.getUTCDate() !== day
    ) {
      continue;
    }

    const expiry = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const key = `${ticker}|${strike}|${cp}|${expiry}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      raw,
      ticker,
      strike,
      optionType: cp === "C" ? "call" : "put",
      expiry,
    });
  }

  return out;
}

// Compact display label for a chat contract (e.g. "GOOGL 330C 5/1").
export function formatChatContract(c: ChatContract): string {
  const cp = c.optionType === "call" ? "C" : "P";
  const strike = Number.isInteger(c.strike) ? `${c.strike}` : c.strike.toFixed(2).replace(/\.?0+$/, "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.expiry);
  const date = m ? `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}` : c.expiry;
  return `${c.ticker} ${strike}${cp} ${date}`;
}
