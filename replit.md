# Replit Project Summary

## Overview

This project is a pnpm workspace monorepo built with TypeScript, focusing on financial market analysis and trading tools. It includes an Express API server, a React-based web application for trading signals and analytics, and a Python CLI for AI-driven market data analysis. The primary goal is to provide users with advanced tools for options flow analysis, dark pool data, signal generation, and performance tracking, leveraging AI for deeper insights.

The project aims to empower traders with real-time market intelligence, AI-generated trade recommendations, and a comprehensive platform to track and analyze their trading performance.

## User Preferences

- I prefer simple language.
- I like iterative development.
- Ask before making major changes.
- I want detailed explanations.
- Do not make changes to the folder `Z`.
- Do not make changes to the file `Y`.

## System Architecture

The project is structured as a pnpm monorepo using TypeScript (v5.9) and Node.js (v24). Each package is a composite TypeScript project, ensuring proper type-checking across the monorepo.

**Core Technologies:**
- **Monorepo Tool:** pnpm workspaces
- **API Framework:** Express 5
- **Database:** PostgreSQL (Replit managed) with Drizzle ORM and `pg` Pool
- **Validation:** Zod (`zod/v4`) with `drizzle-zod`
- **API Codegen:** Orval (from OpenAPI spec)
- **Build Tool:** esbuild (for CJS bundles)

**Monorepo Structure:**
- `artifacts/`: Contains deployable applications like `api-server` and `biddie-web`.
- `lib/`: Houses shared libraries such as `api-spec`, `api-client-react`, `api-zod`, and `db`.
- `scripts/`: Holds utility scripts for various tasks.

**API Server (`@workspace/api-server`):**
- An Express 5 server handling API requests.
- Uses `@workspace/api-zod` for request/response validation and `@workspace/db` for persistence.
- Routes are organized under `src/routes/`.

**Database Layer (`@workspace/db`):**
- Manages PostgreSQL interactions using Drizzle ORM.
- Defines database schema models and provides a Drizzle client instance.
- Utilizes `drizzle-kit` for migrations.

**Frontend (`@workspace/biddie-web`):**
- A React application built with Vite, Tailwind CSS 3, Framer Motion, and shadcn/ui.
- Features include:
    - User authentication via Supabase (email/password, Google/Apple OAuth).
    - Dashboard with tabs for Chat, Decision Engine (signals), Market, P&L, Analytics, Breakout Scanner, Trump Feed, Community, and Settings.
    - Displays various signal categories (Algorithm Plays, Whale Plays, Spreads & Butterflies, SPX/GEX) with real-time data.
    - SPX/GEX tab: Dedicated S&P 500 index tab with real-time Gamma Exposure data (gamma flip, call wall, put wall, key magnet, dealer positioning) from Unusual Whales spot-exposures API. SPX signals are enriched with GEX proximity context.
    - Performance tracking for signals and user trades.
    - AI-powered ticker analysis, integrating options flow, dark pool, and key levels.
    - Breakout scanner with Bollinger Band/Keltner Channel squeeze detection and real-time alerts.
    - Analytics dashboard for overall AI signal performance and personal trading stats.
- **UI/UX:** Dark trading theme with `--background: 230 25% 5%`, `--primary: 230 85% 60%`, and Inter + Orbitron fonts.

**Utility Scripts (`@workspace/scripts`):**
- A package for various standalone TypeScript scripts, capable of importing other workspace packages.

**Python Tools (`whale_claude.py`):**
- A CLI tool for fetching live market data from Unusual Whales and performing AI analysis using Anthropic's Claude.
- Supports commands for options flow, market data, dark pool analysis, and full stock deep-dives.

## External Dependencies

- **Database:** PostgreSQL (Replit managed)
- **AI Integrations:**
    - Anthropic (for Claude AI via `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`)
- **Market Data:**
    - Unusual Whales API (`UNUSUAL_WHALES_API_KEY`)
    - Yahoo Finance (for historical OHLC data)
    - Polygon.io (`POLYGON_API_KEY`) — real-time WebSocket (trades + quotes) and snapshot polling for live prices, bid/ask, and pre-market data. Replaces Finnhub entirely.
