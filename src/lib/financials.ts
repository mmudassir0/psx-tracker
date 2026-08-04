import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { financials } from "@/db/schema";

/**
 * Annual financials and ratios.
 *
 * Line items vary by sector, so nothing here assumes a fixed set: callers ask
 * for a named line item and get null if that company doesn't report it. A bank
 * has no "Sales" row, and a manufacturer has no "Mark-up Earned".
 */

export interface FinancialSeries {
  lineItem: string;
  unit: string;
  /** Fiscal year -> value, newest year first in `years`. */
  byYear: Record<string, number | null>;
}

export interface CompanyFinancials {
  years: string[];
  financials: FinancialSeries[];
  ratios: FinancialSeries[];
}

export function getCompanyFinancials(symbol: string): CompanyFinancials {
  const rows = db
    .select()
    .from(financials)
    .where(eq(financials.symbol, symbol))
    .all();

  const years = [...new Set(rows.map((r) => r.fiscalYear))].sort((a, b) =>
    b.localeCompare(a),
  );

  const build = (section: "financials" | "ratios"): FinancialSeries[] => {
    const byItem = new Map<string, FinancialSeries>();
    for (const row of rows) {
      if (row.section !== section) continue;
      let series = byItem.get(row.lineItem);
      if (!series) {
        series = { lineItem: row.lineItem, unit: row.unit, byYear: {} };
        byItem.set(row.lineItem, series);
      }
      series.byYear[row.fiscalYear] = row.value;
    }
    return [...byItem.values()];
  };

  return { years, financials: build("financials"), ratios: build("ratios") };
}

/** Value of one line item in the most recent fiscal year we have. */
export function getLatestMetric(
  symbol: string,
  lineItem: string,
): number | null {
  const row = db
    .select({ value: financials.value, year: financials.fiscalYear })
    .from(financials)
    .where(
      and(eq(financials.symbol, symbol), eq(financials.lineItem, lineItem)),
    )
    .orderBy(sql`${financials.fiscalYear} desc`)
    .limit(1)
    .get();
  return row?.value ?? null;
}

/**
 * Latest value of a line item for many symbols at once.
 * Used to add fundamental columns to the screener without N queries.
 */
export function getLatestMetricMap(
  lineItem: string,
  symbolList?: string[],
): Map<string, number> {
  const where = symbolList?.length
    ? and(
        eq(financials.lineItem, lineItem),
        inArray(financials.symbol, symbolList),
      )
    : eq(financials.lineItem, lineItem);

  const rows = db
    .select({
      symbol: financials.symbol,
      year: financials.fiscalYear,
      value: financials.value,
    })
    .from(financials)
    .where(where)
    .all();

  // Keep the newest fiscal year per symbol.
  const best = new Map<string, { year: string; value: number }>();
  for (const row of rows) {
    if (row.value == null) continue;
    const current = best.get(row.symbol);
    if (!current || row.year.localeCompare(current.year) > 0) {
      best.set(row.symbol, { year: row.year, value: row.value });
    }
  }

  return new Map([...best].map(([symbol, v]) => [symbol, v.value]));
}

/** Line items commonly present, used for screener columns. */
export const METRIC_EPS_GROWTH = "EPS Growth (%)";
export const METRIC_NET_MARGIN = "Net Profit Margin (%)";
export const METRIC_EPS = "EPS";
