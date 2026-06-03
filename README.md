# Family Command Center

A household operations app for the Edwards family (Trey, Channing, and Theo). It combines a Claude-powered chat assistant, real Chase spending data via Plaid, and a TRMNL e-ink display into a single mobile-first web app.

**Production URL:** https://edwards-command-center.vercel.app  
**GitHub:** https://github.com/TreyEdwards93/family-command-center  
**Vercel Team:** edwards-command-center / project: family-command-center  
**Supabase Project:** https://supabase.com/dashboard/project/rcodsamrovcjmpspzbsw

---

## What It Does

- **Chat tab**: Talk to Claude. Claude can push/clear reminders on the TRMNL display, pull real Chase transaction data, and remember things you tell it (budget targets, preferences, recurring expenses).
- **Budget tab**: Shows current month spending vs. $6,000 budget. Categories come from Plaid's personal finance category system. Budget targets are stored in the `memories` table by Claude or manually.
- **TRMNL cron**: Every day at 12pm UTC (8am ET), a cron job pushes a budget snapshot to the TRMNL display — top spending categories, monthly pace, days remaining.

---

## Architecture

### Stack
- **Next.js 16** (App Router, Turbopack)
- **Supabase** (Postgres + Auth with Google OAuth + RLS)
- **Anthropic Claude** (`claude-sonnet-4-6`, streaming via SSE)
- **Plaid** (production, Chase transactions)
- **TRMNL** (e-ink display, custom plugin webhook)
- **Vercel** (Hobby plan — one cron/day limit)

### File Map

```
app/
  page.tsx                          # Home — auth check, renders CommandCenter
  login/
    page.tsx                        # Login page (server component)
    login-client.tsx                # Google OAuth button (client component)
  auth/
    callback/route.ts               # OAuth callback — exchanges code for session
  api/
    chat/route.ts                   # Claude streaming chat + tool execution
    memories/route.ts               # GET — returns all memories for authed user
    plaid/
      create-link-token/route.ts    # POST — creates Plaid Link token
      exchange-token/route.ts       # POST — exchanges public token, stores in DB
      transactions/route.ts         # GET — fetches 90 days of transactions
    cron/
      budget-push/route.ts          # GET — daily cron, pushes budget to TRMNL

components/
  command-center.tsx                # Main two-tab UI (chat + budget)

lib/
  plaid.ts                          # Plaid client singleton
  resolve-name.ts                   # Maps email → display name (Trey/Channing)
  supabase/
    client.ts                       # Browser Supabase client
    server.ts                       # Server Supabase client (uses cookies)
    env.ts                          # Shared env helpers for Supabase URL/key

vercel.json                         # Cron schedule: 0 12 * * * (daily 12pm UTC)
next.config.ts                      # serverExternalPackages: ["plaid"]
```

---

## Supabase Tables

Run these in the Supabase SQL editor if rebuilding from scratch.

### plaid_connections
```sql
create table plaid_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  access_token text not null,
  item_id text not null,
  institution_name text default 'Chase',
  created_at timestamptz default now()
);
alter table plaid_connections enable row level security;
create policy "own connections" on plaid_connections
  for all using (auth.uid() = user_id);
```

### memories
```sql
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  key text not null,
  value text not null,
  updated_at timestamptz default now(),
  unique(user_id, key)
);
alter table memories enable row level security;
create policy "own memories" on memories
  for all using (auth.uid() = user_id);
```

**Important memory keys Claude uses:**
- `budget_targets` — JSON object: `{"FOOD_AND_DRINK": 800, "SHOPPING": 400, ...}`
  - Uses Plaid personal_finance_category primary names (all caps, underscores)
- Any `budget_target_<category>` keys — individual targets (legacy, also supported)

---

## Environment Variables

All of these must be set in **Vercel → Settings → Environment Variables** (Production + Preview). The `.env.local` file is gitignored and used for local dev only.

