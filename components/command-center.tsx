"use client";

import { getTheoAgeLabel } from "@/lib/theo";
import { detectUpcomingBills, getBillIcon } from "@/lib/upcoming-bills";
import type { PlaidTx, UpcomingBill } from "@/lib/upcoming-bills";
import { resolveNameFromEmail } from "@/lib/resolve-name";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePlaidLink } from "react-plaid-link";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "home" | "chat" | "budget";

type ChatMessage = {
  id: string;
  sender: string;
  isClaude: boolean;
  text: string;
  timestamp: Date;
};

type ApiMessage = {
  role: "user" | "assistant";
  content: string;
};

type CategoryRow = {
  name: string;
  spent: number;
  target: number | null;
};

// ── Theme ─────────────────────────────────────────────────────────────────────

const T = {
  bg: "#0e1521",
  card: "#162032",
  cardBorder: "0.5px solid rgba(255,255,255,0.08)",
  cardBorderAmber: "0.5px solid rgba(245,166,35,0.2)",
  cardBorderGreen: "0.5px solid rgba(16,185,129,0.2)",
  amber: "#f5a623",
  green: "#10b981",
  warn: "#f59e0b",
  muted: "#6b7a99",
  text: "#e2e8f0",
  divider: "rgba(255,255,255,0.06)",
  trackBg: "rgba(255,255,255,0.08)",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_BUDGET = 6000;

function formatDollars(n: number) {
  return "$" + Math.round(n).toLocaleString();
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function toApiMessages(messages: ChatMessage[]): ApiMessage[] {
  return messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({ role: m.isClaude ? "assistant" : "user", content: m.text }));
}

function getInitialMessages(userEmail: string): ChatMessage[] {
  const name = resolveNameFromEmail(userEmail);
  return [
    {
      id: "welcome",
      sender: "Claude",
      isClaude: true,
      text: `Hey ${name} ✊🏾 — what do you need?`,
      timestamp: new Date(),
    },
  ];
}

function parseTargets(memories: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (memories["budget_targets"]) {
    try {
      Object.assign(out, JSON.parse(memories["budget_targets"]) as Record<string, number>);
    } catch { /* ignore */ }
  }
  for (const [k, v] of Object.entries(memories)) {
    if (k.startsWith("budget_target_")) {
      const cat = k.replace("budget_target_", "").replace(/_/g, " ");
      const num = parseFloat(v);
      if (!isNaN(num)) out[cat] = num;
    }
  }
  return out;
}

function buildCategories(transactions: PlaidTx[], targets: Record<string, number>): CategoryRow[] {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const spendMap = new Map<string, number>();

  for (const t of transactions) {
    if (t.amount === 0) continue;
    const d = new Date(`${t.date}T12:00:00`);
    if (d.getMonth() !== month || d.getFullYear() !== year) continue;
    const cat =
      t.personal_finance_category?.primary ??
      t.category?.[0] ??
      "Other";
    spendMap.set(cat, (spendMap.get(cat) ?? 0) + t.amount);
  }

  const normalizeKey = (s: string) => s.toLowerCase().replace(/_/g, " ");
  const resolveTarget = (name: string): number | null => {
    if (targets[name] !== undefined) return targets[name];
    const entry = Object.entries(targets).find(
      ([k]) => normalizeKey(k) === normalizeKey(name),
    );
    return entry?.[1] ?? null;
  };

  const formatName = (plaidKey: string): string => {
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
      LOAN_PAYMENTS: "Loan Payments",
      TRANSFER_IN: "Transfer In",
      TRANSFER_OUT: "Transfer Out",
      OTHER: "Other",
    };
    return overrides[plaidKey] ?? plaidKey.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  };

  const rows: CategoryRow[] = [...spendMap.entries()].map(([key, spent]) => ({
    name: formatName(key),
    spent,
    target: resolveTarget(formatName(key)),
  }));

  const spentNames = new Set(rows.map((r) => r.name.toLowerCase()));
  for (const [targetName, targetAmount] of Object.entries(targets)) {
    if (!spentNames.has(targetName.toLowerCase())) {
      rows.push({ name: targetName, spent: 0, target: targetAmount });
    }
  }

  return rows.sort((a, b) => b.spent - a.spent);
}

