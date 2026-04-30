# Replit Project Summary

## Overview

This project is a pnpm workspace monorepo built with TypeScript, designed for financial market analysis and trading tools. It integrates an Express API server, a React web application, and a Python CLI for AI-driven market data analysis. The platform aims to provide users with advanced tools for options flow analysis, dark pool data, signal generation, and performance tracking, leveraging AI for deeper insights and real-time market intelligence. The ultimate goal is to offer AI-generated trade recommendations and a comprehensive platform for analyzing trading performance.

## User Preferences

- I prefer simple language.
- I like iterative development.
- Ask before making major changes.
- I want detailed explanations.
- Do not make changes to the folder `Z`.
- Do not make changes to the file `Y`.

## System Architecture

The project is a pnpm monorepo using TypeScript (v5.9) and Node.js (v24), with each package configured as a composite TypeScript project.

**Core Technologies:**
- **Monorepo Tool:** pnpm workspaces
- **API Framework:** Express 5
- **Database:** PostgreSQL (Replit managed) with Drizzle ORM and `pg` Pool
- **Validation:** Zod (`zod/v4`) with `drizzle-zod`
- **API Codegen:** Orval (from OpenAPI spec)
- **Build Tool:** esbuild

**Monorepo Structure:**
- `artifacts/`: Deployable applications (`api-server`, `biddie-web`).
- `lib/`: Shared libraries (`api-spec`, `api-client-react`, `api-zod`, `db`).
- `scripts/`: Utility scripts.

**API Server (`@workspace/api-server`):**
- Express 5 server using `@workspace/api-zod` for validation and `@workspace/db` for persistence.

**Database Layer (`@workspace/db`):**
- Manages PostgreSQL interactions via Drizzle ORM, defining schemas and handling migrations with `drizzle-kit`.

**Frontend (`@workspace/biddie-web`):**
- React application with Vite, Tailwind CSS 3, Framer Motion, and shadcn/ui.
- **Features:** User authentication (Supabase), dashboard with trading signals, market data, P&L tracking, analytics, breakout scanner, and AI-powered ticker analysis. Includes a dedicated SPX/GEX tab with real-time Gamma Exposure data from Unusual Whales.
- **UI/UX:** Dark trading theme with `--background: 230 25% 5%`, `--primary: 230 85% 60%`, and Inter + Orbitron fonts.

**Python Tools (`whale_claude.py`):**
- CLI for fetching live market data (Unusual Whales) and AI analysis using Anthropic's Claude, supporting options flow, dark pool, and stock deep-dives.

**Key Features:**

