import { asc } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";

/**
 * Realised gains by tax year, for handing to whoever files your return.
 *
 * Two things stated plainly rather than assumed:
 *
 *  - Pakistan's tax year runs 1 July to 30 June, so a disposal on 2 July
 *    falls in the following year. That is the only date rule applied here.
 *  - The portfolio pages use weighted-average cost. Tax rules may require
 *    FIFO, which gives a different answer for the same trades, so BOTH are
 *    computed side by side. Nothing here picks one for you, and none of it
 *    is tax advice — CGT rates depend on holding period and filer status,
 *    which this does not model.
 */

export type CostMethod = "fifo" | "average";

export interface Disposal {
  symbol: string;
  date: string;
  taxYear: string;
  quantity: number;
  /** Net of selling fees. */
  proceeds: number;
  costBasis: number;
  gain: number;
  /** Days from acquisition to disposal; null under weighted average. */
  holdingDays: number | null;
}

export interface TaxYearSummary {
  taxYear: string;
  disposals: Disposal[];
  proceeds: number;
  costBasis: number;
  netGain: number;
  realisedGains: number;
  realisedLosses: number;
  dividendIncome: number;
}

/** Pakistan's tax year: 1 July to 30 June, labelled by the ending year. */
export function taxYearFor(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const endYear = m >= 7 ? y + 1 : y;
  return `${endYear - 1}-${String(endYear).slice(2)}`;
}

interface Lot {
  date: string;
  quantity: number;
  /** Cost per share including buy-side fees. */
  unitCost: number;
}

/**
 * Walk the ledger and produce disposals under the chosen cost method.
 *
 * Bonus shares enter at zero cost, which dilutes the average and, under FIFO,
 * forms their own zero-cost lot — matching how the portfolio engine treats
 * them so the two views stay reconcilable.
 */
export function computeDisposals(method: CostMethod): Disposal[] {
  const ledger = db
    .select()
    .from(transactions)
    .orderBy(asc(transactions.date), asc(transactions.createdAt))
    .all();

  const lots = new Map<string, Lot[]>();
  const average = new Map<string, { quantity: number; unitCost: number }>();
  const disposals: Disposal[] = [];

  for (const tx of ledger) {
    const symbol = tx.symbol;

    if (tx.type === "buy" || tx.type === "rights" || tx.type === "bonus") {
      const cost = tx.type === "bonus" ? 0 : tx.quantity * tx.price + tx.fees;
      const unitCost = tx.quantity > 0 ? cost / tx.quantity : 0;

      const list = lots.get(symbol) ?? [];
      list.push({ date: tx.date, quantity: tx.quantity, unitCost });
      lots.set(symbol, list);

      const agg = average.get(symbol) ?? { quantity: 0, unitCost: 0 };
      const newQty = agg.quantity + tx.quantity;
      agg.unitCost =
        newQty > 0 ? (agg.quantity * agg.unitCost + cost) / newQty : 0;
      agg.quantity = newQty;
      average.set(symbol, agg);
      continue;
    }

    if (tx.type !== "sell") continue;

    const proceeds = tx.quantity * tx.price - tx.fees;

    if (method === "average") {
      const agg = average.get(symbol);
      if (!agg || agg.quantity <= 0) continue;
      const sold = Math.min(tx.quantity, agg.quantity);
      const costBasis = sold * agg.unitCost;
      // Proceeds are pro-rated when the sale exceeds the held quantity.
      const realisedProceeds = proceeds * (sold / tx.quantity);

      disposals.push({
        symbol,
        date: tx.date,
        taxYear: taxYearFor(tx.date),
        quantity: sold,
        proceeds: realisedProceeds,
        costBasis,
        gain: realisedProceeds - costBasis,
        holdingDays: null,
      });

      agg.quantity -= sold;
      if (agg.quantity <= 0) {
        agg.quantity = 0;
        agg.unitCost = 0;
      }
      average.set(symbol, agg);
      continue;
    }

    // FIFO: consume the oldest lots first, one disposal row per lot touched.
    let remaining = tx.quantity;
    const list = lots.get(symbol) ?? [];
    while (remaining > 0 && list.length > 0) {
      const lot = list[0];
      const take = Math.min(remaining, lot.quantity);
      const share = take / tx.quantity;

      disposals.push({
        symbol,
        date: tx.date,
        taxYear: taxYearFor(tx.date),
        quantity: take,
        proceeds: proceeds * share,
        costBasis: take * lot.unitCost,
        gain: proceeds * share - take * lot.unitCost,
        holdingDays: daysBetween(lot.date, tx.date),
      });

      lot.quantity -= take;
      remaining -= take;
      if (lot.quantity <= 0) list.shift();
    }
    lots.set(symbol, list);
  }

  return disposals;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function summariseByTaxYear(method: CostMethod): TaxYearSummary[] {
  const disposals = computeDisposals(method);

  const dividends = db
    .select()
    .from(transactions)
    .all()
    .filter((t) => t.type === "dividend");

  const years = new Set<string>([
    ...disposals.map((d) => d.taxYear),
    ...dividends.map((d) => taxYearFor(d.date)),
  ]);

  return [...years]
    .sort((a, b) => b.localeCompare(a))
    .map((taxYear) => {
      const rows = disposals.filter((d) => d.taxYear === taxYear);
      const dividendIncome = dividends
        .filter((d) => taxYearFor(d.date) === taxYear)
        .reduce((sum, d) => sum + (d.quantity * d.price - d.fees), 0);

      return {
        taxYear,
        disposals: rows.sort((a, b) => b.date.localeCompare(a.date)),
        proceeds: rows.reduce((s, d) => s + d.proceeds, 0),
        costBasis: rows.reduce((s, d) => s + d.costBasis, 0),
        netGain: rows.reduce((s, d) => s + d.gain, 0),
        realisedGains: rows
          .filter((d) => d.gain > 0)
          .reduce((s, d) => s + d.gain, 0),
        realisedLosses: rows
          .filter((d) => d.gain < 0)
          .reduce((s, d) => s + Math.abs(d.gain), 0),
        dividendIncome,
      };
    });
}

/** CSV for the accountant. */
export function disposalsToCsv(disposals: Disposal[]): string {
  const header = [
    "Tax year",
    "Disposal date",
    "Symbol",
    "Quantity",
    "Proceeds (PKR)",
    "Cost basis (PKR)",
    "Gain/(loss) (PKR)",
    "Holding days",
  ].join(",");

  const rows = disposals.map((d) =>
    [
      d.taxYear,
      d.date,
      d.symbol,
      d.quantity,
      d.proceeds.toFixed(2),
      d.costBasis.toFixed(2),
      d.gain.toFixed(2),
      d.holdingDays ?? "",
    ].join(","),
  );

  return [header, ...rows].join("\n");
}
