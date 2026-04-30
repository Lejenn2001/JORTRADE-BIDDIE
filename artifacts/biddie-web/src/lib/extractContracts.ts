// Pure utility for extracting option-contract mentions from free-form chat text.
//
// Supported formats (real Biddie alert outputs):
//   "GOOGL 330C 5/1"                                — compact
//   "SPY 626P 3/31"                                 — compact, uppercase side
//   "SPY 604p 4/17"                                 — compact, lowercase side
//   "NVDA 212.5C 5/8/26"                            — 2-digit year
//   "AAPL 200C 12/19/2025"                          — 4-digit year
//   "GOOGL $330 Calls exp 5/1"                      — $ prefix + word side + filler
//   "SQQQ $86 calls expiring 4/2"                   — "expiring" filler word
//   "IWM 3/31 $237 puts"                            — date BEFORE strike
//   "SPY 3/31 $618 puts"                            — date BEFORE strike
//   "SPY $626 puts expiring 3/31"                   — $ + word side + filler
//   "GS 🔥 Vol/OI of 214 on these 837.5 calls expiring 4/2"   — ticker far from strike
//   "**SPY 626P 3/31**"                             — markdown bold
//
// Algorithm: locate each "strike+side+date" pattern, then attribute it to the
// nearest preceding non-denied ticker in the same line. This avoids accidental
// matches on prose like "META gapping down -1.29% to $540.47" (no SIDE word
// adjacent → not a contract) and "SPY needs to hold $641-$642 area" (same).
//
// This is UI/parsing-only. It never calls the backend, never runs the
// execution evaluator, and never modifies a signal. It only powers the
// optional inline action row attached to Biddie chat messages so users
// can act on a chat-mentioned contract via the existing Paper Trade flow.

export interface ChatContract {
  raw: string;                       // exact substring matched in the message
  ticker: string;                    // uppercase ticker symbol
  strike: number;                    // numeric strike (supports decimals like 212.5)
  optionType: "call" | "put";        // derived from C / P / Call / Put
  expiry: string;                    // ISO yyyy-mm-dd
}

// Tickers we never treat as a contract. Includes prepositions, common ALL-CAPS
// emphasis words observed in real Biddie messages (HARD, HUGE, FAST, etc.),
// and trading abbreviations (OTM/ITM/ATM/DTE/etc.) that aren't tickers.
const TICKER_DENY = new Set<string>([
  // Prepositions / pronouns / conjunctions
  "AM", "PM", "AT", "BY", "OR", "AN", "IS", "IT", "OF", "ON", "TO", "DO",
  "ME", "MY", "WE", "BE", "GO", "SO", "NO", "IN", "AS", "IF", "UP",
  "THE", "AND", "BUT", "FOR", "WITH", "THIS", "THAT", "INTO", "ONTO", "FROM",
  // Common ALL-CAPS emphasis words from Biddie corpus
  "HARD", "HOT", "HUGE", "BIG", "FAST", "SLOW", "NICE", "COOL",
  "REAL", "REALLY", "JUST", "MORE", "LESS", "WAY", "KEY",
  "EVEN", "OVER", "UNDER", "EVERY", "MANY", "SOME", "MOST", "FEW",
  "HIGH", "LOW", "GOOD", "BAD", "BEST", "WORST",
  "YES", "NOPE", "SURE", "MAYBE", "SOON", "NOW", "LATER", "NEVER", "ALWAYS", "OFTEN",
  "OPEN", "CLOSE", "SAFE", "RISK", "EASY", "PURE", "FULL", "FREE",
  "FRESH", "LIVE", "DEAD", "FAR", "NEAR", "BACK", "NEXT", "LAST", "FIRST",
  "MAJOR", "MINOR", "TINY",
  "GREEN", "RED", "BLUE", "BLACK", "WHITE",
  // Trading shorthand / actions
  "BUY", "SELL", "LONG", "SHORT", "BULL", "BEAR", "PUMP", "DUMP", "MOON",
  "FOMO", "FUD", "ATH", "ATL", "OTM", "ITM", "ATM", "OTB", "DTE",
  "EOD", "EOW", "GMT", "EST", "ET", "UTC", "PT", "MT", "CT",
  "API", "URL", "USD", "EPS", "RSI", "MACD",
  "VOL", "OI", "GM", "OK", "HIT", "NEW", "ALL", "ANY", "GET", "LET",
  "SEE", "OUR", "OUT", "OFF",
  "GG", "LOL", "IMO", "IMHO", "TLDR", "FYI", "BTW", "AKA", "LMAO", "OMG", "WTF",
  "CASH", "FLOW", "WIN", "LOSE", "EAT", "EATS",
]);

const SIDE_PAT = "([CcPp](?:alls?|uts?)?)";       // C, P, c, p, Call, Calls, Put, Puts
const STRIKE_PAT = "\\$?(\\d{1,5}(?:\\.\\d{1,2})?)"; // optional $ prefix, supports decimals
const DATE_PAT = "(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?";
const FILLER_PAT = "(?:\\s+(?:exp(?:ir(?:ing|es))?|for|expires?))?"; // "exp", "expiring", "expires", "for"