- **Authentication:** Supabase (for `biddie-web` via `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)
- **Python Libraries:** `anthropic`, `requests`, `rich`
- **TypeScript Libraries:** `express`, `pg`, `drizzle-orm`, `zod`, `drizzle-zod`, `@tanstack/react-query`

## Breakout Scanner Features

- **Breakout Scanner** (`/dashboard/breakout`): BB/KC squeeze detection + consolidation patterns across 40 tickers
- **Auto Breakout Alerts**: Real-time WebSocket price monitoring with volume confirmation. Alerts only fire when: (1) price breaks resistance/support, (2) session volume >= 1.5x 20-day avg (time-adjusted), (3) burst volume >= 3x the prior 10-min average (measured in 5-second buckets over last 60s). Tagged "INSTITUTIONAL" when both gates pass. 15-min cooldown, 4-hour TTL, max 50 alerts
- **Breakout Imminence Predictor**: `imminenceScore` (0-100) with labels: "BREAKOUT ACTIVE", "BREAKOUT IMMINENT" (>=80), "LIKELY WITHIN 15 MIN" (>=60), "LIKELY WITHIN 1 HOUR" (>=45), "BUILDING PRESSURE" (>=30). Based on proximity to breakout level, squeeze pressure, volume momentum, consolidation tightness
- **0DTE Contract Recommendations**: Each breakout setup includes a smart contract recommendation. Strike selection uses ATR-based offset (ITM for active breakouts, ATM for imminent, slight ITM for building). Expiry logic: 0DTE for SPY/QQQ/IWM (daily) and AAPL/MSFT/AMZN/META/NVDA/TSLA/GOOGL/AMD/NFLX etc. (M/W/F), 1DTE on off-days, Weekly for other tickers. Shows entry, target, stop levels and rationale. Displayed in compact card and expanded detail view
- **Direction Stability Lock**: Prevents thesis direction from flip-flopping between CALL/PUT on each rescan. Uses in-memory direction lock per ticker with 15-min TTL. Lock threshold=20 (min score to establish direction). Momentum-aware flipping: if EMA/SMA momentum contradicts the locked direction, the lock flips immediately when opposing score >=20. Also breaks after 3 consecutive disagreeing scans. Confirmed breakouts always override the lock. Neutral tickers (score too weak) show no contract rec
- **Target Prices**: resistance/support + 1 ATR. Displayed on setup cards, expanded detail, and alert cards
- **Score Breakdown (Normalized 0-100)**: Raw components (squeeze 25-40, near-squeeze 15, consolidation 10-25, volume 10-20, breakout 30, tight range 10) normalized via `rawScore/125*100`. Scores are now on the same 0-100 scale as Decision Engine conviction scores
- **Custom Ticker Watchlist**: Users can add up to 30 custom tickers (e.g. HOOD, RIVN) beyond the 40 default. Custom tickers appear as removable tags, are included in scans, and persist in server memory
- **Endpoints**: `GET /api/breakout/scan` (5-min cache), `GET /api/breakout/scan/:ticker`, `GET /api/breakout/alerts`, `GET /api/breakout/watchlist`, `POST /api/breakout/watchlist/add`, `POST /api/breakout/watchlist/remove`
- **Polygon.io Live Price Injection**: Signal pipeline checks Polygon real-time prices first (if < 2min stale), then Unusual Whales price, then Yahoo Finance as final fallback. Signal candidate tickers are temporarily subscribed to Polygon WebSocket before evaluation. Polygon snapshot polling fallback (every 30s) when WebSocket is silent. WebSocket uses `wss://socket.polygon.io/stocks` with `T.TICKER` (trades) + `Q.TICKER` (quotes) subscriptions
- **Pre-Market Data**: `fetchPremarketSnapshot()` uses Polygon.io snapshot API (`/v2/snapshot/locale/us/markets/stocks/tickers`) with bid/ask/dayVolume for 18 key tickers. `GET /api/whale/premarket` returns live pre-market prices, gap %, bid/ask, and biggest movers (2-min cache). Morning outlook runs at 7:00 AM ET with enriched pre-market context including gap summary and hot flow tickers
- **BASE_TICKERS**: GLD, QQQ, SPY, IWM (always monitored via Polygon WebSocket)

## Signal Performance Tracking

- **Performance Calendar** (`PerformanceCalendar.tsx`): Color-coded calendar heatmap showing daily win rates. Compact version on Dashboard and Breakout pages, full version on Signals page. Click any day to see all signals from that session with hit/miss/pending status.
- **Dedicated Calendar API** (`GET /api/whale/signals/calendar`): Returns all signals (no dedup) with outcome stats for accurate daily performance tracking.
- **Five-Tier Outcome System**: HIT (target reached), PARTIAL HIT (expired with significant favorable move — 50%+ to target or 1%+ price move), PENDING (still active), EXPIRED (time ran out, minimal move), MISSED (invalidation actually breached). Methodology panel on Admin tab explains all 5 with color-coded cards.
- **Success Rate Formula**: (Hits + Partial Hits) / (Hits + Partial Hits + Misses + Expired). Pending signals excluded. CALL/PUT and category stats use the same unified formula.
- **Signal Verification**: Auto-verifies every 5 min during market hours, 30 min after hours. 2-hour minimum hold before miss. Hits checked first. Uses current price for invalidation (not intraday extremes).
- **Trade Status Lifecycle**: Each signal has a `trade_status` column: `watching` (default) → `active` (entry price reached) → `hit`/`miss`/`expired` (resolved). New signals with "⚡ Act Now" tag start as `active`. Frontend badges: WATCHING (yellow Clock), ACTIVE (cyan pulsing Zap), HIT (green CheckCircle2), MISS/EXPIRED (red XCircle). Status transitions happen in `realtimeVerifySignals()` auto-verify loop. Schema columns: `trade_status`, `status_updated_at`, `entry_hit_at`.
- **Admin Signal Insights** (`AdminSignalInsights.tsx`): On the Admin tab — shows overall win rate, CALL/PUT split, per-source stats, ticker performance grid with hit/miss bars, pattern analysis (auto-detects weak/strong tickers, directional bias, underperforming sources), and full signal log with status filters.

## Market Pulse & Trending Tickers

- **Market Pulse** (`MarketPulse.tsx`): Dashboard section showing real-time market overview — SPY/QQQ/IWM prices with change %, VIXY volatility level with educational tooltips, and put/call ratio sentiment indicator
- **Educational Tooltips**: Tap any metric (VIX, Put/Call) to see a plain-English explanation of what it means and what the current level implies for trading. Designed for beginners
- **Volatility Levels**: VIXY-based. Low (<$25), Normal ($25-35), Elevated ($35-45), High ($45-55), Extreme (>$55)
- **Sentiment**: Derived from live options flow put/call premium ratio. Very Bullish (<0.5), Bullish (0.5-0.8), Neutral (0.8-1.2), Bearish (1.2-1.8), Very Bearish (>1.8). Shows "Unavailable" when insufficient flow data
- **Trending Tickers**: Collapsible section showing top 8 tickers by options premium with bias indicator (bullish/bearish/mixed), alert count, sweep count, and total premium
- **Baseline Subscriptions**: SPY, QQQ, IWM, VIXY always tracked via Polygon WebSocket even when no pending signals
- **Endpoint**: `GET /api/whale/market-pulse` (60s cache)

## Referral System

- **Database Tables**: `user_settings` (referral_code UNIQUE, referred_by), `referrals` (referrer_id, referred_id UNIQUE, referred_name, created_at)
- **Referral Code Generation**: Auto-generated on first settings fetch, based on user's first name + random suffix. Uniqueness checked before assignment with retry logic
- **Signup Flow**: `?ref=CODE` param on signup page shows referral banner (10% off first paid month). Code applied on signup via `/api/whale/referral/apply`
- **Tier System**: 1 referral = 50% off next month; Bronze (3) = 1 free month + badge; Silver (5) = 1 free month + 20% off for life + early access; Gold (10) = Pro upgrade or 50% off Pro for life + priority AI + exclusive signals
- **Settings Dashboard**: Profile & Membership section (name, email, plan, billing), Referral section (link + copy, tier progress bar with milestone dots, tier cards, referral list table)
- **API Endpoints**: `GET /api/whale/user-settings` (returns alias + referral_code + count), `POST /api/whale/user-settings` (update alias), `POST /api/whale/referral/apply` (apply ref code at signup), `GET /api/whale/referrals` (list referrals)
- **Two-sided incentive**: Referrer earns tier rewards, referred user gets 10% off first paid month

## Signal Algorithm: JORTRADE FINAL (LOCKED — March 30, 2026)

**⚠️ DO NOT MODIFY without explicit user approval. Full spec in `.local/signal_logic_changelog.md`.**

- **Entry (Hybrid VWAP + Price)**: Shows VWAP context AND actual price together. CALL: `Above VWAP ($X) — Near $Y` (act now), `On bounce from VWAP ($X) — Near $Y` (wait). PUT: `Below VWAP ($X) — Near $Y` (act now), `On rejection from VWAP ($X) — Near $Y` (wait). Whale flows: `Whale sweep at $X`. No VWAP fallback: `Near $X (no VWAP data)` — NO Act Now tag.
- **Invalidation**: Closest support/resistance level (PDL/S1/Pivot for calls, PDH/R1/Pivot for puts). Fallback: 2% from price. VWAP excluded from invalidation.
- **Target**: Must point in correct direction with named levels. Calls: ABOVE price (VWAP, Strike, PDH, R1). Puts: BELOW price (VWAP, Strike, PDL, S1). Fallback: 2%/4% from price.
- **Server code**: `whale.ts` scoreSignal function (~line 2099). **Frontend code**: `useMarketData.ts` (~line 658, uses flat `Near $X` since no VWAP on live alerts).
- **Validation safety net**: After computing, verifies CALL target > price and PUT target < price; resets to 2%/4% if wrong.

## Trump Feed

- **Trump Truth Social Monitor** (`/dashboard/trump`): Polls CNN's public Truth Social archive (`ix.cnn.io/data/truth-social/truth_archive.json`) every 5 minutes
- Shows last 24 hours of posts with engagement stats (likes, replies, reboosts)
- Strips HTML, sanitizes URLs (https only), caches up to 50 posts in memory
- Frontend auto-refreshes every 60 seconds, manual refresh button available
- Endpoint: `GET /api/whale/trump-posts`