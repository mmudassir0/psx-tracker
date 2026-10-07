import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { indexLevels, quotesDaily } from "@/db/schema";
import { listTransactions, type LedgerScope } from "@/lib/portfolio";
import { DEFAULT_INDEX } from "@/lib/psx/indices";

export interface HistoryPoint {
  date: string;
  /** Market value of the positions held that day, at that day's close. */
  value: number;
  /** Cost basis of those positions (weighted average, like the holdings table). */
  invested: number;
  /**
   * The same money in the comparison index: every purchase buys index units on its date and
   * every sale withdraws its proceeds. Null until the index has a level.
   */
  benchmark: number | null;
}

export interface LedgerEntry {
  symbol: string;
  date: string;
  type: string;
  quantity: number;
  price: number;
  fees: number;
}

/**
 * Pure replay of a ledger over a calendar of closes. Exported for tests.
 *
 * Prices carry forward across days a symbol didn't trade, so a missing quote
 * never drops a position's value to zero.
 */
export function replayLedger(
  ledger: LedgerEntry[],
  dates: string[],
  closes: Map<string, Map<string, number>>,
  indexLevel: Map<string, number>,
): HistoryPoint[] {
  const sorted = [...ledger].sort((a, b) => a.date.localeCompare(b.date));
  const qty = new Map<string, number>();
  const cost = new Map<string, number>();
  const lastClose = new Map<string, number>();
  let units = 0;
  // Cash that moved before any index level was known; it converts to units
  // at the first level, instead of silently never entering the benchmark.
  let pendingCash = 0;
  let lastLevel: number | null = null;
  let next = 0;
  const points: HistoryPoint[] = [];

  for (const date of dates) {
    lastLevel = indexLevel.get(date) ?? lastLevel;
    if (lastLevel && pendingCash !== 0) {
      units = Math.max(0, units + pendingCash / lastLevel);
      pendingCash = 0;
    }

    while (next < sorted.length && sorted[next].date <= date) {
      const tx = sorted[next++];
      const q = qty.get(tx.symbol) ?? 0;
      const c = cost.get(tx.symbol) ?? 0;
      if (tx.type === "buy" || tx.type === "rights") {
        const spent = tx.quantity * tx.price + tx.fees;
        qty.set(tx.symbol, q + tx.quantity);
        cost.set(tx.symbol, c + spent);
        if (lastLevel) units += spent / lastLevel;
        else pendingCash += spent;
      } else if (tx.type === "sell") {
        const sold = Math.min(tx.quantity, q);
        const avg = q > 0 ? c / q : 0;
        qty.set(tx.symbol, q - sold);
        cost.set(tx.symbol, c - avg * sold);
        const proceeds = sold * tx.price - tx.fees;
        if (lastLevel) units = Math.max(0, units - proceeds / lastLevel);
        else pendingCash -= proceeds;
      } else if (tx.type === "bonus") {
        qty.set(tx.symbol, q + tx.quantity);
      }
      // Dividends are income, not position changes.
    }

    let value = 0;
    let invested = 0;
    for (const [symbol, q] of qty) {
      if (q <= 0) continue;
      const close = closes.get(symbol)?.get(date);
      if (close != null) lastClose.set(symbol, close);
      value += q * (lastClose.get(symbol) ?? 0);
      invested += cost.get(symbol) ?? 0;
    }

    points.push({
      date,
      value: Math.round(value * 100) / 100,
      invested: Math.round(invested * 100) / 100,
      benchmark: lastLevel ? Math.round(units * lastLevel * 100) / 100 : null,
    });
  }
  return points;
}

/** Daily value of a user's portfolio (or all of them) since their first trade. */
export async function getPortfolioHistory(
  userId: string | null,
  scope: LedgerScope = {},
  indexCode: string = DEFAULT_INDEX,
): Promise<HistoryPoint[]> {
  const ledger = await listTransactions(userId, scope);
  if (ledger.length === 0) return [];

  const firstDate = ledger.reduce((min, t) => (t.date < min ? t.date : min), ledger[0].date);
  const symbols = [...new Set(ledger.map((t) => t.symbol))];

  const [quoteRows, levelRows] = await Promise.all([
    db
      .select({ symbol: quotesDaily.symbol, date: quotesDaily.date, close: quotesDaily.close })
      .from(quotesDaily)
      .where(and(inArray(quotesDaily.symbol, symbols), gte(quotesDaily.date, firstDate)))
      .orderBy(asc(quotesDaily.date))
      .all(),
    db
      .select({ date: indexLevels.date, current: indexLevels.current })
      .from(indexLevels)
      .where(and(eq(indexLevels.indexCode, indexCode), gte(indexLevels.date, firstDate)))
      .all(),
  ]);

  const closes = new Map<string, Map<string, number>>();
  const dateSet = new Set<string>([firstDate]);
  for (const row of quoteRows) {
    let bySymbol = closes.get(row.symbol);
    if (!bySymbol) closes.set(row.symbol, (bySymbol = new Map()));
    bySymbol.set(row.date, row.close);
    dateSet.add(row.date);
  }
  const indexLevel = new Map(levelRows.map((r) => [r.date, r.current]));

  return replayLedger(ledger, [...dateSet].sort(), closes, indexLevel);
}
