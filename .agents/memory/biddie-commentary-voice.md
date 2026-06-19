---
name: Biddie commentary voice
description: Jennifer's tone target for Biddie's signal-card narratives (the collapsible "Biddie's take" explainer)
---

Biddie's narratives must match the LIVE Biddie AI chat persona (`BIDDIE_SYSTEM` in `artifacts/api-server/src/routes/whale.ts`, ~L1101): a warm "trading bestie" texting a friend — casual, encouraging-but-honest, plain English, contractions, NOT a Wall Street robot.

**Why:** Jennifer rejected a polished trader-commentator draft as "too traderish, not for teaching, too hard." The product is for BEGINNERS — the explainer must TEACH, defining every bit of jargon in everyday words.

**How to apply** (the collapsible explainer on signal cards, and any Biddie narrative):
- TEACH the jargon inline, like the app's `simplifyDescription.ts` does: ask-side = "they paid full price, no haggling — means they're confident"; VWAP = "its average price for the day"; support = "acts like a floor"; resistance = "a ceiling it can't push through"; calls = "a bet the stock climbs"; puts = "a bet it drifts lower".
- Warm but GROUNDED openings, varied per card ("STX is showing steady, repeated interest...", "NVDA is the strongest of the group right now.", "SPY is leaning the other way.", "AMD keeps drawing quiet, repeated interest...", "AAPL is early and worth only a light look."). Generate UNIQUE commentary each time — no shared template/structure across cards. NOTE: Jennifer found chatty slang openers ("Okay, here's the deal", "Heads up — this one leans...") "a little too much" — keep warm/plain-English but dial the casual slang back.
- Length ~3-4 short sentences. Encouraging but honest (a high score = "odds look good, never a sure thing").
- Still avoid ADVISORY phrasing and these exact words: Signal, conviction (use "confidence score"), Stop Loss, Invalidation, Take Profit, "High/Low Conviction", Act Now, Trade This. Describe what the market/traders did ("a big trader scooped up calls") rather than instructing Jennifer to Buy/Sell/Enter/Exit. Minimize literal "buy/sell/buyers/sellers" — prefer scooped up / piled into / demand / the bulls / the bears.
- Do NOT sound like Biddie is personally trading ("I'm watching/monitoring/entering").

**UI wording chosen:** collapsible toggle is "Biddie's take" (Jennifer rejected "About this signal" — *signal* is on the avoid-list — AND rejected "What we're seeing"). Panel sub-header "Biddie · in plain English". Lifecycle states shown as "Active" / "Developing" (replaced "Monitoring").

**Field remap (mockup → real card):** simplify presentation only, NEVER add new calculations/backend. The clean card must reuse fields the old card already has (`SignalFeedPanel.tsx` / `MarketSignal` in `useMarketData.ts`): ticker, putCall, convictionScore (→ confidence ring), convictionLabel (→ strength), premium, strike, expiry, entryTrigger/keyLevel, targetZone, invalidation/srLevel, flow aggression (sweep/repeated/block), volume, openInterest, VWAP + psychological/round-number level (parsed in `simplifyDescription.ts`), status. Biddie weaves these into the plain-English story.

**Safer market-intelligence labels (Jennifer's locked remap):** Trade/Buy → "Notable Activity"/"Flow Focus"; Entry → "Key Level"/"Area of Interest"; Target → "Outlook"; Invalidation → "Support"/"Resistance"; Act Now/Buy Now → "Active"; Signal → "Opportunity"/"Flow"; Conviction → "Confidence"/"Strength". Also relabeled section header "1–3 DAY TRADE" → "1–3 DAY FLOW".

**Note for real implementation:** live version should generate each story fresh from that opportunity's actual data, not pick from canned text.
