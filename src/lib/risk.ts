import { and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { quotesDaily } from "@/db/schema";
import { getIndexHistory } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { TRACKED_INDEX } from "@/lib/psx/ingest";
import { addDays, todayPkt } from "@/lib/dates";

export const MIN_OVERLAP = 30;

export interface ReturnSeries {
  symbol: string;
  returns: Map<string, number>;
}

function toReturns(rows: { date: string; close: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].close;
    if (prev > 0) out.set(rows[i].date, rows[i].close / prev - 1);
  }
  return out;
}

export async function loadReturns(
  symbols: string[],
  fromDate: string,
): Promise<ReturnSeries[]> {
  if (symbols.length === 0) return [];

  const rows = await db
    .select({
      symbol: quotesDaily.symbol,
      date: quotesDaily.date,
      close: quotesDaily.close,
    })
    .from(quotesDaily)
    .where(
      and(inArray(quotesDaily.symbol, symbols), gte(quotesDaily.date, fromDate)),
    )
    .orderBy(quotesDaily.date)
    .all();

  const bySymbol = new Map<string, { date: string; close: number }[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol);
    if (list) list.push(row);
    else bySymbol.set(row.symbol, [row]);
  }

  return symbols
    .filter((s) => (bySymbol.get(s)?.length ?? 0) > 1)
    .map((symbol) => ({
      symbol,
      returns: toReturns(bySymbol.get(symbol)!),
    }));
}

export interface PairStat {
  a: string;
  b: string;
  correlation: number | null;
  overlap: number;
}

export function correlate(
  x: Map<string, number>,
  y: Map<string, number>,
): { correlation: number | null; overlap: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, value] of x) {
    const other = y.get(date);
    if (other != null) {
      xs.push(value);
      ys.push(other);
    }
  }

  const n = xs.length;
  if (n < 2) return { correlation: null, overlap: n };

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX <= 0 || varY <= 0) return { correlation: null, overlap: n };
  return { correlation: cov / Math.sqrt(varX * varY), overlap: n };
}

export interface BetaStat {
  symbol: string;
  beta: number | null;
  rSquared: number | null;
  volatilityPct: number | null;
  overlap: number;
}

function computeBeta(
  asset: Map<string, number>,
  market: Map<string, number>,
): Omit<BetaStat, "symbol"> {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, value] of asset) {
    const m = market.get(date);
    if (m != null) {
      ys.push(value);
      xs.push(m);
    }
  }

  const n = xs.length;
  if (n < 2) {
    return { beta: null, rSquared: null, volatilityPct: null, overlap: n };
  }

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const beta = varX > 0 ? cov / varX : null;
  const correlation =
    varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : null;
  const volatilityPct = Math.sqrt(varY / (n - 1)) * Math.sqrt(252) * 100;

  return {
    beta,
    rSquared: correlation == null ? null : correlation * correlation,
    volatilityPct,
    overlap: n,
  };
}

export interface RiskReport {
  symbols: string[];
  matrix: PairStat[];
  betas: BetaStat[];
  portfolioBeta: number | null;
  averageCorrelation: number | null;
  highlyCorrelated: PairStat[];
  concentration: number;
  topWeightPct: number;
  indexCode: string;
  fromDate: string;
  excluded: string[];
}

export async function buildRiskReport({
  indexCode = TRACKED_INDEX,
  days = 365,
}: { indexCode?: string; days?: number } = {}): Promise<RiskReport> {
  const fromDate = addDays(todayPkt(), -days);
  const portfolio = await getPortfolio();
  const open = portfolio.holdings.filter((h) => h.quantity > 0);
  const wanted = open.map((h) => h.symbol);

  const series = await loadReturns(wanted, fromDate);
  const usable = series.filter((s) => s.returns.size >= MIN_OVERLAP);
  const symbols = usable.map((s) => s.symbol);
  const excluded = wanted.filter((s) => !symbols.includes(s));

  const bySymbol = new Map(usable.map((s) => [s.symbol, s.returns]));

  const matrix: PairStat[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const { correlation, overlap } = correlate(
        bySymbol.get(symbols[i])!,
        bySymbol.get(symbols[j])!,
      );
      matrix.push({ a: symbols[i], b: symbols[j], correlation, overlap });
    }
  }

  const indexHistory = await getIndexHistory(indexCode, fromDate);
  const indexReturns = toReturns(
    indexHistory.map((r) => ({
      date: r.date,
      close: r.current,
    })),
  );
  const betas: BetaStat[] = symbols.map((symbol) => ({
    symbol,
    ...computeBeta(bySymbol.get(symbol)!, indexReturns),
  }));

  const totalValue = open.reduce((sum, h) => sum + (h.marketValue ?? 0), 0);
  const weightOf = (symbol: string) => {
    const h = open.find((x) => x.symbol === symbol);
    return totalValue > 0 ? (h?.marketValue ?? 0) / totalValue : 0;
  };

  let portfolioBeta: number | null = null;
  const weighted = betas.filter((b) => b.beta != null);
  if (weighted.length > 0) {
    const covered = weighted.reduce((sum, b) => sum + weightOf(b.symbol), 0);
    if (covered > 0) {
      portfolioBeta =
        weighted.reduce((sum, b) => sum + b.beta! * weightOf(b.symbol), 0) /
        covered;
    }
  }

  const trustworthy = matrix.filter(
    (p) => p.correlation != null && p.overlap >= MIN_OVERLAP,
  );
  const averageCorrelation =
    trustworthy.length > 0
      ? trustworthy.reduce((sum, p) => sum + p.correlation!, 0) /
        trustworthy.length
      : null;

  const concentration = open.reduce(
    (sum, h) => sum + weightOf(h.symbol) ** 2,
    0,
  );
  const topWeightPct = Math.max(0, ...open.map((h) => weightOf(h.symbol) * 100));

  return {
    symbols,
    matrix,
    betas: betas.sort((a, b) => (b.beta ?? 0) - (a.beta ?? 0)),
    portfolioBeta,
    averageCorrelation,
    highlyCorrelated: trustworthy
      .filter((p) => (p.correlation ?? 0) >= 0.7)
      .sort((a, b) => (b.correlation ?? 0) - (a.correlation ?? 0)),
    concentration,
    topWeightPct,
    indexCode,
    fromDate,
    excluded,
  };
}

export function findPair(
  matrix: PairStat[],
  a: string,
  b: string,
): PairStat | null {
  if (a === b) return { a, b, correlation: 1, overlap: 0 };
  return (
    matrix.find(
      (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
    ) ?? null
  );
}
