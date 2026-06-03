export type PlaidTx = {
  amount: number;
  date: string;
  merchant_name?: string | null;
  name: string;
  category?: string[] | null;
  personal_finance_category?: { primary?: string } | null;
};

export type UpcomingBill = {
  name: string;
  amount: number;
  expectedDay: number;
  daysUntil: number;
};

export function getBillIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("rent") || n.includes("mortgage") || n.includes("hoa")) return "🏠";
  if (
    n.includes("internet") || n.includes("wifi") || n.includes("spectrum") ||
    n.includes("comcast") || n.includes("xfinity") || n.includes("at&t") ||
    n.includes("verizon") || n.includes("cox")
  ) return "🌐";
  if (n.includes("phone") || n.includes("mobile") || n.includes("t-mobile")) return "📱";
  if (
    n.includes("netflix") || n.includes("hulu") || n.includes("disney") ||
    n.includes("spotify") || n.includes("apple") || n.includes("amazon prime") ||
    n.includes("hbo") || n.includes("peacock") || n.includes("paramount")
  ) return "📺";
  if (
    n.includes("electric") || n.includes("gas") || n.includes("water") ||
    n.includes("utility") || n.includes("duke") || n.includes("psnc") ||
    n.includes("dominion")
  ) return "⚡";
  if (
    n.includes("insurance") || n.includes("geico") || n.includes("allstate") ||
    n.includes("progressive") || n.includes("state farm")
  ) return "🛡️";
  if (n.includes("gym") || n.includes("fitness") || n.includes("peloton") || n.includes("ymca")) return "💪🏾";
  return "💳";
}

export function detectUpcomingBills(transactions: PlaidTx[]): UpcomingBill[] {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const today = now.getDate();

  // Group by merchant name
  type Entry = { amount: number; date: Date };
  const byMerchant = new Map<string, Entry[]>();

  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const key = (t.merchant_name ?? t.name).trim();
    const date = new Date(`${t.date}T12:00:00`);
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push({ amount: t.amount, date });
  }

  const results: UpcomingBill[] = [];

  for (const [name, entries] of byMerchant) {
    // Minimum $20 to be considered a bill
    const avgAmount = entries.reduce((s, e) => s + e.amount, 0) / entries.length;
    if (avgAmount < 20) continue;

    // Must appear in at least 2 distinct calendar months
    const months = new Set(
      entries.map((e) => `${e.date.getFullYear()}-${e.date.getMonth()}`),
    );
    if (months.size < 2) continue;

    // Amount must be consistent within 20%
    const consistent = entries.every(
      (e) => Math.abs(e.amount - avgAmount) / avgAmount < 0.2,
    );
    if (!consistent) continue;

    // Already posted this month? Skip.
    const postedThisMonth = entries.some(
      (e) => e.date.getMonth() === currentMonth && e.date.getFullYear() === currentYear,
    );
    if (postedThisMonth) continue;

    // Average day of month it hits
    const avgDay = Math.round(
      entries.reduce((s, e) => s + e.date.getDate(), 0) / entries.length,
    );

    const daysUntil = avgDay - today;

    // Show bills expected in the next 14 days (or up to 2 days overdue — sometimes it takes a day)
    if (daysUntil < -2 || daysUntil > 14) continue;

    results.push({
      name,
      amount: Math.round(avgAmount),
      expectedDay: avgDay,
      daysUntil: Math.max(0, daysUntil),
    });
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 4);
}
