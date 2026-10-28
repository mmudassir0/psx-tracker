/**
 * Weekly digest: one Friday-evening message per user summarising the week.
 *
 * Sent by src/scripts/digest.ts (GitHub Actions) through the channels the
 * user already turned on for alerts — Telegram, email, browser push — unless
 * they switched the digest off on the Account page.
 */
import { and, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { getClosesAsOf } from "@/lib/dashboard-data";
import { forecastDividends } from "@/lib/dividend-forecast";
import { getIndexHistory } from "@/lib/market";
import { getPortfolio, listTransactions } from "@/lib/portfolio";
import { getBenchmarkIndex } from "@/lib/benchmark";

export interface DigestMover {
  symbol: string;
  changePct: number;
}

export interface DigestData {
  /** Newest session in the database. */
  asOf: string;
  index: { code: string; level: number; changePct: number | null } | null;
  /** Week's change in the value of positions held now (ignores trades this week). */
  portfolio: { value: number; change: number; changePct: number | null } | null;
  best: DigestMover[];
  worst: DigestMover[];
  announcements: { symbol: string; title: string }[];
  /** Expected (gross) dividends over the next 30 days. */
  dividendsSoon: { amount: number; symbols: string[] } | null;
}

const MOVERS = 3;
const MAX_ANNOUNCEMENTS = 6;

/** Gathers one user's week. Market reads are shared across users by the caches. */
export async function buildDigest(userId: string, asOf: string): Promise<DigestData> {
  const weekAgo = addDays(asOf, -7);
  const indexCode = await getBenchmarkIndex(userId);

  const [indexHistory, portfolio, ledger, closesWeekAgo] = await Promise.all([
    getIndexHistory(indexCode, addDays(weekAgo, -10)),
    getPortfolio(userId, {}, indexCode),
    listTransactions(userId),
    getClosesAsOf(asOf, weekAgo),
  ]);

  const last = indexHistory[indexHistory.length - 1];
  const before = [...indexHistory].reverse().find((p) => p.date <= weekAgo);
  const index = last
    ? {
        code: indexCode,
        level: last.current,
        changePct: before && before.current ? ((last.current - before.current) / before.current) * 100 : null,
      }
    : null;

  const open = portfolio.holdings.filter((h) => h.quantity > 0 && h.close != null);
  let value = 0;
  let valueWeekAgo = 0;
  const moves: DigestMover[] = [];
  for (const h of open) {
    const now = h.close as number;
    const then = closesWeekAgo.get(h.symbol) ?? now;
    value += h.quantity * now;
    valueWeekAgo += h.quantity * then;
    if (then > 0) moves.push({ symbol: h.symbol, changePct: ((now - then) / then) * 100 });
  }
  moves.sort((a, b) => b.changePct - a.changePct);

  const held = open.map((h) => h.symbol);
  const recent = held.length
    ? await db
        .select({ symbol: announcements.symbol, title: announcements.title, date: announcements.date })
        .from(announcements)
        .where(and(inArray(announcements.symbol, held), gt(announcements.date, weekAgo)))
        .all()
    : [];

  const forecast = await forecastDividends(open, ledger, asOf);
  const soon = forecast.rows.flatMap((r) =>
    r.expected.filter((e) => e.date <= addDays(asOf, 30)).map((e) => ({ ...e, symbol: r.symbol })),
  );

  return {
    asOf,
    index,
    portfolio: open.length
      ? {
          value,
          change: value - valueWeekAgo,
          changePct: valueWeekAgo > 0 ? ((value - valueWeekAgo) / valueWeekAgo) * 100 : null,
        }
      : null,
    best: moves.filter((m) => m.changePct > 0).slice(0, MOVERS),
    worst: moves.filter((m) => m.changePct < 0).reverse().slice(0, MOVERS),
    announcements: recent
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_ANNOUNCEMENTS)
      .map(({ symbol, title }) => ({ symbol, title })),
    dividendsSoon: soon.length
      ? { amount: soon.reduce((s, e) => s + e.amount, 0), symbols: [...new Set(soon.map((e) => e.symbol))] }
      : null,
  };
}

const signed = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const pkr = (v: number) =>
  `PKR ${Math.round(v).toLocaleString("en-PK")}`;

/** Pure: the message text (plain text works for Telegram, email and push). */
export function formatDigest(d: DigestData, siteUrl?: string): { subject: string; text: string; short: string } {
  const lines: string[] = [`Your PSX week (to ${d.asOf})`, ""];

  if (d.index) {
    lines.push(
      `${d.index.code}: ${d.index.level.toLocaleString("en-PK", { maximumFractionDigits: 0 })}` +
        (d.index.changePct != null ? ` (${signed(d.index.changePct)}% this week)` : ""),
    );
  }
  if (d.portfolio) {
    lines.push(
      `Your portfolio: ${pkr(d.portfolio.value)}, ${d.portfolio.change >= 0 ? "+" : "−"}${pkr(Math.abs(d.portfolio.change))}` +
        (d.portfolio.changePct != null ? ` (${signed(d.portfolio.changePct)}%)` : ""),
    );
  }
  if (d.best.length) lines.push(`Best: ${d.best.map((m) => `${m.symbol} ${signed(m.changePct)}%`).join(", ")}`);
  if (d.worst.length) lines.push(`Worst: ${d.worst.map((m) => `${m.symbol} ${signed(m.changePct)}%`).join(", ")}`);

  if (d.announcements.length) {
    lines.push("", "Announcements from your holdings:");
    for (const a of d.announcements) lines.push(`• ${a.symbol}: ${a.title}`);
  }
  if (d.dividendsSoon) {
    lines.push(
      "",
      `Dividends likely in the next 30 days: about ${pkr(d.dividendsSoon.amount)} (${d.dividendsSoon.symbols.join(", ")}), based on last year.`,
    );
  }
  if (siteUrl) lines.push("", `${siteUrl}/portfolio`);
  lines.push("", "Turn this off on the Account page.");

  const short = d.portfolio?.changePct != null
    ? `Your portfolio ${signed(d.portfolio.changePct)}% this week`
    : d.index?.changePct != null
      ? `${d.index.code} ${signed(d.index.changePct)}% this week`
      : "Your PSX week";

  return { subject: `${short} · PSX weekly`, text: lines.join("\n"), short };
}
