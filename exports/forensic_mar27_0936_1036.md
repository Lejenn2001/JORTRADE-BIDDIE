# Forensic Reconstruction: March 27, 2026 — 9:36 AM to 10:36 AM ET

---

## 1. DEPLOYED VERSION

**Exact commit hash live during this window:**

```
e679f484bea46b56b57379e6f9dfc80695f0d61d
```

- Committed: March 27, 2026 at 13:23:45 UTC (9:23 AM ET) — 13 minutes before window start
- Message: "Improve daily morning market outlook with added personality"
- whale.ts size: 3,186 lines
- Published to production at: 13:35:54 UTC (9:35 AM ET) — 6 seconds before window start
- Publish commit: `02e042950da1f97fa742bd7c28fb43d6a133a2d2`

---

## 2. DEPLOYS / RESTARTS INSIDE THE WINDOW

| Time (UTC) | Time (ET) | Type | What Changed |
|------------|-----------|------|-------------|
| 13:42:59 | 9:42 AM | Re-publish | No whale.ts change. OG image + breakout scanner preview (non-pipeline files) |
| 14:22:33 | 10:22 AM | Publish | No whale.ts change. Breakout scanner + duplicate scan prevention (non-pipeline files) |
| 14:36:06 | 10:36 AM | Publish | whale.ts dedup commit `5823d44` — adds post-generation dedup filter only. Does NOT change signal generation, scoring, entry/target/invalidation logic, or DB insertion. Only affects which signals are returned in the API response. |

**CONCLUSION: Signal generation logic was IDENTICAL for the entire 9:36–10:36 AM window.**

The dedup commit at 10:36 AM only added a display-layer filter (dedup by ticker+category in the API response). It does not affect scoring, filtering, Claude evaluation, or DB insertion.

All 14 signals in your list were generated under **one single algorithm regime**: commit `e679f484`.

---

## 3. CRITICAL FINDING: RETROACTIVE DB MODIFICATION

**Every signal from March 27 has been retroactively modified.** All signals carry the tag `🔧 Updated Logic`, which was NOT part of the original algorithm output.

The `entry_trigger`, `target`, `target_near`, and `invalidation` values currently stored in the production database are **NOT the original values generated at 9:36–10:36 AM.** They were overwritten by a later code version through the `admin/sync-signal-fields` endpoint, which recalculated these fields using updated logic and appended the `🔧 Updated Logic` tag. The `target_near` field did not exist at all in the March 27 algorithm — it was added on March 28.

**What the DB shows NOW vs. what was ORIGINALLY generated:**

The current DB format (retroactive):
```
Entry: "At VWAP ($642.17) — Near $640.98"
Target: "$640.00"
Target Near: "$627.20"
Invalidation: "Above $653.80"
```

What the live code at `e679f484` would have generated (original):
```
Entry: "Trading below VWAP at $642.17 — confirmed"
Target: "S1 at $627.20" or "PDL at $X.XX, then S1 at $Y.YY"
Target Near: [field did not exist]
Invalidation: "Above VWAP at $642.17" or "Above PDH at $X.XX"
```

**The following fields are TRUSTWORTHY (not modified):**
- `ticker`, `category`, `option_type`, `direction`, `strike`, `expiry`, `premium`
- `confidence`, `conviction_score`
- `price_at_signal` (the live price at generation time)
- `created_at` (timestamp)
- `reason` (text description)
- `signal_source` ("replit")
- `algo_version` ("v2")

**The following fields were RETROACTIVELY OVERWRITTEN:**
- `entry_trigger` — format changed from original
- `target` — recalculated
- `target_near` — did not exist originally, added later
- `invalidation` — recalculated
- `tags` — "🔧 Updated Logic" appended

---

## 4. EXACT LIVE LOGIC — ACTIVE LOGIC SNAPSHOT AT 9:36–10:36 AM ET

### 4a. Pipeline Structure

