# Production deployment runbook

Step-by-step guide to deploy Family Command Center to production on Vercel with real Chase (Plaid Production), Supabase, and optional Theo Fund / TRMNL.

**For AI assistants:** Start with [AI-REPLICATION.md](./AI-REPLICATION.md) — doc order, hard constraints, and verification gates. Execute this file top to bottom without skipping **Verification** bullets.

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

**Verification**

- [ ] Accounts created for Supabase, Google Cloud, Plaid, Anthropic, Vercel (and Coinbase if using Theo Fund)

## 2. Fork and clone

```bash
git clone https://github.com/TreyEdwards93/family-command-center.git
cd family-command-center
```

Push to your own GitHub fork if you plan to deploy from your account.

**Verification**

- [ ] Repo cloned; `package.json` and `vercel.json` present at repo root

## 3. Supabase project (production)

1. Create a new project at [supabase.com](https://supabase.com).
2. Note your **Project ref** (subdomain in Project URL, e.g. `abcdefghijklmnop` from `https://abcdefghijklmnop.supabase.co`).

### 3a. Google Cloud OAuth (for Supabase)

1. [Google Cloud Console](https://console.cloud.google.com) → select or create a project.
2. **APIs & Services → OAuth consent screen** — configure (External is fine for household use); add scopes `email`, `profile`, `openid`.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
4. **Authorized redirect URIs** — add exactly:
   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```
   Replace `YOUR_PROJECT_REF` with your Supabase project ref. Do **not** put the Vercel app URL here.
5. Copy **Client ID** and **Client secret**.

### 3b. Supabase Google provider + URL config

1. Supabase → **Authentication → Providers → Google** — enable; paste Client ID and secret from step 3a.
2. **Authentication → URL Configuration** (use production domain; update after first Vercel deploy if URL unknown):
   - **Site URL:** `https://YOUR_VERCEL_DOMAIN` (e.g. `https://family-command-center.vercel.app`)
   - **Redirect URLs:** `https://YOUR_VERCEL_DOMAIN/auth/callback`
   - When you add a custom domain, add `https://your-custom-domain/auth/callback` here too.
3. Copy **Project URL** and **anon key** (or publishable key) for Vercel env vars.
4. Copy **service_role** key for cron (keep secret — server-only).

App OAuth flow (for reference): `app/login/page.tsx` → Google via Supabase → redirect to **`/auth/callback`** (`app/auth/callback/route.ts`) → session cookies.

**Verification**

- [ ] Google provider enabled in Supabase with client ID/secret
- [ ] Google Console redirect URI is `https://PROJECT_REF.supabase.co/auth/v1/callback`
- [ ] Supabase Site URL and Redirect URLs use `https://YOUR_VERCEL_DOMAIN/auth/callback`
- [ ] Project URL, anon/publishable key, and service_role key copied for step 8

## 4. Plaid Production (Chase)

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com).
2. Create an application; note **client_id**.
3. Enable the **Transactions** product.
4. **Apply for Production access** — required to connect real banks (Chase). Follow Plaid’s review process.
5. After approval, copy the **production secret** from Plaid Dashboard → Keys (not Sandbox).
6. Set `PLAID_ENV=production` in Vercel (see [ENV.md](./ENV.md)).

**No Plaid webhook or app redirect URI** — Link runs in-browser; sync is on page load / refresh only.

**Verification**

- [ ] Plaid Dashboard shows Production access approved
- [ ] Production `client_id` and secret copied
- [ ] Plan to set `PLAID_ENV=production` (code defaults to `sandbox` if unset)

## 5. Coinbase CDP (production keys)

1. Go to [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com).
2. Create API key: **ECDSA**, algorithm **ES256** (not Ed25519).
3. Permissions: **view** + **trade** (Advanced Trade).
4. Save **key name** (`organizations/.../apiKeys/...`) and **private key** PEM.
5. Fund your Coinbase account with USD for market buys.

See [THEO-FUND.md](./THEO-FUND.md) for JWT details and troubleshooting.

**Verification**

- [ ] Key type is ECDSA ES256 with view + trade
- [ ] Key name and PEM saved for step 8

## 6. Anthropic API key

1. [console.anthropic.com](https://console.anthropic.com) → API Keys → create key.
2. Add `ANTHROPIC_API_KEY` in Vercel (Production environment).

**Verification**

- [ ] API key created (starts with `sk-ant-`)

## 7. Deploy to Vercel

1. Import your GitHub repo in the [Vercel dashboard](https://vercel.com/new).
2. Framework preset: **Next.js** (auto-detected).
3. Deploy once to obtain your production URL (e.g. `https://your-project.vercel.app`).
4. Update Supabase **Site URL** and **Redirect URLs** (step 3b) if the Vercel URL differs from what you configured initially.
5. Redeploy after env vars are set (step 8).

### Cron schedule (`vercel.json`)

Repo root `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/budget-push",
      "schedule": "0 12 * * *"
    }
  ]
}
```

- **Path:** `GET /api/cron/budget-push`
- **Schedule:** daily at 12:00 UTC
- **Auth:** Vercel injects `Authorization: Bearer <CRON_SECRET>` on scheduled invocations when `CRON_SECRET` is set in Production. Manual tests must use the same header (`app/api/cron/budget-push/route.ts`).
- **Vercel Hobby:** one cron job per project.

**Verification**

- [ ] Production deployment URL known
- [ ] Supabase Site URL + Redirect URLs match that domain
- [ ] `vercel.json` cron present in deployed commit

## 8. Environment variables (Vercel)

Set all variables under **Project → Settings → Environment Variables**. Full catalog: [ENV.md](./ENV.md).

Use [.env.example](../.env.example) as a checklist of variable **names** — do not treat it as a local-dev file.

**Required for core app:**

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key)
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production`
- `CRON_SECRET` — generate with `openssl rand -hex 32`

**Required for Theo Fund:**

- `COINBASE_API_KEY_NAME`, `COINBASE_API_PRIVATE_KEY`

**Optional:**

- `TRMNL_WEBHOOK_URL` — required for cron success response and TRMNL features

Mark server secrets as sensitive. Never prefix secrets with `NEXT_PUBLIC_`. Redeploy after changes.

**Verification**

- [ ] Every var from `.env.example` that you need is set for the correct Vercel environment (see ENV.md column)
- [ ] `PLAID_ENV` is exactly `production`
- [ ] Sensitive vars marked sensitive in Vercel

## 9. Run SQL schema

Run **[supabase/schema.sql](../supabase/schema.sql)** in Supabase → SQL Editor (single paste, run once).

Order inside the file:

1. `memories`
2. `plaid_connections`
3. `crypto_purchases`
4. RLS policies (idempotent `DROP POLICY IF EXISTS`)

**Re-run safe:** `CREATE TABLE IF NOT EXISTS` and `DROP POLICY IF EXISTS` — policies are replaced; tables are not dropped.

If rebuilding from scratch, drop tables first (see [DATABASE.md](./DATABASE.md)).

**Verification**

- [ ] SQL editor reports success
- [ ] Table Editor shows `memories`, `plaid_connections`, `crypto_purchases` with RLS enabled

## 10. Configure cron

1. Ensure `CRON_SECRET` is set in Vercel **Production**.
2. Ensure `SUPABASE_SERVICE_ROLE_KEY`, `TRMNL_WEBHOOK_URL`, and Plaid vars are set — cron reads budget data and POSTs to TRMNL.
3. Connect Chase in the Budget tab first (cron uses the first `plaid_connections` row).
4. After deploy, test manually:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_VERCEL_DOMAIN/api/cron/budget-push
```

| Response | Meaning |
|----------|---------|
| `401 Unauthorized` | Wrong or missing `CRON_SECRET` / Bearer header |
| `404` + `No Plaid connection found` | No row in `plaid_connections` — connect Chase |
| `500` + `TRMNL_WEBHOOK_URL not configured` | Set TRMNL webhook or skip cron until configured |
| `200` + `{"ok":true,"pushed":{...}}` | Success |

**Verification**

- [ ] Manual curl returns expected status per table above
- [ ] With TRMNL configured, TRMNL device shows budget state

## 11. Production smoke test checklist

Replace `YOUR_VERCEL_DOMAIN` with your production origin.

- [ ] `https://YOUR_VERCEL_DOMAIN/login` → Google OAuth → lands on `/`
- [ ] Sign out works; `/` redirects to `/login` when logged out
- [ ] Budget: Plaid Link connects Chase; transactions load
- [ ] Budget: Refresh button succeeds
- [ ] Chat: streaming response to "How are we doing this month?"
- [ ] Chat: save_memory persists (ask Claude to remember something; reload page)
- [ ] Memories API: `GET /api/memories` returns JSON (browser session)
- [ ] Theo: `GET /api/theo-roundup/pending` shows pending or zero
- [ ] Theo: preview round-up in chat (no confirm)
- [ ] Theo: `GET /api/theo-fund/debug` shows `auth.present: true` and `coinbase.ok: true`
- [ ] Cron: manual curl returns `{"ok":true,...}` (requires TRMNL + Plaid)
- [ ] TRMNL: reminder push from chat (if configured)

## 12. TRMNL (optional)

1. Create a **Custom Plugin** in TRMNL dashboard.
2. Design Liquid template with branches for `state`: `idle`, `reminder`, `budget`.
3. Copy webhook URL → `TRMNL_WEBHOOK_URL` in Vercel.
4. Chat tools `push_reminder` / `clear_reminder` POST merge variables.
5. Daily cron sends `state: budget` with spending metrics — see [ARCHITECTURE.md](./ARCHITECTURE.md).

**Vercel Hobby:** one cron per day (`0 12 * * *` UTC). More frequent updates require Pro or an external scheduler hitting `/api/cron/budget-push` with `Authorization: Bearer CRON_SECRET`.

**Verification**

- [ ] Chat reminder appears on TRMNL
- [ ] Cron push updates budget state on device

## Troubleshooting

| Issue | Check |
|-------|-------|
| OAuth redirect error | Supabase redirect URLs match exact production origin (`/auth/callback`) |
| Google `redirect_uri_mismatch` | Google Console URI is Supabase `.../auth/v1/callback`, not Vercel |
| Plaid Link won't open | `PLAID_CLIENT_ID`, production `PLAID_SECRET`, `PLAID_ENV=production` |
| Plaid sandbox / wrong bank | `PLAID_ENV` missing → defaults to sandbox in `lib/plaid.ts` |
| Plaid production not approved | Complete Plaid production access request in dashboard |
| Chat 500 | `ANTHROPIC_API_KEY` in Vercel Production |
| Theo tab $0 after buy | [THEO-FUND.md](./THEO-FUND.md), `/api/theo-fund/debug` |
| Coinbase 401 | ECDSA ES256 key, not Ed25519; check PEM `\n` escaping in Vercel |
| Cron 401 | `CRON_SECRET` matches `Authorization: Bearer` header |
| Cron 404 No Plaid | At least one row in `plaid_connections` (connect Chase in Budget tab) |
| Cron 500 TRMNL | Set `TRMNL_WEBHOOK_URL` or expect failure until configured |
| RLS / missing purchase rows | Debug endpoint `purchases_query_error`; ensure logged-in user matches inserts |

## Customize for your household

- **`lib/resolve-name.ts`** — map your Google emails to display names.
- **`lib/theo.ts`** — change `THEO_BIRTHDAY` or remove Theo-specific UI.
- **System prompt** in `app/api/chat/route.ts` — family names and budget amount ($6,000 hardcoded in several places).
