# Family Command Center

A mobile-first household dashboard: Claude chat with real Chase spending (Plaid), Theo's crypto round-up fund (Coinbase), and an optional TRMNL e-ink display.

_Screenshots coming soon._

## Features

- **Budget (Plaid)** — Connect Chase, view monthly spend vs. $6,000 budget, category targets, upcoming bills, and transaction refresh.
- **Chat agent** — Streaming Claude assistant with tools for spending analysis, household memory, TRMNL reminders, and Theo Fund operations.
- **Theo Fund** — Round-ups from Chase spending invested into ETH, BTC, and WLD via Coinbase Advanced Trade (preview → confirm flow).
- **TRMNL (optional)** — Push reminders from chat and a daily budget snapshot via cron webhook.

## Quick start

1. **Prerequisites** — Node.js 22+, accounts for [Supabase](https://supabase.com), [Plaid](https://plaid.com), [Anthropic](https://console.anthropic.com), and optionally [Coinbase CDP](https://portal.cdp.coinbase.com) + [TRMNL](https://trmnl.com).
2. **Clone & install** — `git clone https://github.com/TreyEdwards93/family-command-center.git && cd family-command-center && npm install`
3. **Configure env** — Copy `.env.example` to `.env.local` and fill in values (see [docs/ENV.md](./docs/ENV.md)).
4. **Database** — Run [supabase/schema.sql](./supabase/schema.sql) in the Supabase SQL editor.
5. **Run locally** — `npm run dev` → open `http://localhost:3000`, sign in with Google.

Full replication steps: **[docs/SETUP.md](./docs/SETUP.md)**

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/SETUP.md](./docs/SETUP.md) | Step-by-step replication runbook |
| [docs/ENV.md](./docs/ENV.md) | Every environment variable |
| [docs/DATABASE.md](./docs/DATABASE.md) | Supabase tables, RLS, memory keys |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System diagram, API catalog, auth pattern |
| [docs/PRD.md](./docs/PRD.md) | Product requirements and user stories |
| [docs/THEO-FUND.md](./docs/THEO-FUND.md) | Round-ups, Coinbase JWT, troubleshooting |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Extending tools, tabs, type-checking |

## Cost to run (rough)

| Service | Typical cost |
|---------|----------------|
| Vercel Hobby | Free (1 cron/day) |
| Supabase Free | Free tier sufficient for a household |
| Plaid | Production access required for real banks; dev uses Sandbox (free) |
| Anthropic API | Pay-per-token (~$3/M input, $15/M output for Sonnet) |
| Coinbase Advanced Trade | Trading fees only; no API fee |
| TRMNL | Hardware + optional cloud plugin |

## Stack

Next.js 16 (App Router) · Supabase (Postgres + Google OAuth) · Anthropic Claude · Plaid · Coinbase CDP · Vercel

## License

This project is released under the [Unlicense](./LICENSE) (public domain).
