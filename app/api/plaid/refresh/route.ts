import { plaidClient } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connection } = await supabase
    .from("plaid_connections")
    .select("access_token")
    .eq("user_id", user.id)
    .single();

  if (!connection?.access_token) {
    return NextResponse.json({ error: "No connected account" }, { status: 404 });
  }

  await plaidClient.transactionsRefresh({ access_token: connection.access_token });

  return NextResponse.json({ success: true });
}
