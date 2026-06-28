# Theo Fund

Deep dive on round-up calculation, Coinbase integration, chat tools, and troubleshooting.

## Purpose

Theo Fund invests spare change from Chase spending into three Coinbase products:

| Asset key | Product ID |
|-----------|------------|
| `eth` | `ETH-USD` |
| `btc` | `BTC-USD` |
| `wld` | `WLD-USD` |

Default allocation: **34% ETH / 33% BTC / 33% WLD** (configurable via memory).

---

## Round-up calculation

Implemented in `lib/theo-fund.ts` → `calculatePendingRoundups()`.

### Window

```
window_end   = yesterday (UTC date)
window_start = memories.last_roundup_run OR (today - 8 days)
plaid_start  = day after window_start
```

If `plaid_start > window_end`, returns empty (nothing to process).

### Transaction filters

- Not pending
- `amount > 0` (outflows only)
- Category not in: `TRANSFER_IN`, `TRANSFER_OUT`, `LOAN_PAYMENTS`, `BANK_FEES`
- Round-up `ceil(amount) - amount` > 0

### Limits

```typescript
MIN_RUN_USD = 5    // below → tool returns mode: "below_minimum"
MAX_RUN_USD = 500  // raw total capped; capped: true
```

### Split math

```typescript
eth = round(total * split.eth / 100)
btc = round(total * split.btc / 100)
wld = total - eth - btc   // remainder avoids penny drift
```

Split read from `theo_portfolio_split` memory via `parseSplit()` — invalid JSON or sum ≠ 100 falls back to defaults.

---

## Coinbase JWT auth

`lib/coinbase-trade.ts` — **no extra npm packages** for JWT.

1. Read `COINBASE_API_KEY_NAME` (JWT `kid`, `sub`) and `COINBASE_API_PRIVATE_KEY` (EC PEM).
2. Replace `\\n` with newlines in private key string.
3. Build JWT header: `alg: ES256`, `kid`, `nonce`, `typ: JWT`.
4. Payload: `iss: cdp`, `nbf`, `exp` (+120s), `sub`, `uri: "METHOD api.coinbase.com/path"`.
5. Sign with Node `crypto.sign('sha256', ..., { dsaEncoding: 'ieee-p1363' })`.
6. `Authorization: Bearer <jwt>` on each request.

### API endpoints used

| Function | Method | Path |
|----------|--------|------|
| `getPrices` | GET | `/api/v3/brokerage/best_bid_ask?product_ids=...` |
| `previewMarketBuy` | POST | `/api/v3/brokerage/orders/preview` |
| `placeMarketBuy` | POST | `/api/v3/brokerage/orders` |

Orders use `market_market_ioc` with `quote_size` in USD.

### Order response shape

Success: `success: true`, `success_response.order_id`  
Failure: `error_response` with reason/message

Helper `orderId(order)` reads `success_response.order_id`.

---

## Chat tool catalog

| Tool | Preview? | Executes | Records DB |
|------|----------|----------|------------|
| `run_theo_roundup` | Default | `confirm: true` | Up to 3 rows + maybe `last_roundup_run` |
| `buy_crypto` | Default | `confirm: true` | 1 row |
| `get_crypto_performance` | — | Read-only | — |
| `retry_failed_crypto_buy` | — | Retries failed rows | Updates rows |
| `set_portfolio_split` | — | Validates sum=100 | Writes `theo_portfolio_split` |

### `run_theo_roundup` modes

| mode | Meaning |
|------|---------|
| `preview_only` | Totals, window, split, Coinbase previews, sample txs |
| `executed` | Per-leg results, `all_recorded` flag |
| `below_minimum` | Total < $5 |
| `preview_error` | Coinbase preview failed |

### Failed leg behavior

Each leg is independent:

1. `placeMarketBuy` for ETH, BTC, WLD sequentially.
2. `recordPurchase()` inserts row with `status: success|failed`.
3. `last_roundup_run` updated **only if** `results.every(success && recorded)`.

If ETH succeeds but BTC fails:

- ETH row exists as success
- BTC row exists as failed
- Window **not** advanced — same round-ups appear next preview
- User tops up Coinbase → `retry_failed_crypto_buy`

### `base_size` derivation

If Coinbase preview omits `base_size`, code derives `usd_amount / price` for UI performance math.

---

## `crypto_purchases` schema

See [DATABASE.md](./DATABASE.md). Status tracking:

| status | Meaning |
|--------|---------|
| `success` | Included in summary and performance |
| `failed` | Shown in debug; counted in `failed_count`; retryable |

---

## REST endpoints (non-chat)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/theo-fund/summary` | Theo tab metrics |
| `GET /api/theo-roundup/pending` | Pending total + window |
| `GET /api/theo-fund/debug` | Operator diagnostics |

---

## Troubleshooting

### Theo tab shows $0 after successful chat buy

1. Open **`/api/theo-fund/debug`** while logged in.
2. Check `purchases_all` — are rows present?
3. If rows missing → RLS or insert error; see `insert_error` in chat tool result.
4. If rows present but `status: failed` → Coinbase error in `error` column.
5. If rows `success` but summary zero → check `base_size` / `price_at_purchase`; summary derives units if needed.

### Ghost rows / duplicate previews

- Window not advancing leaves same transactions in pending — **by design** until full success.
- Do not manually set `last_roundup_run` forward unless you intentionally skip unprocessed round-ups.

### `last_roundup_run` stuck

Causes:

- Partial leg failure
- DB insert failed (`recorded: false`, `insert_error` in tool response)
- Total below $5 (window not touched)

Fix failed legs → retry → successful full run updates memory.

### Coinbase auth errors

Debug response:

```json
"coinbase": { "ok": false, "error": "Coinbase GET ... → 401: ..." }
```

Checklist:

- Key is **ECDSA ES256**, not Ed25519
- Permissions include **trade**
- Private key newlines escaped correctly in Vercel
- Key name matches `organizations/.../apiKeys/...` exactly

### `preview_error` in chat

- Coinbase credentials missing or invalid
- Product not available on account
- Insufficient funds (may appear at execute, not preview)

### Minimum not met

Pending < $5 → chat explains `below_minimum`; Theo tab may show small pending with "Check now" disabled messaging via `meets_minimum: false`.

---

## UI integration

**Theo Fund tab** (`components/command-center.tsx`):

- Loads `/api/theo-fund/summary` and `/api/theo-roundup/pending` on tab focus
- "Check now" sends chat message to run round-up flow
- Debug link → `/api/theo-fund/debug`
- Target split bar is static 34/33/33 in UI; actual target comes from memory (UI does not yet read `theo_portfolio_split` for display)

---

## Safety model

- All buys require explicit user confirmation in chat (`confirm: true`).
- No scheduled autonomous crypto purchases in codebase.
- Coinbase keys are server-side only (`lib/coinbase-trade.ts`).
