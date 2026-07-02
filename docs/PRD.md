# Product Requirements Document

## Overview

Family Command Center is a private household web app that gives a family a single place to monitor spending, talk to an AI assistant with real financial context, invest spare change into a child's crypto fund, and optionally mirror key info on a TRMNL e-ink display.

## Target user

- **Primary:** Parents managing a shared household budget (e.g. Trey and Channing).
- **Secondary:** Anyone cloning the repo to build a similar personal/family command center.

## Goals

1. Surface real bank spending (Chase via Plaid) against a monthly budget and category targets.
2. Provide a conversational interface that can act on that data (summaries, history, memory).
3. Automate "round-up" micro-investments into ETH/BTC/WLD for a long-term child fund (Theo Fund).
4. Optionally push reminders and budget snapshots to a wall-mounted TRMNL display.

## Non-goals (current release)

- Multi-household SaaS or public signup beyond configured Google OAuth users.
- Coinbase debit/credit card integration.
- MCP-based external agents or autonomous buys without user confirmation.
- Shared household data across multiple Supabase users (memories and Plaid connections are per-user today).
- Plaid webhooks for real-time transaction sync (polling on page load / refresh only).

## Roadmap (from codebase comments and README history)

| Item | Status |
|------|--------|
| Coinbase card round-ups | Not started |
| MCP agents | Not started |
| Autonomous crypto buys | Explicitly blocked — preview → confirm required |
| Auto Vercel alias on deploy | Ops improvement |
| Vercel Pro for multiple crons/day | Optional upgrade |
| Plaid webhooks | Technical debt |
| Shared `household_id` for multi-user data | Future |

---

## User stories

### US-1: Authentication

**As a** household member  
**I want to** sign in with Google  
**So that** my session is scoped to my Supabase user and RLS-protected data.

**Test steps**

1. Visit `/login` while logged out.
2. Click "Sign in with Google".
3. Complete Google OAuth; land on `/` with Command Center loaded.
4. Verify `/` redirects to `/login` when session cookie is cleared.
5. Sign out from the app header; confirm redirect to `/login`.

**Acceptance:** Only authenticated users reach `/`. OAuth callback at `/auth/callback` exchanges code for session cookies.

---

### US-2: Budget — connect Chase

**As a** user  
**I want to** link my Chase account via Plaid Link  
**So that** the Budget and Home tabs show real transactions.

**Test steps**

1. Open Budget tab without a connection → "Connect Chase" appears.
2. Click Connect → Plaid Link opens (link token from `POST /api/plaid/create-link-token`).
3. Complete Link → public token exchanged via `POST /api/plaid/exchange-token`.
4. Budget tab loads transactions from `GET /api/plaid/transactions` (90-day window).
5. Tap Refresh → `POST /api/plaid/refresh` triggers Plaid `transactionsRefresh`.

**Acceptance:** One `plaid_connections` row per user (`user_id` unique). Spending excludes `LOAN_DISBURSEMENTS`, `INCOME`, `TRANSFER_IN` on the UI.

---

### US-3: Budget — targets and chat analysis

**As a** user  
**I want to** set category targets and ask Claude about spending  
**So that** I know if we're on track this month.

**Test steps**

1. In Chat, ask "How are we doing on the budget this month?"
2. Claude calls `get_spending_summary` → returns total, monthly budget (from `NEXT_PUBLIC_MONTH_BUDGET`), categories, transactions.
3. Ask Claude to save targets: "Set Food and Drink to $800" → `save_memory` with key `budget_targets` JSON.
4. Budget tab reads targets from `GET /api/memories` and shows progress bars.
5. Ask for trends: "Compare last 6 months" → `get_spending_history`.

**Acceptance:** Monthly budget comes from `NEXT_PUBLIC_MONTH_BUDGET` (default **6000** if unset). Targets stored under `budget_targets` (preferred) or legacy `budget_target_*` keys.

---

### US-4: Chat — TRMNL reminders (optional)

**As a** user  
**I want to** push a short reminder to our e-ink display  
**So that** the family sees it at a glance.

**Test steps**

1. Ensure `TRMNL_WEBHOOK_URL` is set.
2. In Chat: "Push reminder: take out trash"
3. Claude calls `push_reminder` with text ≤ 40 chars.
4. TRMNL shows reminder state; "Clear the display" → `clear_reminder`.

**Acceptance:** Without `TRMNL_WEBHOOK_URL`, tool execution throws and chat reports error.

---

### US-5: Theo Fund — round-up preview and execute

**As a** user  
**I want to** invest pending round-ups into ETH/BTC/WLD  
**So that** Theo's fund grows from everyday spending.

**Test steps**

