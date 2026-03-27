# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL (Replit managed, `DATABASE_URL`) + Drizzle ORM + direct `pg` Pool
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Python Tools

### `whale_claude.py` — Unusual Whales + Claude AI Analysis

A Python CLI that fetches live market data from Unusual Whales and runs AI analysis using Claude.

**Required secrets:** `UNUSUAL_WHALES_API_KEY`, `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY` (last two auto-configured via Replit AI Integrations).

**Commands:**
```bash
python whale_claude.py flow                  # Options flow alerts + Claude analysis
python whale_claude.py flow --limit 100      # More alerts
python whale_claude.py market                # Sector ETFs, economic & FDA calendar
python whale_claude.py darkpool AAPL         # Dark pool for a specific ticker
python whale_claude.py stock NVDA            # Full deep-dive: flow + dark pool
```

**Working Unusual Whales endpoints:**
- `/api/option-trades/flow-alerts` — real-time options flow alerts
- `/api/market/sector-etfs` — sector ETF volume and call/put data
- `/api/market/economic-calendar` — upcoming economic events
- `/api/market/fda-calendar` — FDA events and outcomes
- `/api/darkpool/{ticker}` — dark pool block trades by ticker

**Dependencies:** `anthropic`, `requests`, `rich` (Python 3.11)

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/biddie-web` (`@workspace/biddie-web`)

Full JORTRADE / Biddie AI web frontend, migrated from Lovable. React + Vite + Tailwind V3 + shadcn/ui.

- **Stack**: React 19, Vite 7, Tailwind CSS 3, Framer Motion, Recharts, Supabase Auth, React Router v6
- **Pages**: Landing (`/`), Login (`/login`), Signup (`/signup`), Dashboard (`/dashboard`) with tabs (Chat, Signals, Market, P&L, Analytics, Breakout Scanner, Community, Settings), Ecosystem (`/ecosystem`), Contact (`/contact`), 404
- **Signal Categories**: 3 categories — Algorithm Plays (price action + gamma analysis), Whale Plays ($250K+ institutional flow), Spreads & Butterflies (multi-leg strategies). Dashboard shows Algorithm Plays + Whale Plays (top 5 each, sorted 0DTE first then conviction score). Signals page has 3 tabs for all categories. Each signal card labeled "DAY TRADE" (buy_now/short_term) or "SWING TRADE" (swing), plus "Live" or "Example" badge. Example signals fill tabs when no live data (META/AMZN/GOOGL for spreads, AAPL/PLTR/AMD for whale).
- **Performance Tracking**: `PerformanceSnapshot` and `SignalAccuracyPanel` track signals from the `signal_outcomes` table in Replit PostgreSQL.
- **Pricing Tiers**: Signal Scout ($49, 5 questions/day), Active Trader ($89, 25 questions/day), Pro Trader ($129, 50 questions/day). All tiers get Biddie AI access. Daily limits enforced via `useQuestionLimit` hook (localStorage-based, resets at midnight). JORTRADE Chat is the community chat room (separate from Biddie AI).
- **Auth**: Supabase email/password + Google/Apple OAuth. Dashboard is protected by `ProtectedRoute` component.
- **API Integration**: 
  - Chat: `POST /api/whale/chat` — sends to API server which calls Claude with Unusual Whales data
  - Signals: `GET /api/whale/signals` — fetches live options flow signals with price action confirmation + gamma analysis
  - Replit artifact routing handles `/api` → API server (port 8080) automatically
- **Signal Analysis Pipeline** (in `whale.ts`):
  - `fetchRecentCandles()` — fetches 1-minute bars from Yahoo Finance for real-time price action
  - `detectPriceActionConfirmation()` — Neo SR Tag + 2 Red/Green Bars pattern detection at key support/resistance levels
  - Gamma zone analysis: ≤2% from strike = negative gamma (amplified moves), ≤5% = positive gamma (pinning)
  - `generateTradeRecommendation()` — produces specific trade recs (action, entry trigger, target, invalidation)
  - Backend hydrates AI signals with authoritative computed data (price_confirmed, gamma_zone, etc.)
  - Frontend displays: "PRICE CONFIRMED" + "ACT NOW" banners, gamma zone badges, price pattern details on signal cards
- **Ticker Analysis** (`GET /api/whale/analyze/:ticker`):
  - Personal trade assistant — enter any ticker for a full AI-powered breakdown
  - Fetches live options flow, dark pool data, key levels (VWAP, pivots, PDH/PDL), and 1-min candles in parallel
  - Filters flow for the specific ticker, computes call/put premium ratios, sweep counts, aggression %
  - Runs price action confirmation and gamma zone analysis
  - Claude AI synthesizes everything into structured JSON: verdict, market structure, flow analysis, dark pool analysis, key levels, trade setup (entry/target/stop), and watch-for items
  - Frontend: `/dashboard/market` — search bar with popular/recent tickers, animated loading, structured analysis cards
- **User Trades** (`POST/GET/DELETE /api/whale/trades`):
  - Users click "I Took This Trade" on signal cards to track which signals they followed
  - `POST /api/whale/trades` — save a taken trade (linked to signal_id + user_id)
  - `GET /api/whale/trades?userId=X` — fetch user's taken trades (joined with signal_outcomes for outcome data)
  - `DELETE /api/whale/trades/:signalId?userId=X` — remove a taken trade
  - `GET /api/whale/trades/stats?userId=X` — computed stats: win rate, streak, by-ticker, by-category, weekly
  - Database: `user_trades` table in PostgreSQL
- **Analytics Dashboard** (`/dashboard/analytics`):
  - Overview tab: AI win rate, personal win rate, trades taken, win streak, top tickers, category breakdown
  - My Trades tab: personal stats, recent trades list with WIN/LOSS/PENDING badges, ticker breakdown
  - AI Signals tab: overall signal performance, win rate rings by category, top performing tickers
  - No longer admin-only — accessible to all users as a Pro feature
- **Signal Verification** (`POST /api/whale/verify-signals`):
  - Fetches pending signals from Replit PostgreSQL `signal_outcomes` table (oldest first, 100 per batch)
  - For each pending signal, pulls historical OHLC data from Yahoo Finance since signal creation date
  - Checks if the stock's high (bullish) or low (bearish) reached the target zone at any point since the signal was issued
  - Marks as "hit" (target reached), "missed" (expired without hitting), or "expired"
  - Updates `outcome` and `resolved_at` in PostgreSQL + syncs `user_trades.signal_outcome` for any user who took the trade
  - **Auto-verification**: `setInterval` runs every 30 min on server startup (first run after 60s delay)
  - **Admin Panel**: Analytics page "Admin" tab (visible only to admin users) with "Verify Now" button + full signal outcomes table with ticker/direction/category/strike/target/outcome columns
  - **Admin Role System**: `user_roles` PostgreSQL table, `GET /api/whale/admin/check?userId=X`, `POST /api/whale/admin/grant` (requires `adminSecret`)
  - Frontend `PerformanceSnapshot` and `SignalAccuracyPanel` components call this endpoint via manual "Verify" button
- **Breakout Scanner** (`/dashboard/breakout`):
  - Bollinger Band / Keltner Channel squeeze detection across 40-ticker watchlist
  - Consolidation pattern detection (multi-day tight ranges)
  - Volume spike filtering and breakout trigger logic
  - Backend: `GET /api/breakout/scan` (full scan, 5-min cache), `GET /api/breakout/scan/:ticker` (single), `GET /api/breakout/watchlist`
  - Uses Yahoo Finance daily candles (60 days) + Finnhub quotes (with candle fallback if Finnhub unavailable)
  - Score 25+ threshold; scoring: squeeze (25-40pts), near-squeeze (15pts), consolidation (10-25pts), volume (10-20pts), breakout (30pts), tight range (10pts)
  - Frontend: expandable cards with detail view (squeeze/consolidation/volume/breakout metrics, resistance/support, BB/KC band width visualization)
- **Design tokens**: Dark trading theme with `--background: 230 25% 5%`, `--primary: 230 85% 60%`, Inter + Orbitron fonts
- **Env vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Build**: `pnpm --filter @workspace/biddie-web run dev` (dev) / `pnpm --filter @workspace/biddie-web run build` (prod static)

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
