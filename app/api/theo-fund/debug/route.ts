import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPrices } from "@/lib/coinbase-trade";

export const runtime = "nodejs";

// Diagnostics endpoint for the Theo Fund. Returns a JSON report that helps
// pinpoint why the Theo tab shows $0 invested. NEVER returns secret values —
// only booleans for env presence and the user's own data.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        auth: { present: false, user_id: null },
        note: "Not authenticated. Open this URL in a browser tab where you are logged in.",
      },
      { status: 401 },
    );
  }

  // ALL rows for this user, every status — so we can see failed/missing rows.
  const { data: purchasesAll, error: purchasesError } = await supabase
    .from("crypto_purchases")
    .select(
      "id, asset, usd_amount, base_size, price_at_purchase, status, error, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const countByStatus: Record<string, number> = {};
  for (const row of purchasesAll ?? []) {
    const status = (row.status as string) ?? "unknown";
    countByStatus[status] = (countByStatus[status] ?? 0) + 1;
  }

  // Attempt Coinbase price fetch so we can see if CDP creds work in prod.
  let coinbase: { ok: boolean; prices?: unknown; error?: string };
  try {
    const prices = await getPrices();
    coinbase = { ok: true, prices };
  } catch (err) {
    coinbase = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    auth: { present: true, user_id: user.id },
    purchases_all: purchasesAll ?? [],
    purchases_query_error: purchasesError
      ? purchasesError.message
      : null,
    purchases_count_by_status: countByStatus,
    purchases_total_rows: purchasesAll?.length ?? 0,
    coinbase,
    env_present: {
      COINBASE_API_KEY_NAME: Boolean(process.env.COINBASE_API_KEY_NAME),
      COINBASE_API_PRIVATE_KEY: Boolean(process.env.COINBASE_API_PRIVATE_KEY),
      NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
    },
  });
}