1. Connect Chase (required for round-ups).
2. Open Theo Fund tab → pending amount from `GET /api/theo-roundup/pending`.
3. In Chat: "Check for pending round-ups"
4. Claude calls `run_theo_roundup` (no confirm) → preview with total, window, split, Coinbase previews.
5. Reply "yes, execute" → `run_theo_roundup` with `confirm: true`.
6. Verify three `crypto_purchases` rows (eth/btc/wld) and Theo tab shows invested total.
7. Confirm `last_roundup_run` memory updated to `window_end` only if **all legs succeed and are recorded**.

**Acceptance:** See [Business rules](#business-rules) below.

---

### US-6: Theo Fund — performance and retry

**As a** user  
**I want to** see fund performance and retry failed buys  
**So that** I can recover from insufficient Coinbase balance.

**Test steps**

1. Ask "How is Theo's fund doing?" → `get_crypto_performance`.
2. Theo tab shows summary from `GET /api/theo-fund/summary`.
3. If a leg failed, ask "Retry failed buys" → `retry_failed_crypto_buy`.
4. Open `/api/theo-fund/debug` while logged in → JSON diagnostics (no secrets).

---

### US-7: Debug and cron

**As an** operator  
**I want to** verify cron and env configuration  
**So that** TRMNL budget push works in production.

**Test steps**

1. Set `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `TRMNL_WEBHOOK_URL` on Vercel.
2. `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/budget-push`
3. Expect `{"ok":true,"pushed":{...}}` and TRMNL budget state update.

---

## Business rules

### Round-up window

| Rule | Value |
|------|--------|
| Window end | **Yesterday** (ISO date) — today's pending transactions excluded |
| Window start | `last_roundup_run` memory value, or **8 days ago** if unset |
| Plaid fetch start | Day **after** `window_start` (avoids double-counting boundary day) |
| Pending txs | Excluded (`t.pending === true`) |
| Spend direction | Only **positive** amounts (outflows) |
| Excluded categories | `TRANSFER_IN`, `TRANSFER_OUT`, `LOAN_PAYMENTS`, `BANK_FEES` |
| Round-up formula | `ceil(amount) - amount`, rounded to cents |
| Zero round-ups | Skipped |

### Run limits

| Rule | Value |
|------|--------|
| Minimum run | **$5** (`MIN_RUN_USD`) — below this, tool returns `below_minimum` |
| Maximum run | **$500** (`MAX_RUN_USD`) — total capped; `capped: true` in response |

### Portfolio split

| Rule | Value |
|------|--------|
| Default | 34% ETH / 33% BTC / 33% WLD |
| Storage | `theo_portfolio_split` memory key as JSON `{"eth":34,"btc":33,"wld":33}` |
| Validation | Percentages must sum to **100** (`set_portfolio_split` tool) |
| Dollar allocation | ETH and BTC rounded; WLD gets remainder (`computeSplitAmounts`) |

### Preview → confirm

- `run_theo_roundup` and `buy_crypto` return preview unless `confirm: true`.
- System prompt instructs Claude to show full summary and ask before executing.
- Autonomous execution without user confirmation is a **non-goal**.

### Failed leg behavior

- Each asset leg is a separate Coinbase market order and separate `crypto_purchases` row.
- Legs with `amount <= 0` after split are skipped.
- On execute: success/failure recorded per leg with `status` and `error`.
- `last_roundup_run` advances **only** when every leg both **succeeded on Coinbase** and **inserted into DB**.
- Partial success leaves window unchanged so round-ups can be retried.
- `retry_failed_crypto_buy` re-attempts rows with `status = 'failed'` and updates them to success on fill.

### Memory keys (app-managed)

| Key | Purpose |
|-----|---------|
| `budget_targets` | JSON map of category → dollar target |
| `budget_target_*` | Legacy per-category targets (still read by UI/cron) |
| `theo_portfolio_split` | JSON `{"eth","btc","wld"}` percentages |
| `last_roundup_run` | ISO date (`window_end`) after successful full round-up |
| Any other key | Free-form via `save_memory` (preferences, rent, etc.) |

### Chat agent behavior

- Model: `claude-sonnet-4-6`, max 1024 tokens, streaming SSE.
- Monthly budget in prompts: value from `NEXT_PUBLIC_MONTH_BUDGET` (default **6000**).
- TRMNL reminder text: max **40 characters**.
- User email in POST body must match session email (403 otherwise).

---

## Success metrics (informal)

- User can connect Chase and see accurate month-to-date spend within one session.
- Round-up preview matches manual spot-check on a few transactions.
- Theo tab `total_invested` matches sum of successful `crypto_purchases`.
- Cron pushes budget to TRMNL once daily on Vercel Hobby.