function getSpendingInsight(categories: CategoryRow[]): string | null {
  const now = new Date();
  const daysElapsed = Math.max(now.getDate(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  for (const cat of categories) {
    if (!cat.target || cat.target === 0 || cat.spent === 0) continue;
    const pace = (cat.spent / daysElapsed) * daysInMonth;
    const overage = Math.round(pace - cat.target);
    const pct = Math.round((cat.spent / cat.target) * 100);
    if (pct >= 50 && overage > 0) {
      return `${cat.name} is ${pct}% used — on pace to go over by ~${formatDollars(overage)}`;
    }
  }
  return null;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({
  children,
  border = T.cardBorder,
  style,
}: {
  children: React.ReactNode;
  border?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: T.card,
        borderRadius: 16,
        border,
        padding: "14px 16px",
        marginBottom: 10,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, marginBottom: 10 }}>
      {children}
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color?: string }) {
  return (
    <div style={{ background: T.trackBg, height: 5, borderRadius: 3, overflow: "hidden" }}>
      <div style={{ background: color ?? T.amber, height: "100%", width: `${Math.min(pct, 100)}%`, borderRadius: 3, transition: "width 0.4s ease" }} />
    </div>
  );
}

function catBarColor(pct: number | null): string {
  if (pct === null) return T.muted;
  if (pct >= 100) return "#ef4444";
  if (pct >= 75) return T.warn;
  return T.green;
}

// ── Spend Chart ───────────────────────────────────────────────────────────────

function SpendChart({ transactions }: { transactions: PlaidTx[] }) {
  const data = useMemo(() => {
    const now = new Date();
    const curMonth = now.getMonth();
    const curYear = now.getFullYear();
    const prevMonth = curMonth === 0 ? 11 : curMonth - 1;
    const prevYear = curMonth === 0 ? curYear - 1 : curYear;
    const today = now.getDate();

    const curDaily = new Array(32).fill(0) as number[];
    const prevDaily = new Array(32).fill(0) as number[];

    for (const t of transactions) {
      if (t.amount === 0) continue;
      const d = new Date(`${t.date}T12:00:00`);
      if (d.getMonth() === curMonth && d.getFullYear() === curYear) {
        curDaily[d.getDate()] += t.amount;
      } else if (d.getMonth() === prevMonth && d.getFullYear() === prevYear) {
        prevDaily[d.getDate()] += t.amount;
      }
    }

    const curCumul: number[] = [];
    const prevCumul: number[] = [];
    let cs = 0;
    let ps = 0;
    for (let day = 1; day <= today; day++) {
      cs += curDaily[day];
      curCumul.push(cs);
      ps += prevDaily[day];
      prevCumul.push(ps);
    }

    const chartMax = Math.max(...curCumul, ...prevCumul, 100);
    const curMonthLabel = now.toLocaleString("en-US", { month: "long" });
    const prevMonthLabel = new Date(prevYear, prevMonth, 1).toLocaleString("en-US", { month: "long" });

    return { curCumul, prevCumul, chartMax, today, curMonthLabel, prevMonthLabel, curTotal: cs, prevTotal: ps };
  }, [transactions]);

  const W = 340;
  const H = 130;
  const padTop = 8;
  const padBot = 22;
  const chartH = H - padTop - padBot;

  const toPoints = (series: number[]) =>
    series
      .map((val, i) => {
        const x = (i / 30) * W;
        const y = padTop + chartH - (val / data.chartMax) * chartH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const todayX = ((data.today - 1) / 30) * W;
  const xAxisDays = [1, 8, 15, 22, 31];

  if (data.curCumul.length < 2 && data.prevCumul.length < 2) return null;

  return (
    <Card style={{ marginBottom: 12, padding: "14px 16px 10px" }}>
      <CardLabel>Cumulative spend</CardLabel>
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Today marker */}
        <line
          x1={todayX} y1={padTop}
          x2={todayX} y2={padTop + chartH}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
        {/* Prev month line */}
        {data.prevCumul.length >= 2 && (
          <polyline
            points={toPoints(data.prevCumul)}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* Current month line */}
        {data.curCumul.length >= 2 && (
          <polyline
            points={toPoints(data.curCumul)}
            fill="none"
            stroke="#f5a623"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* X-axis day labels */}
        {xAxisDays.map((day) => (
          <text
            key={day}
            x={((day - 1) / 30) * W}
            y={H - 4}
            fill="#6b7a99"
            fontSize="9"
            textAnchor={day === 1 ? "start" : day === 31 ? "end" : "middle"}
          >
            {day}
          </text>
        ))}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
          <span style={{ color: "#f5a623", lineHeight: 1 }}>●</span>
          <span style={{ color: T.text }}>{data.curMonthLabel} {formatDollars(data.curTotal)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
          <span style={{ color: "rgba(255,255,255,0.3)", lineHeight: 1 }}>●</span>
          <span style={{ color: T.muted }}>{data.prevMonthLabel} {formatDollars(data.prevTotal)}</span>
        </div>
      </div>
    </Card>
  );
}

// ── Home Tab ──────────────────────────────────────────────────────────────────

function HomeTab({
  userEmail,
  transactions,
  targets,
  budgetLoading,
  plaidConnected,
  categories,
  totalSpent,
  upcomingBills,
  onQuickAction,
}: {
  userEmail: string;
  transactions: PlaidTx[];
  targets: Record<string, number>;
  budgetLoading: boolean;
  plaidConnected: boolean;
  categories: CategoryRow[];
  totalSpent: number;
  upcomingBills: UpcomingBill[];
  onQuickAction: (prompt: string) => void;
}) {
  const name = resolveNameFromEmail(userEmail);
  const theoAge = getTheoAgeLabel();
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });
  const totalPercent = Math.round((totalSpent / MONTH_BUDGET) * 100);
  const insight = getSpendingInsight(categories);
  const topCats = categories.filter((c) => c.spent > 0).slice(0, 3);

  const hour = now.getHours();
  const timeLabel = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dayLabel = now.toLocaleDateString("en-US", { weekday: "long" });

  const quickActions = [
    { icon: "📌", title: "Push reminder", desc: "To the display", prompt: "Push reminder: " },
    { icon: "📊", title: "Month recap", desc: "How are we doing?", prompt: "How are we doing on the budget this month?" },
    { icon: "🎯", title: "Set a target", desc: "For a category", prompt: "Set a budget target for " },
    { icon: "📅", title: "Bill history", desc: "Recurring charges", prompt: "Show me our recurring monthly bills" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 100px" }}>
      {/* Greeting */}
      <div style={{ padding: "12px 4px 14px" }}>
        <div style={{ fontSize: 12, color: T.muted }}>{dayLabel} · {timeLabel}</div>
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.5px", marginTop: 3, color: "#fff" }}>
          Hey {name} ✊🏾
        </div>
        {theoAge && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: "rgba(139,92,246,0.15)", border: "0.5px solid rgba(139,92,246,0.3)",
            borderRadius: 20, padding: "4px 11px", fontSize: 11, color: "#a78bfa", marginTop: 8,
          }}>
            🍼 Theo is {theoAge} today
          </div>
        )}
      </div>

      {/* Budget card */}
      <Card border={T.cardBorderAmber}>
        <CardLabel>{monthLabel} budget</CardLabel>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.5px", color: "#fff" }}>
            {formatDollars(totalSpent)}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: T.muted }}>of {formatDollars(MONTH_BUDGET)}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.green, marginTop: 2 }}>
              {formatDollars(Math.max(0, MONTH_BUDGET - totalSpent))} left
            </div>
          </div>
        </div>
        <ProgressBar pct={totalPercent} color={totalPercent >= 90 ? "#ef4444" : totalPercent >= 75 ? T.warn : T.amber} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: T.muted }}>
          <span>{totalPercent}% used</span>
          <span>{daysLeft} days left</span>
        </div>

        {/* Top categories */}
        {budgetLoading ? (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 12 }}>Loading…</div>
        ) : plaidConnected && topCats.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {topCats.map((cat) => {
              const pct = cat.target ? Math.round((cat.spent / cat.target) * 100) : null;
              return (
                <div key={cat.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: T.text }}>{cat.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>
                      {formatDollars(cat.spent)}
                      {cat.target ? <span style={{ color: T.muted, fontWeight: 400 }}> / {formatDollars(cat.target)}</span> : null}
                    </span>
                  </div>
                  <ProgressBar pct={pct ?? 40} color={catBarColor(pct)} />
                </div>
              );
            })}
          </div>
        ) : !plaidConnected ? (
          <div style={{ fontSize: 11, color: T.muted, marginTop: 10 }}>Connect Chase to see category breakdown</div>
        ) : null}
      </Card>

      {/* AI insight */}
      {insight && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "rgba(245,166,35,0.08)", border: "0.5px solid rgba(245,166,35,0.2)",
          borderRadius: 10, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: T.amber,
        }}>
          <span style={{ flexShrink: 0 }}>⚡</span>
          <span>{insight}</span>
        </div>
      )}

      {/* Upcoming bills */}
      {upcomingBills.length > 0 && (
        <Card>
          <CardLabel>Coming up</CardLabel>
          {upcomingBills.map((bill) => (
            <div key={bill.name} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0", borderBottom: `0.5px solid ${T.divider}`,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: "rgba(245,166,35,0.12)", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
              }}>
                {getBillIcon(bill.name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{bill.name}</div>
                <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
                  Expected {bill.daysUntil === 0 ? "today" : `in ${bill.daysUntil} day${bill.daysUntil !== 1 ? "s" : ""}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{formatDollars(bill.amount)}</div>
                <div style={{ fontSize: 10, color: bill.daysUntil <= 2 ? T.amber : T.muted, marginTop: 1 }}>
                  {bill.daysUntil <= 2 ? "Soon" : `Jun ${bill.expectedDay}`}
                </div>
              </div>
            </div>
          ))}
          <div style={{ height: 1 }} />
        </Card>
      )}

      {/* Quick actions */}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, margin: "14px 2px 8px" }}>
        Quick actions
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        {quickActions.map((qa) => (
          <button
            key={qa.title}
            onClick={() => onQuickAction(qa.prompt)}
            style={{
              background: T.card, border: T.cardBorder, borderRadius: 14,
              padding: "12px 12px", cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 5 }}>{qa.icon}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{qa.title}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>{qa.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Chat Tab ──────────────────────────────────────────────────────────────────

const CHIPS = [
  "How are we doing this month?",
  "What did we spend at Costco?",
  "Set a grocery target",
  "Show me our recurring bills",
  "Clear the display",
];

function ChatTab({
  messages,
  draft,
  setDraft,
  isLoading,
  isTyping,
  onSend,
  onChipSend,
  bottomRef,
}: {
  messages: ChatMessage[];
  draft: string;
  setDraft: (v: string) => void;
  isLoading: boolean;
  isTyping: boolean;
  onSend: () => void;
  onChipSend: (text: string) => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: msg.isClaude ? "flex-start" : "flex-end" }}>
            <div style={{
              maxWidth: "88%", borderRadius: msg.isClaude ? "16px 16px 16px 4px" : "16px 16px 4px 16px",
              padding: "10px 13px",
              background: msg.isClaude ? T.card : T.amber,
              border: msg.isClaude ? T.cardBorder : "none",
              color: msg.isClaude ? T.text : "#0e1521",
            }}>
              {msg.isClaude ? (
                <div className="prose prose-sm max-w-none text-[14px] leading-snug [&_p]:my-0 [&_p]:text-[#e2e8f0] [&_strong]:text-white [&_li]:text-[#e2e8f0] [&_a]:text-[#f5a623]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                </div>
              ) : (
                <p style={{ fontSize: 13, lineHeight: 1.55, fontWeight: 600 }}>{msg.text}</p>
              )}
            </div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 3, paddingLeft: 2 }}>
              {msg.sender} · {formatTime(msg.timestamp)}
            </div>
          </div>
        ))}

        {isTyping && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <div style={{ background: T.card, border: T.cardBorder, borderRadius: "16px 16px 16px 4px", padding: "10px 14px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {[0, 150, 300].map((delay) => (
                  <span key={delay} style={{
                    width: 6, height: 6, borderRadius: "50%", background: T.muted,
                    display: "inline-block", animation: "bounce 1s infinite",
                    animationDelay: `${delay}ms`,
                  }} />
                ))}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} style={{ height: 4 }} />
      </div>

      {/* Suggestion chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 14px 6px" }}>
        {CHIPS.map((chip) => (
          <button
            key={chip}
            onClick={() => onChipSend(chip)}
            disabled={isLoading}
            style={{
              background: T.card, border: T.cardBorder, borderRadius: 20,
              padding: "5px 12px", fontSize: 11, color: "#94a3b8", cursor: "pointer",
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px 10px", borderTop: `0.5px solid ${T.divider}` }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSend(); } }}
          placeholder="Ask anything…"
          disabled={isLoading}
          style={{
            flex: 1, background: T.card, border: T.cardBorder, borderRadius: 22,
            padding: "9px 14px", fontSize: 13, color: "#fff", outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!draft.trim() || isLoading}
          style={{
            width: 36, height: 36, background: T.amber, border: "none",
            borderRadius: "50%", display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", flexShrink: 0,
            opacity: !draft.trim() || isLoading ? 0.4 : 1, color: "#0e1521",
          }}
        >
          <SendIcon />
        </button>
      </form>

      <style>{`@keyframes bounce { 0%,80%,100% { transform:translateY(0) } 40% { transform:translateY(-5px) } }`}</style>
    </>
  );
}

// ── Budget Tab ────────────────────────────────────────────────────────────────

function BudgetTab({
  budgetLoading,
  plaidConnected,
  plaidConnecting,
  transactions,
  categories,
  totalSpent,
  onConnectChase,
}: {
  budgetLoading: boolean;
  plaidConnected: boolean;
  plaidConnecting: boolean;
  transactions: PlaidTx[];
  categories: CategoryRow[];
  totalSpent: number;
  onConnectChase: () => void;
}) {
  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });
  const totalPercent = Math.round((totalSpent / MONTH_BUDGET) * 100);

  if (budgetLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 13, color: T.muted }}>Loading…</p>
      </div>
    );
  }

  if (!plaidConnected) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "0 32px", textAlign: "center" }}>
        <p style={{ fontSize: 13, color: T.text }}>Connect your Chase account to see real spending data.</p>
        <button
          onClick={onConnectChase}
          disabled={plaidConnecting}
          style={{ background: T.amber, color: "#0e1521", border: "none", borderRadius: 22, padding: "11px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: plaidConnecting ? 0.6 : 1 }}
        >
          {plaidConnecting ? "Connecting…" : "Connect Chase"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 100px" }}>
      {/* Header */}
      <div style={{ padding: "14px 2px 10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.3px", color: "#fff" }}>{monthLabel}</div>
          <div style={{ fontSize: 11, color: T.muted }}>{daysLeft} days left</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.5px", color: "#fff" }}>{formatDollars(totalSpent)}</div>
          <div style={{ fontSize: 13, color: T.muted }}>of {formatDollars(MONTH_BUDGET)}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <ProgressBar pct={totalPercent} color={totalPercent >= 90 ? "#ef4444" : totalPercent >= 75 ? T.warn : T.amber} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: T.muted }}>
            <span>{totalPercent}%</span>
            <span>{formatDollars(Math.max(0, MONTH_BUDGET - totalSpent))} remaining</span>
          </div>
        </div>
      </div>

      {/* Cumulative spend chart */}
      <SpendChart transactions={transactions} />

      {/* Categories */}
      {categories.length === 0 ? (
        <p style={{ textAlign: "center", fontSize: 13, color: T.muted, padding: "32px 0" }}>No transactions this month yet.</p>
      ) : (
        <div style={{ background: T.card, border: T.cardBorder, borderRadius: 16, overflow: "hidden" }}>
          {categories.map((cat, i) => {
            const pct = cat.target ? Math.round((cat.spent / cat.target) * 100) : null;
            return (
              <div key={cat.name} style={{ padding: "12px 16px", borderBottom: i < categories.length - 1 ? `0.5px solid ${T.divider}` : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{cat.name}</span>
                  <span style={{ fontSize: 12, color: T.text }}>
                    {formatDollars(cat.spent)}
                    {cat.target ? <span style={{ color: T.muted }}> / {formatDollars(cat.target)}</span> : null}
                  </span>
                </div>
                {cat.target !== null && (
                  <>
                    <ProgressBar pct={pct ?? 0} color={catBarColor(pct)} />
                    <div style={{ textAlign: "right", fontSize: 10, color: T.muted, marginTop: 3 }}>{pct}%</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Bottom Nav ────────────────────────────────────────────────────────────────

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: "home", label: "Home", icon: "⌂" },
    { id: "chat", label: "Chat", icon: "◎" },
    { id: "budget", label: "Budget", icon: "▦" },
  ];
  return (
    <nav
      style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        borderTop: `0.5px solid ${T.divider}`, background: T.bg,
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))", paddingTop: 8,
        flexShrink: 0,
      }}
      role="tablist"
    >
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={tab === item.id}
          onClick={() => setTab(item.id)}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 3, fontSize: 10, background: "none", border: "none",
            color: tab === item.id ? T.amber : T.muted,
            fontWeight: tab === item.id ? 700 : 400,
            cursor: "pointer", padding: "6px 0", position: "relative",
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
          <span>{item.label}</span>
          {tab === item.id && (
            <span style={{ position: "absolute", bottom: 0, left: "25%", right: "25%", height: 3, borderRadius: 2, background: T.amber }} />
          )}
        </button>
      ))}
    </nav>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type CommandCenterProps = {
  userEmail: string;
  signOutAction: () => Promise<void>;
};

export function CommandCenter({ userEmail, signOutAction }: CommandCenterProps) {
  const [tab, setTab] = useState<Tab>("home");

  // Chat state
  const initialMessages = useMemo(() => getInitialMessages(userEmail), [userEmail]);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Budget / Plaid state
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [plaidConnecting, setPlaidConnecting] = useState(false);
  const [transactions, setTransactions] = useState<PlaidTx[]>([]);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const loadBudgetData = useCallback(async () => {
    setBudgetLoading(true);
    try {
      const [txRes, memRes] = await Promise.all([
        fetch("/api/plaid/transactions"),
        fetch("/api/memories"),
      ]);
      if (txRes.ok) {
        const txData = await txRes.json() as { connected: boolean; transactions?: PlaidTx[] };
        if (txData.connected && txData.transactions) {
          setPlaidConnected(true);
          setTransactions(txData.transactions);
        } else {
          setPlaidConnected(false);
        }
      }
      if (memRes.ok) {
        const { memories } = await memRes.json() as { memories: Record<string, string> };
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
          body: JSON.stringify({ public_token, institution_name: metadata.institution?.name }),
        });
        if (res.ok) await loadBudgetData();
      } finally {
        setPlaidConnecting(false);
        setLinkToken(null);
      }
    },
    onExit: () => { setPlaidConnecting(false); setLinkToken(null); },
  });

  useEffect(() => { void loadBudgetData(); }, [loadBudgetData]);
  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  const connectChase = async () => {
    setPlaidConnecting(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", { method: "POST" });
      if (!res.ok) { setPlaidConnecting(false); return; }
      const { link_token } = await res.json() as { link_token: string };
      setLinkToken(link_token);
    } catch {
      setPlaidConnecting(false);
    }
  };

  // Derived
  const { categories, totalSpent } = useMemo(() => {
    const cats = buildCategories(transactions, targets);
    const now = new Date();
    const spent = transactions
      .filter((t) => {
        if (t.amount === 0) return false;
        const d = new Date(`${t.date}T12:00:00`);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((s, t) => s + t.amount, 0);
    return { categories: cats, totalSpent: spent };
  }, [transactions, targets]);

  const upcomingBills = useMemo(() => detectUpcomingBills(transactions), [transactions]);

  // Chat helpers
  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const sendMessage = async (text?: string) => {
    const msgText = (text ?? draft).trim();
    if (!msgText || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sender: userEmail,
      isClaude: false,
      text: msgText,
      timestamp: new Date(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setIsLoading(true);
    setIsTyping(true);
    scrollToBottom();

    const assistantId = crypto.randomUUID();
    let started = false;
    let assistantText = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: toApiMessages(nextMessages), userEmail }),
      });
      if (!res.ok) throw new Error("Chat failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

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
          const payload = JSON.parse(line.slice(6)) as { type: string; text?: string; message?: string };
          if (payload.type === "text" && payload.text) {
            if (!started) {
              started = true;
              setIsTyping(false);
              assistantText = payload.text;
              setMessages((prev) => [...prev, { id: assistantId, sender: "Claude", isClaude: true, text: assistantText, timestamp: new Date() }]);
            } else {
              assistantText += payload.text;
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, text: assistantText } : m));
            }
            scrollToBottom();
          } else if (payload.type === "error") {
            throw new Error(payload.message ?? "Stream error");
          }
        }
      }
    } catch {
      if (!started) {
        setMessages((prev) => [...prev, { id: assistantId, sender: "Claude", isClaude: true, text: "Something went wrong. Try again.", timestamp: new Date() }]);
      }
    } finally {
      setIsLoading(false);
      setIsTyping(false);
      scrollToBottom();
    }
  };

  // Quick action from home tab: navigate to chat and send or pre-fill
  const handleQuickAction = (prompt: string) => {
    setTab("chat");
    // If prompt ends with space/colon it needs completion, else send immediately
    if (prompt.endsWith(" ") || prompt.endsWith(": ")) {
      setDraft(prompt);
    } else {
      void sendMessage(prompt);
    }
  };

  return (
    <div style={{ display: "flex", height: "100dvh", flexDirection: "column", background: T.bg, color: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header — only shown on chat and budget */}
      {tab !== "home" && (
        <header style={{ flexShrink: 0, padding: "max(0.75rem, env(safe-area-inset-top)) 16px 12px", borderBottom: `0.5px solid ${T.divider}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>{tab === "chat" ? "Chat" : "Budget"}</h1>
          <form action={signOutAction}>
            <button type="submit" style={{ fontSize: 12, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>
              Sign out
            </button>
          </form>
        </header>
      )}

      {/* Home header — minimal */}
      {tab === "home" && (
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", padding: "max(0.75rem, env(safe-area-inset-top)) 16px 0" }}>
          <form action={signOutAction}>
            <button type="submit" style={{ fontSize: 12, color: T.muted, background: "none", border: "none", cursor: "pointer" }}>
              Sign out
            </button>
          </form>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: tab === "chat" ? "hidden" : "visible" }}>
        {tab === "home" && (
          <HomeTab
            userEmail={userEmail}
            transactions={transactions}
            targets={targets}
            budgetLoading={budgetLoading}
            plaidConnected={plaidConnected}
            categories={categories}
            totalSpent={totalSpent}
            upcomingBills={upcomingBills}
            onQuickAction={handleQuickAction}
          />
        )}
        {tab === "chat" && (
          <ChatTab
            messages={messages}
            draft={draft}
            setDraft={setDraft}
            isLoading={isLoading}
            isTyping={isTyping}
            onSend={() => void sendMessage()}
            onChipSend={(text) => void sendMessage(text)}
            bottomRef={bottomRef}
          />
        )}
        {tab === "budget" && (
          <BudgetTab
            budgetLoading={budgetLoading}
            plaidConnected={plaidConnected}
            plaidConnecting={plaidConnecting}
            transactions={transactions}
            categories={categories}
            totalSpent={totalSpent}
            onConnectChase={() => void connectChase()}
          />
        )}
      </div>

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}