```
runSignalsPipeline()
├── 1. fetchFlowAlerts(500) → Unusual Whales API
├── 2. enrichAlerts() → parse premium, aggression, vol/OI, sweep, multileg
├── 3. Pre-filter:
│   ├── Must have ticker AND expiry
│   ├── Expiry >= today
│   ├── Premium >= $25,000
│   ├── Ask aggression >= 50%
│   └── Slice to top 20 by premium
├── 4. Extract UW prices from flow data for each ticker
├── 5. Unique tickers → limit 10 (Polygon rate limit)
├── 6. Parallel fetch (15s timeout):
│   ├── fetchKeyLevels(ticker) → Polygon daily + intraday bars → VWAP, PDH, PDL, pivot, R1, S1
│   ├── fetchRecentCandles(ticker, "1m", 10) → last 10 1-min candles
│   └── fetchStructureCandles(ticker) → 5-min bars for market structure
├── 7. analyzeMarketStructure() → ICT/SMC analysis (FVGs, order blocks, BOS/CHoCH, liquidity)
├── 8. detectPriceActionConfirmation() → candle pattern confirmation
├── 9. generateTradeRecommendation() → trade recommendation
├── 10. LOCAL scoreSignal() per candidate → pre-screen
│   ├── Hard filters (OTM, expiry, confidence floor)
│   ├── Scoring (base 5 + modifiers)
│   └── Entry/target/invalidation generation
├── 11. Dedup by ticker+optionType → sort by confidence → top 15
├── 12. CLAUDE CALL #1: Hedge detection + ICT/SMC evaluation
│   ├── Sends: all 15 candidates + market structure + intraday trend
│   ├── Returns: is_hedge, adjusted_confidence, signal_quality, category
│   └── Post-filter: remove hedges, remove confidence < 6
├── 13. CLAUDE CALL #2: Spread generation (if ≥2 signals with conf ≥7)
│   ├── Sends: top 6 directional signals
│   └── Returns: up to 2 spread suggestions
├── 14. Sort by confidence, limit 20
└── 15. DB insertion with dedup check (ticker + category + strike + option_type)
```

### 4b. Filtering Logic (exact code)

```typescript
// Pre-filter (before scoring)
const candidates = enriched.filter((a) => {
    if (!a.ticker || !a.expiry) return false;    // Must have ticker + expiry
    if (a.expiry < today) return false;           // Not expired
    if (a.total_premium < 25_000) return false;   // $25K minimum premium
    if (a.ask_aggression_pct < 50) return false;  // 50% minimum ask aggression
    return true;
}).slice(0, 20);                                  // Top 20 by premium (pre-sorted)

// Hard filters INSIDE scoreSignal():

// Filter 1: Reject deep OTM (>15% from current price)
if (price && strike) {
    const otmPct = Math.abs(strike - price) / price;
    if (otmPct > 0.15) return null;
}

// Filter 2: Reject far-out expiries (>45 days) or expired
if (expiryDate) {
    const daysToExpiry = (expMs - nowMs) / (1000 * 60 * 60 * 24);
    if (daysToExpiry > 45) return null;
    if (daysToExpiry < 0) return null;
}

// Filter 3: Confidence floor
confidence = Math.min(10, Math.round(confidence));
if (confidence < 5) return null;

// Post-Claude filter:
signals = signals.filter((s) => !s.is_hedge && s.confidence >= 6);
```

**Filters that DID NOT EXIST on March 27:**
- No "no live price" rejection (Filter 0c — added March 28)
- No "deep ITM >5%" rejection (Filter 1b — added March 28)

### 4c. Scoring Logic (exact code)

```typescript
let confidence = 5;                                    // Base score

// Flow characteristics
if (hasSweep) confidence += 1;                         // Sweep detected
if (aggression >= 80) confidence += 1;                 // High aggression
if (aggression >= 95) confidence += 0.5;               // Very high aggression
if (volOi >= 2) confidence += 0.5;                     // Elevated vol/OI
if (volOi >= 5) confidence += 0.5;                     // Very high vol/OI
if (premium >= 100_000) confidence += 0.5;             // $100K+ premium
if (premium >= 500_000) confidence += 0.5;             // $500K+ premium
if (premium >= 1_000_000) confidence += 0.5;           // $1M+ premium
if (confirmation?.confirmed) confidence += 1;          // Candle pattern confirmed

// ATM bonus / OTM penalty
if (diff < 0.02) confidence += 1;                      // Very near strike
else if (diff < 0.05) confidence += 0.5;               // Near strike
else if (diff > 0.10) confidence -= 1;                 // Far from strike

// Near-term expiry bonus
if (daysOut <= 7) confidence += 0.5;                   // Weekly or 0DTE

// VWAP alignment (CRITICAL)
if (priceAligned === false) confidence -= 1.5;         // Against direction = heavy penalty
else if (priceAligned === true && confirmed) confidence += 0.5; // Aligned + confirmed = boost

// Cap and floor
confidence = Math.min(10, Math.round(confidence));
if (confidence < 5) return null;                       // Hard floor
```

