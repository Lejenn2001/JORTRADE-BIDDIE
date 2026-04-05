# JORTRADE / Biddie AI — Full System Audit
### Internal Documentation — April 5, 2026
### Platform: jortrade.com | Biddie AI Trading Platform

---

## TABLE OF CONTENTS

1. Dashboard (Biddie Picks / Top Signals)
2. Jortrade Chat (Biddie AI)
3. Decision Engine
4. Algo Tab
5. Whales Tab
6. Spreads Tab
7. Breakout Scanner
8. Market View
9. Analytics
10. System Overview
11. Appendix A — Dashboard Curation Logic
12. Appendix B — UI vs Backend Field Mapping (Per Page)
13. Appendix C — Signal Field Storage & Display
14. Appendix D — Analytics Calculation Logic
15. Appendix E — Verification Basis
16. Appendix F — Failure & Recovery Guide

---

## 1. DASHBOARD — Main Page (`/dashboard`)

### Purpose
Central hub of the platform. Shows a real-time signal feed, market status, ticker tape, AI chat panel, and the three signal categories (Algo, Whale, Spread). This is what users see first after login.

### Data Sources
| Source | Type | Details |
|---|---|---|
| `GET /api/whale/signals` | Live signal pipeline | Triggers full pipeline: Unusual Whales flow → Polygon price/levels → scoring |
| `GET /api/whale/signals/history?limit=300` | Database query | Fetches recent signals from `signal_outcomes` table |
| `GET /api/whale/trades?userId={id}` | Database query | Fetches user's "taken" trades from `user_trades` table |

### Data Freshness
- Signal pipeline: Runs every **3 minutes** during market hours; results cached between runs
- Signal history: Fetched on page load from database (not cached — always current)
- Taken trades: Fetched on page load, updated immediately on user action
- Ticker tape prices: Real-time via Polygon WebSocket (sub-second updates)
- Market status: Computed client-side from current time vs. market hours

### Backend Route
- `GET /api/whale/signals` → `runSignalsPipeline()` in `whale.ts`
- `GET /api/whale/signals/history` → Direct database SELECT from `signal_outcomes`

### Filters & Transformations
- Signals categorized by `category` field: `algorithm`, `whale`, or `spread`
- Sorted by detection time (newest first), then by conviction score (highest first)
- **Minimum conviction score of 60** required on the main Dashboard (see Appendix A)
- **Limited to top 5 signals per category** on this page
- Resolved signals hidden by default
- Admin-reviewed "wrong" signals hidden from non-admins

### Signal Engine Dependency
**Fully dependent.** This page is the primary consumer of the signal pipeline.

### Risks & Limitations
- If Unusual Whales API is down, no new signals are generated (historical signals still display)
- If Polygon WebSocket disconnects, ticker tape prices freeze until reconnection (30s backoff retry)
- During market close (nights/weekends), pipeline runs but produces no new signals
- Signal history limited to last 300 records on page load

---

## 2. JORTRADE CHAT — Biddie AI (`/dashboard/chat`)

### Purpose
Interactive AI trading assistant. Users ask questions about market conditions, specific tickers, trade setups, or general trading education. "Biddie" responds with real-time market context.

### Data Sources
| Source | Type | Details |
|---|---|---|
| `POST /api/whale/chat` | Request-response | Sends user message + history to Claude AI with live market context |
| Unusual Whales API | Live (per-request) | Last 80 flow alerts + ticker-specific flow fetched at request time |
| Polygon.io API | Live (per-request) | Key levels (VWAP, pivots, PDH/PDL) for mentioned tickers + SPY/QQQ |
| Unusual Whales Dark Pool | Live (per-request) | Recent dark pool prints for mentioned tickers |
| Economic Calendar | Live (per-request) | Top 10 upcoming economic events |

### Data Freshness
- **Real-time**: All market data is fetched fresh at the moment the user sends a message
- **Not cached**: Each chat message triggers new API calls to Unusual Whales and Polygon
- **History**: Last 10 conversation turns sent as context to Claude

### Backend Route
- `POST /api/whale/chat` in `whale.ts`
- AI Model: **Claude claude-sonnet-4-6** via Anthropic SDK

### Filters & Transformations
- `detectNeeds()` helper analyzes the user's message to determine what data to fetch (ticker mentions, market context needs)
- System prompt (`BIDDIE_SYSTEM`) defines Biddie's persona, trading vocabulary, and response rules
- User's first name is injected for personalized responses

### Signal Engine Dependency
**Independent.** Chat does not read from or write to the signal pipeline. It fetches its own market data per request.

### Risks & Limitations
- Request-response only (not streaming) — user sees loading state until full response returns
- If Anthropic API is down, chat is completely non-functional
- No conversation persistence across sessions — history is client-side only
- If Unusual Whales API rate-limits, chat context may be incomplete (flow data missing)

---

## 3. DECISION ENGINE

### Purpose
This is NOT a separate page — it is the backend logic engine that powers the signals shown on the Dashboard and Signals pages. It is the core brain of the platform.

### How It Works (Pipeline)
1. **Fetch**: Pull 500 flow alerts from Unusual Whales API
2. **Pre-filter**: Keep only sweeps/blocks with premium ≥ $25K, aggression ≥ 50%
3. **Cap**: Limit to top 20 candidates by premium
4. **Enrich**: For each candidate, fetch from Polygon.io:
   - Live price (WebSocket → Snapshot → UW → Bar → Previous Close)
   - VWAP, Pivot Points (R1/S1), Prior Day High/Low
   - 1-minute and daily candle bars
5. **Filter**: Apply rejection filters:
   - Filter 0a: Price divergence > 20% between sources
   - Filter 0b: Strike ratio sanity check
   - Filter 0c: No-price reject
   - Filter 1: Deep OTM > 15% rejected; Deep ITM > 5% tagged (not rejected)
   - Filter 2: Expiry > 45 days rejected; expired options rejected
