/**
 * Money-weighted annual return (XIRR): the yearly rate at which every cash
 * flow, grown or discounted to today, adds up to zero. Unlike "total P&L %"
 * it accounts for when money went in and came out.
 */
import { pktDateToUtc } from "@/lib/dates";

export interface CashFlow {
  date: string;
  /** Money out of your pocket is negative (buys); money back is positive. */
  amount: number;
}

const DAY_MS = 86_400_000;

/** Annual rate as a percentage, or null when it can't be determined. */
export function xirr(flows: CashFlow[]): number | null {
  const usable = flows.filter((f) => Number.isFinite(f.amount) && f.amount !== 0);
  if (!usable.some((f) => f.amount < 0) || !usable.some((f) => f.amount > 0)) return null;

  const t0 = Math.min(...usable.map((f) => pktDateToUtc(f.date).getTime()));
  const years = usable.map((f) => (pktDateToUtc(f.date).getTime() - t0) / (365 * DAY_MS));
  const npv = (rate: number) =>
    usable.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, years[i]), 0);

  // Bisection: slower than Newton but never wanders off. NPV falls as the
  // rate rises (for buy-first flows), so bracket the sign change.
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-10) return mid * 100;
    if (Math.sign(fMid) === Math.sign(fLo)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * Cash flows from a ledger plus today's market value as a final inflow, as if
 * everything were sold at the latest close.
 */
export function ledgerCashFlows(
  ledger: { date: string; type: string; quantity: number; price: number; fees: number }[],
  marketValue: number,
  asOf: string,
): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const tx of ledger) {
    if (tx.type === "buy" || tx.type === "rights") flows.push({ date: tx.date, amount: -(tx.quantity * tx.price + tx.fees) });
    else if (tx.type === "sell") flows.push({ date: tx.date, amount: tx.quantity * tx.price - tx.fees });
    else if (tx.type === "dividend") flows.push({ date: tx.date, amount: tx.quantity * tx.price - tx.fees });
    // Bonus shares cost nothing; their value shows up in the final market value.
  }
  if (marketValue > 0) flows.push({ date: asOf, amount: marketValue });
  return flows;
}