**Category assignment:**
```typescript
let category = "algorithm";                            // Default
if (premium >= 2_000_000) category = "whale";          // $2M+ = whale
else if (premium >= 1_000_000 && (hasSweep || aggression >= 90)) category = "whale"; // $1M+ with sweep/aggression
if (hasMultileg) category = "spread";                  // Multi-leg = spread
```

### 4d. Claude Usage (exact prompts)

**Call #1: Hedge Detection + ICT/SMC Evaluation**

Model: `claude-sonnet-4-6`, max_tokens: 1500

Each candidate sent to Claude with:
- ticker, direction, option_type, trade, strike, expiry, premium
- ask_aggression_pct, vol_oi_ratio, has_sweep
- current_price, vwap, prior_day_high, prior_day_low, pivot, r1, s1
- intraday_trend, intraday_change_pct, trend_description
- Full ICT/SMC market structure: trend, BOS/CHoCH, active FVGs, inversed FVGs, order blocks, liquidity levels, discount/premium zone position

Claude prompt scoring framework:

```
HIGHEST CONVICTION (8-10):
- Trend-aligned flow (calls in uptrend above VWAP, puts in downtrend below VWAP)
- Flow at discount (calls) or premium (puts)
- Respected order block in trend direction
- Bullish BOS + calls / Bearish BOS + puts
- Active FVG supporting direction
- Liquidity just swept in opposite direction

FVG PLAYS:
- Active bullish FVG + calls = continuation
- Active bearish FVG + puts = continuation
- IFVG (inversed bullish) + puts = reversal
- IFVG (inversed bearish) + calls = reversal

REVERSAL (5-8):
- CHoCH + aligned flow = strong reversal
- Price in discount + calls = smart money buying cheap
- Price in premium + puts = smart money selling high

HEDGE / LOW (3-5):
- No ICT confluence
- Counter-trend with no structural reason
- Index flow against trend = portfolio hedge
- Far OTM + massive premium + far expiry = tail hedge
```

Claude returns: `is_hedge`, `adjusted_confidence` (1-10), `hedge_reason`, `signal_quality` ("strong"/"moderate"/"weak"/"hedge"), `recommended_category`

Post-Claude filter: `signals = signals.filter((s) => !s.is_hedge && s.confidence >= 6)`

**Call #2: Spread Generation**

Model: `claude-sonnet-4-6`, max_tokens: 2000

Triggered when ≥2 signals have confidence ≥7. Top 6 directional signals sent. Claude can suggest 0-2 spread strategies. Returns empty array if outright options are better.

### 4e. Entry Generation (exact code — ORIGINAL, not retroactive)

```typescript
// CALL ENTRY:
if (vwap && price) {
    if (price > vwap) {
        entryTrigger = `Holding above VWAP at $${vwap.toFixed(2)} — confirmed`;
    } else {
        entryTrigger = `Needs to reclaim VWAP at $${vwap.toFixed(2)} (currently below)`;
    }
} else if (pdh) {
    entryTrigger = price > pdh
        ? `Broke above PDH at $${pdh.toFixed(2)} — confirmed`
        : `Break above PDH at $${pdh.toFixed(2)}`;
} else {
    entryTrigger = `Above $${strike}`;
}

// PUT ENTRY:
if (vwap && price) {
    if (price < vwap) {
        entryTrigger = `Trading below VWAP at $${vwap.toFixed(2)} — confirmed`;
    } else {
        entryTrigger = `Needs rejection at VWAP $${vwap.toFixed(2)} (currently above)`;
    }
} else if (pdl) {
    entryTrigger = price < pdl
        ? `Broke below PDL at $${pdl.toFixed(2)} — confirmed`
        : `Break below PDL at $${pdl.toFixed(2)}`;
} else {
    entryTrigger = `Below $${strike}`;
}
```