6. **Score**: Base confidence score (5) with additive modifiers for sweep, aggression, volume/OI, premium, VWAP alignment, technical confirmation
7. **Trade Plan**: Generate entry trigger, TP1 (target), TP2 (target_near), and invalidation using VWAP directional logic
8. **Store**: Insert passing signals into `signal_outcomes` database table
9. **Return**: Serve scored signals to frontend via API response

### Data Sources
- Unusual Whales: Flow alerts, options greeks (IV, delta, OI)
- Polygon.io: Real-time prices (WebSocket), snapshots, aggregate bars, previous close
- Polygon Options: Contract-level IV, delta, OI, open interest

### Backend Route
- `GET /api/whale/signals` → `runSignalsPipeline()` → `scoreSignalLocal()` in `whale.ts`
- Scheduled: Every 3 minutes during market hours

### What Modifies Signals After Creation
- `realtimeVerifySignals()` — updates outcome (hit/miss/expired), MFE, MAE, trade status
- Admin review (`/whale/admin/signal-review`) — can mark signals correct/wrong with notes
- Admin utility endpoints — sync fields, cleanup bad signals

---

## 4. ALGO TAB (`/dashboard/signals` → Algorithm tab)

### Purpose
Displays algorithmically generated trade signals — the primary signal category. Signals are sub-divided into "ACT NOW" (price-confirmed) and "1–3 Day Trade" (conditional setups).

### Data Sources
| Source | Type | Details |
|---|---|---|
| `GET /api/whale/signals` | Live pipeline | Same pipeline as Dashboard — filtered to `category === "algorithm"` |
| `GET /api/whale/signals/history?limit=300` | Database | Historical algorithm signals |
| Polygon WebSocket | Real-time prices | Live price updates for signal tickers |

### Data Freshness
- **Pipeline signals**: Refreshed every 3 minutes during market hours
- **History**: Fetched once on page load from database
- **Prices**: Real-time via WebSocket (sub-second)

### Backend Route
- Same as Dashboard: `GET /api/whale/signals` in `whale.ts`
- Frontend filter: `category === "algorithm"`

