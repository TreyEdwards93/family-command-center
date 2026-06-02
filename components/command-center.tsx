"use client";

import { resolveNameFromEmail } from "@/lib/resolve-name";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePlaidLink } from "react-plaid-link";

type Tab = "chat" | "budget";

type ChatMessage = {
  id: string;
  sender: string;
  isClaude: boolean;
  text: string;
  timestamp: Date;
};

const BORDER = "border-[0.5px] border-zinc-200";
const BG = "bg-[#f8f7f4]";
const MONTH_BUDGET = 6000;

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDollars(n: number) {
  return "$" + Math.round(n).toLocaleString();
}

function getInitialMessages(userEmail: string): ChatMessage[] {
  const name = resolveNameFromEmail(userEmail);
  return [
    {
      id: "welcome",
      sender: "Claude",
      isClaude: true,
      text: `Hey ${name}, what do you need?`,
      timestamp: new Date(),
    },
  ];
}

type ApiMessage = {
  role: "user" | "assistant";
  content: string;
};

function toApiMessages(messages: ChatMessage[]): ApiMessage[] {
  return messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({
      role: m.isClaude ? "assistant" : "user",
      content: m.text,
    }));
}

function barColor(percent: number) {
  if (percent >= 100) return "bg-red-500";
  if (percent >= 85) return "bg-amber-400";
  return "bg-emerald-500";
}

function barBg(percent: number) {
  if (percent >= 100) return "bg-red-50";
  if (percent >= 85) return "bg-amber-50";
  return "bg-zinc-100";
}

type PlaidTransaction = {
  amount: number;
  date: string;
  category: string[] | null;
  merchant_name?: string | null;
  name: string;
};

type CategoryRow = {
  name: string;
  spent: number;
  target: number | null;
};

function buildCategories(
  transactions: PlaidTransaction[],
  targets: Record<string, number>,
): CategoryRow[] {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  const spendMap = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    const d = new Date(`${t.date}T12:00:00`);
    if (d.getMonth() !== month || d.getFullYear() !== year) continue;
    const cat = (t as { personal_finance_category?: { primary?: string } }).personal_finance_category?.primary ?? t.category?.[0] ?? "Other";
    spendMap.set(cat, (spendMap.get(cat) ?? 0) + t.amount);
  }

  // Resolve a target for a category name (case-insensitive fallback)
  const resolveTarget = (name: string): number | null =>
    targets[name] ?? targets[name.toLowerCase()] ?? null;

  // Build rows from actual spend
  const rows: CategoryRow[] = [...spendMap.entries()].map(([name, spent]) => ({
    name,
    spent,
    target: resolveTarget(name),
  }));

  // Add zero-spend rows for every target category not already in the list
  const spentNames = new Set(rows.map((r) => r.name.toLowerCase()));
  for (const [targetName, targetAmount] of Object.entries(targets)) {
    if (!spentNames.has(targetName.toLowerCase())) {
      rows.push({ name: targetName, spent: 0, target: targetAmount });
    }
  }

  // Sort: categories with spend first (descending), then zero-spend rows by target descending
  return rows.sort((a, b) => {
    if (a.spent !== b.spent) return b.spent - a.spent;
    return (b.target ?? 0) - (a.target ?? 0);
  });
}

function parseTargets(memories: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};

  // Check for a single budget_targets JSON blob Claude may have saved
  if (memories["budget_targets"]) {
    try {
      const parsed = JSON.parse(memories["budget_targets"]) as Record<string, number>;
      Object.assign(out, parsed);
    } catch {
      // not JSON, ignore
    }
  }

  // Also pick up individual budget_target_* keys
  for (const [k, v] of Object.entries(memories)) {
    if (k.startsWith("budget_target_")) {
      const cat = k.replace("budget_target_", "").replace(/_/g, " ");
      const num = parseFloat(v);
      if (!isNaN(num)) out[cat] = num;
    }
  }

  return out;
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 10h8M8 14h5M6 4h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-4 3V6a2 2 0 012-2z"
      />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path strokeLinecap="round" d="M5 19V9M12 19V5M19 19v-7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12h14M13 6l6 6-6 6"
      />
    </svg>
  );
}

type CommandCenterProps = {
  userEmail: string;
  signOutAction: () => Promise<void>;
};