### 4f. Target Generation (exact code — ORIGINAL)

```typescript
// CALL TARGET — next resistance above:
if (abovePdh && r1 && r1 > price) {
    target = `R1 at $${r1.toFixed(2)}`;
} else if (pdh && price < pdh) {
    target = r1 ? `PDH at $${pdh.toFixed(2)}, then R1 at $${r1.toFixed(2)}`
               : `PDH at $${pdh.toFixed(2)}`;
} else if (r1) {
    target = `R1 at $${r1.toFixed(2)}`;
} else if (pdh) {
    target = `PDH at $${pdh.toFixed(2)}`;
} else {
    target = `$${(strike * 1.02).toFixed(2)}`;
}

// PUT TARGET — next support below:
if (belowPdl && s1 && s1 < price) {
    target = `S1 at $${s1.toFixed(2)}`;
} else if (pdl && price > pdl) {
    target = s1 ? `PDL at $${pdl.toFixed(2)}, then S1 at $${s1.toFixed(2)}`
               : `PDL at $${pdl.toFixed(2)}`;
} else if (s1) {
    target = `S1 at $${s1.toFixed(2)}`;
} else if (pdl) {
    target = `PDL at $${pdl.toFixed(2)}`;
} else {
    target = `$${(strike * 0.98).toFixed(2)}`;
}
```

**No `target_near` field existed. It was added March 28.**

### 4g. Invalidation Generation (exact code — ORIGINAL)

```typescript
// CALL INVALIDATION — next support below:
if (vwap && price > vwap && pdl) {
    invalidation = `Below VWAP at $${vwap.toFixed(2)}`;
} else if (pdl) {
    invalidation = `Below PDL at $${pdl.toFixed(2)}`;
} else if (s1) {
    invalidation = `Below S1 at $${s1.toFixed(2)}`;
} else if (vwap) {
    invalidation = `Below VWAP at $${vwap.toFixed(2)}`;
} else {
    invalidation = `Below $${(strike * 0.98).toFixed(2)}`;
}

// PUT INVALIDATION — next resistance above:
if (vwap && price < vwap && pdh) {
    invalidation = `Above VWAP at $${vwap.toFixed(2)}`;
} else if (pdh) {
    invalidation = `Above PDH at $${pdh.toFixed(2)}`;
} else if (r1) {
    invalidation = `Above R1 at $${r1.toFixed(2)}`;
} else if (vwap) {
    invalidation = `Above VWAP at $${vwap.toFixed(2)}`;
} else {
    invalidation = `Above $${(strike * 1.02).toFixed(2)}`;
}
```

### 4h. Price Source / Fallback Logic (exact code)

```typescript
// In fetchKeyLevels():
// Priority 1: Polygon WebSocket (priceMonitor, within 120s)
const rtData = priceMonitor.getPrice(ticker);
const polygonLive = rtData && Date.now() - rtData.lastUpdate < 120000
    ? Math.round(rtData.price * 100) / 100
    : null;

// Priority 2: UW underlying_price from flow data
let currentPrice = polygonLive ?? (uwPrice ? Math.round(uwPrice * 100) / 100 : null);

// Priority 3: Polygon snapshot API
if (!currentPrice) {
    const snap = await fetchPolygonSnapshot(ticker);
    if (snap) currentPrice = Math.round(snap.price * 100) / 100;
}

// Priority 4: Last intraday bar close
if (!currentPrice && intradayBars.length > 0) {
    currentPrice = Math.round(intradayBars[intradayBars.length - 1].close * 100) / 100;
}

// Priority 5: Previous day close
if (!currentPrice && prevClose) {
    currentPrice = Math.round(prevClose * 100) / 100;
}

// VWAP calculation: from Polygon 5-min intraday bars
// cumulative (typical_price × volume) / cumulative volume
let vwap = null;
if (intradayBars.length > 0) {
    let cumTPV = 0, cumVol = 0;
    for (const b of intradayBars) {
        if (b.high && b.low && b.close && b.volume) {
            cumTPV += ((b.high + b.low + b.close) / 3) * b.volume;
            cumVol += b.volume;
        }
    }
    vwap = cumVol > 0 ? Math.round((cumTPV / cumVol) * 100) / 100 : null;
}
```

