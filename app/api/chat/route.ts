import { plaidClient } from "@/lib/plaid";
import { resolveNameFromEmail } from "@/lib/resolve-name";
import { getTheoAgeLabel } from "@/lib/theo";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.mjs";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";

const tools: Tool[] = [
  {
    name: "push_reminder",
    description:
      "Push a short reminder to the family's TRMNL e-ink display. Text must be under 40 characters.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Reminder text shown on the display (max 40 characters)",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "clear_reminder",
    description: "Clear the reminder and return the TRMNL display to idle state.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_spending_summary",
    description:
      "Fetch real Chase spending data for a specific month via Plaid. Returns total spent, budget, remaining, days remaining, and a full category breakdown with individual transactions (merchant, amount, date). Use for questions about a specific month, category drilldowns, or transaction lookups. Defaults to current month/year if not specified.",
    input_schema: {
      type: "object",
      properties: {
        month: {
          type: "number",
          description: "Month number 1-12. Defaults to current month.",
        },
        year: {
          type: "number",
          description: "Four-digit year e.g. 2026. Defaults to current year.",
        },
      },
    },
  },
  {
    name: "get_spending_history",
    description:
      "Fetch month-by-month spending totals and category breakdowns from Chase via Plaid. Use for trend analysis, comparing months, and setting realistic category targets. Returns category totals per month without individual transactions.",
    input_schema: {
      type: "object",
      properties: {
        months_back: {
          type: "number",
          description:
            "How many past months to include (default 6, max 24). The current month is always included.",
        },
      },
    },
  },
  {
    name: "save_memory",
    description:
      "Persist a piece of household knowledge so it's available in every future conversation. Use proactively when the user shares budget targets, recurring expenses, preferences, or any fact worth remembering. key should be a short snake_case identifier (e.g. 'grocery_budget', 'rent_amount'). value is the plain-text fact to remember.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Short snake_case identifier for the memory",
        },
        value: {
          type: "string",
          description: "The fact or preference to store",
        },
      },
      required: ["key", "value"],
    },
  },
];

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ToolContext = {
  pushedBy: string;
  supabase: SupabaseClient;
  userId: string;
};

async function getAccessToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("plaid_connections")
    .select("access_token")
    .eq("user_id", userId)
    .single();
  return data?.access_token ?? null;
}

async function fetchAllTransactions(
  accessToken: string,
  startDate: string,
  endDate: string,
) {
  const allTransactions: Awaited<
    ReturnType<typeof plaidClient.transactionsGet>
  >["data"]["transactions"] = [];

  let offset = 0;
  while (true) {
    const res = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count: 500, offset, include_personal_finance_category: true },
    });
    allTransactions.push(...res.data.transactions);
    if (allTransactions.length >= res.data.total_transactions) break;
    offset = allTransactions.length;
  }

  return allTransactions;
}

type CategorySummary = {
  name: string;
  total: number;
  transactions: { merchant: string; amount: number; date: string }[];
};

function groupByCategory(
  transactions: Awaited<
    ReturnType<typeof plaidClient.transactionsGet>
  >["data"]["transactions"],
): CategorySummary[] {
  const map = new Map<string, CategorySummary>();

  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const cat = t.personal_finance_category?.primary ?? t.category?.[0] ?? "Other";
    if (!map.has(cat)) map.set(cat, { name: cat, total: 0, transactions: [] });
    const entry = map.get(cat)!;
    entry.total += t.amount;
    entry.transactions.push({
      merchant: t.merchant_name ?? t.name,
      amount: Math.round(t.amount * 100) / 100,
      date: t.date,
    });
  }

  return [...map.values()]
    .map((c) => ({
      ...c,
      total: Math.round(c.total * 100) / 100,
      transactions: c.transactions.sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.total - a.total);
}

async function getSpendingSummary(
  supabase: SupabaseClient,
  userId: string,
  month?: number,
  year?: number,
) {
  const accessToken = await getAccessToken(supabase, userId);
  if (!accessToken) {
    return { connected: false, message: "No Chase account connected yet." };
  }

  const now = new Date();
  const m = (month ?? now.getMonth() + 1) - 1;
  const y = year ?? now.getFullYear();

  const startDate = new Date(y, m, 1).toISOString().split("T")[0];
  const lastDay = new Date(y, m + 1, 0).getDate();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  const endDate = isCurrentMonth
    ? now.toISOString().split("T")[0]
    : new Date(y, m, lastDay).toISOString().split("T")[0];
  const daysRemaining = isCurrentMonth
    ? Math.max(0, lastDay - now.getDate())
    : 0;

  const transactions = await fetchAllTransactions(
    accessToken,
    startDate,
    endDate,
  );

  const allDates = transactions.map((t) => t.date).sort();
  const earliestTransactionDate = allDates[0] ?? null;

  const categories = groupByCategory(transactions);
  const totalSpent =
    Math.round(categories.reduce((s, c) => s + c.total, 0) * 100) / 100;
  const budget = 6000;

  return {
    connected: true,
    month: new Date(y, m, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    }),
    total_spent: totalSpent,
    budget,
    remaining: Math.max(0, Math.round((budget - totalSpent) * 100) / 100),
    days_remaining: daysRemaining,
    earliest_transaction_date: earliestTransactionDate,
    categories,
  };
}

