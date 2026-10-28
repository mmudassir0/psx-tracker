/**
 * Mutual funds the user holds, valued at NAVs they record.
 *
 * MUFAP publishes daily NAVs but its site sits behind a bot check that blocks
 * automated reads, so nothing here is fetched: the user adds a fund, records
 * purchases/redemptions/dividends at the NAV on their statement, and notes a
 * newer NAV when they want the value refreshed. The latest NAV known from
 * either a transaction or a noted NAV is used.
 *
 * Cost uses the weighted-average method (as AMC statements do): a redemption
 * takes out cost in proportion to the units redeemed.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { fundNavs, fundTransactions, funds } from "@/db/schema";

export type FundTxType = "buy" | "redeem" | "dividend";

export interface FundRow {
  id: string;
  name: string;
  amc: string | null;
  category: string | null;
  shariah: boolean;
}

export interface FundTx {
  id: string;
  fundId: string;
  date: string;
  type: FundTxType;
  units: number;
  nav: number;
  amount: number;
  note: string | null;
}

export interface FundHolding extends FundRow {
  units: number;
  /** Cost of the units still held. */
  costBasis: number;
  avgCostPerUnit: number | null;
  latestNav: { date: string; nav: number } | null;
  value: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  realizedPnl: number;
  dividends: number;
  /** Unrealized + realized + dividends. */
  totalReturn: number | null;
}

export interface FundPortfolio {
  holdings: FundHolding[];
  value: number;
  costBasis: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dividends: number;
  /** Funds with units but no NAV yet, so not in `value`. */
  unpriced: string[];
}

const EPS = 1e-9;

/** Pure: holdings from funds, their transactions (any order) and noted NAVs. */
export function computeFundPortfolio(
  fundRows: FundRow[],
  txs: FundTx[],
  navs: { fundId: string; date: string; nav: number }[],
): FundPortfolio {
  const holdings: FundHolding[] = [];
  for (const f of fundRows) {
    const ledger = txs
      .filter((t) => t.fundId === f.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    let units = 0;
    let cost = 0;
    let realized = 0;
    let dividends = 0;
    for (const t of ledger) {
      if (t.type === "buy") {
        units += t.units;
        cost += t.amount;
      } else if (t.type === "redeem") {
        const avg = units > EPS ? cost / units : 0;
        const taken = Math.min(t.units, units);
        realized += t.amount - avg * taken;
        cost -= avg * taken;
        units -= taken;
      } else {
        dividends += t.amount;
      }
    }
    if (units < EPS) {
      units = 0;
      cost = 0;
    }

    const candidates = [
      ...navs.filter((n) => n.fundId === f.id && n.nav > 0),
      ...ledger.filter((t) => t.nav > 0 && t.type !== "dividend").map((t) => ({ date: t.date, nav: t.nav })),
    ];
    // Newest date wins; on a tie a noted NAV beats a transaction's.
    const latest = candidates.reduce<{ date: string; nav: number } | null>(
      (best, c) => (!best || c.date > best.date ? { date: c.date, nav: c.nav } : best),
      null,
    );

    const value = latest ? units * latest.nav : null;
    const unrealized = value != null ? value - cost : null;
    holdings.push({
      ...f,
      units,
      costBasis: cost,
      avgCostPerUnit: units > 0 ? cost / units : null,
      latestNav: latest,
      value,
      unrealizedPnl: unrealized,
      unrealizedPct: unrealized != null && cost > 0 ? (unrealized / cost) * 100 : null,
      realizedPnl: realized,
      dividends,
      totalReturn: unrealized != null ? unrealized + realized + dividends : null,
    });
  }

  holdings.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.name.localeCompare(b.name));
  const open = holdings.filter((h) => h.units > 0);
  return {
    holdings,
    value: open.reduce((s, h) => s + (h.value ?? 0), 0),
    costBasis: open.reduce((s, h) => s + h.costBasis, 0),
    unrealizedPnl: open.reduce((s, h) => s + (h.unrealizedPnl ?? 0), 0),
    realizedPnl: holdings.reduce((s, h) => s + h.realizedPnl, 0),
    dividends: holdings.reduce((s, h) => s + h.dividends, 0),
    unpriced: open.filter((h) => h.latestNav == null).map((h) => h.name),
  };
}

// --- Database ---------------------------------------------------------------

export async function listFunds(userId: string): Promise<FundRow[]> {
  return db
    .select({ id: funds.id, name: funds.name, amc: funds.amc, category: funds.category, shariah: funds.shariah })
    .from(funds)
    .where(eq(funds.userId, userId))
    .orderBy(asc(funds.name))
    .all();
}