**Key note:** NO hard rejection for missing price. If all 5 sources failed, `currentPrice` would be null and the signal could still proceed (unlike March 28+ where missing price = hard reject).

---

## 5. SIGNAL-BY-SIGNAL PATH RECONSTRUCTION

For each of your 14 signals, the following path was executed. I am using the TRUSTWORTHY DB fields (ticker, strike, premium, aggression, price_at_signal, confidence, category, tags, reason) to reconstruct the exact scoring path.

### SPY $640 Put — 9:36 AM ET
- **Raw flow:** $2.3M premium sweep, $640 puts, 100% ask aggression
- **Enrichment:** premium=2,322,384, aggression=100%, sweep=true
- **Pre-filter:** premium $2.3M > $25K ✓, aggression 100% > 50% ✓
- **Price source:** price_at_signal=$640.98, VWAP=$642.17 (Polygon)
- **Filters passed:** OTM = |640-640.98|/640.98 = 0.15% ✓ (< 15%), expiry Apr 30 = ~34 days ✓ (< 45)
- **Confidence calculation:**
  - Base: 5
  - Sweep: +1 = 6
  - Aggression 100% ≥ 80: +1 = 7, ≥ 95: +0.5 = 7.5
  - Premium $2.3M ≥ $100K: +0.5 = 8, ≥ $500K: +0.5 = 8.5, ≥ $1M: +0.5 = 9
  - Price confirmed (SR Tag + 2 Red Bars): +1 = 10
  - ATM: diff = 0.15% < 2%: +1 = 11
  - VWAP aligned (put, price $640.98 < VWAP $642.17 = below = aligned): +0.5 (since also confirmed) = 11.5
  - Capped at 10, rounded = **10 pre-Claude**
- **Claude adjustment:** Reduced to **9** (negative gamma zone, strong setup)
- **Category:** "whale" (premium $2.3M ≥ $2M)
- **Original entry:** `Trading below VWAP at $642.17 — confirmed`
- **Original target:** PDL-based or S1-based (depending on Polygon data for SPY that morning)
- **Original invalidation:** `Above VWAP at $642.17` or `Above PDH at $X.XX`

### META $587.50 Put — 9:36 AM ET
- **Raw flow:** $915K premium, $587.50 puts, 100% ask aggression, 0DTE
- **Price source:** price_at_signal=$536.96 — META was at $537, strike $587.50 is deep ITM ($50+ ITM)
- **Filters passed:** OTM = |587.50-536.96|/536.96 = 9.4% ✓ (< 15% — note: this was treated as OTM distance, not ITM, because March 27 had no ITM filter)
- **Confidence calculation:**
  - Base: 5
  - No sweep: +0
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $915K: +0.5 + 0.5 = 7.5
  - Price confirmed: +1 = 8.5
  - OTM penalty: diff = 9.4% > 5%: no bonus, not > 10% so no penalty = 8.5
  - 0DTE bonus: +0.5 = 9
  - VWAP: price $537 vs VWAP — DB shows "no VWAP data" so VWAP fallback unavailable = no alignment check
  - Rounded = **9 pre-Claude**
- **Claude adjustment:** Reduced to **6** (deep ITM, likely hedge but not flagged as hedge)
- **Category:** "algorithm" (premium $915K < $1M)
- **Note:** This signal would have been REJECTED on March 28+ by the deep ITM filter (>5% ITM)

### IREN $37 Put — 9:43 AM ET
- **Raw flow:** $537K premium, $37 puts, 100% aggression
- **Price source:** price_at_signal=$36.63, VWAP=$36.95
- **Filters passed:** OTM = |37-36.63|/36.63 = 1.0% ✓, expiry Apr 17 ✓
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $537K: +0.5 + 0.5 = 7.5
  - Price confirmed (SR Tag + 2 Red Bars): +1 = 8.5
  - ATM: diff 1.0% < 2%: +1 = 9.5
  - Negative gamma: (tag present)
  - VWAP aligned (put, price $36.63 < VWAP $36.95 = below = aligned) + confirmed: +0.5 = 10
  - Capped at 10, rounded = **10 pre-Claude**
