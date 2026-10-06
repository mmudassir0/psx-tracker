import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { getAllSymbolViews, getConstituents, type ConstituentView } from "@/lib/market";
import { ensureDefaultPortfolio, ownsPortfolio } from "@/lib/portfolios";
import { txKey, type ImportedTx } from "@/lib/csv-import";

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
  /** PKR change in this position's value today: quantity × (close − previous close). */
  dayChange: number | null;
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
  /** True when the name is not (or no longer) a KMI30 constituent. */
  droppedFromIndex: boolean;
}

export interface PortfolioSummary {
  holdings: HoldingView[];
  investedValue: number;
  marketValue: number;
  /** Today's change in the value of open positions, PKR and %. */
  dayChange: number;
  dayChangePct: number | null;
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
 * Which slice of a user's ledger to read. `portfolioId` omitted (or null)
 * means every portfolio combined; `asOf` limits to trades up to that date.
 */
export interface LedgerScope {
  portfolioId?: string | null;
  asOf?: string;
}

function ledgerWhere(userId: string, scope: LedgerScope = {}): SQL | undefined {
  return and(
    eq(transactions.userId, userId),
    scope.portfolioId ? eq(transactions.portfolioId, scope.portfolioId) : undefined,
    scope.asOf ? lte(transactions.date, scope.asOf) : undefined,
  );
}

/**
 * Every personal function takes the owner's id explicitly. Pages and actions
 * resolve it from the session; a null id (logged out) means an empty ledger.
 */
export async function getHoldings(
  userId: string | null,
  scope: LedgerScope = {},
): Promise<Holding[]> {
  if (!userId) return [];
  const ledger = await db
    .select()
    .from(transactions)
    .where(ledgerWhere(userId, scope))
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
export async function getPortfolio(
  userId: string | null,
  scope: LedgerScope = {},
): Promise<PortfolioSummary> {
  const holdings = await getHoldings(userId, scope);
  if (holdings.length === 0) return emptyPortfolio();

  // Prices come from every listed symbol, not just KMI30: a holding outside
  // the index still has a price. KMI30 supplies index weights only.
  const [allSymbols, constituents] = await Promise.all([getAllSymbolViews(), getConstituents()]);
  const priced = new Map<string, ConstituentView>(allSymbols.map((c) => [c.symbol, c]));
  const inIndex = new Map<string, ConstituentView>(constituents.map((c) => [c.symbol, c]));

  const views: HoldingView[] = holdings.map((holding) => {
    const member = inIndex.get(holding.symbol);
    const market = member ?? priced.get(holding.symbol);
    const close = market?.close ?? null;
    const ldcp = market?.ldcp ?? null;
    const marketValue = close == null ? null : holding.quantity * close;
    const unrealizedPnl =
      marketValue == null ? null : marketValue - holding.investedValue;

    return {
      ...holding,
      name: market?.name ?? null,
      sectorName: market?.sectorName ?? null,
      close,
      changePct: market?.changePct ?? null,
      dayChange:
        close != null && ldcp != null && holding.quantity > 0
          ? holding.quantity * (close - ldcp)
          : null,
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
      indexWeightPct: member?.indexWeightPct ?? null,
      activeWeightPct: null,
      droppedFromIndex: holding.quantity > 0 && !member,
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

  const dayChange = openPositions.reduce((sum, v) => sum + (v.dayChange ?? 0), 0);
  const previousValue = marketValue - dayChange;

  return {
    holdings: views,
    investedValue,
    marketValue,
    dayChange,
    dayChangePct: previousValue > 0 ? (dayChange / previousValue) * 100 : null,
    unrealizedPnl,
    unrealizedPct,
    realizedPnl: views.reduce((sum, v) => sum + v.realizedPnl, 0),
    dividendIncome: views.reduce((sum, v) => sum + v.dividendIncome, 0),
    totalPnl,
    sectors: sectorRollup,
    droppedHoldings,
  };
}

export async function listTransactions(
  userId: string | null,
  scope: LedgerScope = {},
) {
  if (!userId) return [];
  return await db
    .select()
    .from(transactions)
    .where(ledgerWhere(userId, scope))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();
}

export async function addTransaction(userId: string, input: {
  symbol: string;
  date: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fees?: number;
  note?: string;
  /** One of the user's portfolios; anything else falls back to the default. */
  portfolioId?: string | null;
}) {
  const portfolioId =
    input.portfolioId && (await ownsPortfolio(userId, input.portfolioId))
      ? input.portfolioId
      : await ensureDefaultPortfolio(userId);
  const id = randomUUID();
  await db
    .insert(transactions)
    .values({
      id,
      userId,
      portfolioId,
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

export async function deleteTransaction(userId: string, id: string) {
  // Scoped to the owner, so one user can never delete another's row by id.
  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .run();
}

/** Move one of the user's trades into another of their portfolios. */
export async function moveTransaction(userId: string, id: string, portfolioId: string) {
  if (!(await ownsPortfolio(userId, portfolioId))) return;
  await db
    .update(transactions)
    .set({ portfolioId })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .run();
}

/**
 * Bulk insert from a CSV import. Rows identical to one already in the target
 * portfolio (same date, symbol, type, quantity and price) are skipped, so
 * importing the same statement twice is harmless.
 */
export async function importTransactions(
  userId: string,
  portfolioId: string | null,
  rows: ImportedTx[],
): Promise<{ imported: number; skipped: number }> {
  const target =
    portfolioId && (await ownsPortfolio(userId, portfolioId))
      ? portfolioId
      : await ensureDefaultPortfolio(userId);

  const existing = new Set(
    (await listTransactions(userId, { portfolioId: target })).map((t) => txKey(t)),
  );
  const fresh: ImportedTx[] = [];
  for (const row of rows) {
    const key = txKey(row);
    if (existing.has(key)) continue;
    existing.add(key); // also drops duplicates within the file itself
    fresh.push(row);
  }

  const createdAt = new Date();
  for (let i = 0; i < fresh.length; i += 100) {
    await db
      .insert(transactions)
      .values(
        fresh.slice(i, i + 100).map((row) => ({
          id: randomUUID(),
          userId,
          portfolioId: target,
          symbol: row.symbol,
          date: row.date,
          type: row.type,
          quantity: row.quantity,
          price: row.price,
          fees: row.fees,
          note: row.note,
          createdAt,
        })),
      )
      .run();
  }
  return { imported: fresh.length, skipped: rows.length - fresh.length };
}

function emptyPortfolio(): PortfolioSummary {
  return {
    holdings: [],
    investedValue: 0,
    marketValue: 0,
    dayChange: 0,
    dayChangePct: null,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    realizedPnl: 0,
    dividendIncome: 0,
    totalPnl: 0,
    sectors: [],
    droppedHoldings: [],
  };
}
