import { MONTH_BUDGET } from "@/lib/budget";
import { plaidClient } from "@/lib/plaid";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const EXCLUDED_CATS = new Set(["LOAN_DISBURSEMENTS", "INCOME", "TRANSFER_IN"]);

function catStatus(percent: number): "ok" | "warning" | "over" {
  if (percent >= 100) return "over";
  if (percent >= 80) return "warning";
  return "ok";
}

function parseTargets(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

// Convert Plaid primary category keys to human-readable names
// e.g. "FOOD_AND_DRINK" → "Food and Drink"
function formatCategoryName(plaidKey: string): string {
  const overrides: Record<string, string> = {
    FOOD_AND_DRINK: "Food and Drink",
    GENERAL_MERCHANDISE: "General Merchandise",
    RENT_AND_UTILITIES: "Rent and Utilities",
    TRAVEL: "Travel",
    ENTERTAINMENT: "Entertainment",
    HEALTHCARE: "Healthcare",
    PERSONAL_CARE: "Personal Care",
    GENERAL_SERVICES: "General Services",
    GOVERNMENT_AND_NON_PROFIT: "Government and Non-Profit",
    HOME_IMPROVEMENT: "Home Improvement",
    INCOME: "Income",
    LOAN_PAYMENTS: "Loan Payments",
    TRANSFER_IN: "Transfer In",
    TRANSFER_OUT: "Transfer Out",
    OTHER: "Other",
  };
  return overrides[plaidKey] ?? plaidKey
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Normalize a string for target lookup: lowercase, underscores → spaces
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/_/g, " ");
}

