import { plaidClient } from "@/lib/plaid";
import { resolveNameFromEmail } from "@/lib/resolve-name";
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
    name: "get_budget_summary",
    description:
      "Fetch real spending data from Chase via Plaid for the current calendar month. Returns total spent, days remaining, and a breakdown by category. Call this proactively whenever the user asks about spending, budget, categories, or money.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ToolContext = {
  pushedBy: string;
  supabase: SupabaseClient;
  userId: string;
};

async function getBudgetSummary(supabase: SupabaseClient, userId: string) {
  const { data: connection } = await supabase
    .from("plaid_connections")
    .select("access_token")
    .eq("user_id", userId)
    .single();

  if (!connection) {
    return { connected: false, message: "No Chase account connected yet." };
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];
  const endDate = now.toISOString().split("T")[0];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = Math.max(0, lastDay - now.getDate());

  const response = await plaidClient.transactionsGet({
    access_token: connection.access_token,
    start_date: startDate,
    end_date: endDate,
  });

  const byCategory = new Map<string, number>();
  let totalSpent = 0;

  for (const t of response.data.transactions) {
    if (t.amount <= 0) continue;
    totalSpent += t.amount;
    const cat = t.category?.[0] ?? "Other";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + t.amount);
  }

  const categories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, spent]) => ({ name, spent: Math.round(spent) }));

  return {
    connected: true,
    month: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    totalSpent: Math.round(totalSpent),
    monthlyBudget: 6000,
    remaining: Math.max(0, 6000 - Math.round(totalSpent)),
    daysRemaining,
    categories,
  };
}

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

function buildSystemPrompt(name: string): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `You are the command center assistant for the Edwards family. The household is Trey, Channing, and their newborn Theo.

You manage two things: a TRMNL e-ink display in their home, and their household budget.

Display: The TRMNL is a black and white e-ink screen the family glances at throughout the day. Anything pushed to it must be short and readable in under 5 seconds. Keep reminder text under 40 characters. When someone asks you to push a reminder, do it immediately without asking for confirmation. Confirm after with one short sentence.

Budget: You have a get_budget_summary tool that pulls real transaction data from Chase via Plaid. Call it proactively whenever the user asks about spending, budget, categories, how much they have left, or anything money-related. Don't wait to be asked explicitly. Monthly budget is $6,000. Be encouraging and forward-looking. Acknowledge what is on track before addressing what is not. Be direct when something needs attention but never shame or lecture.

Style: Short and casual. Never use em dashes. No bullet points in responses. Make reasonable assumptions rather than asking clarifying questions. You are action-oriented.

Current context:
Date: ${today}
Display state: Idle
Currently talking to: ${name}
`;
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

  if (name === "get_budget_summary") {
    const summary = await getBudgetSummary(ctx.supabase, ctx.userId);
    return summary as Record<string, unknown>;
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
  const system = buildSystemPrompt(name);
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
