import { and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { quotesDaily } from "@/db/schema";
import { getConstituents, getIndexHistory } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { TRACKED_INDEX } from "@/lib/psx/ingest";

/**
 * Historical simulation over stored daily closes.
 *
 * Two limitations are structural, not bugs, and the UI states both:
 *
 *  1. SURVIVORSHIP BIAS. The universe is an index's constituents *today*.
 *     Membership snapshots only start when the app was first run, so past
 *     membership is unknown — companies that were dropped along the way are
 *     absent, which flatters the basket. The index level series it is compared
 *     against has no such bias, so the comparison is not apples to apples.
 *
 *  2. PRICE RETURN ONLY. Dividends are excluded, because PSX announcement
 *     titles frequently omit the rate. Both the basket and the index series
 *     are price-return, so the comparison is at least consistent.
 */

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
  /** Simulated basket value. */
  strategy: number;
  /** Index level rebased to the same starting capital. */
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
  /** Symbols included in the simulation. */
  included: string[];
  /** Constituents dropped for having no price on the start date. */
  excluded: string[];
  rebalanceDates: string[];
  startDate: string;
  endDate: string;
  tradingDays: number;
}

/** Closes for a set of symbols from `startDate`, keyed by date then symbol. */
function loadPriceMatrix(
  symbols: string[],
  startDate: string,
): Map<string, Map<string, number>> {
  if (symbols.length === 0) return new Map();

  const rows = db
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

/** True when `date` opens a new month/quarter/year relative to `previous`. */
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
  // quarterly
  return cy !== py || Math.floor((cm - 1) / 3) !== Math.floor((pm - 1) / 3);
}

export function runBacktest(options: BacktestOptions): BacktestResult {
  const {
    indexCode = TRACKED_INDEX,
    startDate,
    initialCapital = 1_000_000,
    weighting = "index",
    rebalance = "none",
  } = options;

  const constituents = getConstituents(indexCode);
  const allSymbols = constituents.map((c) => c.symbol);
  const matrix = loadPriceMatrix(allSymbols, startDate);
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
  // A symbol with no price on day one cannot be bought, so it sits out.
  const included = allSymbols.filter((s) => firstDay.has(s));
  const excluded = allSymbols.filter((s) => !firstDay.has(s));
  if (included.length === 0) return empty;

  // Target weights, normalised across the symbols we can actually hold.
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

  // Buy on day one.
  const shares = new Map<string, number>();
  for (const s of included) {
    const price = firstDay.get(s)!;
    shares.set(s, price > 0 ? (initialCapital * targets.get(s)!) / price : 0);
  }

  // Carry the last known price so a symbol that stops trading holds its value
  // rather than silently vanishing from the basket.
  const lastPrice = new Map<string, number>(
    included.map((s) => [s, firstDay.get(s)!]),
  );

  const indexHistory = getIndexHistory(indexCode, startDate);
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

    // Rebalance at the close, effective for subsequent days.
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

  const strategySeries = points.map((p) => p.strategy);
  const benchmarkSeries = points
    .map((p) => p.benchmark)
    .filter((v): v is number => v != null);

  const years = yearsBetween(dates[0], dates[dates.length - 1]);

  return {
    points,
    strategy: computeMetrics(strategySeries, years),
    benchmark:
      benchmarkSeries.length >= 2
        ? computeMetrics(benchmarkSeries, years)
        : null,
    included,
    excluded,
    rebalanceDates,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    tradingDays: dates.length,
  };
}

function yearsBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(ms / (365.25 * 86_400_000), 1 / 365.25);
}

/** Exported for testing: metrics from a bare equity series. */
export function computeMetrics(
  series: number[],
  years: number,
): BacktestMetrics {
  if (series.length < 2) return emptyMetrics();

  const first = series[0];
  const last = series[series.length - 1];
  const totalReturnPct = first > 0 ? ((last - first) / first) * 100 : 0;
  const cagrPct =
    first > 0 && last > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : 0;

  let peak = series[0];
  let maxDrawdown = 0;
  const dailyReturns: number[] = [];

  for (let i = 0; i < series.length; i++) {
    const value = series[i];
    if (value > peak) peak = value;
    if (peak > 0) {
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    if (i > 0 && series[i - 1] > 0) {
      dailyReturns.push(value / series[i - 1] - 1);
    }
  }

  const mean =
    dailyReturns.reduce((sum, r) => sum + r, 0) / (dailyReturns.length || 1);
  const variance =
    dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) /
    (dailyReturns.length > 1 ? dailyReturns.length - 1 : 1);
  // ~252 PSX trading sessions a year.
  const volatilityPct = Math.sqrt(variance) * Math.sqrt(252) * 100;

  return {
    totalReturnPct,
    cagrPct,
    maxDrawdownPct: maxDrawdown * 100,
    volatilityPct,
    finalValue: last,
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

// ---------------------------------------------------------------------------
// Rebalance planner — what to trade to reach a target allocation today
// ---------------------------------------------------------------------------

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
  /** Positive = buy, negative = sell. Whole shares only. */
  tradeShares: number;
  tradeValue: number;
  action: "buy" | "sell" | "hold";
}

export interface RebalancePlan {
  rows: RebalanceRow[];
  portfolioValue: number;
  /** Sum of absolute trade values as a share of the portfolio. */
  turnoverPct: number;
  totalBuy: number;
  totalSell: number;
  /** Names in the index you do not hold at all. */
  missing: string[];
}

/**
 * Trades needed to move today's portfolio onto an index's weights.
 * Only positions drifting more than `tolerancePct` are traded, which is what
 * stops a rebalance from generating a wall of trivial orders.
 */
export function planRebalance({
  indexCode = TRACKED_INDEX,
  weighting = "index",
  tolerancePct = 0.5,
  includeMissing = false,
}: {
  indexCode?: string;
  weighting?: Weighting;
  tolerancePct?: number;
  includeMissing?: boolean;
} = {}): RebalancePlan {
  const portfolio = getPortfolio();
  const constituents = getConstituents(indexCode);
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
