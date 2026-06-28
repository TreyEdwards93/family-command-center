# Database

Supabase Postgres schema used by Family Command Center. Apply via [supabase/schema.sql](../supabase/schema.sql).

## Tables overview

| Table | Purpose |
|-------|---------|
| `memories` | Key-value household facts per user (budget targets, Theo split, last round-up date) |
| `plaid_connections` | Plaid access token and item metadata (one row per user) |
| `crypto_purchases` | Theo Fund buy ledger (success/failed legs) |

There is **no** `theo_contributions` table in the current codebase.

---

## `memories`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` FK → `auth.users` | Required |
| `key` | `text` | Snake_case identifier |
| `value` | `text` | Plain text or JSON string |
| `updated_at` | `timestamptz` | Default `now()` |

**Constraints:** `unique(user_id, key)`

**RLS:** enabled — policy `memories_own` — all operations where `auth.uid() = user_id`

**Used by:** `app/api/memories`, `app/api/chat` (load/save), `app/api/theo-roundup/pending`, `app/api/cron/budget-push`

---

## `plaid_connections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `auth.users` | **Unique** — one connection per user |
| `access_token` | `text` | Plaid access token (sensitive) |
| `item_id` | `text` | Plaid item ID |
| `institution_name` | `text` | Default `'Chase'` |
| `created_at` | `timestamptz` | Default `now()` |

**RLS:** enabled — policy `plaid_connections_own` — `auth.uid() = user_id`

**Used by:** All Plaid API routes, chat spending/round-up tools, cron (first connection via service role)

---

## `crypto_purchases`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `auth.users` | |
| `asset` | `text` | Check: `'eth'`, `'btc'`, `'wld'` |
| `usd_amount` | `numeric` | USD spent on this leg |
| `base_size` | `numeric` nullable | Crypto units purchased |
| `price_at_purchase` | `numeric` nullable | USD price at buy time |
| `status` | `text` | Check: `'success'`, `'failed'` |
| `error` | `text` nullable | JSON/string error from Coinbase |
| `created_at` | `timestamptz` | Default `now()` |

**RLS:** enabled — policy `crypto_purchases_own` — `auth.uid() = user_id`

**Used by:** Chat tools (`run_theo_roundup`, `buy_crypto`, `retry_failed_crypto_buy`, `get_crypto_performance`), `app/api/theo-fund/summary`, `app/api/theo-fund/debug`

**Indexes:** `(user_id)`, `(user_id, status)` for summary queries

---

## RLS summary

| Table | Policy | Rule |
|-------|--------|------|
| `memories` | `memories_own` | `auth.uid() = user_id` FOR ALL |
| `plaid_connections` | `plaid_connections_own` | `auth.uid() = user_id` FOR ALL |
| `crypto_purchases` | `crypto_purchases_own` | `auth.uid() = user_id` FOR ALL |

**Cron exception:** `/api/cron/budget-push` uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. Never expose this key to the client.

---

## Memory keys

| Key | Written by | Read by | Format |
|-----|------------|---------|--------|
| `budget_targets` | Chat `save_memory` | UI, cron | JSON: `{"Food and Drink": 800, ...}` — system prompt prefers Plaid-style names |
| `budget_target_*` | Legacy/manual | UI, cron | Individual keys; category suffix after prefix |
| `theo_portfolio_split` | `set_portfolio_split`, `save_memory` | Round-up tool | JSON: `{"eth":34,"btc":33,"wld":33}` |
| `last_roundup_run` | `run_theo_roundup` on full success | Round-up calculator | ISO date `YYYY-MM-DD` (= last window end) |
| *(custom)* | `save_memory` | Injected into chat system prompt | Any short snake_case key |

### `last_roundup_run` semantics

- Stores the **end date** of the last fully successful round-up window.
- Next run starts the day after this date (see `lib/theo-fund.ts`).
- **Not updated** if any leg fails or DB insert fails — prevents silent loss of round-ups.

---

## SQL files

| File | Description |
|------|-------------|
| [supabase/schema.sql](../supabase/schema.sql) | Consolidated idempotent schema — run this |

---

## Rebuilding from scratch

1. Drop tables if re-running on a dirty project (optional):

```sql
drop table if exists crypto_purchases cascade;
drop table if exists plaid_connections cascade;
drop table if exists memories cascade;
```

2. Run `supabase/schema.sql`.
3. Reconnect Plaid via UI (tokens are not in repo).
4. Re-seed memories via chat or manual SQL inserts if needed.

---

## Example memory seed (SQL)

```sql
insert into memories (user_id, key, value)
values
  ('YOUR_USER_UUID', 'budget_targets', '{"FOOD_AND_DRINK": 800, "GENERAL_MERCHANDISE": 400}'),
  ('YOUR_USER_UUID', 'theo_portfolio_split', '{"eth":34,"btc":33,"wld":33}')
on conflict (user_id, key) do update set value = excluded.value, updated_at = now();
```

Replace `YOUR_USER_UUID` with `auth.users.id` from Supabase Authentication dashboard.
