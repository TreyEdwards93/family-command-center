# Setup runbook

Step-by-step guide to clone and replicate Family Command Center from scratch.

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Node.js 22+** | Supabase JS v2 requires Node 20+; this project targets 22 |
| **npm** | Comes with Node |
| **Git** | Clone the repository |
| **Supabase account** | Free tier works |
| **Google Cloud OAuth** | For Supabase Google provider |
| **Plaid account** | Sandbox for dev; Production for real Chase |
| **Anthropic account** | API key for Claude |
| **Coinbase CDP** | Optional until you test Theo Fund buys |
| **TRMNL device + plugin** | Optional |
| **Vercel account** | Optional for deploy |

## 2. Clone and install

```bash
git clone https://github.com/TreyEdwards93/family-command-center.git
cd family-command-center
npm install
```

## 3. Supabase project setup

1. Create a new project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Google**: enable, add OAuth client ID/secret from Google Cloud Console.
3. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (add production URL later)
   - Redirect URLs: `http://localhost:3000/auth/callback`, `https://YOUR_DOMAIN/auth/callback`
4. Copy **Project URL** and **anon key** (or publishable key) for env vars.
5. Copy **service_role** key for cron (keep secret).

## 4. Plaid setup

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com).
2. Create an application; note **client_id** and **secret** (Sandbox first).
3. Enable **Transactions** product.
4. For production Chase: complete Plaid production access request; set `PLAID_ENV=production` and use production secret.

## 5. Coinbase CDP key

1. Go to [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com).
2. Create API key: **ECDSA**, algorithm **ES256**.
3. Permissions: **view** + **trade** (Advanced Trade).
4. Save **key name** (`organizations/.../apiKeys/...`) and **private key** PEM.
5. Fund Coinbase account with USD for market buys.

See [THEO-FUND.md](./THEO-FUND.md) for JWT details.

## 6. Anthropic API key

1. [console.anthropic.com](https://console.anthropic.com) → API Keys → create key.
2. Set `ANTHROPIC_API_KEY` in `.env.local`.

## 7. Environment variables

```bash
cp .env.example .env.local
```

Fill every value. Reference: [ENV.md](./ENV.md).

Minimum for local dev without Theo/TRMNL:

- Supabase URL + anon key
- Anthropic key
- Plaid sandbox credentials

## 8. Run SQL scripts

Run **[supabase/schema.sql](../supabase/schema.sql)** in Supabase → SQL Editor (single paste, run once).

Order inside the file:

1. `memories`
2. `plaid_connections`
3. `crypto_purchases`
4. RLS policies (idempotent `DROP POLICY IF EXISTS`)

Verify in **Table Editor** that all three tables exist with RLS enabled.

## 9. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`:

1. Sign in with Google (must be an allowed Google account in your Supabase project).
2. Budget tab → Connect Chase (Sandbox: use Plaid test credentials).
3. Chat tab → ask a budget question.
4. Theo tab → optional if Coinbase configured.

Type-check (optional):

```bash
npx tsc --noEmit
```

## 10. Vercel deploy + env mirroring

```bash
npx vercel link
npx vercel env pull   # optional: pull remote env for comparison
```

1. Import GitHub repo in Vercel dashboard.
2. Add **all** env vars from [ENV.md](./ENV.md) for Production (and Preview if desired).
3. Deploy; update Supabase redirect URLs with production domain.
4. `vercel.json` cron runs `/api/cron/budget-push` daily — requires Hobby or higher with cron support.

After deploy, test cron manually:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/budget-push
```

## 11. Smoke test checklist

- [ ] `/login` → Google OAuth → lands on home
- [ ] Sign out works
- [ ] Budget: Plaid Link connects; transactions load
- [ ] Budget: Refresh button succeeds
- [ ] Chat: streaming response to "How are we doing this month?"
- [ ] Chat: save_memory persists (ask Claude to remember something; reload page)
- [ ] Memories API: `GET /api/memories` returns JSON (browser session)
- [ ] Theo: `/api/theo-roundup/pending` shows pending or zero
- [ ] Theo: preview round-up in chat (no confirm)
- [ ] Theo: `/api/theo-fund/debug` shows `auth.present: true`
- [ ] Cron: manual curl returns `{ "ok": true }` (production)
- [ ] TRMNL: reminder push from chat (if configured)

## 12. TRMNL cron (optional)

1. Create a **Custom Plugin** in TRMNL dashboard.
2. Design Liquid template with branches for `state`: `idle`, `reminder`, `budget`.
3. Copy webhook URL → `TRMNL_WEBHOOK_URL`.
4. Chat tools `push_reminder` / `clear_reminder` POST merge variables.
5. Daily cron sends `state: budget` with spending metrics — see [ARCHITECTURE.md](./ARCHITECTURE.md) and legacy README TRMNL payload section.

**Vercel Hobby:** one cron per day (`0 12 * * *` UTC). More frequent updates require Pro or external scheduler hitting `/api/cron/budget-push` with `CRON_SECRET`.

## Troubleshooting

| Issue | Check |
|-------|-------|
| OAuth redirect error | Supabase redirect URLs match exact origin |
| Plaid Link won't open | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` |
| Chat 500 | `ANTHROPIC_API_KEY` |
| Theo tab $0 after buy | [THEO-FUND.md](./THEO-FUND.md), `/api/theo-fund/debug` |
| Cron 401 | `CRON_SECRET` matches Authorization header |
| Cron 404 No Plaid | At least one row in `plaid_connections` |

## Customize for your household

- **`lib/resolve-name.ts`** — map your Google emails to display names.
- **`lib/theo.ts`** — change `THEO_BIRTHDAY` or remove Theo-specific UI.
- **System prompt** in `app/api/chat/route.ts` — family names and budget amount ($6,000 hardcoded in several places).