| Variable | Used In | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase clients | Public, safe to expose |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Supabase clients | Public, safe to expose |
| `ANTHROPIC_API_KEY` | `app/api/chat/route.ts` | Secret |
| `TRMNL_WEBHOOK_URL` | `app/api/chat/route.ts`, `app/api/cron/budget-push/route.ts` | Full webhook URL including plugin ID |
| `PLAID_CLIENT_ID` | `lib/plaid.ts` | From Plaid dashboard |
| `PLAID_SECRET` | `lib/plaid.ts` | Production secret from Plaid |
| `PLAID_ENV` | `lib/plaid.ts` | Set to `production` |
| `CRON_SECRET` | `app/api/cron/budget-push/route.ts` | Any random string — must match what you use in the curl Authorization header |
| `SUPABASE_SERVICE_ROLE_KEY` | `app/api/cron/budget-push/route.ts` | Service role key from Supabase → Project Settings → API → Secret keys. Needed because cron runs without a user session and must bypass RLS. |

**Current CRON_SECRET:** `6cd91e0e762fab953ea04a85084204f5f001c03ca9fa815ab54a08dd1f6849e6`

---

## The Vercel Alias Problem

**This is the #1 operational gotcha.**

The production domain `edwards-command-center.vercel.app` is a manually-set alias — it does NOT auto-update when new deployments happen. After every deploy you must re-point it:

```bash
# 1. Find the latest Ready deployment URL
npx vercel ls --scope edwards-command-center

# 2. Re-point the alias
npx vercel alias set <new-deployment-url> edwards-command-center.vercel.app --scope edwards-command-center
```

Or use the Vercel dashboard: Deployments → click the latest → Promote to Production.

**Why this happens:** The team name is `edwards-command-center` and project name is `family-command-center`, so the auto-managed production alias is `family-command-center-edwards-command-center.vercel.app`, not the custom `edwards-command-center.vercel.app` domain.

---

## TRMNL Display

**Plugin type:** Custom Plugin (private)  
**Webhook URL:** stored in `TRMNL_WEBHOOK_URL`

### Payload Schema

The `state` field controls which template branch renders.

**Reminder state** (pushed by Claude via chat):
```json
{
  "merge_variables": {
    "state": "reminder",
    "reminder_text": "Pick up dry cleaning",
    "reminder_by": "Trey"
  }
}
```

**Idle state** (pushed by Claude to clear):
```json
{
  "merge_variables": {
    "state": "idle",
    "reminder_text": ""
  }
}
```

**Budget state** (pushed by daily cron):
```json
{
  "merge_variables": {
    "state": "budget",
    "month": "June",
    "days_remaining": 28,
    "total_spent": 1219,
    "total_budget": 6000,
    "percent_used": 20,
    "monthly_pace": 4500,
    "on_pace": true,
    "cat1_name": "FOOD_AND_DRINK",
    "cat1_spent": 420,
    "cat1_target": 800,
    "cat1_percent": 53,
    "cat1_status": "ok",
    "cat2_name": "SHOPPING",
    "cat2_spent": 310,
    "cat2_target": 400,
    "cat2_percent": 78,
    "cat2_status": "ok"
  }
}
```

`cat1`–`cat4` are the top categories by spend (over-budget first, then % descending). Only categories with `spent > 0` are included — no padding with empty entries.

**Status values:** `ok` (under 80%), `warning` (80–99%), `over` (100%+)

The TRMNL plugin template uses Liquid-style conditionals to branch on `state`. Update the template in the TRMNL dashboard → Plugins → Family Command Center → Edit markup.

---

## How to Test Each Piece

### Trigger the cron manually
```bash
curl -H "Authorization: Bearer 6cd91e0e762fab953ea04a85084204f5f001c03ca9fa815ab54a08dd1f6849e6" \
  https://edwards-command-center.vercel.app/api/cron/budget-push
```
Expected response: `{"ok":true,"pushed":{"month":"June","total_spent":...}}`

### Test chat locally
```bash
npm run dev
# Open http://localhost:3000
# Log in with Google
# Ask "how are we doing on spending this month?"
```

### Test Plaid connection
Visit the Budget tab — if connected, shows real transactions. If not, shows "Connect Chase" button.

### Check memories
```bash
curl https://edwards-command-center.vercel.app/api/memories \
  -H "Cookie: <your session cookie>"
```
Or ask Claude: "What do you remember about our budget?"

### Reconnect Chase (if token expires)
Click "Connect Chase" in the Budget tab → goes through Plaid Link → token stored in `plaid_connections`.

---

## Known Issues & Key Decisions