- **Claude adjustment:** Reduced to **8** (strong directional setup)
- **Category:** "algorithm"
- **Original entry:** `Trading below VWAP at $36.95 — confirmed`

### MSTR $120 Put — 9:51 AM ET
- **Raw flow:** $421K sweep, $120 puts, 100% aggression
- **Price source:** price_at_signal=$125.63, VWAP=$128.69
- **Filters passed:** OTM = |120-125.63|/125.63 = 4.5% ✓
- **Confidence calculation:**
  - Base: 5
  - Sweep: +1 = 6
  - Aggression 100%: +1 + 0.5 = 7.5
  - Premium $421K: +0.5 = 8
  - ATM: diff 4.5% < 5%: +0.5 = 8.5
  - VWAP aligned (put, price $125.63 < VWAP $128.69 = below = aligned): no confirmed tag, just aligned = no extra
  - Wait — priceAligned is true, but no confirmation.confirmed, so just the base priceAligned = no penalty = 8.5
  - Rounded = **9 pre-Claude** (rounding from 8.5)
- **Claude adjustment:** Stays at **8** (sweep confirmation, good setup)
- **Outcome:** HIT ✓

### SLV $62 Call — 9:51 AM ET
- **Raw flow:** $377K premium, $62 calls, 100% aggression
- **Price source:** price_at_signal=$61.60, VWAP=$61.64
- **Filters passed:** OTM = |62-61.60|/61.60 = 0.6% ✓
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $377K: +0.5 = 7
  - Price confirmed: +1 = 8
  - ATM: diff 0.6% < 2%: +1 = 9
  - Negative gamma tag
  - VWAP aligned (call, price $61.60 < VWAP $61.64 = below = NOT aligned): -1.5 = 7.5
  - Wait — price $61.60 vs VWAP $61.64, price is BELOW VWAP, call direction = bullish, aligned = price > vwap for calls. So priceAligned = FALSE
  - But confirmed is true, so: -1.5 for misaligned = 7.5
  - Rounded = **8 pre-Claude** (rounding from 7.5)
- **Claude adjustment:** To **7**
- **Note:** The -1.5 VWAP penalty was applied because price was slightly below VWAP. This is the conservative gating that made March 27 effective.

### GOOGL $275 Call — 9:51 AM ET
- **Raw flow:** $412K premium, $275 calls, 100% aggression, 0DTE, high volume
- **Price source:** price_at_signal=$277.25, VWAP=$276.96
- **Filters passed:** OTM = |275-277.25|/277.25 = 0.8% ✓ (ATM)
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Vol/OI ≥ 5: +0.5 + 0.5 = 7.5 (High Volume tag)
  - Premium $412K: +0.5 = 8
  - Price confirmed: +1 = 9
  - ATM: diff 0.8% < 2%: +1 = 10
  - 0DTE: +0.5 = 10.5
  - Negative gamma tag
  - VWAP aligned (call, price $277.25 > VWAP $276.96 = above = aligned) + confirmed: +0.5 = 11
  - Capped at 10 = **10 pre-Claude**
- **Claude adjustment:** To **7** (0DTE risk adjustment, negative gamma caution)

### COP $140 Call — 9:51 AM ET
- **Raw flow:** $393K premium, $140 calls, 100% aggression
- **Price source:** price_at_signal=$134.56, VWAP=$133.57
- **Filters passed:** OTM = |140-134.56|/134.56 = 4.0% ✓
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $393K: +0.5 = 7
  - Price confirmed: +1 = 8
  - ATM: diff 4.0% < 5%: +0.5 = 8.5
  - VWAP aligned (call, price $134.56 > VWAP $133.57 = above = aligned) + confirmed: +0.5 = 9
  - Rounded = **9 pre-Claude**
- **Claude adjustment:** To **6**
- **Outcome:** MISS