async function getSpendingHistory(
  supabase: SupabaseClient,
  userId: string,
  monthsBack = 6,
) {
  const accessToken = await getAccessToken(supabase, userId);
  if (!accessToken) {
    return { connected: false, message: "No Chase account connected yet." };
  }

  const clampedMonths = Math.min(Math.max(monthsBack, 1), 24);
  const now = new Date();

  const startOfEarliest = new Date(
    now.getFullYear(),
    now.getMonth() - clampedMonths + 1,
    1,
  );
  const startDate = startOfEarliest.toISOString().split("T")[0];
  const endDate = now.toISOString().split("T")[0];

  const transactions = await fetchAllTransactions(
    accessToken,
    startDate,
    endDate,
  );

  const monthMap = new Map<
    string,
    { month: number; year: number; categories: Map<string, number> }
  >();

  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const d = new Date(`${t.date}T12:00:00`);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!monthMap.has(key)) {
      monthMap.set(key, {
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        categories: new Map(),
      });
    }
    const entry = monthMap.get(key)!;
    const cat = t.personal_finance_category?.primary ?? t.category?.[0] ?? "Other";
    entry.categories.set(cat, (entry.categories.get(cat) ?? 0) + t.amount);
  }

  const history = [...monthMap.values()]
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(({ month, year, categories }) => {
      const cats = [...categories.entries()]
        .map(([name, total]) => ({
          name,
          total: Math.round(total * 100) / 100,
        }))
        .sort((a, b) => b.total - a.total);
      const totalSpent = Math.round(cats.reduce((s, c) => s + c.total, 0) * 100) / 100;
      return {
        month,
        year,
        month_label: new Date(year, month - 1, 1).toLocaleString("en-US", {
          month: "long",
          year: "numeric",
        }),
        total_spent: totalSpent,
        categories: cats,
      };
    });

  const allDates = transactions.map((t) => t.date).sort();
  const earliestTransactionDate = allDates[0] ?? null;

  return { connected: true, earliest_transaction_date: earliestTransactionDate, months: history };
}

async function loadMemories(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("memories")
    .select("key, value")
    .eq("user_id", userId);
  if (!data) return {};
  return Object.fromEntries(data.map((r) => [r.key, r.value]));
}

async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  value: string,
) {
  await supabase.from("memories").upsert(
    { user_id: userId, key, value, updated_at: new Date().toISOString() },
    { onConflict: "user_id,key" },
  );
}

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

