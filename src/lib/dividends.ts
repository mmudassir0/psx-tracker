import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { payouts } from "@/db/schema";
import { addDays, todayPkt } from "@/lib/dates";

/**
 * Dividend analysis built on the real declared rates from PSX's payouts
 * fragment.
 *
 * Rates are quoted as a percent of face value; PKR 10 is the PSX standard and
 * what the per-share figure assumes. A company on a different face value would
 * be misconverted, which is why the raw percent is always kept alongside.
 */

export interface PayoutRecord {
  id: string;
  symbol: string;
  date: string;
  type: string;
  percent: number | null;
  perShare: number | null;
  period: string | null;
  instalment: string | null;
  bookClosureFrom: string | null;
  bookClosureTo: string | null;
}

/** Cash dividends declared in the last `months`, newest first. */
export function getPayouts(symbol: string, limit = 20): PayoutRecord[] {
  return db
    .select()
    .from(payouts)
    .where(eq(payouts.symbol, symbol))
    .orderBy(desc(payouts.date))
    .limit(limit)
    .all();
}

/**
 * Trailing dividend per share over the last 12 months.
 * Cash dividends only — bonus and rights are not income.
 */
export function getTrailingDividendPerShare(
  symbol: string,
  asOf: string = todayPkt(),
): number | null {
  const since = addDays(asOf, -365);
  const rows = db
    .select({ perShare: payouts.perShare })
    .from(payouts)
    .where(
      and(
        eq(payouts.symbol, symbol),
        eq(payouts.type, "cash_dividend"),
        gte(payouts.date, since),
      ),
    )
    .all();

  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + (r.perShare ?? 0), 0);
  return total > 0 ? total : null;
}

/** Trailing 12-month dividend yield as a percentage of `price`. */
export function getDividendYield(
  symbol: string,
  price: number | null,
  asOf: string = todayPkt(),
): number | null {
  if (price == null || price <= 0) return null;
  const dps = getTrailingDividendPerShare(symbol, asOf);
  if (dps == null) return null;
  return (dps / price) * 100;
}

/** Trailing dividend per share for many symbols in one query. */
export function getTrailingDividendMap(
  asOf: string = todayPkt(),
): Map<string, number> {
  const since = addDays(asOf, -365);
  const rows = db
    .select({
      symbol: payouts.symbol,
      total: sql<number>`sum(${payouts.perShare})`,
    })
    .from(payouts)
    .where(
      and(eq(payouts.type, "cash_dividend"), gte(payouts.date, since)),
    )
    .groupBy(payouts.symbol)
    .all();

  return new Map(
    rows
      .filter((r) => r.total != null && r.total > 0)
      .map((r) => [r.symbol, r.total]),
  );
}

export interface UpcomingBookClosure extends PayoutRecord {
  /** Days until the book closure opens; negative once it has started. */
  daysUntil: number;
}

/**
 * Book closure windows opening on or after `from`.
 *
 * This is the date that actually matters for entitlement — you must be on the
 * register when the books close, not merely when the dividend is announced.
 */
export function getUpcomingBookClosures(
  from: string = todayPkt(),
  limit = 40,
): UpcomingBookClosure[] {
  const rows = db
    .select()
    .from(payouts)
    .where(gte(payouts.bookClosureTo, from))
    .orderBy(payouts.bookClosureFrom)
    .limit(limit)
    .all();

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  return rows
    .filter((r) => r.bookClosureFrom)
    .map((r) => ({
      ...r,
      daysUntil: Math.round(
        (Date.parse(`${r.bookClosureFrom}T00:00:00Z`) - fromMs) / 86_400_000,
      ),
    }));
}
