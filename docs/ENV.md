# Environment variables

Complete catalog of every `process.env.*` reference in the codebase. In production, set these in **Vercel → Project → Settings → Environment Variables**. Use [.env.example](../.env.example) as a variable-name reference only.

| Variable | Required | Where to get it | Format / notes | If missing |
|----------|----------|-----------------|----------------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Supabase → Project Settings → API → Project URL | `https://xxx.supabase.co` | App throws on Supabase client init |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes*** | Supabase → API → anon public key | JWT string | App throws (*or use publishable key) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional | Supabase → API → publishable key | `sb_publishable_...` | Fallback if anon key unset |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (cron) | Supabase → API → service_role secret | JWT; **never expose to client** | Cron returns errors; cannot bypass RLS |
| `ANTHROPIC_API_KEY` | **Yes** (chat) | [console.anthropic.com](https://console.anthropic.com) | `sk-ant-...` | Chat API 500 |
| `PLAID_CLIENT_ID` | **Yes** (budget) | [Plaid Dashboard](https://dashboard.plaid.com) → Production | String | Plaid API calls fail |
| `PLAID_SECRET` | **Yes** (budget) | Plaid Dashboard → Keys → **Production** secret | Production secret only | Plaid API calls fail |
| `PLAID_ENV` | **Yes** (budget) | — | Set to `production` | Must be `production` for real Chase |
| `COINBASE_API_KEY_NAME` | **Yes** (Theo buys) | [CDP Portal](https://portal.cdp.coinbase.com) → API Keys | `organizations/{org}/apiKeys/{id}` | Coinbase JWT/build fails |
| `COINBASE_API_PRIVATE_KEY` | **Yes** (Theo buys) | CDP Portal → download EC private key | PEM; use `\n` for newlines in Vercel: `"-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----\n"`. Code replaces `\\n` → newline. | Coinbase auth fails |
| `TRMNL_WEBHOOK_URL` | Optional | TRMNL → Custom Plugin → webhook URL | Full HTTPS URL with plugin ID | Reminder tools + cron push fail |
| `CRON_SECRET` | **Yes** (cron) | Generate: `openssl rand -hex 32` | Any secret string | Cron returns 401 |

\* One of `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is required.

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
2. Add each variable from [.env.example](../.env.example) for the **Production** environment (and Preview if needed).
3. Mark secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PLAID_SECRET`, `ANTHROPIC_API_KEY`, `COINBASE_API_PRIVATE_KEY`, `CRON_SECRET`) as sensitive.
4. Do not prefix server secrets with `NEXT_PUBLIC_`.
5. Redeploy after changing env vars.

## Coinbase private key tips

1. Create an **ECDSA ES256** key with **view** and **trade** permissions.
2. Single-line env value with escaped newlines is the most reliable for Vercel.
3. Verify with `/api/theo-fund/debug` → `coinbase.ok: true` while logged in.

## Debug endpoint env check

`GET /api/theo-fund/debug` returns booleans only (never secret values):

```json
{
  "env_present": {
    "COINBASE_API_KEY_NAME": true,
    "COINBASE_API_PRIVATE_KEY": true,
    "NEXT_PUBLIC_SUPABASE_URL": true,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": true
  }
}
```