function buildSystemPrompt(
  name: string,
  memories: Record<string, string>,
): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const memoryBlock =
    Object.keys(memories).length > 0
      ? `\nStored memory:\n${Object.entries(memories)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")}\n`
      : "";

  const theoAge = getTheoAgeLabel();
  const theoLine = theoAge ? `Theo was born May 13, 2026 and is currently ${theoAge}.` : "Theo was born May 13, 2026.";

  return `You are the command center assistant for the Edwards family. The household is Trey, Channing, and their son Theo. ${theoLine}

You manage two things: a TRMNL e-ink display in their home, and their household budget.

Display: The TRMNL is a black and white e-ink screen the family glances at throughout the day. Anything pushed to it must be short and readable in under 5 seconds. Keep reminder text under 40 characters. When someone asks you to push a reminder, do it immediately without asking for confirmation. Confirm after with one short sentence.

Budget: You have two spending tools that pull real Chase transaction data via Plaid. Use them proactively on any money-related question without waiting to be asked.

- get_spending_summary: use for questions about a specific month, remaining budget, category drilldowns, or individual transaction lookups. Defaults to current month. The response includes earliest_transaction_date so you know the actual data window — use it to explain data availability rather than guessing Plaid's range.
- get_spending_history: use for trend analysis, comparing months, or helping set realistic targets. Fetches up to 24 months of category totals. Also includes earliest_transaction_date.

Monthly budget is $6,000. Be encouraging and forward-looking. Acknowledge what is on track before addressing what is not. Be direct when something needs attention but never shame or lecture.

Memory: Use save_memory proactively when the user shares budget targets, recurring expenses, preferences, or any fact worth keeping. Stored memories are injected into every conversation so you always have context. When saving budget targets, always use Plaid's exact category names: Food and Drink, Shops, Travel, Recreation, Healthcare, Service, Transfer, Payment, Other. Save all targets together as a JSON object under the single key budget_targets — e.g. {"Food and Drink": 800, "Shops": 400}.

Style: Short and casual. Never use em dashes. No bullet points in responses. Make reasonable assumptions rather than asking clarifying questions. You are action-oriented.

Current context:
Date: ${today}
Display state: Idle
Currently talking to: ${name}
${memoryBlock}`;
}

async function postToTrmnl(body: Record<string, unknown>) {
  const url = process.env.TRMNL_WEBHOOK_URL;
  if (!url) {
    throw new Error("TRMNL_WEBHOOK_URL is not configured");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`TRMNL webhook failed: ${res.status}`);
  }
}

async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  if (name === "push_reminder") {
    const { text } = input as { text: string };
    await postToTrmnl({
      merge_variables: {
        state: "reminder",
        reminder_text: text,
        reminder_by: ctx.pushedBy,
      },
    });
    return { success: true, pushed: text };
  }

  if (name === "clear_reminder") {
    await postToTrmnl({
      merge_variables: {
        state: "idle",
        reminder_text: "",
      },
    });
    return { success: true };
  }

  if (name === "get_spending_summary") {
    const { month, year } = (input ?? {}) as {
      month?: number;
      year?: number;
    };
    const result = await getSpendingSummary(
      ctx.supabase,
      ctx.userId,
      month,
      year,
    );
    return result as Record<string, unknown>;
  }

  if (name === "get_spending_history") {
    const { months_back } = (input ?? {}) as { months_back?: number };
    const result = await getSpendingHistory(
      ctx.supabase,
      ctx.userId,
      months_back,
    );
    return result as Record<string, unknown>;
  }

  if (name === "save_memory") {
    const { key, value } = input as { key: string; value: string };
    await saveMemory(ctx.supabase, ctx.userId, key, value);
    return { success: true, saved: { key, value } };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function sse(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function runAgentLoop(
  anthropic: Anthropic,
  messages: MessageParam[],
  system: string,
  ctx: ToolContext,
  onText: (text: string) => void,
) {
  while (true) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
      tools,
    });

    stream.on("text", (text) => {
      onText(text);
    });

    const final = await stream.finalMessage();

    if (final.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: final.content });

      const toolResults = await Promise.all(
        final.content
          .filter((block) => block.type === "tool_use")
          .map(async (block) => {
            const result = await executeTool(block.name, block.input, ctx);
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify(result),
            };
          }),
      );

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    break;
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { messages?: ClientMessage[]; userEmail?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { messages: clientMessages, userEmail } = body;

  if (!userEmail || userEmail !== user.email) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!Array.isArray(clientMessages) || clientMessages.length === 0) {
    return Response.json({ error: "messages array is required" }, { status: 400 });
  }

  const name = resolveNameFromEmail(userEmail);
  const memories = await loadMemories(supabase, user.id);
  const system = buildSystemPrompt(name, memories);
  const anthropicMessages: MessageParam[] = clientMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const anthropic = new Anthropic({ apiKey });
  const ctx: ToolContext = { pushedBy: name, supabase, userId: user.id };

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: object) => {
        controller.enqueue(encoder.encode(sse(payload)));
      };

      try {
        await runAgentLoop(
          anthropic,
          anthropicMessages,
          system,
          ctx,
          (text) => send({ type: "text", text }),
        );
        send({ type: "done" });
      } catch (err) {
        console.error("Chat API error:", err);
        send({
          type: "error",
          message:
            err instanceof Error ? err.message : "Something went wrong",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
