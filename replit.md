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
    - Dashboard with tabs for Chat, Signals, Market, P&L, Analytics, Breakout Scanner, Community, and Settings.
    - Displays various signal categories (Algorithm Plays, Whale Plays, Spreads & Butterflies) with real-time data.
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
    - Finnhub (for real-time market data via WebSocket)
- **Authentication:** Supabase (for `biddie-web` via `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)
- **Python Libraries:** `anthropic`, `requests`, `rich`
- **TypeScript Libraries:** `express`, `pg`, `drizzle-orm`, `zod`, `drizzle-zod`, `@tanstack/react-query`

## Breakout Scanner Features

- **Breakout Scanner** (`/dashboard/breakout`): BB/KC squeeze detection + consolidation patterns across 40 tickers
- **Auto Breakout Alerts**: Real-time WebSocket price monitoring with volume confirmation. Alerts only fire when: (1) price breaks resistance/support, (2) session volume >= 1.5x 20-day avg (time-adjusted), (3) burst volume >= 3x the prior 10-min average (measured in 5-second buckets over last 60s). Tagged "INSTITUTIONAL" when both gates pass. 15-min cooldown, 4-hour TTL, max 50 alerts
- **Breakout Imminence Predictor**: `imminenceScore` (0-100) with labels: "BREAKOUT ACTIVE", "BREAKOUT IMMINENT" (>=80), "LIKELY WITHIN 15 MIN" (>=60), "LIKELY WITHIN 1 HOUR" (>=45), "BUILDING PRESSURE" (>=30). Based on proximity to breakout level, squeeze pressure, volume momentum, consolidation tightness
- **Target Prices**: resistance/support + 1 ATR. Displayed on setup cards, expanded detail, and alert cards
- **Score Breakdown**: squeeze (25-40pts), near-squeeze (15pts), consolidation (10-25pts), volume (10-20pts), breakout (30pts), tight range (10pts)
- **Custom Ticker Watchlist**: Users can add up to 30 custom tickers (e.g. HOOD, RIVN) beyond the 40 default. Custom tickers appear as removable tags, are included in scans, and persist in server memory
- **Endpoints**: `GET /api/breakout/scan` (5-min cache), `GET /api/breakout/scan/:ticker`, `GET /api/breakout/alerts`, `GET /api/breakout/watchlist`, `POST /api/breakout/watchlist/add`, `POST /api/breakout/watchlist/remove`
- **Finnhub Live Price Injection**: Signal pipeline checks Finnhub real-time prices first (if < 2min stale), then Unusual Whales price, then Yahoo Finance as final fallback. Signal candidate tickers are temporarily subscribed to Finnhub before evaluation