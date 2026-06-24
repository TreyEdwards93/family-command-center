import { randomBytes, randomUUID, sign as cryptoSign } from "node:crypto";

const HOST = "api.coinbase.com";

// Coinbase has no CBBTC-USD product. Buy BTC-USD; withdrawing BTC over the
// Base network delivers cbBTC 1:1.
export const PRODUCTS = {
  eth: "ETH-USD",
  cbbtc: "BTC-USD",
  wld: "WLD-USD",
} as const;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function buildJwt(method: "GET" | "POST", path: string): string {
  const keyName = process.env.COINBASE_API_KEY_NAME;
  const rawKey = process.env.COINBASE_API_PRIVATE_KEY;
  if (!keyName || !rawKey) {
    throw new Error("COINBASE_API_KEY_NAME / COINBASE_API_PRIVATE_KEY not configured");
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: keyName,
    nonce: randomBytes(16).toString("hex"),
    typ: "JWT",
  };
  const payload = {
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    sub: keyName,
    uri: `${method} ${HOST}${path}`,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${b64url(signature)}`;
}

async function cbFetch<T>(
  method: "GET" | "POST",
  path: string,
  opts: { query?: string; body?: object } = {},
): Promise<T> {
  const jwt = buildJwt(method, path);
  const res = await fetch(`https://${HOST}${path}${opts.query ?? ""}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coinbase ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export type Prices = { eth: number; cbbtc: number; wld: number };

export async function getPrices(): Promise<Prices> {
  const data = await cbFetch<{
    pricebooks: { product_id: string; asks: { price: string }[] }[];
  }>("GET", "/api/v3/brokerage/best_bid_ask", {
    query: `?product_ids=${PRODUCTS.eth}&product_ids=${PRODUCTS.cbbtc}&product_ids=${PRODUCTS.wld}`,
  });
  const ask = (id: string) =>
    Number(data.pricebooks.find((p) => p.product_id === id)?.asks[0]?.price ?? 0);
  return { eth: ask(PRODUCTS.eth), cbbtc: ask(PRODUCTS.cbbtc), wld: ask(PRODUCTS.wld) };
}

type OrderConfiguration = {
  market_market_ioc: { quote_size: string };
};

function marketBuyConfig(quoteUsd: number): OrderConfiguration {
  return { market_market_ioc: { quote_size: quoteUsd.toFixed(2) } };
}

export type OrderPreview = {
  product_id: string;
  quote_usd: number;
  base_size: string | null;
  total_with_fees: string | null;
  commission: string | null;
  errors: unknown[];
};

export async function previewMarketBuy(
  productId: string,
  quoteUsd: number,
): Promise<OrderPreview> {
  const data = await cbFetch<{
    order_total?: string;
    commission_total?: string;
    base_size?: string;
    errs?: unknown[];
  }>("POST", "/api/v3/brokerage/orders/preview", {
    body: {
      product_id: productId,
      side: "BUY",
      order_configuration: marketBuyConfig(quoteUsd),
    },
  });
  return {
    product_id: productId,
    quote_usd: quoteUsd,
    base_size: data.base_size ?? null,
    total_with_fees: data.order_total ?? null,
    commission: data.commission_total ?? null,
    errors: data.errs ?? [],
  };
}

// Shape of POST /api/v3/brokerage/orders (Coinbase Advanced Trade). On success
// the order_id lives under success_response, NOT at the top level. On failure
// the details live under error_response.
// https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order
export type PlaceOrderResponse = {
  success: boolean;
  success_response?: {
    order_id?: string;
    product_id?: string;
    side?: string;
    client_order_id?: string;
  };
  error_response?: {
    new_order_failure_reason?: string;
    message?: string;
    error_details?: string;
  };
  order_configuration?: unknown;
};

export async function placeMarketBuy(
  productId: string,
  quoteUsd: number,
): Promise<PlaceOrderResponse> {
  return cbFetch<PlaceOrderResponse>("POST", "/api/v3/brokerage/orders", {
    body: {
      client_order_id: randomUUID(),
      product_id: productId,
      side: "BUY",
      order_configuration: marketBuyConfig(quoteUsd),
    },
  });
}

// Convenience: extract the order_id from a create-order response regardless of
// success/failure (it only exists on success).
export function orderId(order: PlaceOrderResponse): string | null {
  return order.success_response?.order_id ?? null;
}
