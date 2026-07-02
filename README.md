# Family Command Center

A mobile-first household dashboard: Claude chat with real Chase spending (Plaid), Theo's crypto round-up fund (Coinbase), and an optional TRMNL e-ink display.

## Features

- **Budget (Plaid)** — Connect Chase, view monthly spend vs. your configured budget (`NEXT_PUBLIC_MONTH_BUDGET`, default $6,000), category targets, upcoming bills, and transaction refresh.
- **Chat agent** — Streaming Claude assistant with tools for spending analysis, household memory, TRMNL reminders, and Theo Fund operations.
- **Theo Fund** — Round-ups from Chase spending invested into ETH, BTC, and WLD via Coinbase Advanced Trade (preview → confirm flow).
- **TRMNL (optional)** — Push reminders from chat and a daily budget snapshot via cron webhook.

## Production deployment

1. **Prerequisites** — Accounts for [Supabase](https://supabase.com), [Plaid Production](https://dashboard.plaid.com) (real Chase), [Anthropic](https://console.anthropic.com), [Coinbase CDP](https://portal.cdp.coinbase.com), [Vercel](https://vercel.com), and optionally [TRMNL](https://trmnl.com).
2. **Fork & clone** — `git clone https://github.com/TreyEdwards93/family-command-center.git && cd family-command-center`
3. **Configure services** — Supabase (Google OAuth), Plaid Production, Coinbase CDP, Anthropic API key.
4. **Deploy to Vercel** — Connect the GitHub repo; set all env vars in Vercel (see [docs/ENV.md](./docs/ENV.md) and [.env.example](./.env.example) for variable names).
5. **Database** — Run [supabase/schema.sql](./supabase/schema.sql) in the Supabase SQL editor.
6. **Cron** — Set `CRON_SECRET` in Vercel; `vercel.json` schedules daily budget push.
7. **Smoke test** — Sign in, connect Chase, chat, Theo tab, cron.

Full step-by-step runbook: **[docs/SETUP.md](./docs/SETUP.md)**

**AI-assisted deployment:** Paste the repo into your AI tool and start with **[docs/AI-REPLICATION.md](./docs/AI-REPLICATION.md)** (doc order, constraints, verification gates).

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/AI-REPLICATION.md](./docs/AI-REPLICATION.md) | AI handoff — replication contract and verification gates |
| [docs/SETUP.md](./docs/SETUP.md) | Production deployment runbook |
| [docs/ENV.md](./docs/ENV.md) | Every environment variable (Vercel configuration) |
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
| Plaid Production | Per Plaid pricing; required for real Chase |
| Anthropic API | Pay-per-token (~$3/M input, $15/M output for Sonnet) |
| Coinbase Advanced Trade | Trading fees only; no API fee |
| TRMNL | Hardware + optional cloud plugin |

## Stack

Next.js 16 (App Router) · Supabase (Postgres + Google OAuth) · Anthropic Claude · Plaid · Coinbase CDP · Vercel

## License

This project is released under the [Unlicense](./LICENSE) (public domain).
