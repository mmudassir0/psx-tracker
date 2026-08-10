import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { getConstituents, type ConstituentView } from "@/lib/market";

export type TransactionType = "buy" | "sell" | "dividend" | "bonus" | "rights";

export interface Holding {
  symbol: string;
  quantity: number;
  /** Weighted-average cost per share, including fees. */
  avgCost: number;
  /** quantity x avgCost. */
  investedValue: number;
  realizedPnl: number;
  dividendIncome: number;
}

export interface HoldingView extends Holding {
  name: string | null;
  sectorName: string | null;
  close: number | null;
  changePct: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
  /** Unrealized + realized + dividends. */
  totalPnl: number | null;
  /** Share of portfolio market value, 0-100. */
  portfolioWeightPct: number | null;
  /** Share of KMI30 by free-float cap, 0-100. */
  indexWeightPct: number | null;
  /** portfolioWeight - indexWeight. Positive = overweight vs the index. */
  activeWeightPct: number | null;
  /** True when the name is no longer a KMI30 constituent. */
  droppedFromIndex: boolean;
}

export interface PortfolioSummary {
  holdings: HoldingView[];
  investedValue: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  realizedPnl: number;
  dividendIncome: number;
  totalPnl: number;
  sectors: {
    sector: string;
    portfolioWeightPct: number;
    indexWeightPct: number;
    activeWeightPct: number;
    marketValue: number;
  }[];
  /** Names held that have left KMI30 — the Shariah-compliance watch list. */
  droppedHoldings: string[];
}

export async function getHoldings(): Promise<Holding[]> {
  const ledger = await db
    .select()
    .from(transactions)
    .orderBy(asc(transactions.date), asc(transactions.createdAt))
    .all();

  const bySymbol = new Map<string, Holding>();

  for (const tx of ledger) {
    const holding = bySymbol.get(tx.symbol) ?? {
      symbol: tx.symbol,
      quantity: 0,
      avgCost: 0,
      investedValue: 0,
      realizedPnl: 0,
      dividendIncome: 0,
    };

    switch (tx.type as TransactionType) {
      case "buy":
      case "rights": {
        const addedCost = tx.quantity * tx.price + tx.fees;
        const newQuantity = holding.quantity + tx.quantity;
        holding.avgCost =
          newQuantity > 0
            ? (holding.quantity * holding.avgCost + addedCost) / newQuantity
            : 0;
        holding.quantity = newQuantity;
        break;
      }
      case "bonus": {
        const newQuantity = holding.quantity + tx.quantity;
        holding.avgCost =
          newQuantity > 0
            ? (holding.quantity * holding.avgCost) / newQuantity
            : 0;
        holding.quantity = newQuantity;
        break;
      }
      case "sell": {
        const sellQuantity = Math.min(tx.quantity, holding.quantity);
        const proceed = sellQuantity * tx.price - tx.fees;
        const costBasis = sellQuantity * holding.avgCost;
        holding.realizedPnl += proceed - costBasis;
        holding.quantity = Math.max(0, holding.quantity - sellQuantity);
        if (holding.quantity === 0) holding.avgCost = 0;
        break;
      }
      case "dividend": {
        holding.dividendIncome += tx.quantity * tx.price - tx.fees;
        break;
      }
    }

    holding.investedValue = holding.quantity * holding.avgCost;
    bySymbol.set(tx.symbol, holding);
  }

  return [...bySymbol.values()];
}

