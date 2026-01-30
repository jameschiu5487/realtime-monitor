# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15 application for a midterm frequency trading system. It uses:
- Next.js 15.5.4 with Turbopack
- React 19
- TypeScript with strict mode
- Tailwind CSS v4 with `@tailwindcss/postcss`
- shadcn/ui component library (New York style)
- pnpm as the package manager

## Common Commands

### Development
```bash
pnpm dev           # Start development server with Turbopack
pnpm build         # Production build with Turbopack
pnpm start         # Start production server
pnpm lint          # Run ESLint
```

### Adding UI Components
The project is configured with shadcn/ui. To add components:
```bash
npx shadcn@latest add <component-name>
```

Components will be added to `@/components/ui` with the New York style variant.

## Architecture

### File Structure
- `app/` - Next.js 15 App Router directory
  - `app/page.tsx` - Homepage
  - `app/layout.tsx` - Root layout with Geist fonts
  - `app/globals.css` - Global Tailwind styles
- `lib/` - Utility functions
  - `lib/utils.ts` - Contains `cn()` utility for class merging
- `components/` - React components (when created, organized by shadcn/ui conventions)
- `public/` - Static assets

### Path Aliases
The project uses `@/*` path alias mapping to the root directory:
- `@/components` → `components/`
- `@/lib` → `lib/`
- `@/hooks` → `hooks/`

### Styling
- Uses Tailwind CSS v4 with CSS variables for theming
- Base color: neutral
- Includes `cn()` utility (`lib/utils.ts`) for conditional class merging with `clsx` and `tailwind-merge`
- Geist Sans and Geist Mono fonts are pre-configured

### TypeScript Configuration
- Strict mode enabled
- Target: ES2017
- Path aliases configured via `tsconfig.json`
- React Server Components (RSC) enabled

## Development Notes

### Tailwind CSS v4
This project uses Tailwind CSS v4 with the new PostCSS plugin (`@tailwindcss/postcss`). No `tailwind.config.js` is needed - configuration is CSS-based.

### Turbopack
Both `dev` and `build` commands use Turbopack (`--turbopack` flag) for faster builds.

### shadcn/ui
- Style: "new-york"
- RSC: enabled
- Icon library: lucide-react
- CSS variables: enabled
- Component registry configured in `components.json`

## Supabase Database Schema

### Authentication
- Uses Supabase Auth with email/password
- Protected routes via middleware.ts
- User session managed via cookies

### Tables

#### strategies
| Column | Type | Notes |
|--------|------|-------|
| strategy_id | string | Primary Key |
| user_id | string | Foreign Key to auth.users |
| name | string | |
| version | string | |
| description | string | |
| created_at | string | |

#### strategy_runs
| Column | Type | Notes |
|--------|------|-------|
| run_id | string | Primary Key |
| strategy_id | string | Foreign Key to strategies |
| mode | string | 'backtest' \| 'paper' \| 'live' |
| status | string | 'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled' |
| start_time | string | |
| end_time | string | |
| initial_capital | number | |
| params | jsonb | |
| code_ref | string | |
| notes | string | |
| created_at | string | |

#### trades
| Column | Type | Notes |
|--------|------|-------|
| trade_id | integer | Primary Key |
| run_id | string | Foreign Key to strategy_runs |
| ts | string | Timestamp |
| symbol | string | |
| exchange | string | |
| action | string | |
| side | string | 'buy' \| 'sell' |
| quantity_nominal | number | |
| quantity_actual | number | |
| price | number | |
| fee_amount_usdt | number | |
| fee_rate_bps | number | |
| funding_rate | number | |
| interval_hours | string | |
| status | string | |

#### combined_trades
Position-level P&L aggregation.

| Column | Type | Notes |
|--------|------|-------|
| combined_trade_id | integer | Primary Key |
| run_id | string | Foreign Key to strategy_runs |
| ts | string | Timestamp |
| symbol | string | |
| exchange | string | |
| side | string | 'long' \| 'short' |
| quantity | number | |
| entry_price | number | |
| exit_price | number | |
| holding_period_hours | number | |
| price_pnl | number | |
| funding_fee_realized | number | |
| commission_fee | number | |
| total_pnl | number | |

#### pnl_series
Hourly P&L breakdown.

| Column | Type | Notes |
|--------|------|-------|
| run_id | string | Primary Key (composite) |
| ts | string | Primary Key (composite) |
| total_pnl | number | |
| total_funding_pnl | number | |
| total_price_pnl | number | |
| total_fee | number | |
| binance_funding_pnl | number | |
| binance_price_pnl | number | |
| binance_fee | number | |
| bybit_funding_pnl | number | |
| bybit_price_pnl | number | |
| bybit_fee | number | |

#### equity_curve
Equity snapshots with drawdown.

| Column | Type | Notes |
|--------|------|-------|
| run_id | string | Primary Key (composite) |
| ts | string | Primary Key (composite) |
| total_equity | number | |
| total_pnl | number | |
| binance_equity | number | |
| binance_pnl | number | |
| bybit_equity | number | |
| bybit_pnl | number | |
| drawdown_pct | number | |

### Navigation Flow
```
/login                                -> Email/password login
/strategies                           -> List all strategies
/strategies/[strategyId]              -> Strategy detail + runs list
/strategies/[strategyId]/runs/[runId] -> Run details (charts, trades, metrics)
```
