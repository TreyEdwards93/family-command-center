-- Family Command Center — consolidated schema
-- Run in Supabase SQL Editor (idempotent: safe to re-run policies)

-- ── memories ─────────────────────────────────────────────────────────────────

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  key text not null,
  value text not null,
  updated_at timestamptz default now(),
  unique (user_id, key)
);

alter table memories enable row level security;

drop policy if exists memories_own on memories;
create policy memories_own on memories
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── plaid_connections ────────────────────────────────────────────────────────

create table if not exists plaid_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  access_token text not null,
  item_id text not null,
  institution_name text default 'Chase',
  created_at timestamptz default now()
);

alter table plaid_connections enable row level security;

drop policy if exists plaid_connections_own on plaid_connections;
create policy plaid_connections_own on plaid_connections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── crypto_purchases ─────────────────────────────────────────────────────────

create table if not exists crypto_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  asset text not null check (asset in ('eth', 'btc', 'wld')),
  usd_amount numeric not null,
  base_size numeric,
  price_at_purchase numeric,
  status text not null check (status in ('success', 'failed')),
  error text,
  created_at timestamptz default now()
);

create index if not exists crypto_purchases_user_id_idx
  on crypto_purchases (user_id);

create index if not exists crypto_purchases_user_status_idx
  on crypto_purchases (user_id, status);

alter table crypto_purchases enable row level security;

drop policy if exists crypto_purchases_own on crypto_purchases;
create policy crypto_purchases_own on crypto_purchases
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