// Pass A: STRIKE+SIDE [filler]? DATE — e.g. "330C 5/1", "$330 Calls exp 5/1"
const RE_STRIKE_FIRST = new RegExp(
  "(?<![\\w])" + STRIKE_PAT + "\\s*" + SIDE_PAT + "\\b" + FILLER_PAT + "\\s+" + DATE_PAT + "\\b",
  "g"
);
// Pass B: DATE STRIKE+SIDE — e.g. "3/31 $237 puts"
const RE_DATE_FIRST = new RegExp(
  "(?<![\\w])" + DATE_PAT + "\\s+" + STRIKE_PAT + "\\s*" + SIDE_PAT + "\\b",
  "g"
);

// Find nearest non-denied ticker that PRECEDES `pos` in the same line, looking
// back up to ~140 characters. Single-letter tickers (F, T, A) are skipped to
// avoid "Watching" matching as W; 2-6 letter tickers are required.
function findNearestTicker(text: string, pos: number, maxLookback = 140): { ticker: string; index: number } | null {
  const lookbackStart = Math.max(0, pos - maxLookback);
  const segment = text.slice(lookbackStart, pos);
  const newlineIdx = segment.lastIndexOf("\n");
  const sameLine = newlineIdx >= 0 ? segment.slice(newlineIdx + 1) : segment;
  const baseOffset = pos - sameLine.length;
  const re = /\b[A-Z]{2,6}(?![a-z])\b/g;
  let last: { ticker: string; index: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sameLine)) !== null) {
    const ticker = m[0];
    if (TICKER_DENY.has(ticker)) continue;
    last = { ticker, index: baseOffset + m.index };
  }
  return last;
}

function resolveExpiry(monthStr: string, dayStr: string, yearStrRaw: string | undefined, now: Date): string | null {
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

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
    if (candidate < today - 14 * 24 * 3600 * 1000) year += 1;
  }

  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function extractContractsFromText(text: string, now: Date = new Date()): ChatContract[] {
  const out: ChatContract[] = [];
  const seenKeys = new Set<string>();
  const claimedRanges: Array<[number, number]> = [];
  if (!text || typeof text !== "string") return out;

  function tryClaim(
    spanStart: number,
    spanEnd: number,
    ticker: string,
    strikeStr: string,
    sideStr: string,
    monthStr: string,
    dayStr: string,
    yearStrRaw: string | undefined,
    raw: string,
  ): void {
    const strike = Number(strikeStr);
    if (!Number.isFinite(strike) || strike <= 0) return;
    const expiry = resolveExpiry(monthStr, dayStr, yearStrRaw, now);
    if (!expiry) return;
    const optionType: "call" | "put" = sideStr.charAt(0).toLowerCase() === "c" ? "call" : "put";
    const key = `${ticker}|${strike}|${optionType}|${expiry}`;
    if (seenKeys.has(key)) return;
    if (claimedRanges.some(([s, e]) => spanStart < e && spanEnd > s)) return;
    seenKeys.add(key);
    claimedRanges.push([spanStart, spanEnd]);
    out.push({ raw, ticker, strike, optionType, expiry });
  }

  RE_STRIKE_FIRST.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_STRIKE_FIRST.exec(text)) !== null) {
    const [, strikeStr, sideStr, monthStr, dayStr, yearStrRaw] = m;
    const t = findNearestTicker(text, m.index);
    if (!t) continue;
    const spanEnd = m.index + m[0].length;
    tryClaim(t.index, spanEnd, t.ticker, strikeStr, sideStr, monthStr, dayStr, yearStrRaw, text.slice(t.index, spanEnd));
  }

  RE_DATE_FIRST.lastIndex = 0;
  while ((m = RE_DATE_FIRST.exec(text)) !== null) {
    const [, monthStr, dayStr, yearStrRaw, strikeStr, sideStr] = m;
    const t = findNearestTicker(text, m.index);
    if (!t) continue;
    const spanEnd = m.index + m[0].length;
    tryClaim(t.index, spanEnd, t.ticker, strikeStr, sideStr, monthStr, dayStr, yearStrRaw, text.slice(t.index, spanEnd));
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

// Stable key for a chat contract (used for dedup, monitor set membership,
// and the synthetic chat-* signalId we send to /paper/trades).
export function chatContractKey(c: ChatContract): string {
  return `${c.ticker}|${c.strike}|${c.optionType}|${c.expiry}`;
}

// Build the input expected by the PaperTradeTicket modal for a chat-derived
// contract. NOTE: type-only import keeps this file free of runtime cycles.
import type { PaperTradeSignalInput } from "@/components/PaperTradeTicket";

export function buildPaperTradeFromChat(c: ChatContract): PaperTradeSignalInput {
  // Chat trades carry no signal plan and no execution verdict.
  // The "chat-" signalId prefix prevents collision with real signal IDs.
  return {
    signalId: `chat-${chatContractKey(c)}`,
    ticker: c.ticker,
    optionType: c.optionType,
    strike: c.strike,
    expiry: c.expiry,
    source: "chat",
  };
}
