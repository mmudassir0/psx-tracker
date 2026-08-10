import { and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { quotesDaily } from "@/db/schema";
import { getConstituents, getIndexHistory } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { TRACKED_INDEX } from "@/lib/psx/ingest";

export type Weighting = "index" | "equal";
export type RebalanceFrequency = "none" | "monthly" | "quarterly" | "annually";

export interface BacktestOptions {
  indexCode?: string;
  startDate: string;
  initialCapital?: number;
  weighting?: Weighting;
  rebalance?: RebalanceFrequency;
}

export interface EquityPoint {
  date: string;
  strategy: number;
  benchmark: number | null;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  finalValue: number;
}

export interface BacktestResult {
  points: EquityPoint[];
  strategy: BacktestMetrics;
  benchmark: BacktestMetrics | null;
  included: string[];
  excluded: string[];
  rebalanceDates: string[];
  startDate: string;
  endDate: string;
  tradingDays: number;
}

async function loadPriceMatrix(
  symbols: string[],
  startDate: string,
): Promise<Map<string, Map<string, number>>> {
  if (symbols.length === 0) return new Map();

  const rows = await db
    .select({
      date: quotesDaily.date,
      symbol: quotesDaily.symbol,
      close: quotesDaily.close,
    })
    .from(quotesDaily)
    .where(
      and(inArray(quotesDaily.symbol, symbols), gte(quotesDaily.date, startDate)),
    )
    .orderBy(quotesDaily.date)
    .all();

  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let day = byDate.get(row.date);
    if (!day) {
      day = new Map();
      byDate.set(row.date, day);
    }
    day.set(row.symbol, row.close);
  }
  return byDate;
}

function isRebalanceBoundary(
  previous: string,
  date: string,
  frequency: RebalanceFrequency,
): boolean {
  if (frequency === "none") return false;
  const [py, pm] = previous.split("-").map(Number);
  const [cy, cm] = date.split("-").map(Number);

  if (frequency === "monthly") return cy !== py || cm !== pm;
  if (frequency === "annually") return cy !== py;
  return cy !== py || Math.floor((cm - 1) / 3) !== Math.floor((pm - 1) / 3);
}

export async function runBacktest(options: BacktestOptions): Promise<BacktestResult> {
  const {
    indexCode = TRACKED_INDEX,
    startDate,
    initialCapital = 1_000_000,
    weighting = "index",
    rebalance = "none",
  } = options;

  const constituents = await getConstituents(indexCode);
  const allSymbols = constituents.map((c) => c.symbol);
  const matrix = await loadPriceMatrix(allSymbols, startDate);
  const dates = [...matrix.keys()].sort();

  const empty: BacktestResult = {
    points: [],
    strategy: emptyMetrics(),
    benchmark: null,
    included: [],
    excluded: allSymbols,
    rebalanceDates: [],
    startDate,
    endDate: startDate,
    tradingDays: 0,
  };
  if (dates.length < 2) return empty;

  const firstDay = matrix.get(dates[0])!;
  const included = allSymbols.filter((s) => firstDay.has(s));
  const excluded = allSymbols.filter((s) => !firstDay.has(s));
  if (included.length === 0) return empty;

  const targets = new Map<string, number>();
  if (weighting === "equal") {
    for (const s of included) targets.set(s, 1 / included.length);
  } else {
    const weights = new Map(
      constituents.map((c) => [c.symbol, c.indexWeightPct ?? 0]),
    );
    const total = included.reduce((sum, s) => sum + (weights.get(s) ?? 0), 0);
    if (total <= 0) {
      for (const s of included) targets.set(s, 1 / included.length);
    } else {
      for (const s of included) targets.set(s, (weights.get(s) ?? 0) / total);
    }
  }

  const shares = new Map<string, number>();
  for (const s of included) {
    const price = firstDay.get(s)!;
    shares.set(s, price > 0 ? (initialCapital * targets.get(s)!) / price : 0);
  }

  const lastPrice = new Map<string, number>(
    included.map((s) => [s, firstDay.get(s)!]),
  );

  const indexHistory = await getIndexHistory(indexCode, startDate);
  const indexByDate = new Map(indexHistory.map((r) => [r.date, r.current]));
  const indexStart = indexByDate.get(dates[0]) ?? null;

  const points: EquityPoint[] = [];
  const rebalanceDates: string[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const day = matrix.get(date)!;

    for (const s of included) {
      const price = day.get(s);
      if (price != null && price > 0) lastPrice.set(s, price);
    }

    const value = included.reduce(
      (sum, s) => sum + (shares.get(s) ?? 0) * (lastPrice.get(s) ?? 0),
      0,
    );

    const indexLevel = indexByDate.get(date);
    points.push({
      date,
      strategy: value,
      benchmark:
        indexStart && indexLevel
          ? (indexLevel / indexStart) * initialCapital
          : null,
    });

    if (
      i > 0 &&
      rebalance !== "none" &&
      isRebalanceBoundary(dates[i - 1], date, rebalance) &&
      value > 0
    ) {
      for (const s of included) {
        const price = lastPrice.get(s) ?? 0;
        shares.set(s, price > 0 ? (value * targets.get(s)!) / price : 0);
      }
      rebalanceDates.push(date);
    }
  }

  const strategyMetrics = computeMetrics(
    points.map((p) => p.strategy),
    initialCapital,
  );

  const benchValues = points.map((p) => p.benchmark).filter((v): v is number => v != null);
  const benchmarkMetrics =
    benchValues.length === points.length
      ? computeMetrics(benchValues, initialCapital)
      : null;

  return {
    points,
    strategy: strategyMetrics,
    benchmark: benchmarkMetrics,
    included,
    excluded,
    rebalanceDates,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    tradingDays: dates.length,
  };
}