- **Breakout Scanner:** Detects Bollinger Band/Keltner Channel squeezes and consolidation patterns, providing real-time alerts with volume confirmation and a breakout imminence predictor. Includes 0DTE contract recommendations and custom watchlist functionality.
- **Signal Performance Tracking:** Features a color-coded calendar heatmap for daily win rates, a five-tier outcome system (HIT, PARTIAL HIT, PENDING, EXPIRED, MISSED), and an admin panel for detailed signal insights and analytics. All date logic uses Eastern Time (America/New_York) for "today" and week boundaries. Analytics and Admin tabs share the same calendar endpoint (deduped via `DISTINCT ON` by ticker/strike/option_type/ET date) for reporting numbers. Admin tab includes a "Signal Insights" summary bar (admin-only) synced with Analytics, plus a separate raw operational signal list (un-deduped, limit 300) for individual signal management.
- **Signal Reinforcement System:** Same-day exact-contract duplicate signals (ticker + strike + option_type + expiry + ET trading day) are merged into a single card with a reinforcement count. Badges display "2nd Reinforcement", "3rd Reinforcement", etc. Confidence updates upward only. Each new ET day resets reinforcement for the same contract. Frontend merge keys normalize strike formatting (`$675`, `675.00`, `675` all match) and include option_type to prevent call/put collisions. DB columns: `reinforcement_count` (INTEGER DEFAULT 1), `last_reinforced_at` (TIMESTAMPTZ) on `signal_outcomes`.
- **Market Pulse & Trending Tickers:** Displays real-time market overview (SPY/QQQ/IWM, VIXY volatility, put/call ratio sentiment) and identifies top trending tickers by options premium.
- **Referral System:** Implements a multi-tier referral program with auto-generated codes, signup integration, and incentives for both referrers and referred users.
- **Signal Algorithm (JORTRADE FINAL):** Advanced signal generation logic incorporating hybrid VWAP + price entry, swing high/low targets and invalidations, GEX integration for all tickers, flow clustering, and cross-tab confirmation.
- **Trump Feed:** Monitors and displays recent posts from Donald Trump's Truth Social archive with engagement statistics.
- **JORTRADE Community Chat:** Live chat room with Supabase Realtime. Biddie AI responds to user messages via `shouldBiddieRespond()` (trading word + ticker detection, no plain question-mark trigger). Automated server-side posts (morning recaps, whale alerts, flow alerts) go through `postBiddieToChat()` in whale.ts. Initial message load fetches newest 100 messages (descending + reverse). Timestamps show full date + time + ET timezone.
- **Chat Trade Action Bar (both Biddie chat surfaces):** Each Biddie assistant message is parsed for option contracts via `extractContractsFromText()` in `src/lib/extractContracts.ts`. The parser supports the full range of LLM-generated formats observed in the live Biddie corpus: compact (`GOOGL 330C 5/1`, `SPY 604p 4/17`), word-suffix (`SQQQ $86 calls expiring 4/2`, `SPY $626 puts expiring 3/31`), date-first (`IWM 3/31 $237 puts`), ticker-far-from-strike (`GS 🔥 Vol/OI of 214 on these 837.5 calls expiring 4/2`), **relative-expiry** (`SPY 711C expiring TODAY`, `QQQ $500 calls 0DTE`, `MSFT 400 calls zero DTE`, `AAPL 200P same day`), and **side-first** constructions (`CVNA puts at the $370 strike expiring 3/19/27`, `GOOGL calls on $500 for 5/1`, `SPY puts at $640 5/2`). Relative-expiry phrases (`today`, `0DTE`, `zero DTE`, `same day`/`same-day`, all case-insensitive) resolve to the message's own `createdAt` UTC date. Side-first construction requires word-form side (`Calls`/`Puts`) plus a connecting bridge (`at`/`on` + optional `the`) to anchor the parse. The deny-list now also rejects time/macro/trading caps (`TODAY`, `TONIGHT`, `TOMORROW`, `CPI`, `FOMC`, `STRIKE`, `LEVEL`, `CALLS`, `PUTS`, etc.) so prose like "earnings are TODAY ... CVNA puts at the $370 strike" correctly attributes to CVNA, not TODAY. Algorithm: locate each `STRIKE+SIDE+DATE` pattern, then attribute it to the nearest preceding non-denied ticker in the same line (look-back ≤140 chars). Side accepts `C/P/c/p/Call/Calls/Put/Puts`; filler words `exp/expiring/expires/for` are tolerated between strike and date. The deny-list rejects common ALL-CAPS English emphasis words (HARD, HUGE, FAST, OVER, etc.) so prose like "stacking HARD … 604p 4/17" correctly attributes to the actual ticker (e.g. SPY) rather than the emphasis word. False-positive guards: `STRIKE` alone with no adjacent SIDE word is rejected (so price levels like "$641-$642 area" or "$540.47" are ignored), invalid dates like `2/30` are dropped, single-letter ticker matches are skipped (so "Watching" doesn't become ticker `W`), and per-message dedup is by `ticker|strike|optionType|expiry`. Wired into both chat surfaces: (1) Dashboard right-rail Biddie panel `AIChatPanel.tsx` (`/dashboard/chat`), and (2) JORTRADE Community Chat `DashboardCommunity.tsx` (`/dashboard/community`) where Biddie is identified by `msg.user_id === BIDDIE_USER_ID`. Action bar labeled "Chat Idea — Not Execution Approved" with Buy Paper / Monitor / Review buttons per contract. Buy Paper / Review open `PaperTradeTicket` in chat-trade mode (`source: "chat"`), which shows an amber "Chat Trade (Unverified)" banner, suppresses the signal plan card, and replaces "Recommended Contract" / "Highest-probability" copy with neutral "As Quoted in Chat" / "Alternate Contract". The execution evaluator is never called for chat trades. Monitor persists locally in `localStorage` key `biddie-chat-monitor-${userId}` (shared across both surfaces; no schema change). Parser anchors year resolution to the message's `createdAt/created_at` so an expiry like "5/1" never silently rolls forward to the next year on later renders. Backend `POST /whale/paper/trades` accepts the synthetic `chat-...` signalId as plain TEXT (no FK lookup). Shared helpers `chatContractKey` and `buildPaperTradeFromChat` live in the same module.