export async function listFundTransactions(userId: string): Promise<FundTx[]> {
  return db
    .select({
      id: fundTransactions.id,
      fundId: fundTransactions.fundId,
      date: fundTransactions.date,
      type: fundTransactions.type,
      units: fundTransactions.units,
      nav: fundTransactions.nav,
      amount: fundTransactions.amount,
      note: fundTransactions.note,
    })
    .from(fundTransactions)
    .where(eq(fundTransactions.userId, userId))
    .orderBy(asc(fundTransactions.date))
    .all();
}

/** The user's fund transactions; empty before the fund tables exist. */
export async function getFundLedger(userId: string): Promise<FundTx[]> {
  try {
    return await listFundTransactions(userId);
  } catch {
    return [];
  }
}

/**
 * The user's funds valued at their latest NAVs. A database without the fund
 * tables yet (before the workflow creates them) reads as no funds.
 */
export async function getFundPortfolio(userId: string | null): Promise<FundPortfolio> {
  const empty: FundPortfolio = { holdings: [], value: 0, costBasis: 0, unrealizedPnl: 0, realizedPnl: 0, dividends: 0, unpriced: [] };
  if (!userId) return empty;
  try {
    const fundRows = await listFunds(userId);
    if (fundRows.length === 0) return empty;
    const [txs, navs] = await Promise.all([
      listFundTransactions(userId),
      db.select().from(fundNavs).where(inArray(fundNavs.fundId, fundRows.map((f) => f.id))).all(),
    ]);
    return computeFundPortfolio(fundRows, txs, navs);
  } catch {
    return empty;
  }
}

async function ownsFund(userId: string, fundId: string): Promise<boolean> {
  const row = await db
    .select({ id: funds.id })
    .from(funds)
    .where(and(eq(funds.id, fundId), eq(funds.userId, userId)))
    .get();
  return Boolean(row);
}

export async function createFund(
  userId: string,
  input: { name: string; amc?: string | null; category?: string | null; shariah?: boolean },
): Promise<string> {
  const id = randomUUID();
  await db
    .insert(funds)
    .values({
      id,
      userId,
      name: input.name.trim(),
      amc: input.amc?.trim() || null,
      category: input.category?.trim() || null,
      shariah: Boolean(input.shariah),
      createdAt: new Date(),
    })
    .run();
  return id;
}

/** Removes a fund with its transactions and NAVs. Returns false if not the user's. */
export async function deleteFund(userId: string, fundId: string): Promise<boolean> {
  if (!(await ownsFund(userId, fundId))) return false;
  await db.delete(fundTransactions).where(eq(fundTransactions.fundId, fundId)).run();
  await db.delete(fundNavs).where(eq(fundNavs.fundId, fundId)).run();
  await db.delete(funds).where(eq(funds.id, fundId)).run();
  return true;
}

export async function addFundTransaction(
  userId: string,
  input: { fundId: string; date: string; type: FundTxType; units: number; nav: number; amount?: number | null; note?: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await ownsFund(userId, input.fundId))) return { ok: false, message: "Unknown fund" };
  const units = input.type === "dividend" ? 0 : input.units;
  if (input.type !== "dividend" && !(units > 0)) return { ok: false, message: "Units must be more than zero" };
  if (input.type !== "dividend" && !(input.nav > 0)) return { ok: false, message: "NAV must be more than zero" };

  if (input.type === "redeem") {
    const held = computeFundPortfolio(
      [{ id: input.fundId, name: "", amc: null, category: null, shariah: false }],
      (await listFundTransactions(userId)).filter((t) => t.fundId === input.fundId && t.date <= input.date),
      [],
    ).holdings[0].units;
    if (units > held + EPS) return { ok: false, message: `You held ${held.toLocaleString("en-PK")} units on that date` };
  }

  const amount = input.amount != null && Number.isFinite(input.amount) ? input.amount : units * input.nav;
  if (!(amount > 0)) return { ok: false, message: "Amount must be more than zero" };

  await db
    .insert(fundTransactions)
    .values({
      id: randomUUID(),
      userId,
      fundId: input.fundId,
      date: input.date,
      type: input.type,
      units,
      nav: input.type === "dividend" ? 0 : input.nav,
      amount,
      note: input.note?.trim() || null,
      createdAt: new Date(),
    })
    .run();
  return { ok: true };
}

export async function deleteFundTransaction(userId: string, id: string): Promise<void> {
  await db
    .delete(fundTransactions)
    .where(and(eq(fundTransactions.id, id), eq(fundTransactions.userId, userId)))
    .run();
}

export async function recordFundNav(
  userId: string,
  input: { fundId: string; date: string; nav: number },
): Promise<boolean> {
  if (!(await ownsFund(userId, input.fundId)) || !(input.nav > 0)) return false;
  await db
    .insert(fundNavs)
    .values(input)
    .onConflictDoUpdate({ target: [fundNavs.fundId, fundNavs.date], set: { nav: input.nav } })
    .run();
  return true;
}
