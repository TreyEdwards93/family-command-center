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
    .select("asset, usd_amount, base_size")
    .eq("user_id", user.id)
    .eq("status", "success");

  const empty = {
    total_invested: 0,
    current_value: 0,
    gain_usd: 0,
    gain_pct: 0,
    by_asset: {
      eth: { invested: 0, base_size: 0, current_value: 0, current_price: 0 },
      cbbtc: { invested: 0, base_size: 0, current_value: 0, current_price: 0 },
      wld: { invested: 0, base_size: 0, current_value: 0, current_price: 0 },
    },
  };

  if (!purchases || purchases.length === 0) {
    return NextResponse.json(empty);
  }

  // Get current prices — non-fatal if Coinbase is unreachable
  let prices = { eth: 0, cbbtc: 0, wld: 0 };
  try {
    prices = await getPrices();
  } catch {
    // return cost basis only if prices unavailable
  }

  const summary = {
    eth: { invested: 0, base_size: 0, current_value: 0 },
    cbbtc: { invested: 0, base_size: 0, current_value: 0 },
    wld: { invested: 0, base_size: 0, current_value: 0 },
  } as Record<string, { invested: number; base_size: number; current_value: number }>;

  for (const p of purchases) {
    const asset = p.asset as string;
    if (!summary[asset]) continue;
    summary[asset].invested += Number(p.usd_amount);
    if (p.base_size) summary[asset].base_size += Number(p.base_size);
  }

  summary.eth.current_value = summary.eth.base_size * prices.eth;
  summary.cbbtc.current_value = summary.cbbtc.base_size * prices.cbbtc;
  summary.wld.current_value = summary.wld.base_size * prices.wld;

  const totalInvested = summary.eth.invested + summary.cbbtc.invested + summary.wld.invested;
  const totalValue = summary.eth.current_value + summary.cbbtc.current_value + summary.wld.current_value;
  const gain = totalValue - totalInvested;
  const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  return NextResponse.json({
    total_invested: Math.round(totalInvested * 100) / 100,
    current_value: Math.round(totalValue * 100) / 100,
    gain_usd: Math.round(gain * 100) / 100,
    gain_pct: Math.round(gainPct * 100) / 100,
    by_asset: {
      eth: { ...summary.eth, current_price: prices.eth },
      cbbtc: { ...summary.cbbtc, current_price: prices.cbbtc },
      wld: { ...summary.wld, current_price: prices.wld },
    },
  });
}
