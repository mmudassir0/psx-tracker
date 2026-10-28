/**
 * Expected dividend income over the next 12 months.
 *
 * Assumes each company pays what it paid over the last 12 months, at about
 * the same time of year. Per stock, the dividends you recorded yourself win
 * (they are what actually reached your account, and PSX stopped publishing
 * payouts in September 2026); otherwise PSX's payout history is used.
 * Amounts are gross, before withholding tax.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { payouts } from "@/db/schema";
import { addDays } from "@/lib/dates";

export type ForecastSource = "recorded" | "psx";

export interface DividendEvent {
  /** When the payment happened last year. */
  date: string;
  perShare: number;
}

export interface ForecastRow {
  symbol: string;
  quantity: number;
  /** Sum of the last 12 months' cash dividends per share. */
  annualPerShare: number;
  expectedIncome: number;
  yieldOnValuePct: number | null;
  yieldOnCostPct: number | null;
  source: ForecastSource;
  /** Expected payment dates (last year's dates + 1 year), oldest first. */
  expected: { date: string; amount: number }[];
}

export interface DividendForecast {
  rows: ForecastRow[];
  total: number;
  yieldOnValuePct: number | null;
  /** Twelve months of the year from the current one ("10", "11", …). */
  byMonth: { month: string; amount: number }[];
  /** Open positions with no cash dividend in the last 12 months. */
  noHistory: string[];
}

export interface ForecastHolding {
  symbol: string;
  quantity: number;
  avgCost: number;
  close: number | null;
}

export interface LedgerEntry {
  symbol: string;
  date: string;
  type: string;
  price: number;
}

/** Pure: builds the forecast from holdings and last year's dividend events. */
export function buildForecast(
  holdings: ForecastHolding[],
  recorded: Map<string, DividendEvent[]>,
  psx: Map<string, DividendEvent[]>,
  asOf: string,
): DividendForecast {
  const rows: ForecastRow[] = [];
  const noHistory: string[] = [];

  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const own = recorded.get(h.symbol) ?? [];
    const events = own.length ? own : (psx.get(h.symbol) ?? []);
    const paid = events.filter((e) => e.perShare > 0);
    if (paid.length === 0) {
      noHistory.push(h.symbol);
      continue;
    }
    const annualPerShare = paid.reduce((sum, e) => sum + e.perShare, 0);
    const expectedIncome = annualPerShare * h.quantity;
    rows.push({
      symbol: h.symbol,
      quantity: h.quantity,
      annualPerShare,
      expectedIncome,
      yieldOnValuePct: h.close && h.close > 0 ? (annualPerShare / h.close) * 100 : null,
      yieldOnCostPct: h.avgCost > 0 ? (annualPerShare / h.avgCost) * 100 : null,
      source: own.length ? "recorded" : "psx",
      expected: paid
        .map((e) => ({ date: addDays(e.date, 365), amount: e.perShare * h.quantity }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  rows.sort((a, b) => b.expectedIncome - a.expectedIncome);
  const total = rows.reduce((sum, r) => sum + r.expectedIncome, 0);

  // Twelve calendar months starting with this one. The window runs to the
  // same day next year, so this month's bin also takes next year's payments
  // from before that day: bins are months of the year, not dated months.
  const startMonth = Number(asOf.slice(5, 7));
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const mm = String(((startMonth - 1 + i) % 12) + 1).padStart(2, "0");
    return {
      month: mm,
      amount: rows
        .flatMap((r) => r.expected)
        .filter((e) => e.date.slice(5, 7) === mm)
        .reduce((sum, e) => sum + e.amount, 0),
    };
  });

  const value = holdings.reduce(
    (sum, h) => sum + (h.quantity > 0 && h.close ? h.quantity * h.close : 0),
    0,
  );

  return {
    rows,
    total,
    yieldOnValuePct: value > 0 ? (total / value) * 100 : null,
    byMonth,
    noHistory: noHistory.sort(),
  };
}

/** Loads last year's dividends (yours and PSX's) and builds the forecast. */
export async function forecastDividends(
  holdings: ForecastHolding[],
  ledger: LedgerEntry[],
  asOf: string,
): Promise<DividendForecast> {
  const since = addDays(asOf, -365);
  const held = holdings.filter((h) => h.quantity > 0).map((h) => h.symbol);

  const recorded = new Map<string, DividendEvent[]>();
  for (const t of ledger) {
    if (t.type !== "dividend" || t.date <= since || t.date > asOf) continue;
    const list = recorded.get(t.symbol) ?? [];
    list.push({ date: t.date, perShare: t.price });
    recorded.set(t.symbol, list);
  }

  const psx = new Map<string, DividendEvent[]>();
  if (held.length) {
    const rows = await db
      .select({ symbol: payouts.symbol, date: payouts.date, perShare: payouts.perShare })
      .from(payouts)
      .where(
        and(
          inArray(payouts.symbol, held),
          eq(payouts.type, "cash_dividend"),
          gte(payouts.date, addDays(since, 1)),
        ),
      )
      .all();
    for (const r of rows) {
      if (r.perShare == null || r.date > asOf) continue;
      const list = psx.get(r.symbol) ?? [];
      list.push({ date: r.date, perShare: r.perShare });
      psx.set(r.symbol, list);
    }
  }

  return buildForecast(holdings, recorded, psx, asOf);
}
