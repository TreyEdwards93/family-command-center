"use client";

import { resolveNameFromEmail } from "@/lib/resolve-name";
import { useMemo, useRef, useState } from "react";

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

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function progressBarColor(percent: number) {
  if (percent >= 100) return "bg-red-500";
  if (percent >= 85) return "bg-amber-500";
  return "bg-emerald-500";
}

const BUDGET_CATEGORIES = [
  { name: "Groceries", spent: 412, budget: 600 },
  { name: "Dining", spent: 278, budget: 300 },
  { name: "Transportation", spent: 195, budget: 200 },
  { name: "Shopping", spent: 468, budget: 450 },
  { name: "Subscriptions", spent: 89, budget: 100 },
] as const;

const MONTH_SPENT = 3240;
const MONTH_BUDGET = 5000;

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
  const initialMessages = useMemo(
    () => getInitialMessages(userEmail),
    [userEmail],
  );
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const daysLeft = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(0, lastDay - now.getDate());
  }, []);

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
        body: JSON.stringify({
          messages: toApiMessages(nextMessages),
          userEmail,
        }),
      });

      if (!res.ok) {
        throw new Error("Chat request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }

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
                {
                  id: assistantId,
                  sender: "Claude",
                  isClaude: true,
                  text: assistantText,
                  timestamp: new Date(),
                },
              ]);
            } else {
              assistantText += payload.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, text: assistantText } : m,
                ),
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
          {
            id: assistantId,
            sender: "Claude",
            isClaude: true,
            text: "Sorry, something went wrong. Try again.",
            timestamp: new Date(),
          },
        ]);
      }
    } finally {
      setIsLoading(false);
      setIsTyping(false);
      scrollToBottom();
    }
  };

  return (
    <div className={`flex h-dvh flex-col ${BG} text-zinc-900`}>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "chat" ? (
          <>
            <header
              className={`shrink-0 ${BORDER} border-x-0 border-t-0 bg-[#f8f7f4] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight">
                    Command center
                  </h1>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {userEmail}
                  </p>
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
              <div
                className={`mt-3 flex items-center gap-2 rounded-lg ${BORDER} bg-white/60 px-3 py-2`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                  aria-hidden
                />
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
                      <p className="whitespace-pre-wrap text-[15px] leading-snug text-zinc-900">
                        {message.text}
                      </p>
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
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className={`shrink-0 ${BORDER} border-x-0 border-b-0 bg-[#f8f7f4] px-3 py-3`}
            >
              <div className="flex items-center gap-2">
                <label htmlFor="message" className="sr-only">
                  Message
                </label>
                <input
                  id="message"
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Message the family…"
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <header
              className={`${BORDER} border-x-0 border-t-0 bg-[#f8f7f4] px-4 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]`}
            >
              <h1 className="text-lg font-semibold tracking-tight">May budget</h1>
              <p className="mt-0.5 text-sm text-zinc-500">
                {daysLeft} {daysLeft === 1 ? "day" : "days"} left
              </p>
            </header>

            <div className="space-y-3 px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl ${BORDER} bg-white p-4`}>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Spent
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    ${MONTH_SPENT.toLocaleString()}
                  </p>
                </div>
                <div className={`rounded-xl ${BORDER} bg-white p-4`}>
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Remaining
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    ${(MONTH_BUDGET - MONTH_SPENT).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className={`rounded-xl ${BORDER} bg-white p-4`}>
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  By category
                </p>
                <ul className="space-y-4">
                  {BUDGET_CATEGORIES.map((cat) => {
                    const percent = Math.round((cat.spent / cat.budget) * 100);
                    const width = Math.min(percent, 100);
                    return (
                      <li key={cat.name}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                          <span className="font-medium text-zinc-800">
                            {cat.name}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                            ${cat.spent} / ${cat.budget} · {percent}%
                          </span>
                        </div>
                        <div
                          className={`h-1.5 overflow-hidden rounded-full bg-zinc-100 ${BORDER}`}
                        >
                          <div
                            className={`h-full rounded-full ${progressBarColor(percent)}`}
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div
                className={`rounded-xl ${BORDER} bg-zinc-100/80 p-4 text-sm leading-relaxed text-zinc-600`}
              >
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Recommendation
                </p>
                <p className="mt-2">
                  Shopping is over budget this month. Consider pausing
                  non-essential purchases until June, or moving $50 from Dining
                  to cover the gap.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

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
