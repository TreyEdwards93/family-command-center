# Production deployment runbook

Step-by-step guide to deploy Family Command Center to production on Vercel with real Chase (Plaid Production), Supabase, and optional Theo Fund / TRMNL.

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Git** | Fork or clone the repository |
| **Supabase account** | Production project for auth + Postgres |
| **Google Cloud OAuth** | For Supabase Google provider |
| **Plaid Production access** | Required for real Chase; Transactions product enabled |
| **Anthropic account** | API key for Claude chat |
| **Coinbase CDP** | Production API key for Theo Fund market buys |
| **Vercel account** | Hosts the app and daily cron |
| **TRMNL device + plugin** | Optional — reminders and daily budget push |

## 2. Fork and clone

```bash
git clone https://github.com/TreyEdwards93/family-command-center.git
cd family-command-center
```

Push to your own GitHub fork if you plan to deploy from your account.

## 3. Supabase project (production)

1. Create a new project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Google**: enable, add OAuth client ID/secret from [Google Cloud Console](https://console.cloud.google.com) (OAuth consent screen + credentials).
3. **Authentication → URL Configuration** (use your production domain from the start):
   - Site URL: `https://YOUR_DOMAIN.vercel.app` (or custom domain)
   - Redirect URLs: `https://YOUR_DOMAIN.vercel.app/auth/callback` (add custom domain callback when you add one)
4. Copy **Project URL** and **anon key** (or publishable key) for Vercel env vars.
5. Copy **service_role** key for cron (keep secret — server-only).

## 4. Plaid Production (Chase)

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com).
2. Create an application; note **client_id**.
3. Enable the **Transactions** product.
4. **Apply for Production access** — required to connect real banks (Chase). Follow Plaid’s review process.
5. After approval, copy the **production secret** from Plaid Dashboard → Keys.
6. Set `PLAID_ENV=production` in Vercel (see [ENV.md](./ENV.md)).

## 5. Coinbase CDP (production keys)

1. Go to [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com).
2. Create API key: **ECDSA**, algorithm **ES256**.
3. Permissions: **view** + **trade** (Advanced Trade).
4. Save **key name** (`organizations/.../apiKeys/...`) and **private key** PEM.
5. Fund your Coinbase account with USD for market buys.

See [THEO-FUND.md](./THEO-FUND.md) for JWT details and troubleshooting.

## 6. Anthropic API key

1. [console.anthropic.com](https://console.anthropic.com) → API Keys → create key.
2. Add `ANTHROPIC_API_KEY` in Vercel (Production environment).

## 7. Deploy to Vercel

1. Import your GitHub repo in the [Vercel dashboard](https://vercel.com/new).
2. Framework preset: **Next.js** (auto-detected).
3. Deploy once to obtain your production URL (e.g. `https://your-project.vercel.app`).
4. Update Supabase **Site URL** and **Redirect URLs** (step 3) if the Vercel URL differs from what you configured initially.
5. Redeploy after env vars are set (step 8).

`vercel.json` in the repo configures a daily cron at `/api/cron/budget-push` (`0 12 * * *` UTC). Vercel Hobby allows one cron job per project.

## 8. Environment variables (Vercel)

Set all variables under **Project → Settings → Environment Variables** for **Production** (and Preview if you use preview deployments).

Use [.env.example](../.env.example) as a checklist of variable **names** — do not treat it as a local-dev file. Full descriptions: [ENV.md](./ENV.md).

**Required for core app:**

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key)
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production`
- `CRON_SECRET` — generate with `openssl rand -hex 32`

**Required for Theo Fund:**

- `COINBASE_API_KEY_NAME`, `COINBASE_API_PRIVATE_KEY`

**Optional:**

- `TRMNL_WEBHOOK_URL`

Mark server secrets as sensitive. Never prefix secrets with `NEXT_PUBLIC_`.

## 9. Run SQL schema

Run **[supabase/schema.sql](../supabase/schema.sql)** in Supabase → SQL Editor (single paste, run once).

Order inside the file:

1. `memories`
2. `plaid_connections`
3. `crypto_purchases`
4. RLS policies (idempotent `DROP POLICY IF EXISTS`)

Verify in **Table Editor** that all three tables exist with RLS enabled. See [DATABASE.md](./DATABASE.md) for table details.

## 10. Configure cron

1. Ensure `CRON_SECRET` is set in Vercel Production.
2. Ensure `SUPABASE_SERVICE_ROLE_KEY`, `TRMNL_WEBHOOK_URL` (if using TRMNL), and Plaid vars are set — cron reads budget data and pushes to TRMNL.
3. After deploy, test manually:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/budget-push
```

Expect `{ "ok": true }` when Plaid is connected and env is correct.

## 11. Production smoke test checklist

- [ ] `https://YOUR_DOMAIN/login` → Google OAuth → lands on home
- [ ] Sign out works
- [ ] Budget: Plaid Link connects Chase; transactions load
- [ ] Budget: Refresh button succeeds
- [ ] Chat: streaming response to "How are we doing this month?"
- [ ] Chat: save_memory persists (ask Claude to remember something; reload page)
- [ ] Memories API: `GET /api/memories` returns JSON (browser session)
- [ ] Theo: `/api/theo-roundup/pending` shows pending or zero
- [ ] Theo: preview round-up in chat (no confirm)
- [ ] Theo: `/api/theo-fund/debug` shows `auth.present: true`
- [ ] Cron: manual curl returns `{ "ok": true }`
- [ ] TRMNL: reminder push from chat (if configured)

## 12. TRMNL (optional)

1. Create a **Custom Plugin** in TRMNL dashboard.
2. Design Liquid template with branches for `state`: `idle`, `reminder`, `budget`.
3. Copy webhook URL → `TRMNL_WEBHOOK_URL` in Vercel.
4. Chat tools `push_reminder` / `clear_reminder` POST merge variables.
5. Daily cron sends `state: budget` with spending metrics — see [ARCHITECTURE.md](./ARCHITECTURE.md).

**Vercel Hobby:** one cron per day (`0 12 * * *` UTC). More frequent updates require Pro or an external scheduler hitting `/api/cron/budget-push` with `CRON_SECRET`.

## Troubleshooting

| Issue | Check |
|-------|-------|
| OAuth redirect error | Supabase redirect URLs match exact production origin |
| Plaid Link won't open | `PLAID_CLIENT_ID`, production `PLAID_SECRET`, `PLAID_ENV=production` |
| Plaid production not approved | Complete Plaid production access request in dashboard |
| Chat 500 | `ANTHROPIC_API_KEY` in Vercel Production |
| Theo tab $0 after buy | [THEO-FUND.md](./THEO-FUND.md), `/api/theo-fund/debug` |
| Cron 401 | `CRON_SECRET` matches Authorization header |
| Cron 404 No Plaid | At least one row in `plaid_connections` (connect Chase in Budget tab) |

## Customize for your household

- **`lib/resolve-name.ts`** — map your Google emails to display names.
- **`lib/theo.ts`** — change `THEO_BIRTHDAY` or remove Theo-specific UI.
- **System prompt** in `app/api/chat/route.ts` — family names and budget amount ($6,000 hardcoded in several places).