export function CommandCenter({ userEmail, signOutAction }: CommandCenterProps) {
  const [tab, setTab] = useState<Tab>("chat");

  // ── Chat state ──────────────────────────────────────────────────────────────
  const initialMessages = useMemo(() => getInitialMessages(userEmail), [userEmail]);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Budget state ─────────────────────────────────────────────────────────────
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [plaidConnecting, setPlaidConnecting] = useState(false);
  const [transactions, setTransactions] = useState<PlaidTransaction[]>([]);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const loadBudgetData = useCallback(async () => {
    setBudgetLoading(true);
    try {
      const [txRes, memoriesRes] = await Promise.all([
        fetch("/api/plaid/transactions"),
        fetch("/api/memories"),
      ]);

      if (txRes.ok) {
        const txData = (await txRes.json()) as {
          connected: boolean;
          transactions?: PlaidTransaction[];
        };
        if (txData.connected && txData.transactions) {
          setPlaidConnected(true);
          setTransactions(txData.transactions);
        } else {
          setPlaidConnected(false);
        }
      }

      if (memoriesRes.ok) {
        const { memories } = (await memoriesRes.json()) as {
          memories: Record<string, string>;
        };
        setTargets(parseTargets(memories));
      }
    } catch {
      setPlaidConnected(false);
    } finally {
      setBudgetLoading(false);
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      try {
        const res = await fetch("/api/plaid/exchange-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token,
            institution_name: metadata.institution?.name,
          }),
        });
        if (res.ok) await loadBudgetData();
      } finally {
        setPlaidConnecting(false);
        setLinkToken(null);
      }
    },
    onExit: () => {
      setPlaidConnecting(false);
      setLinkToken(null);
    },
  });

  useEffect(() => {
    void loadBudgetData();
  }, [loadBudgetData]);

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const connectChase = async () => {
    setPlaidConnecting(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", { method: "POST" });
      if (!res.ok) { setPlaidConnecting(false); return; }
      const { link_token } = (await res.json()) as { link_token: string };
      setLinkToken(link_token);
    } catch {
      setPlaidConnecting(false);
    }
  };

  // ── Derived budget metrics ────────────────────────────────────────────────
  const { monthLabel, daysLeft, totalSpent, categories } = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return {
      monthLabel: now.toLocaleDateString("en-US", { month: "long" }),
      daysLeft: Math.max(0, lastDay - now.getDate()),
      totalSpent: transactions
        .filter((t) => {
          if (t.amount <= 0) return false;
          const d = new Date(`${t.date}T12:00:00`);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        })
        .reduce((s, t) => s + t.amount, 0),
      categories: buildCategories(transactions, targets),
    };
  }, [transactions, targets]);

  const totalPercent = Math.round((totalSpent / MONTH_BUDGET) * 100);

  // ── Chat helpers ──────────────────────────────────────────────────────────
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sender: userEmail,
      isClaude: false,
      text,
      timestamp: new Date(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setIsLoading(true);
    setIsTyping(true);
    scrollToBottom();

    const assistantId = crypto.randomUUID();
    let assistantStarted = false;
    let assistantText = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toApiMessages(nextMessages), userEmail }),
      });
      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6)) as {
            type: string;
            text?: string;
            message?: string;
          };
          if (payload.type === "text" && payload.text) {
            if (!assistantStarted) {
              assistantStarted = true;
              setIsTyping(false);
              assistantText = payload.text;
              setMessages((prev) => [
                ...prev,
                { id: assistantId, sender: "Claude", isClaude: true, text: assistantText, timestamp: new Date() },
              ]);
            } else {
              assistantText += payload.text;
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, text: assistantText } : m),
              );
            }
            scrollToBottom();
          } else if (payload.type === "error") {
            throw new Error(payload.message ?? "Stream error");
          }
        }
      }
    } catch {
      if (!assistantStarted) {
        setMessages((prev) => [
          ...prev,
          { id: assistantId, sender: "Claude", isClaude: true, text: "Sorry, something went wrong. Try again.", timestamp: new Date() },
        ]);
      }
    } finally {
      setIsLoading(false);
      setIsTyping(false);
      scrollToBottom();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`flex h-dvh flex-col ${BG} text-zinc-900`}>
      <div className="flex min-h-0 flex-1 flex-col">

        {/* ── Chat tab ─────────────────────────────────────────────────────── */}
        {tab === "chat" ? (
          <>
            <header
              className={`shrink-0 ${BORDER} border-x-0 border-t-0 bg-[#f8f7f4] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight">Command center</h1>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{userEmail}</p>
                </div>
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="shrink-0 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
                  >
                    Sign out
                  </button>
                </form>
              </div>
              <div className={`mt-3 flex items-center gap-2 rounded-lg ${BORDER} bg-white/60 px-3 py-2`}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="text-xs text-zinc-600">
                  Display: <span className="font-medium text-zinc-800">Idle</span>
                </span>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <ul className="flex flex-col gap-4">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={`flex flex-col ${message.isClaude ? "items-start" : "items-end"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${
                        message.isClaude
                          ? "rounded-bl-sm bg-zinc-200/80"
                          : "rounded-br-sm bg-sky-100"
                      }`}
                    >
                      {message.isClaude ? (
                        <div className="prose prose-sm prose-zinc max-w-none text-[15px] leading-snug [&_p]:my-0 [&_table]:text-sm [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-[15px] leading-snug text-zinc-900">
                          {message.text}
                        </p>
                      )}
                    </div>
                    <p className="mt-1 px-0.5 text-[11px] text-zinc-500">
                      {message.sender} · {formatTime(message.timestamp)}
                    </p>
                  </li>
                ))}
                {isTyping && (
                  <li className="flex flex-col items-start">
                    <div className="rounded-2xl rounded-bl-sm bg-zinc-200/80 px-4 py-3">
                      <span className="flex items-center gap-1" aria-label="Claude is typing">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:300ms]" />
                      </span>
                    </div>
                  </li>
                )}
              </ul>
              <div ref={bottomRef} className="h-1" aria-hidden />
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}
              className={`shrink-0 ${BORDER} border-x-0 border-b-0 bg-[#f8f7f4] px-3 py-3`}
            >
              <div className="flex items-center gap-2">
                <label htmlFor="message" className="sr-only">Message</label>
                <input
                  id="message"
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void sendMessage(); }
                  }}
                  placeholder="How can I help?"
                  disabled={isLoading}
                  className={`h-11 min-w-0 flex-1 rounded-full ${BORDER} bg-white px-4 text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-300 disabled:opacity-50`}
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || isLoading}
                  aria-label="Send message"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-35"
                >
                  <SendIcon />
                </button>
              </div>
            </form>
          </>
        ) : (

        /* ── Budget tab ────────────────────────────────────────────────────── */
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {budgetLoading ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-zinc-400">Loading…</p>
              </div>
            ) : !plaidConnected ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                <p className="text-sm text-zinc-600">
                  Connect your Chase account to see real spending data.
                </p>
                <button
                  type="button"
                  onClick={() => void connectChase()}
                  disabled={plaidConnecting}
                  className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {plaidConnecting ? "Connecting…" : "Connect Chase"}
                </button>
              </div>
            ) : (
              <>
                {/* Header */}
                <header
                  className={`${BORDER} border-x-0 border-t-0 bg-[#f8f7f4] px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]`}
                >
                  <div className="flex items-baseline justify-between">
                    <h1 className="text-lg font-semibold tracking-tight">
                      {monthLabel}
                    </h1>
                    <span className="text-xs text-zinc-500">
                      {daysLeft} {daysLeft === 1 ? "day" : "days"} left
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatDollars(totalSpent)}
                    </span>
                    <span className="text-sm text-zinc-500">
                      of {formatDollars(MONTH_BUDGET)}
                    </span>
                  </div>
                  {/* Overall progress bar */}
                  <div className={`mt-2 h-2 overflow-hidden rounded-full ${barBg(totalPercent)} ${BORDER}`}>
                    <div
                      className={`h-full rounded-full transition-all ${barColor(totalPercent)}`}
                      style={{ width: `${Math.min(totalPercent, 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-xs tabular-nums text-zinc-500">
                    {formatDollars(Math.max(0, MONTH_BUDGET - totalSpent))} remaining · {totalPercent}%
                  </p>
                </header>

                {/* Category rows */}
                <div className="px-4 pb-6 pt-3">
                  {categories.length === 0 ? (
                    <p className="py-8 text-center text-sm text-zinc-400">
                      No transactions this month yet.
                    </p>
                  ) : (
                    <ul className={`divide-y divide-zinc-100 rounded-xl ${BORDER} bg-white`}>
                      {categories.map((cat) => {
                        const hasTarget = cat.target !== null;
                        const percent = hasTarget
                          ? Math.round((cat.spent / cat.target!) * 100)
                          : null;
                        return (
                          <li key={cat.name} className="px-4 py-3">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium text-zinc-800">
                                {cat.name}
                              </span>
                              <span className="shrink-0 tabular-nums text-sm text-zinc-700">
                                {formatDollars(cat.spent)}
                                {hasTarget && (
                                  <span className="ml-1 text-xs text-zinc-400">
                                    / {formatDollars(cat.target!)}
                                  </span>
                                )}
                              </span>
                            </div>
                            {hasTarget && percent !== null && (
                              <>
                                <div className={`mt-1.5 h-1.5 overflow-hidden rounded-full ${barBg(percent)} ${BORDER}`}>
                                  <div
                                    className={`h-full rounded-full ${barColor(percent)}`}
                                    style={{ width: `${Math.min(percent, 100)}%` }}
                                  />
                                </div>
                                <p className="mt-0.5 text-right text-[11px] tabular-nums text-zinc-400">
                                  {percent}%
                                </p>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom nav ──────────────────────────────────────────────────────── */}
      <nav
        className={`shrink-0 ${BORDER} border-x-0 border-b-0 bg-[#f8f7f4] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1`}
        role="tablist"
        aria-label="Main navigation"
      >
        <div className="grid grid-cols-2">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat"}
            onClick={() => setTab("chat")}
            className={`relative flex flex-col items-center gap-1 py-2 text-xs ${
              tab === "chat" ? "font-semibold text-zinc-900" : "text-zinc-500"
            }`}
          >
            <MessageIcon />
            Chat
            {tab === "chat" && (
              <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-zinc-900" />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "budget"}
            onClick={() => setTab("budget")}
            className={`relative flex flex-col items-center gap-1 py-2 text-xs ${
              tab === "budget" ? "font-semibold text-zinc-900" : "text-zinc-500"
            }`}
          >
            <ChartIcon />
            Budget
            {tab === "budget" && (
              <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-zinc-900" />
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
