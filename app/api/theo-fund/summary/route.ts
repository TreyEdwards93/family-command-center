import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrices } from "@/lib/coinbase-trade";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: purchases } = await supabase
    .from("crypto_purchases")
    .select("asset, usd_amount, base_size, price_at_purchase, created_at")
    .eq("user_id", user.id)
    .eq("status", "success");

  // Count failed buys so the UI can prompt a retry instead of silently
  // hiding everything when orders didn't fill / weren't recorded as success.
  const { count: failedCount } = await supabase
    .from("crypto_purchases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "failed");

  const empty = {
    total_invested: 0,
    current_value: 0,
    gain_usd: 0,
    gain_pct: 0,
    failed_count: failedCount ?? 0,
    actual_split: null,
    avg_buy_price: null,
    this_month_invested: 0,
    last_month_invested: 0,
    by_asset: {
      eth: { invested: 0, base_size: 0, current_value: 0, current_price: 0 },
      btc: { invested: 0, base_size: 0, current_value: 0, current_price: 0 },
      wld: { invested: 0, base_size: 0, current_value: 0, current_price: 0 },
    },
  };

  if (!purchases || purchases.length === 0) {
    return NextResponse.json(empty);
  }

  // Get current prices — non-fatal if Coinbase is unreachable
  let prices = { eth: 0, btc: 0, wld: 0 };
  try {
    prices = await getPrices();
  } catch {
    // return cost basis only if prices unavailable
  }

  const summary = {
    eth: { invested: 0, base_size: 0, current_value: 0 },
    btc: { invested: 0, base_size: 0, current_value: 0 },
    wld: { invested: 0, base_size: 0, current_value: 0 },
  } as Record<string, { invested: number; base_size: number; current_value: number }>;

  for (const p of purchases) {
    const asset = p.asset as string;
    if (!summary[asset]) continue;
    summary[asset].invested += Number(p.usd_amount);

    // Use base_size from the row if present; otherwise derive from usd/price.
    // The Coinbase order response doesn't always include a filled quantity
    // immediately — deriving from usd_amount / price_at_purchase is accurate
    // for market orders which fill near the ask price.
    let bs = p.base_size ? Number(p.base_size) : null;
    if (!bs && p.price_at_purchase && Number(p.price_at_purchase) > 0) {
      bs = Math.round((Number(p.usd_amount) / Number(p.price_at_purchase)) * 1e8) / 1e8;
    }
    if (bs) summary[asset].base_size += bs;
  }

  summary.eth.current_value = summary.eth.base_size * prices.eth;
  summary.btc.current_value = summary.btc.base_size * prices.btc;
  summary.wld.current_value = summary.wld.base_size * prices.wld;

  const totalInvested = summary.eth.invested + summary.btc.invested + summary.wld.invested;
  const totalValue = summary.eth.current_value + summary.btc.current_value + summary.wld.current_value;
  const gain = totalValue - totalInvested;
  const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  // Actual portfolio split by current value
  const actual_split = totalValue > 0 ? {
    eth: Math.round((summary.eth.current_value / totalValue) * 100),
    btc: Math.round((summary.btc.current_value / totalValue) * 100),
    wld: Math.round((summary.wld.current_value / totalValue) * 100),
  } : null;

  // Average buy price per asset (invested / units held)
  const avg_buy_price = {
    eth: summary.eth.base_size > 0 ? summary.eth.invested / summary.eth.base_size : null,
    btc: summary.btc.base_size > 0 ? summary.btc.invested / summary.btc.base_size : null,
    wld: summary.wld.base_size > 0 ? summary.wld.invested / summary.wld.base_size : null,
  };

  // Investment velocity: this month vs last month
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

  const thisMonthInvested = (purchases ?? [])
    .filter((p) => p.created_at >= thisMonthStart)
    .reduce((s, p) => s + Number(p.usd_amount), 0);
  const lastMonthInvested = (purchases ?? [])
    .filter((p) => p.created_at >= lastMonthStart && p.created_at < thisMonthStart)
    .reduce((s, p) => s + Number(p.usd_amount), 0);

  return NextResponse.json({
    total_invested: Math.round(totalInvested * 100) / 100,
    current_value: Math.round(totalValue * 100) / 100,
    gain_usd: Math.round(gain * 100) / 100,
    gain_pct: Math.round(gainPct * 100) / 100,
    failed_count: failedCount ?? 0,
    actual_split,
    avg_buy_price,
    this_month_invested: Math.round(thisMonthInvested * 100) / 100,
    last_month_invested: Math.round(lastMonthInvested * 100) / 100,
    by_asset: {
      eth: { ...summary.eth, current_price: prices.eth },
      btc: { ...summary.btc, current_price: prices.btc },
      wld: { ...summary.wld, current_price: prices.wld },
    },
  });
}