### No middleware/proxy
Multiple attempts were made to use Next.js middleware for auth (both `middleware.ts` and Next.js 16's `proxy.ts`). All failed in production due to Edge runtime bundling — Plaid's dependencies use Node.js APIs (`__dirname`) that aren't available in the Edge runtime, and `@supabase/ssr` pulled in local `@/lib/supabase/env` which also broke the Edge bundle. Solution: removed middleware entirely. Auth is handled server-side in each route/page.

### Vercel Hobby plan = 1 cron per day
The `0 */6 * * *` schedule (every 6 hours) fails deployment on Hobby. Changed to `0 12 * * *` (daily at 12pm UTC). To get more frequent pushes, upgrade to Vercel Pro.

### Service role key for cron
The cron runs without a user session (no cookies). Supabase RLS policies require `auth.uid() = user_id`, which fails for unauthenticated requests. The cron uses `SUPABASE_SERVICE_ROLE_KEY` directly to bypass RLS. This key must **never** be exposed to the browser.

### Plaid personal finance categories
Using `personal_finance_category.primary` (e.g., `FOOD_AND_DRINK`, `SHOPPING`) instead of the legacy `category[0]` array (e.g., `"Food and Drink"`). The new system is more accurate. Budget targets saved in memory must use the new ALL_CAPS format to match.

### Memory key format for budget targets
Claude saves budget targets as a JSON blob under `budget_targets`. The system prompt instructs Claude to use exact Plaid primary category names. If Claude previously saved targets with the old format (e.g., `"Food and Drink": 800`), they won't match the new `FOOD_AND_DRINK` keys. Ask Claude to re-save them: *"Please re-save our budget targets using the correct Plaid category names."*

---

## Resuming Development in a New Session

When starting a new Cursor session, paste this context block:

> **Project:** Family Command Center — Next.js 16 App Router, Supabase auth (Google OAuth), Claude claude-sonnet-4-6 chat with streaming, Plaid production (Chase), TRMNL e-ink display.
>
> **Repo:** `TreyEdwards93/family-command-center` on GitHub. Production: `https://edwards-command-center.vercel.app` (Vercel team: edwards-command-center, Hobby plan).
>
> **Key gotcha:** The Vercel alias `edwards-command-center.vercel.app` must be manually re-pointed after every deploy using `npx vercel alias set <new-url> edwards-command-center.vercel.app --scope edwards-command-center`.
>
> **No middleware** — auth handled per-route. No `middleware.ts` or `proxy.ts`.
>
> **Supabase tables:** `plaid_connections` (user_id, access_token, item_id, institution_name) and `memories` (user_id, key, value) — both with RLS.
>
> **Cron:** `GET /api/cron/budget-push` — Bearer token auth via `CRON_SECRET`. Uses Supabase service role key to bypass RLS. Runs daily at 12pm UTC on Vercel Hobby.
>
> **See README.md for full details.**

---

## Roadmap / What's Next

### High priority
- [ ] **Auto-alias on deploy** — Add a post-deploy GitHub Action or Vercel webhook that automatically re-points `edwards-command-center.vercel.app` to the latest production deployment, eliminating the manual alias step
- [ ] **Upgrade to Vercel Pro** — Unlocks multiple cron schedules per day (e.g., every 6 hours for TRMNL updates)
- [ ] **Fix memory/category mismatch** — Ask Claude to re-save `budget_targets` using new Plaid ALL_CAPS category names so budget tab and cron match

### Features
- [ ] **Multi-user budget view** — Both Trey and Channing can see each other's spending context; currently memories are per-user
- [ ] **Recurring expense tracker** — Claude notices and remembers monthly charges (rent, subscriptions) and factors them into remaining budget
- [ ] **TRMNL idle screen** — Design a proper idle state showing date, Theo's age in weeks, and a motivational note
- [ ] **Push notifications** — Alert when a category hits 80% of its target mid-month
- [ ] **Historical budget report** — Month-end summary Claude can generate and optionally push to TRMNL
- [ ] **Multiple bank accounts** — Currently assumes one Chase connection per household; extend to support multiple `plaid_connections` rows per user and aggregate across accounts

### Technical debt
- [ ] **Plaid webhook for real-time sync** — Currently polling on page load; Plaid can push transaction updates via webhook to keep data fresh
- [ ] **Error boundary in Budget tab** — If Plaid or Supabase is down, the tab shows a blank loading state with no feedback
- [ ] **Shared household Supabase user** — Right now each Google account has separate memories and Plaid connections; add a `household_id` concept so Trey and Channing share data
