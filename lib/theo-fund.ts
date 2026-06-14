import { plaidClient } from "@/lib/plaid";

export const MIN_RUN_USD = 5;
export const MAX_RUN_USD = 500;
export const DEFAULT_SPLIT = { eth: 40, cbbtc: 30, usdc: 30 };

const EXCLUDED_CATEGORIES = new Set([
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
]);

export type PortfolioSplit = { eth: number; cbbtc: number; usdc: number };

export function parseSplit(raw: string | undefined): PortfolioSplit {
  if (!raw) return DEFAULT_SPLIT;
  try {
    const parsed = JSON.parse(raw) as Partial<PortfolioSplit>;
    const split = {
      eth: parsed.eth ?? DEFAULT_SPLIT.eth,
      cbbtc: parsed.cbbtc ?? DEFAULT_SPLIT.cbbtc,
      usdc: parsed.usdc ?? DEFAULT_SPLIT.usdc,
    };
    const sum = split.eth + split.cbbtc + split.usdc;
    return sum === 100 ? split : DEFAULT_SPLIT;
  } catch {
    return DEFAULT_SPLIT;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export type RoundupTransaction = {
  merchant: string;
  amount: number;
  roundup: number;
  date: string;
};

export type PendingRoundups = {
  total: number;
  capped: boolean;
  transaction_count: number;
  window_start: string;
  window_end: string;
  transactions: RoundupTransaction[];
};

export async function calculatePendingRoundups(
  accessToken: string,
  sinceDate: string | undefined,
): Promise<PendingRoundups> {
  const yesterday = new Date(Date.now() - 86_400_000);
  const windowEnd = isoDate(yesterday);
  const windowStart =
    sinceDate ?? isoDate(new Date(Date.now() - 8 * 86_400_000));

  const startForPlaid = isoDate(
    new Date(new Date(`${windowStart}T12:00:00`).getTime() + 86_400_000),
  );

  const empty: PendingRoundups = {
    total: 0,
    capped: false,
    transaction_count: 0,
    window_start: windowStart,
    window_end: windowEnd,
    transactions: [],
  };
  if (startForPlaid > windowEnd) return empty;

  const transactions: RoundupTransaction[] = [];

  let offset = 0;
  while (true) {
    const res = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startForPlaid,
      end_date: windowEnd,
      options: { count: 500, offset, include_personal_finance_category: true },
    });

    for (const t of res.data.transactions) {
      if (t.pending) continue;
      if (t.amount <= 0) continue;
      const cat = t.personal_finance_category?.primary ?? "";
      if (EXCLUDED_CATEGORIES.has(cat)) continue;

      const roundup = Math.round((Math.ceil(t.amount) - t.amount) * 100) / 100;
      if (roundup === 0) continue;

      transactions.push({
        merchant: t.merchant_name ?? t.name,
        amount: t.amount,
        roundup,
        date: t.date,
      });
    }

    offset += res.data.transactions.length;
    if (offset >= res.data.total_transactions) break;
  }

  const rawTotal =
    Math.round(transactions.reduce((s, t) => s + t.roundup, 0) * 100) / 100;
  const capped = rawTotal > MAX_RUN_USD;

  return {
    total: capped ? MAX_RUN_USD : rawTotal,
    capped,
    transaction_count: transactions.length,
    window_start: windowStart,
    window_end: windowEnd,
    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export type SplitAmounts = { eth: number; cbbtc: number; usdc: number };

export function computeSplitAmounts(
  total: number,
  split: PortfolioSplit,
): SplitAmounts {
  const eth = Math.round(total * split.eth) / 100;
  const cbbtc = Math.round(total * split.cbbtc) / 100;
  const usdc = Math.round((total - eth - cbbtc) * 100) / 100;
  return { eth, cbbtc, usdc };
}