function fmtDollars(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const CHART_W = 260;
const CHART_H = 130;

function toPolylinePoints(series: number[], max: number): string {
  if (series.length < 2) return "";
  return series
    .map((val, i) => {
      const x = Math.round((i / 30) * CHART_W);
      const y = Math.round(CHART_H - (val / max) * CHART_H * 0.9);
      return `${x},${y}`;
    })
    .join(" ");
}

export async function GET(request: Request) {
  // Verify Vercel cron secret
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service role key so cron can bypass RLS (no user session in cron context)
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Grab the first plaid connection (shared household)
  const { data: connection, error: connErr } = await supabase
    .from("plaid_connections")
    .select("access_token, user_id")
    .limit(1)
    .single();

  if (connErr || !connection) {
    return NextResponse.json({ error: "No Plaid connection found" }, { status: 404 });
  }

  // Date range: full current month up to today
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startDate = new Date(year, month, 1).toISOString().split("T")[0];
  const endDate = now.toISOString().split("T")[0];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysElapsed = Math.max(now.getDate(), 1);
  const daysRemaining = daysInMonth - now.getDate();
  const monthName = now.toLocaleString("en-US", { month: "long" });

  // Fetch all transactions (paginated), including pending
  const allTx: Awaited<
    ReturnType<typeof plaidClient.transactionsGet>
  >["data"]["transactions"] = [];
  let offset = 0;
  while (true) {
    const res = await plaidClient.transactionsGet({
      access_token: connection.access_token,
      start_date: startDate,
      end_date: endDate,
      options: { count: 500, offset, include_personal_finance_category: true },
    });
    allTx.push(...res.data.transactions);
    if (allTx.length >= res.data.total_transactions) break;
    offset = allTx.length;
  }

  // Fetch previous month transactions through the same day-of-month
  const prevMonthNum = month === 0 ? 11 : month - 1;
  const prevMonthYear = month === 0 ? year - 1 : year;
  const prevStartDate = new Date(prevMonthYear, prevMonthNum, 1).toISOString().split("T")[0];
  const prevEndDate = new Date(prevMonthYear, prevMonthNum, daysElapsed).toISOString().split("T")[0];
  const prevMonthLabel = new Date(prevMonthYear, prevMonthNum, 1).toLocaleString("en-US", { month: "long" });

  const prevTx: Awaited<
    ReturnType<typeof plaidClient.transactionsGet>
  >["data"]["transactions"] = [];
  let prevOffset = 0;
  while (true) {
    const res = await plaidClient.transactionsGet({
      access_token: connection.access_token,
      start_date: prevStartDate,
      end_date: prevEndDate,
      options: { count: 500, offset: prevOffset, include_personal_finance_category: true },
    });
    prevTx.push(...res.data.transactions);
    if (prevTx.length >= res.data.total_transactions) break;
    prevOffset = prevTx.length;
  }

  // Sum by category (positive amounts = spending)
  const spendMap = new Map<string, number>();
  let totalSpent = 0;
  for (const t of allTx) {
    if (t.amount === 0) continue;
    const primaryCat = t.personal_finance_category?.primary ?? "";
    if (EXCLUDED_CATS.has(primaryCat)) continue;
    totalSpent += t.amount;
    const cat = primaryCat || t.category?.[0] || "Other";
    spendMap.set(cat, (spendMap.get(cat) ?? 0) + t.amount);
  }
  totalSpent = Math.round(totalSpent);

  // Build daily cumulative series for chart
  const curDailySpend = new Array(32).fill(0) as number[];
  for (const t of allTx) {
    if (t.amount === 0) continue;
    const primaryCat = t.personal_finance_category?.primary ?? "";
    if (EXCLUDED_CATS.has(primaryCat)) continue;
    const d = new Date(`${t.date}T12:00:00`);
    curDailySpend[d.getDate()] += t.amount;
  }
  const prevDailySpend = new Array(32).fill(0) as number[];
  for (const t of prevTx) {
    if (t.amount === 0) continue;
    const primaryCat = t.personal_finance_category?.primary ?? "";
    if (EXCLUDED_CATS.has(primaryCat)) continue;
    const d = new Date(`${t.date}T12:00:00`);
    prevDailySpend[d.getDate()] += t.amount;
  }
  const curCumul: number[] = [];
  const prevCumul: number[] = [];
  let cSum = 0;
  let pSum = 0;
  for (let day = 1; day <= daysElapsed; day++) {
    cSum += curDailySpend[day];
    curCumul.push(cSum);
    pSum += prevDailySpend[day];
    prevCumul.push(pSum);
  }
  const prevTotalToDate = Math.round(pSum);
  const chartMax = Math.max(...curCumul, ...prevCumul, 1);
  const currentMonthPoints = toPolylinePoints(curCumul, chartMax);
  const prevMonthPoints = toPolylinePoints(prevCumul, chartMax);

  // Read budget targets from memories
  const { data: memoriesRows } = await supabase
    .from("memories")
    .select("key, value")
    .eq("user_id", connection.user_id);

  const memoriesMap: Record<string, string> = Object.fromEntries(
    (memoriesRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const targets = parseTargets(memoriesMap["budget_targets"]);

  // Also absorb individual budget_target_* keys
  for (const [k, v] of Object.entries(memoriesMap)) {
    if (k.startsWith("budget_target_")) {
      const cat = k.replace("budget_target_", "").replace(/_/g, " ");
      const num = parseFloat(v);
      if (!isNaN(num) && !(cat in targets)) targets[cat] = num;
    }
  }

  // Build category rows with percent of target
  type CatRow = {
    name: string;
    spent: number;
    target: number;
    percent: number;
  };

  const catRows: CatRow[] = [...spendMap.entries()].map(([plaidKey, spent]) => {
    const name = formatCategoryName(plaidKey);
    const normalizedPlaid = normalizeKey(plaidKey);
    // Match targets by: exact name, normalized plaid key, or normalized target key
    const target =
      targets[name] ??
      Object.entries(targets).find(
        ([k]) => normalizeKey(k) === normalizedPlaid || normalizeKey(k) === normalizeKey(name),
      )?.[1] ??
      0;
    const percent = target > 0 ? Math.round((spent / target) * 100) : 0;
    return { name, spent: Math.round(spent), target, percent };
  });

  // Sort: over-budget first, then by percent descending
  catRows.sort((a, b) => {
    const aOver = a.percent >= 100 ? 1 : 0;
    const bOver = b.percent >= 100 ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    return b.percent - a.percent;
  });

  // Only include categories with actual spend, up to 4
  const top4 = catRows.filter((c) => c.spent > 0).slice(0, 4);

  // Only project after 5 days in to avoid wild early-month numbers
  const showProjection = daysElapsed >= 5;
  const monthlyPace = showProjection
    ? Math.round((totalSpent / daysElapsed) * daysInMonth)
    : 0;
  const percentUsed = Math.round((totalSpent / MONTH_BUDGET) * 100);
  const onPace = !showProjection || monthlyPace <= MONTH_BUDGET;

  const mergeVariables: Record<string, string | number | boolean> = {
    state: "budget",
    month: monthName,
    days_remaining: daysRemaining,
    total_spent: totalSpent,
    total_budget: MONTH_BUDGET,
    percent_used: percentUsed,
    monthly_pace: monthlyPace,
    on_pace: onPace,
    show_projection: showProjection,
    // Pre-formatted display strings
    total_spent_display: fmtDollars(totalSpent),
    total_budget_display: fmtDollars(MONTH_BUDGET),
    remaining_display: fmtDollars(Math.max(0, MONTH_BUDGET - totalSpent)),
    monthly_pace_display: showProjection ? fmtDollars(monthlyPace) : fmtDollars(totalSpent),
    // Chart data
    prev_month_label: prevMonthLabel,
    prev_month_total_to_date: prevTotalToDate,
    prev_month_total_to_date_display: fmtDollars(prevTotalToDate),
    current_month_points: currentMonthPoints,
    prev_month_points: prevMonthPoints,
    chart_max: chartMax,
    today_x: Math.round((daysElapsed / 30) * CHART_W),
  };

  top4.forEach((cat, i) => {
    const n = i + 1;
    mergeVariables[`cat${n}_name`] = cat.name;
    mergeVariables[`cat${n}_spent`] = cat.spent;
    mergeVariables[`cat${n}_target`] = cat.target;
    mergeVariables[`cat${n}_percent`] = cat.percent;
    mergeVariables[`cat${n}_status`] = catStatus(cat.percent);
  });

  // Push to TRMNL
  const trmnlUrl = process.env.TRMNL_WEBHOOK_URL;
  if (!trmnlUrl) {
    return NextResponse.json({ error: "TRMNL_WEBHOOK_URL not configured" }, { status: 500 });
  }

  const trmnlRes = await fetch(trmnlUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merge_variables: mergeVariables }),
  });

  if (!trmnlRes.ok) {
    return NextResponse.json(
      { error: `TRMNL webhook failed: ${trmnlRes.status}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    pushed: { month: monthName, total_spent: totalSpent, percent_used: percentUsed, on_pace: onPace, prev_month_label: prevMonthLabel, prev_month_total_to_date: prevTotalToDate },
  });
}
