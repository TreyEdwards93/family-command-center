# Environment variables

Complete catalog of every `process.env.*` reference in the codebase. In production, set these in **Vercel → Project → Settings → Environment Variables**. Use [.env.example](../.env.example) as a variable-name reference only.

| Variable | Required | Vercel environment | Where to get it | Format / notes | If missing |
|----------|----------|-------------------|-----------------|----------------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Production, Preview | Supabase → Project Settings → API → Project URL | `https://xxx.supabase.co` | App throws on Supabase client init |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes*** | Production, Preview | Supabase → API → anon public key | JWT string | App throws (*or use publishable key) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional | Production, Preview | Supabase → API → publishable key | `sb_publishable_...` | Fallback if anon key unset |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (cron) | Production | Supabase → API → service_role secret | JWT; **never expose to client** | Cron returns errors; cannot bypass RLS |
| `ANTHROPIC_API_KEY` | **Yes** (chat) | Production, Preview | [console.anthropic.com](https://console.anthropic.com) | `sk-ant-...` | Chat API 500 |
| `PLAID_CLIENT_ID` | **Yes** (budget) | Production, Preview | [Plaid Dashboard](https://dashboard.plaid.com) → Production | String | Plaid API calls fail |
| `PLAID_SECRET` | **Yes** (budget) | Production, Preview | Plaid Dashboard → Keys → **Production** secret | Production secret only | Plaid API calls fail |
| `PLAID_ENV` | **Yes** (budget) | Production, Preview | — | Must be `production` for real Chase; code defaults to `sandbox` if unset | Sandbox keys / wrong environment |
| `COINBASE_API_KEY_NAME` | **Yes** (Theo buys) | Production | [CDP Portal](https://portal.cdp.coinbase.com) → API Keys | `organizations/{org}/apiKeys/{id}` | Coinbase JWT/build fails |
| `COINBASE_API_PRIVATE_KEY` | **Yes** (Theo buys) | Production | CDP Portal → download EC private key | PEM; use `\n` for newlines in Vercel: `"-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"`. Code replaces `\\n` → newline. **ECDSA ES256 only.** | Coinbase auth fails |
| `TRMNL_WEBHOOK_URL` | Optional† | Production | TRMNL → Custom Plugin → webhook URL | Full HTTPS URL with plugin ID | Reminder tools fail; cron returns 500 |
| `CRON_SECRET` | **Yes** (cron) | Production | Generate: `openssl rand -hex 32` | Any secret string; Vercel cron sends `Authorization: Bearer <value>` | Cron returns 401 |

\* One of `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is required.

† Required for `/api/cron/budget-push` to return `{ ok: true }`; optional for core app without TRMNL.

## Feature matrix

| Feature | Required vars |
|---------|----------------|
| Login / session | `NEXT_PUBLIC_SUPABASE_URL`, anon or publishable key |
| Chat (no tools) | + `ANTHROPIC_API_KEY` |
| Budget / Plaid (Chase) | + `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=production` |
| Theo Fund trades | + `COINBASE_API_KEY_NAME`, `COINBASE_API_PRIVATE_KEY` |
| TRMNL reminders (chat) | + `TRMNL_WEBHOOK_URL` |
| Daily budget cron | + `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TRMNL_WEBHOOK_URL`, Plaid connection in DB |

## Vercel configuration

1. Open **Project → Settings → Environment Variables**.
2. Add each variable from [.env.example](../.env.example) using the **Vercel environment** column above.
3. Mark secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PLAID_SECRET`, `ANTHROPIC_API_KEY`, `COINBASE_API_PRIVATE_KEY`, `CRON_SECRET`) as sensitive.
4. Do not prefix server secrets with `NEXT_PUBLIC_`.
5. Redeploy after changing env vars.

**Preview vs Production:** Set `NEXT_PUBLIC_*` and Plaid/Anthropic on Preview if you test preview deployments. Cron and TRMNL typically need Production only (Vercel crons run on Production).

## Coinbase private key tips

1. Create an **ECDSA ES256** key with **view** and **trade** permissions — not Ed25519.
2. Single-line env value with escaped newlines is the most reliable for Vercel.
3. Verify with `/api/theo-fund/debug` → `coinbase.ok: true` while logged in.

## Debug endpoint env check

`GET /api/theo-fund/debug` returns booleans only (never secret values):

```json
{
  "auth": { "present": true, "user_id": "..." },
  "coinbase": { "ok": true },
  "env_present": {
    "COINBASE_API_KEY_NAME": true,
    "COINBASE_API_PRIVATE_KEY": true,
    "NEXT_PUBLIC_SUPABASE_URL": true,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": true
  }
}
```