- **Paper Automation Engine — Phase 1 / Commit 1 (pending_entry, backend-only, dev-merged 2026-04-30):** Adds a queued-entry state for paper trades that fires when the underlying crosses a target price. New `paper_trades` columns: `entry_trigger_price NUMERIC`, `entry_trigger_direction TEXT` (`at_or_below` | `at_or_above`), `pending_expires_at TIMESTAMPTZ`, `pending_cancel_reason TEXT`, plus `created_at TIMESTAMPTZ DEFAULT NOW()` (so `opened_at` cleanly means "filled time" for both market and pending fills). `entry_price` and `entry_fill_source` were relaxed to nullable since pending rows have no fill yet (existing rows still satisfy NOT NULL data). New partial index `idx_paper_trades_pending` on `status='pending_entry'`. Schema migrations live in the seed IIFE at `routes/whale.ts` ~line 194-209. New helper `evaluatePendingEntry(t, q)` next to `evaluateAndMaybeClose` in `whale.ts`; re-exported via `__paperTradeInternals` and `paperTradeService.ts`. The monitor's `processPendingEntries()` runs after `processOpenTrades()` on every cycle (same 60s/5min cadence): pre-flights expired contracts and expired pending windows (cancels without paying a Polygon call), fetches quotes for the rest, and either refreshes `last_quote_*` (no fire) or atomically promotes the row to `status='open'` at live `pickEntryFill` (matches market-mode entries). Trigger evaluation uses `priceMonitor.getPrice()` for the underlying when available so it fires off the same realtime tick that drives signal evaluation, falling back to `q.underlying`. `POST /whale/paper/trades` accepts new fields `mode: 'market' | 'pending_entry'`, `entryTriggerPrice`, `entryTriggerDirection`, `pendingExpiresAt`; default mode is `market` so existing callers (PaperTradeTicket, Buy button) are unchanged. New `POST /whale/paper/trades/:id/cancel` only works while `status='pending_entry'` and sets `pending_cancel_reason='user_cancelled'`. Both `GET /whale/paper/trades` AND `POST /whale/paper/trades/refresh-all` filters were tightened identically: `?status=closed` now means `status='closed'` exactly (was `!= 'open'`, which would have bled pending/cancelled rows into the existing dashboard via the 30s foreground poll); `?status=pending` is a new filter exposing pending rows for future UI; `?status=open` and the default unchanged. Both endpoints sort by `COALESCE(created_at, opened_at) DESC` for consistency. Sort order is `COALESCE(created_at, opened_at) DESC` so legacy rows still order sensibly. **No UI changes** (Commits 2 and 3 deferred). Verified end-to-end on dev: SPY pending row promoted to open (entry_price=24.21 ask, entry_underlying=718.87) on the first cycle after queue; non-firing pending refreshed `last_quote_*` only; expired pending cancelled with `expired_unfilled`; cancel SQL transition tested. `?status=open` and `?status=closed` confirmed isolated from pending/cancelled.

- **Paper-Trade Monitor (Quote Refresh):** Background loop in `artifacts/api-server/src/lib/paperTradeMonitor.ts` polls Polygon every 60s (market hours) / 5min (off-hours) for every open paper trade and updates `last_quote_*` fields. **Critical OPRA-symbol bug fixed (2026-04-30):** pg returns DATE columns as JS `Date` objects. The previous code called `String(t.expiry).slice(0, 10)` which produced `"Fri May 01"` (no year). Passed to `new Date()`, JavaScript's loose parser silently defaulted the year to **2001**, generating malformed OPRA symbols like `O:NVDA010501C00205000` that 404 on Polygon. As a result, every open trade had `last_quote_underlying == entry_underlying` (stuck at entry). Fix: a single canonical helper `normalizeExpiryToIso(expiry: string | Date)` in `routes/whale.ts` (re-exported via `paperTradeService.ts`) that handles `Date | ISO string | other` defensively, branching on `instanceof Date` and using `getUTCFullYear/Month/Date`. All five `String(t.expiry).slice(0, 10)` call sites were replaced with `normalizeExpiryToIso(t.expiry)`. `buildOptionContractSymbol` and `fetchOptionQuote` accept `string | Date` and normalize internally so future call sites can pass the raw Date safely. `fetchOptionQuote` now logs full diagnostics on every Polygon failure (status, statusText, contract, elapsed, body snippet, request_id, JSON parse errors, empty results). The dashboard's `DashboardPaperTrades.tsx` uses `deriveQuoteState()` to label each row LIVE / STALE / QUOTE UNAVAILABLE / PENDING based on `last_checked_at` and quote presence; UNAVAILABLE/PENDING rows show "—" for P/L and are excluded from the openUnrealized stat with an "(N excluded)" disclosure plus a red banner. **No schema changes, no signal/Biddie/executionEvaluator/auto-close/Buy-button changes.**

## External Dependencies

- **Database:** PostgreSQL (Replit managed)
- **AI Integrations:** Anthropic (Claude AI)
- **Market Data:**
    - Unusual Whales API
    - Yahoo Finance
    - Polygon.io (real-time WebSocket and snapshot polling)
- **Authentication:** Supabase
- **Python Libraries:** `anthropic`, `requests`, `rich`
- **TypeScript Libraries:** `express`, `pg`, `drizzle-orm`, `zod`, `drizzle-zod`, `@tanstack/react-query`