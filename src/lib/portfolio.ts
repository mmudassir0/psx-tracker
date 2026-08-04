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

/**
 * Rebuild holdings from the transaction ledger using weighted-average cost.
 *
 * - buy      adds shares and cost (fees increase basis)
 * - sell     realises P&L against the running average; basis per share is unchanged
 * - bonus    adds shares at zero cost, which dilutes the average
 * - rights   adds shares at the subscription price
 * - dividend records income only and does not affect the average
 */
export function getHoldings(): Holding[] {
  const ledger = db
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
        // Same total cost spread over more shares.
        holding.avgCost =
          newQuantity > 0
            ? (holding.quantity * holding.avgCost) / newQuantity
            : 0;
        holding.quantity = newQuantity;
        break;
      }
      case "sell": {
        const soldQuantity = Math.min(tx.quantity, holding.quantity);
        const proceeds = soldQuantity * tx.price - tx.fees;
        holding.realizedPnl += proceeds - soldQuantity * holding.avgCost;
        holding.quantity -= soldQuantity;
        if (holding.quantity <= 0) {
          holding.quantity = 0;
          holding.avgCost = 0;
        }
        break;
      }
      case "dividend": {
        // quantity x price = gross payout; fees carry withholding tax.
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
export function getPortfolio(): PortfolioSummary {
  const holdings = getHoldings();
  const constituents = getConstituents();
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
      // Absent from the constituent list = no longer in KMI30.
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
      view.portfolioWeightPct == null
        ? null
        : view.portfolioWeightPct - (view.indexWeightPct ?? 0);
  }

  const investedValue = openPositions.reduce(
    (sum, v) => sum + v.investedValue,
    0,
  );
  const unrealizedPnl = marketValue - investedValue;
  const realizedPnl = views.reduce((sum, v) => sum + v.realizedPnl, 0);
  const dividendIncome = views.reduce((sum, v) => sum + v.dividendIncome, 0);

  return {
    holdings: views.sort(
      (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0),
    ),
    investedValue,
    marketValue,
    unrealizedPnl,
    unrealizedPct: investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0,
    realizedPnl,
    dividendIncome,
    totalPnl: unrealizedPnl + realizedPnl + dividendIncome,
    sectors: buildSectorComparison(openPositions, constituents, marketValue),
    droppedHoldings: views
      .filter((v) => v.droppedFromIndex)
      .map((v) => v.symbol),
  };
}

/** Portfolio sector weights next to the index's, to surface concentration. */
function buildSectorComparison(
  holdings: HoldingView[],
  constituents: ConstituentView[],
  totalMarketValue: number,
) {
  const indexBySector = new Map<string, number>();
  for (const c of constituents) {
    const sector = c.sectorName ?? c.sectorCode ?? "Unknown";
    indexBySector.set(
      sector,
      (indexBySector.get(sector) ?? 0) + (c.indexWeightPct ?? 0),
    );
  }

  const portfolioBySector = new Map<string, number>();
  for (const h of holdings) {
    const sector = h.sectorName ?? "Unknown";
    portfolioBySector.set(
      sector,
      (portfolioBySector.get(sector) ?? 0) + (h.marketValue ?? 0),
    );
  }

  const sectors = new Set([
    ...indexBySector.keys(),
    ...portfolioBySector.keys(),
  ]);

  return [...sectors]
    .map((sector) => {
      const value = portfolioBySector.get(sector) ?? 0;
      const portfolioWeightPct =
        totalMarketValue > 0 ? (value / totalMarketValue) * 100 : 0;
      const indexWeightPct = indexBySector.get(sector) ?? 0;
      return {
        sector,
        portfolioWeightPct,
        indexWeightPct,
        activeWeightPct: portfolioWeightPct - indexWeightPct,
        marketValue: value,
      };
    })
    .filter((s) => s.portfolioWeightPct > 0 || s.indexWeightPct > 0)
    .sort((a, b) => b.portfolioWeightPct - a.portfolioWeightPct);
}

// ---------------------------------------------------------------------------
// Ledger mutations
// ---------------------------------------------------------------------------

export function listTransactions() {
  return db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();
}

export function addTransaction(input: {
  symbol: string;
  date: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fees?: number;
  note?: string | null;
}) {
  const id = randomUUID();
  db.insert(transactions)
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

export function deleteTransaction(id: string) {
  db.delete(transactions).where(eq(transactions.id, id)).run();
}