/** Holdings joined with live prices, index weights and concentration analysis. */
export async function getPortfolio(): Promise<PortfolioSummary> {
  const holdings = await getHoldings();
  const constituents = await getConstituents();
  const bySymbol = new Map<string, ConstituentView>(
    constituents.map((c) => [c.symbol, c]),
  );

  const views: HoldingView[] = holdings.map((holding) => {
    const market = bySymbol.get(holding.symbol);
    const close = market?.close ?? null;
    const marketValue = close == null ? null : holding.quantity * close;
    const unrealizedPnl =
      marketValue == null ? null : marketValue - holding.investedValue;

    return {
      ...holding,
      name: market?.name ?? null,
      sectorName: market?.sectorName ?? null,
      close,
      changePct: market?.changePct ?? null,
      marketValue,
      unrealizedPnl,
      unrealizedPct:
        unrealizedPnl != null && holding.investedValue > 0
          ? (unrealizedPnl / holding.investedValue) * 100
          : null,
      totalPnl:
        unrealizedPnl == null
          ? null
          : unrealizedPnl + holding.realizedPnl + holding.dividendIncome,
      portfolioWeightPct: null,
      indexWeightPct: market?.indexWeightPct ?? null,
      activeWeightPct: null,
      droppedFromIndex: holding.quantity > 0 && !market,
    };
  });

  const openPositions = views.filter((v) => v.quantity > 0);
  const marketValue = openPositions.reduce(
    (sum, v) => sum + (v.marketValue ?? 0),
    0,
  );

  for (const view of openPositions) {
    view.portfolioWeightPct =
      marketValue > 0 && view.marketValue != null
        ? (view.marketValue / marketValue) * 100
        : null;

    view.activeWeightPct =
      view.portfolioWeightPct != null && view.indexWeightPct != null
        ? view.portfolioWeightPct - view.indexWeightPct
        : null;
  }

  const investedValue = openPositions.reduce(
    (sum, v) => sum + v.investedValue,
    0,
  );
  const unrealizedPnl = marketValue - investedValue;
  const unrealizedPct =
    investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0;

  const totalPnl = views.reduce(
    (sum, v) =>
      sum + (v.unrealizedPnl ?? 0) + v.realizedPnl + v.dividendIncome,
    0,
  );

  // Sector rollup for portfolio-vs-index concentration analysis.
  const bySector = new Map<
    string,
    { portfolioCap: number; indexWeightSum: number }
  >();

  for (const view of openPositions) {
    const sector = view.sectorName ?? "Unknown";
    const existing = bySector.get(sector) ?? {
      portfolioCap: 0,
      indexWeightSum: 0,
    };
    existing.portfolioCap += view.marketValue ?? 0;
    bySector.set(sector, existing);
  }

  // Include index sector weights so underweight sectors show up too.
  for (const constituent of constituents) {
    const sector = constituent.sectorName ?? "Unknown";
    const existing = bySector.get(sector) ?? {
      portfolioCap: 0,
      indexWeightSum: 0,
    };
    existing.indexWeightSum += constituent.indexWeightPct ?? 0;
    bySector.set(sector, existing);
  }

  const sectorRollup = [...bySector.entries()]
    .map(([sector, s]) => {
      const portWeight =
        marketValue > 0 ? (s.portfolioCap / marketValue) * 100 : 0;
      return {
        sector,
        portfolioWeightPct: portWeight,
        indexWeightPct: s.indexWeightSum,
        activeWeightPct: portWeight - s.indexWeightSum,
        marketValue: s.portfolioCap,
      };
    })
    .filter((s) => s.portfolioWeightPct > 0 || s.indexWeightPct > 0)
    .sort((a, b) => b.portfolioWeightPct - a.portfolioWeightPct);

  const droppedHoldings = openPositions
    .filter((v) => v.droppedFromIndex)
    .map((v) => v.symbol);

  return {
    holdings: views,
    investedValue,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    realizedPnl: views.reduce((sum, v) => sum + v.realizedPnl, 0),
    dividendIncome: views.reduce((sum, v) => sum + v.dividendIncome, 0),
    totalPnl,
    sectors: sectorRollup,
    droppedHoldings,
  };
}

export async function listTransactions() {
  return await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();
}

export async function addTransaction(input: {
  symbol: string;
  date: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fees?: number;
  note?: string;
}) {
  const id = randomUUID();
  await db
    .insert(transactions)
    .values({
      id,
      symbol: input.symbol.toUpperCase().trim(),
      date: input.date,
      type: input.type,
      quantity: input.quantity,
      price: input.price,
      fees: input.fees ?? 0,
      note: input.note ?? null,
      createdAt: new Date(),
    })
    .run();
  return id;
}

export async function deleteTransaction(id: string) {
  await db.delete(transactions).where(eq(transactions.id, id)).run();
}
