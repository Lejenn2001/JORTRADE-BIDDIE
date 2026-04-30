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
- **Chat Trade Action Bar (both Biddie chat surfaces):** Each Biddie assistant message is parsed for option contracts ("TICKER STRIKE[CP] M/D[/YY]") via `extractContractsFromText()` in `src/lib/extractContracts.ts`. Wired into both chat surfaces: (1) the Dashboard right-rail Biddie panel `AIChatPanel.tsx` (route `/dashboard/chat`), and (2) the JORTRADE Community Chat page `DashboardCommunity.tsx` (route `/dashboard/community`) where Biddie is identified by `msg.user_id === BIDDIE_USER_ID`. Detected contracts render an action bar labeled "Chat Idea — Not Execution Approved" with three buttons per contract: Buy Paper, Monitor, Review. Buy Paper / Review open the existing PaperTradeTicket modal in chat-trade mode (`source: "chat"`), which shows an amber "Chat Trade (Unverified)" banner, suppresses the signal plan card, and replaces "Recommended Contract" / "Highest-probability" copy with neutral "As Quoted in Chat" / "Alternate Contract" labels. The execution evaluator is never called for chat trades. Monitor persists locally in `localStorage` key `biddie-chat-monitor-${userId}` (shared across both surfaces; no schema change). Parser anchors year resolution to the message's createdAt/created_at timestamp so an expiry like "5/1" never silently rolls forward to the next year on later renders. Backend `POST /whale/paper/trades` accepts the synthetic `chat-...` signalId as plain TEXT (no FK lookup). Shared helpers `chatContractKey` and `buildPaperTradeFromChat` live in `src/lib/extractContracts.ts`.

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