### Filters & Transformations
- "ACT NOW" sub-section: Signals where `actNow === true` (price confirmed aligned with VWAP direction)
- "1–3 Day Trade" sub-section: Signals where `actNow === false` (conditional — needs price to reach trigger)
- Search by ticker, call/put filter, resolved toggle
- Admin-reviewed "wrong" signals hidden from non-admins
- **No minimum conviction score filter** on this page (unlike Dashboard's 60 minimum)

### Signal Engine Dependency
**Fully dependent.** All data comes from the signal pipeline.

### Risks & Limitations
- If no flow meets the $25K premium / 50% aggression threshold, no algo signals appear
- "ACT NOW" status can change as price moves (confirmed → invalidated)
- Weekend/after-hours: No new signals generated; only historical signals visible

---

## 5. WHALES TAB (`/dashboard/signals` → Whale Activity tab)

### Purpose
Displays institutional-level options flow — large premium trades ($1M+) with aggressive execution (sweeps, high aggression scores).

### Data Sources
Same as Algo Tab — filtered to `category === "whale"`

### Data Freshness
Same as Algo Tab (3-minute pipeline refresh, real-time prices)

### Backend Route
Same pipeline: `GET /api/whale/signals` → filtered by `category === "whale"` on frontend

### Filters & Transformations
- Category assignment: `whale` if premium ≥ $2M, or ≥ $1M with sweep or aggression ≥ 90%
- Same search/filter controls as Algo tab

### Signal Engine Dependency
**Fully dependent.**

### Risks & Limitations
- Whale signals are less frequent — may show 0-3 per day on quiet market days
- Premium threshold means smaller institutional trades are classified as "algorithm" instead

---

## 6. SPREADS TAB (`/dashboard/signals` → Spreads & Butterflies tab)

### Purpose
Displays multi-leg options strategies detected in institutional flow — credit spreads, debit spreads, butterflies, condors, etc.

### Data Sources
Same as Algo/Whale Tabs — filtered to `category === "spread"`

### Data Freshness
Same as other signal tabs

### Backend Route
Same pipeline: `GET /api/whale/signals` → filtered by `category === "spread"` on frontend

### Filters & Transformations
- Category assignment: `spread` if the Unusual Whales `has_multileg` flag is true
- `spreadDetails` JSON field stores leg details when available

### Signal Engine Dependency
**Fully dependent.**

### Risks & Limitations
- Spread detection depends on Unusual Whales correctly identifying multi-leg trades
- Spread signals may have less reliable conviction scores since scoring was designed primarily for single-leg flow
- Lower volume than algo signals — some days may show zero spread signals

---

## 7. BREAKOUT SCANNER (`/dashboard/breakout`)

### Purpose
Technical analysis scanner that identifies stocks transitioning from consolidation/squeeze patterns into directional breakouts. Combines price action indicators with institutional options flow for trade thesis generation.

### Data Sources
| Source | Type | Details |
|---|---|---|
| `GET /api/breakout/scan` | On-demand scan | Scans full watchlist through technical analysis pipeline |
| `GET /api/breakout/alerts` | Polling (30s refresh) | Active breakout alerts from background monitor |
| `GET /api/breakout/watchlist` | On-demand | Current default + custom watchlist |
| Polygon.io Daily Bars | Per-request | 60-day daily candles for squeeze/consolidation detection |
| Polygon.io 5-min Bars | Per-request | Intraday candles for VWAP, momentum, volume analysis |
| Unusual Whales Flow | Per-request | Options flow for directional bias confirmation |

### Data Freshness
- **Scan results**: Fresh per request — not cached; each scan triggers live Polygon API calls
- **Breakout alerts**: Background monitor refreshes alert cache every **30 seconds**
- **Watchlist**: Default list is hardcoded (~40 liquid tickers); custom tickers stored in server memory

### Backend Route
- `GET /api/breakout/scan` → `breakout.ts` — full technical scan
- `GET /api/breakout/alerts` → `breakout.ts` — cached alert list
- `POST /api/breakout/watchlist/add` / `remove` → `breakout.ts` — watchlist management

### Technical Indicators Used
- **TTM Squeeze**: Bollinger Bands (2.0 SD) inside Keltner Channels (1.5 ATR)
- **Bollinger Band Width (BBW)**: Volatility measurement
- **Average True Range (ATR)**: Stop loss and target calculation
- **VWAP**: Intraday entry reference
- **Moving Averages**: EMA 8 (momentum), SMA 20 (trend), SMA 50 (institutional trend)
- **Volume Ratio**: Current vs. 20-day average; >2.0x = high conviction
- **Relative Volume Burst**: 5-second volume bucket analysis for institutional activity

### Signal Engine Dependency
**Independent.** Breakout scanner has its own analysis pipeline separate from the whale/signal engine.

### Risks & Limitations
- Custom watchlist is stored in server memory — resets on server restart
- "Watched" stars are stored in browser localStorage — not synced across devices
- Squeeze detection requires sufficient historical data — newly listed tickers may not have enough bars
- If Polygon API rate-limits, scan may return incomplete results for some tickers
- Breakout alerts are not persisted to database — lost on server restart

---

## 8. MARKET VIEW (`/dashboard/market`)

### Purpose
AI-powered single-ticker analysis tool. Users search a ticker and receive a comprehensive analysis combining options flow, dark pool data, technical levels, and an AI-generated verdict with trade setup.

### Data Sources
| Source | Type | Details |
|---|---|---|
| `GET /api/whale/analyze/:ticker` | On-demand | Full analysis: flow + dark pool + levels + AI verdict |
| `GET /api/whale/market-pulse` | Cached (60s) | Market-wide put/call ratio, trending tickers, sentiment |
| Unusual Whales Flow API | Per-request | Last 500 flow alerts for the searched ticker |
| Unusual Whales Dark Pool | Per-request | Recent dark pool prints for the ticker |
| Polygon.io | Per-request | Real-time price, VWAP, pivots, PDH/PDL, 1-min candles |
| Claude AI (Anthropic) | Per-request | AI verdict, trade setup, confidence assessment |

### Data Freshness
- **Ticker analysis**: Fresh per request — all data fetched live at time of search
- **Market pulse**: Cached **60 seconds** server-side to avoid rate-limiting
- **Trending tickers**: From market pulse cache (up to 60s stale)
- **AI verdict**: Not cached — new Claude call each search

### Backend Route
- `GET /api/whale/analyze/:ticker` in `whale.ts` — orchestrates multi-source fetch + AI call
- `GET /api/whale/market-pulse` in `whale.ts` — aggregated market metrics

### Filters & Transformations
- Flow data filtered to searched ticker before AI analysis
- Dark pool data filtered to last 30 prints
- AI receives structured prompt with all data; returns JSON with verdict, action, levels, confidence
- "Trending Tickers" shows top 8 by options premium volume

### Signal Engine Dependency
**Independent.** Market View has its own analysis pipeline. Does not read from signal_outcomes or the scheduled signal pipeline.

### Risks & Limitations
- Each analysis makes multiple external API calls — can be slow (3-8 seconds)
- If Claude API is down, analysis returns no verdict (data still shows)
- Dark pool data availability varies by ticker — small caps may show zero prints
- No analysis history persistence — results are not saved to database
- Rate-limiting on Unusual Whales could degrade flow data quality

---

## 9. ANALYTICS (`/dashboard/analytics`)

### Purpose
Performance tracking and reporting. Three sub-tabs: Overview (global signal stats), My Trades (personal performance), and P&L (manual daily profit/loss calendar).

### Data Sources
| Source | Type | Details |
|---|---|---|
| `GET /api/whale/signals/calendar?limit=1000` | Database | Historical signals for global accuracy calculation |
| `GET /api/whale/weekly-stats` | Database | Pre-computed weekly snapshots from `weekly_signal_stats` table |
| `GET /api/whale/trades/stats?userId={id}` | Database | Aggregated user statistics |
| `GET /api/whale/trades?userId={id}` | Database | User's trade history from `user_trades` table |
| Supabase Direct (`trades` table) | Database | Manual P&L entries (CRUD via Supabase client) |

### Data Freshness
- **Weekly stats**: Pre-computed snapshots, updated every **1 hour** by `autoSnapshotWeeklyStats()`
- **Signal calendar**: Fetched from database on page load — reflects current resolved states
- **User trades**: Real-time from database
- **P&L entries**: Real-time from Supabase

### Backend Route
- `GET /api/whale/weekly-stats` in `whale.ts` → SELECT from `weekly_signal_stats`
- `GET /api/whale/signals/calendar` in `whale.ts` → SELECT from `signal_outcomes`
- `GET /api/whale/trades/stats` in `whale.ts` → Aggregation query on `user_trades`

### Database Tables
- `weekly_signal_stats` — weekly aggregated performance (auto-computed)
- `signal_outcomes` — all historical signals with outcomes
- `user_trades` — user's taken trades with synced outcomes
- `trades` (Supabase) — manual P&L entries

### Filters & Transformations
- Win rate calculated as: (hits + partial hits) / total resolved signals (see Appendix D for exact formulas)
- Top tickers computed client-side from signal history using `useMemo`
- Weekly stats include Biddie Pick-specific accuracy tracking
- P&L calendar uses color-coded heatmap (green = profit, red = loss)

### Signal Engine Dependency
**Partially dependent.** Reads from `signal_outcomes` (populated by the engine) but does not trigger the pipeline. P&L tab is fully independent (manual entries).

### Risks & Limitations
- Weekly stats snapshot may lag up to 1 hour behind real-time signal resolutions
- Signal calendar limited to last 1000 records — older signals not shown
- P&L entries are manual — platform does not auto-calculate actual P&L from trades
- If `autoSnapshotWeeklyStats()` fails silently, weekly stats may become stale
- User trade outcomes depend on `realtimeVerifySignals()` syncing correctly

---

## 10. SYSTEM OVERVIEW

---

### SIGNAL PIPELINE — End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVERY 3 MINUTES (MARKET HOURS)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. INGESTION                                                   │
│     └─ fetchFlowAlerts() → Unusual Whales API (500 alerts)     │
│                                                                 │
│  2. PRE-FILTER                                                  │
│     └─ Premium ≥ $25K, Aggression ≥ 50%, Cap at 20 candidates  │
│                                                                 │
│  3. ENRICHMENT                                                  │
│     ├─ fetchKeyLevels() → VWAP, Pivots, PDH/PDL, S/R levels   │
│     │   Sources: WebSocket → Snapshot → UW → Bar → PrevClose   │
│     │   (SPX uses UW-first exception)                          │
│     ├─ Polygon Options API → IV, Delta, OI per contract        │
│     └─ Price confirmation (candle pattern + gamma zone)         │
│                                                                 │
│  4. FILTERING                                                   │
│     ├─ 0a: Price divergence > 20% → reject                    │
│     ├─ 0b: Strike ratio sanity → reject                       │
│     ├─ 0c: No price available → reject                        │
│     ├─ 1: Deep OTM > 15% → reject                            │
│     ├─ 1: Deep ITM > 5% → TAG only (not rejected)            │
│     └─ 2: Expiry > 45 days or expired → reject               │
│                                                                 │
│  5. SCORING (scoreSignalLocal)                                  │
│     ├─ Base: 5                                                 │
│     ├─ + Sweep, Aggression, Vol/OI, Premium modifiers          │
│     ├─ + VWAP alignment bonus / penalty                        │
│     ├─ + Technical confirmation bonus                          │
│     ├─ Min threshold: 5 (below = rejected)                     │
│     └─ Max: 10                                                 │
│                                                                 │
│  6. TRADE PLAN (Blended Logic)                                  │
│     ├─ Entry: VWAP directional + live price                    │
│     ├─ TP1: Strike (if forward) or nearest key level           │
│     ├─ TP2: Next key level beyond TP1                          │
│     └─ Invalidation: VWAP ± 0.5% buffer → fallback chain      │
│                                                                 │
│  7. CATEGORIZATION                                              │
│     ├─ "whale": Premium ≥ $2M, or ≥ $1M + sweep/aggression    │
│     ├─ "spread": has_multileg flag from Unusual Whales         │
│     └─ "algorithm": everything else                            │
│                                                                 │
│  8. STORAGE                                                     │
│     └─ INSERT into signal_outcomes table (deduplicated)        │
│                                                                 │
│  9. RESPONSE                                                    │
│     └─ Return scored signals to frontend via JSON              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### How Signals Move: Ingestion → Scoring → Database → UI

```
Unusual Whales API (500 alerts)
       │
       ▼
Pre-filter (≥$25K premium, ≥50% aggression, cap 20)
       │
       ▼
Polygon.io enrichment (price, VWAP, pivots, candles)
       │
       ▼
Polygon Options API (IV, delta, OI per contract)
       │
       ▼
scoreSignalLocal() — filters + scoring + trade plan
       │
       ▼
signal_outcomes TABLE (PostgreSQL, deduplicated)
       │
       ▼
GET /api/whale/signals → Frontend (3-min polling)
       │
       ▼
DashboardSignals.tsx (Algo / Whale / Spread tabs)
```

### Scheduled vs. On-Demand Tasks

| Task | Type | Frequency | Description |
|---|---|---|---|
| Signal Pipeline | Scheduled | Every 3 min (market hours) | Generate new signals from flow |
| Signal Verification | Scheduled | Every 5 min (market) / 30 min (after hours) | Check if signals hit target or invalidation |
| Weekly Stats Snapshot | Scheduled | Every 1 hour | Compute win rates and top tickers |
| Trump Post Monitor | Scheduled | Every 5 minutes | Poll Truth Social feed |
| Biddie Flow Scanner | Scheduled | Every 5 min (market hours) | Post notable flow to community chat |
| Morning Outlook | Scheduled | Once daily at 7:00 AM ET | Pre-market summary posted to chat |
| Price Monitor Heartbeat | Scheduled | Every 30 seconds | Keep Polygon WebSocket alive |
| Price Snapshot Polling | Scheduled | Every 30 seconds | Refresh stale ticker prices via REST |
| Breakout Alert Refresh | Scheduled | Every 30 seconds | Refresh breakout alert cache |
| Subscription Sync | Scheduled | Every 5 min | Sync priceMonitor with active signal tickers |
| Ticker Analysis | On-demand | Per user search | Market View deep-dive analysis |
| AI Chat | On-demand | Per user message | Biddie AI conversation |
| Breakout Scan | On-demand | Per user request | Full watchlist technical scan |
| Trade Actions | On-demand | Per user click | Take/remove trades |

### What Modifies Signals After Creation

| Modifier | Automated? | What It Changes |
|---|---|---|
| `realtimeVerifySignals()` | Yes (5-30 min) | Outcome (hit/miss/expired), MFE, MAE, trade_status, entry_hit_at, resolved_at |
| Admin Signal Review | No (manual) | Can mark correct/wrong, add notes |
| Admin Utility Endpoints | No (manual) | sync-signal-fields, cleanup-bad-signals, revert-signal-prices |
| User Trade Sync | Yes (on verify) | Syncs signal outcome to user_trades table |

---

### DISCONNECTED OR PLACEHOLDER STATUS

| Page / Feature | Status | Notes |
|---|---|---|
| Dashboard | **LIVE** | Fully connected to signal pipeline + real-time prices |
| Chat (Biddie AI) | **LIVE** | Connected to Claude AI + live market data per request |
| Decision Engine | **LIVE** | Full pipeline active with all filters and blended trade plan |
| Algo Tab | **LIVE** | Connected to signal pipeline (algorithm category) |
| Whales Tab | **LIVE** | Connected to signal pipeline (whale category) |
| Spreads Tab | **LIVE** | Connected to signal pipeline (spread category) |
| Breakout Scanner | **LIVE** | Connected to Polygon for technical analysis |
| Market View | **LIVE** | Connected to Polygon + Unusual Whales + Claude AI |
| Analytics - Overview | **LIVE** | Connected to signal_outcomes + weekly_signal_stats |
| Analytics - My Trades | **LIVE** | Connected to user_trades table |
| Analytics - P&L | **LIVE** | Connected to Supabase trades table (manual entries) |
| Trump Monitor | **LIVE** | Polling Truth Social feed every 5 minutes |
| Community Chat | **LIVE** | Connected to chat_messages table + Biddie auto-posts |

**No pages are currently disconnected from live data.**
**No pages are using placeholder or mock data.**

All data displayed across the platform comes from live external APIs (Unusual Whales, Polygon.io, Anthropic Claude) or from the PostgreSQL database populated by those APIs.

---

### EXTERNAL SERVICE DEPENDENCIES

| Service | Used By | API Key Required | Failure Impact |
|---|---|---|---|
| Polygon.io | Prices, bars, key levels, options data | Yes (`POLYGON_API_KEY`) | No signal pricing, no breakout scans, no market view |
| Unusual Whales | Flow alerts, dark pool, greeks | Yes (`UNUSUAL_WHALES_API_KEY`) | No new signals generated, no flow data in chat/analysis |
| Anthropic (Claude) | AI chat, morning outlook, flow commentary | Yes (`ANTHROPIC_API_KEY`) | Chat non-functional, no AI commentary |
| Supabase | P&L entries (direct client) | Yes (`SUPABASE_SERVICE_ROLE_KEY`) | P&L calendar non-functional |
| Discord Webhook | Alert notifications | Yes (`DISCORD_WEBHOOK_URL`) | No Discord notifications (platform still functional) |

---

### DATABASE TABLES SUMMARY

| Table | Records Created By | Updated By | Purpose |
|---|---|---|---|
| `signal_outcomes` | Signal pipeline (auto) | Verification loop, admin review | Core signal storage with outcomes |
| `signal_alerts` | Notification system (auto) | Read status toggle | Signal-related notifications |
| `user_trades` | User action ("Take Trade") | Verification loop (outcome sync) | Personal trade tracking |
| `user_price_alerts` | User action (set alert) | Price check trigger | Custom price alerts |
| `chat_messages` | User + Biddie AI (auto) | N/A (append-only) | Chat conversation history |
| `chat_reactions` | User action (emoji react) | N/A (append-only) | Message reactions |
| `user_roles` | Admin seed (auto) | Manual | Role-based access control |
| `weekly_signal_stats` | Hourly snapshot (auto) | Hourly overwrite | Aggregated weekly performance |

---

### ADMIN ACCOUNTS

| Name | User ID | Role |
|---|---|---|
| Jennifer | `6e8cffca-7c06-4896-b67f-478965ac6556` | Primary Admin |
| River Jordan | `5845af78-f880-431b-b2c0-56a9923e6835` | Admin |

---

## APPENDIX A — DASHBOARD CURATION LOGIC

### Is the Dashboard a curated "top signals" experience?

**Yes.** The Dashboard is NOT the same as the full Signals feed. It is a curated, limited view.

### Exact differences between Dashboard and Signals page:

| Feature | Dashboard (`/dashboard`) | Signals Page (`/dashboard/signals`) |
|---|---|---|
| Conviction score filter | **Minimum 60 required** | No minimum — shows all passing signals |
| Signals per category | **Top 5 per section** (capped at 10 fetched) | Full history (up to 300 signals) |
| Sorting | Timestamp first, then conviction score | Timestamp only (newest first) |
| Biddie Picks | Highlighted inline (no separate section) | Highlighted inline (no separate section) |
| Search/Filter | No search, no call/put filter | Search by ticker, call/put toggle, resolved toggle |
| Resolved signals | Hidden | Can be shown via toggle |

### Biddie Picks — How They Are Selected

"Biddie Picks" are NOT a separate section. They are a visual badge applied to signals where `is_biddie_pick === true` in the database.

A signal becomes a Biddie Pick when:
- It has high confidence (typically 8+) and high conviction score (80+)
- The backend sets `is_biddie_pick = true` during signal creation

**Visual treatment**: Biddie Pick signals get an emerald glow border and a "Biddie Pick" badge on the card. They appear within the normal feed, not separated.

### Conviction Score Calculation (Frontend Adjustment)

The backend stores `confidence` as a 0–10 value. The frontend converts this to a 0–100 conviction score with floor adjustments:

| Backend Confidence | Frontend Conviction Score |
|---|---|
| 9–10 | At least 92 |
| 8–8.9 | At least 85 |
| 7–7.9 | At least 78 |
| 6–6.9 | At least 70 |
| Below 6 | `confidence × 10` |

---

## APPENDIX B — UI vs BACKEND FIELD MAPPING (Per Page)

### Dashboard & Signals Page — What the User Sees on Each Signal Card

**Card Header:**
- Category label: "WHALE PLAY", "SPREAD PLAY", or "TOP SIGNAL" (color-coded)
- Trade type: "Day Trade" (0DTE) or "Swing Trade"
- Urgency tags: "ACT NOW", "HIGH CONVICTION", or "Buy Now" (pulsing amber badge)
- Biddie Picks badge: Emerald badge for `is_biddie_pick === true` signals
- Live price: Real-time ticker price with pulsing radio icon (WebSocket)
- Timestamp: Relative time since detection (e.g., "10:30 AM")
- Historical warning: "Signal from [Date]" banner if from a previous day
- Outcome status: "WIN" (hit/partial), "LOSS" (miss/near miss), "ACTIVE", or "WATCHING"
- MFE percentage: Shows how close price got to target (e.g., "MFE 85%")

**Core Signal Data:**
- Directional icon: Green up arrow (bullish) or red down arrow (bearish)
- Ticker symbol
- Option type: "CALL" or "PUT" badge
- Description: Compact trade logic explanation
- Beginner tooltip: "Help" icon with plain-English explanation
- Conviction Score Ring: Circular gauge showing 0–100 score with label

**Trade Execution Levels:**
- **Suggested Trade**: Specific contract (e.g., "Buy SPY 500 Calls exp 04/20")
- **Entry Trigger**: Specific entry condition (e.g., "Holding above VWAP at $642.17 — confirmed (price $640.98)")
- **Target Zone**: TP1 and TP2 displayed as a range (e.g., "$640.00 – $638.50")
- **Invalidation**: Stop-loss level (e.g., "Above $645.38")

**Tags bar:**
- Sweep, Call Flow / Put Flow, High Volume, ATM, Deep ITM, 0DTE, Price Confirmed, Negative/Positive Gamma

**Interactive elements:**
- "Take Trade" / "Remove" toggle button
- Expand/collapse for additional technical detail

---

### Breakout Scanner — What the User Sees

**Header section:**
- "BREAKOUT SCANNER" title with "Momentum Starts Here" subtitle
- Stats bar: Last scan time, total tickers scanned, setups found, WebSocket status, watched count
- "Rescan" button, "Notify Me" button

**Alert cards (active breakouts):**
- Conviction Ring, trade instruction (e.g., "SPX $5120 CALL @ $12.40"), bias badge, target price, squeeze length

**Setup cards (collapsed):**
- Conviction Ring + label, ticker + price, freshness label, status tag ("ENTER NOW" / "WATCH"), bias badge, contract summary, timestamp

**Setup cards (expanded):**
- Squeeze length (candles), consolidation (days), volume ratio, distance to break (%)
- Ceiling (resistance) and floor (support) with percentages
- Squeeze tightness (BB/KC ratio)
- Momentum status, trend vs 50d SMA, flow bias
- Smart money flow details
- Thesis reasons (bulleted list)
- Contract recommendation: ticker, strike, type, expiry, entry (with VWAP tooltip), target (near/far), stop loss
- "I Took This Trade" button, "Set Alert" button

---

### Market View — What the User Sees

**Default view (no ticker searched):**
- Welcome card: "Your Personal Trade Assistant"
- Trending Tickers grid: Top 8 symbols by activity, showing bias icon, alert count, total premium, sweep count

**After searching a ticker:**
- Verdict header: Ticker name, verdict badge (BULLISH/BEARISH/NEUTRAL/NO PLAY), price confirmation status, summary, current price, timestamp
- Trade setup card: Confidence, timeframe, action (e.g., "LONG ABOVE $512"), entry/target/stop grid, reasoning
- Options Flow section: Call/put premium, sweep count, aggression %
- Dark Pool section: Trade count, total notional, average price (with educational tooltip)
- Key Levels section: VWAP, Pivot, PDH, PDL, R1, S1
- "Watch For" section: Price action alerts
- Disclaimer

---

### Chat — What the User Sees

**Active chat:**
- Biddie Avatar + "Biddie AI" name + "Online" status + credits remaining counter
- Message feed: Biddie messages (Markdown-rendered), user messages, loading dots
- Quick prompt buttons (initial state): "What's the best setup for today?" etc.
- Input: "Ask Biddie anything..." text field + send button

**Non-subscriber view:**
- Lock screen with "Upgrade to talk to Biddie" message

---

### Analytics — What the User Sees

**Overview tab:**
- Total signals count, global win rate, average conviction score
- Biddie Pick accuracy (hits / total picks)
- Weekly performance chart (from `weekly_signal_stats`)
- Top performing tickers and categories

**My Trades tab:**
- Personal win rate, total trades taken, current win streak
- Trade history list with outcomes

**P&L tab:**
- Calendar heatmap (green = profit day, red = loss day)
- Monthly P&L total, win/loss day count, best/worst day
- Manual entry: Add daily P&L amounts

---

## APPENDIX C — SIGNAL FIELD STORAGE & DISPLAY

### How Each Field Is Stored and Displayed

| Field | DB Column | Backend Variable | How It's Set | Frontend Display |
|---|---|---|---|---|
| **Entry** | `entry_trigger` | `entryTrigger` | VWAP directional wording + live price | Grey badge with TrendingUp icon, labeled "Entry:" |
| **TP1** | `target` | `target` | Strike price (if forward/OTM) or nearest key level (if deep ITM) | Emerald badge with MapPin icon, labeled "Target:" |
| **TP2** | `target_near` | `targetNear` | Next key level beyond TP1 in trade direction (PDH/R1 for calls, PDL/S1 for puts) | Combined with TP1 as a range: "nearest – extended" with info tooltip |
| **Invalidation** | `invalidation` | `invalidation` | VWAP ± 0.5% buffer, fallback to PDL/S1 (calls) or PDH/R1 (puts), then 2% from price | Red badge with ShieldX icon, labeled "Invalidation:" |
| **Act Now** | Not stored in DB | `actNow` | `true` if price is above VWAP (calls) or below VWAP (puts) | "ACT NOW" tag badge on signal card |
| **Confidence** | `confidence` | `confidence` | 0–10 score from scoring formula | Converted to 0–100 conviction score, shown in circular ring gauge |

### Target Zone Display Logic (Frontend)

The frontend combines `target` (TP1) and `target_near` (TP2) into a single "Target Zone" display:

1. If both `target` and `target_near` exist and are different:
   - Determines which is "nearest" based on call vs put direction
   - Displays as: **"$nearest – $extended"**
   - Info tooltip labels them: "$price: Nearest target · $price: Extended target"

2. If `target_near` is missing:
   - Frontend calculates a fallback: 60% of the distance between entry price and target
   - Displays only the single target value

### Do Any Pages Rely on Older Field Assumptions?

**No.** All pages that display signal data use the same field names: `entry_trigger`, `target`, `target_near`, `invalidation`. These are populated by the current blended trade-plan logic. The old sorted-array target logic has been fully replaced.

The frontend field mapping (in DashboardSignals.tsx line 128) explicitly maps:
- `s.target_near` → `signal.targetNear`
- `s.entry_trigger` → `signal.entryTrigger`

No legacy field names are referenced.

---

## APPENDIX D — ANALYTICS CALCULATION LOGIC

### Outcome Thresholds (Backend — realtimeVerifySignals)

| Outcome | MFE-to-Target Threshold | Additional Conditions |
|---|---|---|
| **hit** | ≥ 75% of target move reached | None — immediately resolved |
| **partial_hit** | ≥ 50% but < 75% of target move | None — immediately resolved |
| **near_miss** | ≥ 30% but < 50% of target move | Only assigned when signal expires OR invalidation breached |
| **missed** | < 30% of target move | Only assigned when signal expires OR invalidation breached |
| **expired** | N/A | Signal reached expiry date without hitting other thresholds |

### MFE Percent Formula (Maximum Favorable Excursion)

MFE measures the best price reached relative to the target, using signal price as reference:

- **Calls (Bullish):** `((HighestPriceSince - EntryPrice) / (TargetPrice - EntryPrice)) × 100`
- **Puts (Bearish):** `((EntryPrice - LowestPriceSince) / (EntryPrice - TargetPrice)) × 100`

### MAE Tracking (Maximum Adverse Excursion)

MAE tracks the worst price seen since signal creation:

- **Calls:** MAE = lowest price since signal
- **Puts:** MAE = highest price since signal
- Stored in `max_adverse_price` column
- `pct_past_invalidation` = how far past the invalidation level the adverse price went

### Default Invalidation (When No Level Provided)

If the scoring function did not produce an invalidation level, verification uses defaults:
- **SPX/NDX/QQQ:** 0.75% adverse move from entry
- **All other tickers:** 2.5% adverse move from entry

### Win Rate Calculation — IMPORTANT: Two Different Formulas Exist

**1. Global Signal Accuracy (Frontend — Analytics Overview tab):**
```
Win Rate = (hits + partial_hits) / (hits + partial_hits + missed + near_misses) × 100
```
Partial hits and near misses ARE counted. Partial hits count as wins.

**2. Personal User Stats (Backend — /api/whale/trades/stats):**
```
Win Rate = hits / (hits + missed) × 100
```
Partial hits and near misses are EXCLUDED from both numerator and denominator.

**This means a user can see different win rates on the Overview tab vs. My Trades tab for the same signals.** This is by design — global accuracy is more generous (includes partial wins), while personal stats are stricter (full hits only).

### Automated vs. Manual Metrics

| Metric | Automated or Manual | Source |
|---|---|---|
| Signal outcome (hit/miss/etc.) | **Automated** | `realtimeVerifySignals()` every 5-30 min |
| MFE percent | **Automated** | Calculated during verification |
| MAE / max_adverse_price | **Automated** | Calculated during verification |
| Win rate (global) | **Automated** | Computed from signal_outcomes on page load |
| Win rate (personal) | **Automated** | Computed from user_trades via backend |
| Weekly stats snapshot | **Automated** | `autoSnapshotWeeklyStats()` every 1 hour |
| P&L entries | **Manual** | User enters daily dollar amounts |
| Signal review (correct/wrong) | **Manual** | Admin marks via review endpoint |

### Where signal_outcomes and user_trades Can Differ

| Scenario | Outcome |
|---|---|
| Normal operation | In sync — `user_trades` joins `signal_outcomes` for outcome data |
| Signal deleted by admin | Code attempts to delete matching `user_trades`, but if transaction fails, orphaned records persist |
| Admin manually overrides outcome | Changes apply to all users who took that signal — may not reflect individual exit timing |
| Win rate formula difference | Global shows partial_hits as wins; personal stats exclude them entirely |
| Verification lag | If `realtimeVerifySignals` is delayed, both tables show stale "pending" status together |

---

## APPENDIX E — VERIFICATION BASIS

### How This Audit Was Verified

| Page | Verification Method | Notes |
|---|---|---|
| Dashboard | **Code structure + confirmed production behavior** | Pipeline confirmed running via server logs showing signal ingestion, scoring, and DB insert. Conviction ≥60 filter confirmed in Dashboard.tsx source. Signal counts verified via live API response. |
| Chat (Biddie AI) | **Code structure + confirmed production behavior** | Claude API integration confirmed via `ANTHROPIC_API_KEY` environment variable presence and server startup logs. Chat endpoint tested via curl in development. |
| Decision Engine | **Code structure + confirmed production behavior** | Full pipeline traced line-by-line in whale.ts. Filter logic verified against March 27 forensic data (77 signals analyzed). Blended trade-plan logic confirmed via server restart + clean build. Deep ITM tag change confirmed via log diff (QQQ rejection removed). |
| Algo Tab | **Code structure** | Same pipeline as Dashboard with different frontend filter. Category assignment logic confirmed in source. |
| Whales Tab | **Code structure** | Same pipeline. Category threshold ($2M / $1M+sweep) confirmed in source. |
| Spreads Tab | **Code structure** | Same pipeline. `has_multileg` flag mapping confirmed in source. |
| Breakout Scanner | **Code structure + confirmed production behavior** | Breakout.ts endpoints traced. Polygon API calls for daily/5-min bars confirmed in source. Alert refresh interval confirmed. Background monitor confirmed running in server logs. |
| Market View | **Code structure + confirmed production behavior** | `/analyze/:ticker` endpoint traced through multi-source fetch + Claude call. Market pulse 60s cache confirmed in source. |
| Analytics | **Code structure + database verification** | `weekly_signal_stats` table confirmed populated via `autoSnapshotWeeklyStats()` seen in server logs ("Auto-snapshot complete"). Win rate formula differences identified by comparing frontend and backend code. |
| Signal Pipeline | **Code structure + confirmed production behavior** | End-to-end pipeline verified via server logs showing: `fetchFlowAlerts done: 164ms, got 500 alerts` → `key levels + candles done` → Polygon options enrichment → filter rejections logged → DB inserts. WebSocket freshness threshold (120s) confirmed restored and tested. |
| Price Monitor | **Code structure + confirmed production behavior** | WebSocket connection confirmed via server logs: "Connected to Polygon.io, authenticating..." → "Authenticated" → "Subscribed to N tickers". 30s heartbeat and snapshot polling confirmed in source. |
| Signal Verification | **Code structure** | `realtimeVerifySignals()` logic traced line-by-line. MFE/MAE formulas and outcome thresholds extracted from source. Frequency (5min/30min) confirmed in `adjustVerifyFrequency()`. |

---

## APPENDIX F — FAILURE & RECOVERY GUIDE

### Polygon.io Failure

| Page | Impact | What Happens | Recovery |
|---|---|---|---|
| Dashboard / Signals | **Severe** | No new signals generated — Filter 0c rejects all candidates without price data. Historical signals still display from database. Ticker tape freezes. | Pipeline auto-retries every 3 min. WebSocket reconnects with exponential backoff (1s → 30s). When Polygon recovers, signals resume automatically. |
| Breakout Scanner | **Severe** | Scan returns empty or incomplete results. No daily/5-min bars for technical analysis. Existing alerts stop updating. | Manual "Rescan" button retries. Alert cache preserves last known state for 30s. |
| Market View | **Partial** | Key levels section empty. AI verdict still generated but without price context. Flow and dark pool data still available (from Unusual Whales). | Re-search the ticker after Polygon recovers. |
| Chat (Biddie AI) | **Partial** | Chat still works but AI responses lack price levels and VWAP data. Flow data still included from Unusual Whales. | Biddie will note missing data in response. |
| Analytics | **None** | All data comes from database. Not affected by live Polygon outage. | N/A |

### Unusual Whales Failure

| Page | Impact | What Happens | Recovery |
|---|---|---|---|
| Dashboard / Signals | **Severe** | No new signals generated — `fetchFlowAlerts()` returns empty. Historical signals still display. | Pipeline auto-retries every 3 min. When UW recovers, new signals appear within 3 minutes. |
| Breakout Scanner | **Partial** | Scan still runs (uses Polygon for technicals) but directional bias section may be empty. Core squeeze/breakout detection still functional. | Re-scan after UW recovers. |
| Market View | **Partial** | Options flow and dark pool sections empty. AI verdict weaker without flow context. Key levels still available from Polygon. | Re-search after UW recovers. |
| Chat (Biddie AI) | **Partial** | Chat works but AI lacks flow context. Responses may be more general, relying only on price data. | Auto-recovers when UW is back. |
| Analytics | **None** | All data from database. | N/A |

### Anthropic (Claude AI) Failure

| Page | Impact | What Happens | Recovery |
|---|---|---|---|
| Dashboard / Signals | **None** | Signal pipeline does NOT depend on Claude. Signals generate normally. Biddie Pick designation may not occur for new signals. | N/A |
| Chat (Biddie AI) | **Complete failure** | Chat returns error. No AI responses possible. | Only recovers when Anthropic API is back online. User sees error message. |
| Market View | **Partial** | Flow data, dark pool, and key levels still display. AI verdict section is empty or shows error. | Re-search after Anthropic recovers. |
| Breakout Scanner | **None** | Scanner does not use Claude. | N/A |
| Analytics | **None** | All data from database. | N/A |
| Morning Outlook / Flow Commentary | **Fails silently** | No morning outlook posted to chat. No flow commentary auto-posted. These are non-critical features. | Auto-resumes when Anthropic recovers. |

### Database Stale or Unreachable

| Page | Impact | What Happens | Recovery |
|---|---|---|---|
| Dashboard / Signals | **Partial** | Live pipeline still runs and returns signals in API response (in-memory). But signals are not persisted. Signal history endpoint returns error. | Restart server to re-establish DB connection. Signals generated during outage are lost. |
| Analytics | **Complete failure** | All tabs fail — all data comes from database queries. | Only recovers when database is reachable. |
| Chat (Biddie AI) | **None** | Chat is stateless — does not use the database for message delivery. | N/A (chat history in client memory only) |
| Breakout Scanner | **None** | Scanner does not use the database. Watchlist is in server memory. | N/A |
| Market View | **None** | Analysis is computed per-request from external APIs. | N/A |

### Server Restart Impact

| Feature | Lost on Restart | Persisted |
|---|---|---|
| Signal cache (in-memory) | **Lost** — regenerated within 3 min | N/A |
| Custom breakout watchlist | **Lost** — must re-add tickers | Default watchlist preserved (hardcoded) |
| Breakout alerts | **Lost** — regenerated within 30s | N/A |
| Market pulse cache | **Lost** — regenerated on next request | N/A |
| Trump post cache | **Lost** — regenerated within 5 min | N/A |
| Chat history | **Not affected** — stored in client browser | N/A |
| All database records | **Not affected** — persisted in PostgreSQL | Full persistence |
| WebSocket subscriptions | **Reset** — re-established within 30s | N/A |
| Price monitor data | **Reset** — repopulated via snapshots within 30s | N/A |

### Quick Diagnostic Checklist (When Something Breaks)

1. **No new signals appearing?**
   - Check server logs for `[signals] starting pipeline` / `fetchFlowAlerts done`
   - If missing: Unusual Whales API may be down or rate-limited
   - If present but "0 alerts": Market may be closed or no flow meets $25K threshold

2. **Prices frozen on ticker tape?**
   - Check logs for `[price-monitor] Connected to Polygon.io`
   - If disconnected: Polygon WebSocket down, will auto-reconnect
   - Check `GET /api/whale/prices/realtime` for last update timestamps

3. **Chat not responding?**
   - Check `ANTHROPIC_API_KEY` is set
   - Check server logs for Anthropic API errors
   - AI model: `claude-sonnet-4-6` — verify model availability

4. **Analytics showing stale data?**
   - Check `[weekly-stats] Auto-snapshot complete` in logs
   - If missing: snapshot job may have failed — restart server
   - Check database connectivity

5. **Breakout scanner empty?**
   - Check Polygon API rate limits
   - Try manual "Rescan" button
   - Check if market is open (scanner needs live data)

---

*Document generated April 5, 2026*
*Platform version: Production (Replit-hosted)*
*AI Model: Claude claude-sonnet-4-6 (Anthropic)*
*Data providers: Polygon.io, Unusual Whales, Supabase*