### TSM $332.50 Call — 9:56 AM ET
- **Raw flow:** $473K premium, $332.50 calls, 100% aggression, high volume
- **Price source:** price_at_signal=$322.95, VWAP=$325.77
- **Filters passed:** OTM = |332.50-322.95|/322.95 = 3.0% ✓
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Vol/OI ≥ 5: +0.5 + 0.5 = 7.5 (High Volume tag)
  - Premium $473K: +0.5 = 8
  - ATM: diff 3.0% < 5%: +0.5 = 8.5
  - Positive gamma tag
  - VWAP: call, price $322.95 < VWAP $325.77 = below = NOT aligned: -1.5 = 7
  - Rounded = **7 pre-Claude**
- **Claude adjustment:** Stays at **7** (flow conviction despite VWAP misalignment)
- **Original entry:** `Needs to reclaim VWAP at $325.77 (currently below)` — this is a WATCH, not ACT NOW
- **Outcome:** HIT ✓ — price eventually reclaimed VWAP and ran

### IWM $234 Put — 9:56 AM ET
- **Raw flow:** $650K sweep, $234 puts, 99% aggression
- **Price source:** price_at_signal=$244.52, VWAP=$245.91
- **Filters passed:** OTM = |234-244.52|/244.52 = 4.3% ✓
- **Confidence calculation:**
  - Base: 5
  - Sweep: +1 = 6
  - Aggression 99% ≥ 80: +1, ≥ 95: +0.5 = 7.5
  - Premium $650K: +0.5 + 0.5 = 8.5
  - Price confirmed: +1 = 9.5
  - ATM: diff 4.3% < 5%: +0.5 = 10
  - Positive gamma tag
  - VWAP aligned (put, price $244.52 < VWAP $245.91 = below = aligned) + confirmed: +0.5 = 10.5
  - Capped at 10 = **10 pre-Claude**
- **Claude adjustment:** To **9** (strong setup, sweep confirmed)
- **Outcome:** MISS

### TSLA $335 Put — 9:56 AM ET
- **Raw flow:** $852K premium, $335 puts, 100% aggression
- **Price source:** price_at_signal=$362.56, VWAP=$365.84
- **Filters passed:** OTM = |335-362.56|/362.56 = 7.6% ✓ (< 15%)
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $852K: +0.5 + 0.5 = 7.5
  - No confirmation tag, no sweep
  - OTM: diff 7.6% > 5%, < 10%: no bonus/penalty = 7.5
  - VWAP aligned (put, price $362.56 < VWAP $365.84 = below = aligned): no confirmed, so no extra = 7.5
  - Rounded = **8 pre-Claude**
- **Claude adjustment:** To **7**
- **Outcome:** MISS

### AMD $175 Put — 9:56 AM ET
- **Raw flow:** $501K premium, $175 puts, 100% aggression
- **Price source:** price_at_signal=$198.37, VWAP=$201.41
- **Filters passed:** OTM = |175-198.37|/198.37 = 11.8% ✓ (< 15%, but close)
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $501K: +0.5 + 0.5 = 7.5
  - OTM: diff 11.8% > 10%: -1 = 6.5
  - VWAP aligned (put, price $198.37 < VWAP $201.41 = below = aligned): no confirmed = 6.5
  - Rounded = **7 pre-Claude** (rounding from 6.5)
- **Claude adjustment:** To **6** (far OTM concern)
- **Outcome:** MISS
- **Note:** The 11.8% OTM distance is large. This signal barely passed the 15% OTM filter.

### SOFI $15 Put — 10:32 AM ET
- **Raw flow:** $733K premium, $15 puts, 100% aggression
- **Price source:** price_at_signal=$15.38, VWAP=$15.41
- **Filters passed:** OTM = |15-15.38|/15.38 = 2.5% ✓
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $733K: +0.5 + 0.5 = 7.5
  - ATM: diff 2.5%, between 2-5%: +0.5 = 8
  - Positive gamma tag
  - VWAP aligned (put, price $15.38 < VWAP $15.41 = below = aligned): no confirmed = 8
  - Rounded = **8 pre-Claude**
- **Claude adjustment:** To **7**
- **Outcome:** PARTIAL HIT

