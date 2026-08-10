import { asc } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";

export type CostMethod = "fifo" | "average";

export interface Disposal {
  symbol: string;
  date: string;
  taxYear: string;
  quantity: number;
  proceeds: number;
  costBasis: number;
  gain: number;
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

export function taxYearFor(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const endYear = m >= 7 ? y + 1 : y;
  return `${endYear - 1}-${String(endYear).slice(2)}`;
}

interface Lot {
  date: string;
  quantity: number;
  unitCost: number;
}

export async function computeDisposals(method: CostMethod): Promise<Disposal[]> {
  const ledger = await db
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
    } else if (tx.type === "sell") {
      const proceeds = tx.quantity * tx.price - tx.fees;

      if (method === "average") {
        const agg = average.get(symbol) ?? { quantity: 0, unitCost: 0 };
        const sellQty = Math.min(tx.quantity, agg.quantity);
        const costBasis = sellQty * agg.unitCost;
        agg.quantity = Math.max(0, agg.quantity - sellQty);
        if (agg.quantity === 0) agg.unitCost = 0;
        average.set(symbol, agg);

        disposals.push({
          symbol,
          date: tx.date,
          taxYear: taxYearFor(tx.date),
          quantity: sellQty,
          proceeds,
          costBasis,
          gain: proceeds - costBasis,
          holdingDays: null,
        });
      } else {
        let remaining = tx.quantity;
        let totalCost = 0;
        let weightedDaysNumerator = 0;
        const list = lots.get(symbol) ?? [];

        while (remaining > 0 && list.length > 0) {
          const lot = list[0];
          const take = Math.min(remaining, lot.quantity);
          totalCost += take * lot.unitCost;
          weightedDaysNumerator += take * daysBetween(lot.date, tx.date);

          lot.quantity -= take;
          remaining -= take;

          if (lot.quantity === 0) list.shift();
        }

        const matchedQty = tx.quantity - remaining;

        disposals.push({
          symbol,
          date: tx.date,
          taxYear: taxYearFor(tx.date),
          quantity: matchedQty,
          proceeds,
          costBasis: totalCost,
          gain: proceeds - totalCost,
          holdingDays:
            matchedQty > 0
              ? Math.round(weightedDaysNumerator / matchedQty)
              : null,
        });

        lots.set(symbol, list);
      }
    }
  }

  return disposals;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export async function summariseByTaxYear(method: CostMethod): Promise<TaxYearSummary[]> {
  const disposals = await computeDisposals(method);

  const txs = await db
    .select()
    .from(transactions)
    .all();
  const dividends = txs.filter((t) => t.type === "dividend");

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
