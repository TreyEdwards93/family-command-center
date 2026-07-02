# AI-assisted production replication

Paste this repo into your AI tool and use this page as the execution contract. Follow docs in order; do not skip verification gates.

## Handoff prompt (copy to your AI)

```
Replicate Family Command Center in production on Vercel.

Read in order:
1. docs/AI-REPLICATION.md (this file — constraints and gates)
2. docs/SETUP.md (numbered steps — execute top to bottom)
3. docs/ENV.md + .env.example (every env var in Vercel)
4. docs/DATABASE.md + supabase/schema.sql (run SQL once)
5. docs/THEO-FUND.md (only if enabling Theo Fund / Coinbase)
6. docs/ARCHITECTURE.md (reference for routes, cron, auth)

Hard constraints:
- Plaid: PLAID_ENV=production and production secret (defaults to sandbox if unset)
- Coinbase: ECDSA ES256 key only — not Ed25519
- Never commit secrets; set all values in Vercel → Environment Variables
- OAuth callback path in app code: /auth/callback (not /api/auth/callback)
- Google Cloud redirect URI goes to Supabase: https://PROJECT_REF.supabase.co/auth/v1/callback
- Supabase redirect URL goes to app: https://YOUR_VERCEL_DOMAIN/auth/callback
- No Plaid webhooks in this codebase; no Plaid OAuth redirect URI needed
- Cron requires TRMNL_WEBHOOK_URL for { ok: true }; auth is Authorization: Bearer CRON_SECRET
- Set NEXT_PUBLIC_MONTH_BUDGET in Vercel to your household monthly budget (USD); defaults to 6000 if unset

After each SETUP phase, run that phase's Verification bullets before continuing.
```

## Doc read order

| Order | File | Purpose |
|-------|------|---------|
| 1 | [SETUP.md](./SETUP.md) | Ordered deployment checklist |
| 2 | [ENV.md](./ENV.md) | Env var catalog + Vercel targets |
| 3 | [DATABASE.md](./DATABASE.md) + [schema.sql](../supabase/schema.sql) | Tables, RLS, idempotent apply |
| 4 | [THEO-FUND.md](./THEO-FUND.md) | Coinbase JWT, round-ups (if using crypto) |
| 5 | [ARCHITECTURE.md](./ARCHITECTURE.md) | API catalog, auth pattern, cron config |

Reference only: [PRD.md](./PRD.md) (user stories), [CONTRIBUTING.md](../CONTRIBUTING.md) (extending code).

## Hard constraints

| Area | Rule |
|------|------|
| **Secrets** | Vercel only. Never commit `.env` or paste secrets into docs/issues. |
| **Plaid** | `PLAID_ENV=production` + production secret. Code defaults to `sandbox` if `PLAID_ENV` is missing. |
| **Plaid webhooks** | Not used. Transaction sync is on-demand (page load / refresh). |
| **Coinbase** | ECDSA ES256 (`view` + `trade`). Ed25519 keys fail JWT signing. |
| **Supabase keys** | `NEXT_PUBLIC_*` for client; `SUPABASE_SERVICE_ROLE_KEY` server-only (cron bypasses RLS). |
| **OAuth paths** | App callback: `GET /auth/callback`. No `middleware.ts` — auth is per-route. |
| **Cron** | `vercel.json` → `GET /api/cron/budget-push` at `0 12 * * *` UTC. Vercel sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is set. |
| **Budget** | `NEXT_PUBLIC_MONTH_BUDGET` — monthly spend ceiling for Budget tab, chat tools, and TRMNL push. Set your own amount in Vercel. |

## Exact URLs (replace placeholders)

| Setting | Where | Value pattern |
|---------|-------|---------------|
| Google OAuth redirect | Google Cloud Console → OAuth client → Authorized redirect URIs | `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` |
| Supabase Site URL | Supabase → Authentication → URL Configuration | `https://YOUR_VERCEL_DOMAIN` |
| Supabase Redirect URLs | Same | `https://YOUR_VERCEL_DOMAIN/auth/callback` |
| App OAuth handler | Code: `app/login/page.tsx` → `redirectTo` | `${origin}/auth/callback` |
| Cron manual test | Terminal | `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_VERCEL_DOMAIN/api/cron/budget-push` |
| Plaid webhook | — | **None** (not implemented) |

Custom domain: add `https://your-custom-domain/auth/callback` to Supabase Redirect URLs when the domain is live.

## Verification gates (summary)

Run after completing the matching [SETUP.md](./SETUP.md) section.

| Phase | Success looks like |
|-------|-------------------|
| Supabase + Google OAuth | Google provider enabled; Site URL + redirect URL set; can reach `/login` after first Vercel deploy |
| Plaid Production | Dashboard shows Production access; `PLAID_ENV=production` in Vercel |
| Vercel deploy | Production URL loads; env vars set per [ENV.md](./ENV.md) |
| SQL schema | Table Editor shows `memories`, `plaid_connections`, `crypto_purchases` with RLS on |
| Login | `https://YOUR_DOMAIN/login` → Google → lands on `/` |
| Plaid | Budget tab connects Chase; transactions load |
| Chat | Streaming reply; `GET /api/memories` returns JSON while logged in |
| Theo (optional) | `GET /api/theo-fund/debug` → `auth.present: true`, `coinbase.ok: true` |
| Cron (TRMNL) | Manual curl → `{"ok":true,"pushed":{...}}`; without `TRMNL_WEBHOOK_URL` → 500 (expected) |

Full smoke checklist: [SETUP.md §11](./SETUP.md#11-production-smoke-test-checklist).

## Common failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| OAuth redirect error | Mismatch between Supabase redirect URLs and production origin | Match exact `https://YOUR_VERCEL_DOMAIN/auth/callback`; redeploy |
| Google "redirect_uri_mismatch" | Google Console URI points to app instead of Supabase | Use `https://PROJECT_REF.supabase.co/auth/v1/callback` |
| Plaid Link fails / sandbox data | Missing or wrong `PLAID_ENV` | Set `PLAID_ENV=production` and production secret |
| Chat 500 | Missing `ANTHROPIC_API_KEY` | Set in Vercel Production, redeploy |
| Theo $0 / auth errors | Ed25519 key or bad PEM newlines | ECDSA ES256; escape `\n` in Vercel; check `/api/theo-fund/debug` |
| Cron 401 | Wrong or missing `CRON_SECRET` | Regenerate; manual curl must send `Bearer` prefix |
| Cron 404 | No Plaid row | Connect Chase in Budget tab first |
| Cron 500 TRMNL | `TRMNL_WEBHOOK_URL` unset | Set webhook URL or skip cron until TRMNL configured |
| RLS / empty Theo data | Purchases inserted under wrong user or blocked | Use logged-in session; check `purchases_query_error` in debug JSON |
| Re-run SQL | Policies already exist | Safe — `schema.sql` uses `DROP POLICY IF EXISTS` |

## User-specific values (you must supply)

These cannot be documented with real values:

- Vercel production domain
- Supabase project ref, URL, keys
- Google OAuth client ID/secret
- Plaid production client ID/secret (after Plaid approval)
- Anthropic API key
- Coinbase CDP key name + EC private key PEM
- `CRON_SECRET` (generate locally)
- `TRMNL_WEBHOOK_URL` (if using TRMNL)
- Household customizations: `lib/resolve-name.ts`, budget amount in chat prompt, `lib/theo.ts` birthday