### CVNA $295 Call — 10:36 AM ET
- **Raw flow:** $450K sweep, $295 calls, 100% aggression, 0DTE
- **Price source:** price_at_signal=$301.52, VWAP=$299.59
- **Filters passed:** OTM = |295-301.52|/301.52 = 2.2% ✓ (ATM, ITM actually)
- **Confidence calculation:**
  - Base: 5
  - Sweep: +1 = 6
  - Aggression 100%: +1 + 0.5 = 7.5
  - Premium $450K: +0.5 = 8
  - ATM: diff 2.2%, between 2-5%: +0.5 = 8.5
  - 0DTE: +0.5 = 9
  - Positive gamma tag
  - VWAP aligned (call, price $301.52 > VWAP $299.59 = above = aligned): no confirmed tag = 9
  - Rounded = **9 pre-Claude**
- **Claude adjustment:** To **7** (0DTE risk)
- **Outcome:** PARTIAL HIT

### GAP $26 Put — 10:36 AM ET
- **Raw flow:** $456K premium, $26 puts, 100% aggression
- **Price source:** price_at_signal=$24.91, VWAP=$25.00
- **Filters passed:** OTM = |26-24.91|/24.91 = 4.4% ✓
- **Confidence calculation:**
  - Base: 5
  - Aggression 100%: +1 + 0.5 = 6.5
  - Premium $456K: +0.5 = 7
  - Price confirmed (SR Tag + Red Rejection): +1 = 8
  - ATM: diff 4.4% < 5%: +0.5 = 8.5
  - Positive gamma tag
  - VWAP aligned (put, price $24.91 < VWAP $25.00 = below = aligned) + confirmed: +0.5 = 9
  - Rounded = **9 pre-Claude**
- **Claude adjustment:** To **7**
- **Outcome:** HIT ✓

---

## 6. ALGORITHM REGIME CONFIRMATION

**All 14 signals came from the EXACT SAME algorithm regime.**

- Single commit: `e679f484`
- Single published state (13:35:54 publish)
- No pipeline-changing deploys inside the window
- All signals: algo_version = v2, signal_source = "replit"
- Pipeline ran multiple times during the window (signal batches at ~9:36, ~9:40, ~9:43, ~9:51, ~9:56, ~10:32, ~10:36)
- Each pipeline run: fetch 500 → enrich → filter → score → Claude evaluate → Claude spread → insert

---

## 7. SUMMARY: THE MARCH 27 9:36–10:36 REGIME

```
Commit: e679f484
File: whale.ts (3,186 lines)
Version: v2

PIPELINE:
  UW flow (500 alerts)
  → enrich (premium, aggression, vol/OI, sweep)
  → pre-filter ($25K premium, 50% aggression, valid expiry)
  → top 20 candidates, 10 unique tickers
  → Polygon key levels (VWAP, PDH/PDL, pivot, R1/S1) + candles + structure
  → ICT/SMC analysis (FVGs, order blocks, BOS/CHoCH, liquidity)
  → local scoreSignal() with base-5 additive scoring
  → top 15 by confidence
  → Claude #1: hedge detection + ICT/SMC evaluation → remove hedges, remove conf < 6
  → Claude #2: spread generation (optional, max 2)
  → sort by confidence, limit 20
  → DB insert with dedup

FILTERS:
  - OTM > 15% = reject
  - Expiry > 45 days = reject
  - Expired = reject
  - Confidence < 5 (pre-Claude) = reject
  - Hedge (Claude) = reject
  - Confidence < 6 (post-Claude) = reject
  - NO ITM filter
  - NO "missing price" hard reject

SCORING: Base 5 + sweep(1) + aggression(1/0.5) + volOI(0.5/0.5) + premium(0.5/0.5/0.5)
         + confirmed(1) + ATM(1/0.5/-1) + expiry(0.5) + VWAP(-1.5/+0.5)

ENTRY: VWAP-relative, binary: above = confirmed, below = needs reclaim/rejection
TARGET: Key levels only (PDH/R1 for calls, PDL/S1 for puts). No target_near.
INVALIDATION: First support below (calls) or first resistance above (puts)
PRICING: Polygon WS → UW price → Polygon snapshot → bar close → prev close
CLAUDE: 2 calls, claude-sonnet-4-6, ICT/SMC-aware hedge detection + spread gen
BIDDIE PICK: Did not exist
SPX LOGIC: None
```
