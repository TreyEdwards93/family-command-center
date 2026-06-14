import { calculatePendingRoundups, MIN_RUN_USD } from "@/lib/theo-fund";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connection } = await supabase
    .from("plaid_connections")
    .select("access_token")
    .eq("user_id", user.id)
    .single();

  if (!connection?.access_token) {
    return Response.json({ connected: false, pending: 0 });
  }

  const { data: memory } = await supabase
    .from("memories")
    .select("value")
    .eq("user_id", user.id)
    .eq("key", "theo_last_roundup_date")
    .single();

  const result = await calculatePendingRoundups(
    connection.access_token,
    memory?.value,
  );

  return Response.json({
    connected: true,
    pending: result.total,
    meets_minimum: result.total >= MIN_RUN_USD,
    transaction_count: result.transaction_count,
    since: result.window_start,
    through: result.window_end,
  });
}