function emptyMetrics(): BacktestMetrics {
  return {
    totalReturnPct: 0,
    cagrPct: 0,
    maxDrawdownPct: 0,
    volatilityPct: 0,
    finalValue: 0,
  };
}

export function computeMetrics(
  series: number[],
  initialCapital: number,
): BacktestMetrics {
  if (series.length < 2) return emptyMetrics();

  const finalValue = series[series.length - 1];
  const totalReturnPct = ((finalValue - initialCapital) / initialCapital) * 100;

  const years = series.length / 252;
  const cagrPct =
    years > 0 && finalValue > 0
      ? (Math.pow(finalValue / initialCapital, 1 / years) - 1) * 100
      : 0;

  let peak = series[0];
  let maxDrawdownPct = 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    if (prev > 0) dailyReturns.push(series[i] / prev - 1);

    if (series[i] > peak) peak = series[i];
    const drawdown = peak > 0 ? (peak - series[i]) / peak : 0;
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown;
  }

  const n = dailyReturns.length;
  let volatilityPct = 0;
  if (n > 1) {
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / n;
    const variance =
      dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1);
    volatilityPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  return {
    totalReturnPct,
    cagrPct,
    maxDrawdownPct: maxDrawdownPct * 100,
    volatilityPct,
    finalValue,
  };
}

export interface RebalanceRow {
  symbol: string;
  name: string | null;
  price: number | null;
  currentQuantity: number;
  currentValue: number;
  currentWeightPct: number;
  targetWeightPct: number;
  driftPct: number;
  targetValue: number;
  tradeShares: number;
  tradeValue: number;
  action: "buy" | "sell" | "hold";
}

export interface RebalancePlan {
  rows: RebalanceRow[];
  portfolioValue: number;
  turnoverPct: number;
  totalBuy: number;
  totalSell: number;
  missing: string[];
}

export async function planRebalance({
  indexCode = TRACKED_INDEX,
  weighting = "index",
  tolerancePct = 0.5,
  includeMissing = false,
}: {
  indexCode?: string;
  weighting?: Weighting;
  tolerancePct?: number;
  includeMissing?: boolean;
} = {}): Promise<RebalancePlan> {
  const portfolio = await getPortfolio();
  const constituents = await getConstituents(indexCode);
  const held = portfolio.holdings.filter((h) => h.quantity > 0);
  const portfolioValue = held.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);

  const targetUniverse = includeMissing
    ? constituents
    : constituents.filter((c) => held.some((h) => h.symbol === c.symbol));

  const totalTargetWeight =
    weighting === "equal"
      ? targetUniverse.length
      : targetUniverse.reduce((sum, c) => sum + (c.indexWeightPct ?? 0), 0);

  const targetFor = (symbol: string): number => {
    const row = targetUniverse.find((c) => c.symbol === symbol);
    if (!row || totalTargetWeight <= 0) return 0;
    return weighting === "equal"
      ? (1 / totalTargetWeight) * 100
      : ((row.indexWeightPct ?? 0) / totalTargetWeight) * 100;
  };

  const symbols = new Set<string>([
    ...held.map((h) => h.symbol),
    ...targetUniverse.map((c) => c.symbol),
  ]);

  const rows: RebalanceRow[] = [...symbols].map((symbol) => {
    const holding = held.find((h) => h.symbol === symbol);
    const market = constituents.find((c) => c.symbol === symbol);
    const price = holding?.close ?? market?.close ?? null;

    const currentValue = holding?.marketValue ?? 0;
    const currentWeightPct =
      portfolioValue > 0 ? (currentValue / portfolioValue) * 100 : 0;
    const targetWeightPct = targetFor(symbol);
    const driftPct = currentWeightPct - targetWeightPct;

    const targetValue = portfolioValue * (targetWeightPct / 100);
    const delta = targetValue - currentValue;

    const withinTolerance = Math.abs(driftPct) <= tolerancePct;
    const tradeShares =
      withinTolerance || price == null || price <= 0
        ? 0
        : Math.trunc(delta / price);

    return {
      symbol,
      name: holding?.name ?? market?.name ?? null,
      price,
      currentQuantity: holding?.quantity ?? 0,
      currentValue,
      currentWeightPct,
      targetWeightPct,
      driftPct,
      targetValue,
      tradeShares,
      tradeValue: price != null ? tradeShares * price : 0,
      action: tradeShares > 0 ? "buy" : tradeShares < 0 ? "sell" : "hold",
    };
  });

  const totalBuy = rows
    .filter((r) => r.tradeValue > 0)
    .reduce((sum, r) => sum + r.tradeValue, 0);
  const totalSell = rows
    .filter((r) => r.tradeValue < 0)
    .reduce((sum, r) => sum + Math.abs(r.tradeValue), 0);

  return {
    rows: rows.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct)),
    portfolioValue,
    turnoverPct:
      portfolioValue > 0 ? ((totalBuy + totalSell) / portfolioValue) * 100 : 0,
    totalBuy,
    totalSell,
    missing: constituents
      .filter((c) => !held.some((h) => h.symbol === c.symbol))
      .map((c) => c.symbol),
  };
}
