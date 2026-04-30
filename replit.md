# Replit Project Summary

## Overview

This project is a pnpm workspace monorepo built with TypeScript, designed for financial market analysis and trading tools. It provides advanced tools for options flow analysis, dark pool data, signal generation, and performance tracking, leveraging AI for deeper insights and real-time market intelligence. The platform aims to offer AI-generated trade recommendations and a comprehensive platform for analyzing trading performance.

## User Preferences

- I prefer simple language.
- I like iterative development.
- Ask before making major changes.
- I want detailed explanations.
- Do not make changes to the folder `Z`.
- Do not make changes to the file `Y`.

## System Architecture

The project is a pnpm monorepo using TypeScript and Node.js, with each package configured as a composite TypeScript project.

**Core Technologies:**
- **Monorepo Tool:** pnpm workspaces
- **API Framework:** Express 5
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval
- **Build Tool:** esbuild

**Monorepo Structure:**
- `artifacts/`: Deployable applications (API server, web app).
- `lib/`: Shared libraries (API specifications, database).
- `scripts/`: Utility scripts.

**API Server:**
- Express 5 server utilizing Zod for validation and Drizzle ORM for database persistence.

**Database Layer:**
- Manages PostgreSQL interactions via Drizzle ORM, including schema definition and migrations.

**Frontend:**
- React application with Vite, Tailwind CSS, Framer Motion, and shadcn/ui.
- **UI/UX:** Dark trading theme with `--background: 230 25% 5%`, `--primary: 230 85% 60%`, and Inter + Orbitron fonts.
- **Key Features:**
    - User authentication (Supabase).
    - Dashboard with trading signals, market data, P&L tracking, and analytics.
    - Breakout scanner for pattern detection and real-time alerts.
    - AI-powered ticker analysis.
    - SPX/GEX tab for real-time Gamma Exposure data.
    - Signal Performance Tracking with a color-coded calendar heatmap and five-tier outcome system. All date logic uses Eastern Time (America/New_York).
    - Signal Reinforcement System that merges duplicate signals into a single card with a reinforcement count.
    - Market Pulse & Trending Tickers displaying real-time market overview and top trending options by premium.
    - Referral System with multi-tier programs and auto-generated codes.
    - JORTRADE Signal Algorithm: Advanced signal generation with hybrid VWAP + price entry, swing high/low targets, GEX integration, flow clustering, and cross-tab confirmation.
    - Trump Feed: Monitors and displays recent posts from Donald Trump's Truth Social.
    - JORTRADE Community Chat: Live chat room with Supabase Realtime, Biddie AI responses, and automated server-side posts. Includes a Chat Trade Action Bar to parse option contracts from Biddie messages and offer "Buy Paper / Monitor / Review" actions.
    - Paper Automation Engine - Phase 1:
        - **Pending Entry:** Introduces a queued-entry state for paper trades that fire when the underlying crosses a target price. Includes `entry_trigger_price`, `entry_trigger_direction`, and `pending_expires_at` for paper trades.
        - **Safety Controls:** Implements a global kill switch and per-user trade cap for automated paper trades.
        - **UI Surface for Pending Entries:** Expands the Paper Trades dashboard with filters for "Pending" and "Cancelled" trades, a sky-blue badge for pending count, and an automation status badge. The trade ticket now includes an "Entry mode" toggle for "Buy Now" or "Queue at Entry" for verified signals.
        - **Exit Strategy Layer:** Adds three new option-P&L-based auto-exits (hard stop, profit target, trailing stop) to the paper-trade monitor.
        - **View Original Signal Panel (UI-only):** Each Paper Trades row has an expandable "View Original Signal" panel that shows the full original signal context (timing/contract/plan/conviction/verdict/reason). Backed by an additive widening of `GET /whale/signals/detail/:id` to also return `conviction_score`, `reinforcement_count`, `last_reinforced_at`, `is_biddie_pick`, `target_near`, `signal_source`, `suggested_trade`, `tags`. Source label is inferred from the fetch result (200 → "Verified Signal", 404 → "Unverified" with hedged tooltip). Lazy-fetches the detail on first expand with per-`signal_id` caching, in-flight de-dupe via a `useRef` set, and retry-on-error semantics. Fields that are not stored anywhere (original chat message, execution verdict at trade time) render as "Not available".
    - Paper-Trade Monitor: Background loop polling Polygon for open paper trade updates with a fix for OPRA-symbol generation.
    - Realized P/L Stats Card Fix (Apr 2026): Fixed a stats-accuracy bug in the Paper Trades dashboard (`DashboardPaperTrades.tsx`) where the Realized P/L card displayed `$0.00` (and Closed/Wins/Losses/Win Rate showed 0) whenever the active tab filter was anything other than "all". Root cause: the `load()` fetcher passed `?status=${activeFilter}` to `GET /whale/paper/trades`, so when the user was on the default "Open" tab the post-close refetch returned only `status='open'` rows — excluding the freshly-closed trade — and the stats `useMemo` (which sums `realized_pl` over `trades.filter(status==='closed')`) had nothing to sum. Fix: `load()` now always fetches `?status=all` (server still LIMITs to 200 rows per user) and a new `filteredTrades` `useMemo` applies the tab filter client-side for the visible row list. Stats `useMemo` is unchanged. Backend close handler (`POST /whale/paper/trades/:id/close`) was always correct — it computed and persisted `realized_pl`, `realized_pl_pct`, `exit_*`, and `closed_at` in a single SQL UPDATE.
    - Market-Hours Gate (Phase 1, Apr 2026): Paper trade execution is restricted to US equity options regular trading hours (9:30 AM – 4:00 PM ET, weekdays). Weekends-only check (no NYSE holiday calendar yet). Shared util `marketHours.ts` mirrored on both backend (`artifacts/api-server/src/lib/marketHours.ts`) and frontend (`artifacts/biddie-web/src/lib/marketHours.ts`) exporting `isMarketOpenET()`, `marketClosedReason()`, and `MARKET_CLOSED_MESSAGE`. Backend gates `POST /whale/paper/trades` (after auth, before cap check) with a 409 `{ code: "market_closed", error: MARKET_CLOSED_MESSAGE }` response. The paper-trade monitor processes contract-expiry exits 24/7 but skips option-P&L exits and pending-entry trigger evaluation when closed; pending-expiry cancellation continues to run. Frontend hook `useMarketStatus` ticks every 30s and drives an amber "Market closed" banner + disabled submit on `PaperTradeTicket`, a disabled "Market closed" button on chat contract chips in `DashboardCommunity`, and a "Market: OPEN/CLOSED" badge on the Paper Trades dashboard header. Manual close/cancel endpoints are intentionally NOT gated so users can always exit positions. Biddie chat, signal generation, Review, Monitor, and pending-expiry cancellation continue running 24/7.

**Python Tools:**
- CLI for fetching live market data (Unusual Whales) and AI analysis using Anthropic's Claude.

## External Dependencies

- **Database:** PostgreSQL
- **AI Integrations:** Anthropic (Claude AI)
- **Market Data:**
    - Unusual Whales API
    - Yahoo Finance
    - Polygon.io
- **Authentication:** Supabase