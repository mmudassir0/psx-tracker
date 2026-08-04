import { and, desc, eq, gte, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  symbols,
  quotesDaily,
  indexLevels,
  companyStats,
  constituents,
  ingestRuns,
} from "@/db/schema";
import { TRACKED_INDEX } from "@/lib/psx/ingest";
import { startOfYear } from "@/lib/dates";
import { getTrailingDividendMap } from "@/lib/dividends";
import {
  getLatestMetricMap,
  METRIC_EPS_GROWTH,
  METRIC_NET_MARGIN,
} from "@/lib/financials";

export interface ConstituentView {
  symbol: string;
  name: string | null;
  sectorName: string | null;
  sectorCode: string | null;
  close: number | null;
  ldcp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  changePct: number | null;
  peTtm: number | null;
  marketCap: number | null;
  freeFloatShares: number | null;
  freeFloatPct: number | null;
  week52High: number | null;
  week52Low: number | null;
  ytdChangePct: number | null;
  year1ChangePct: number | null;
  /** Free-float market cap in PKR — the basis for index weighting. */
  freeFloatCap: number | null;
  /** Share of KMI30 free-float cap, 0-100. */
  indexWeightPct: number | null;
  /** How far below the 52-week high, as a positive percentage. */
  drawdownFrom52wPct: number | null;
  /** Trailing 12-month cash dividend per share, PKR. */
  dividendPerShare: number | null;
  /** Trailing 12-month dividend yield, percent of price. */
  dividendYieldPct: number | null;
  /** Latest reported EPS growth, percent. */
  epsGrowthPct: number | null;
  /** Latest reported net profit margin, percent. */
  netMarginPct: number | null;
}

/** Most recent date for which we have any quote data. */
export function latestQuoteDate(): string | null {
  const row = db
    .select({ date: quotesDaily.date })
    .from(quotesDaily)
    .orderBy(desc(quotesDaily.date))
    .limit(1)
    .get();
  return row?.date ?? null;
}

/** Most recent date on which we captured a membership snapshot for an index. */
export function latestConstituentDate(
  indexCode: string = TRACKED_INDEX,
): string | null {
  const row = db
    .select({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(1)
    .get();
  return row?.date ?? null;
}

/** Every index we hold a membership snapshot for. */
export function getTrackedIndexCodes(): string[] {
  return db
    .selectDistinct({ indexCode: constituents.indexCode })
    .from(constituents)
    .all()
    .map((r) => r.indexCode);
}

/** Build the market view for one symbol, independent of any index. */
interface ViewMaps {
  dividends?: Map<string, number>;
  epsGrowth?: Map<string, number>;
  netMargin?: Map<string, number>;
}

function buildView(
  symbol: string,
  quoteDate: string | null,
  maps: ViewMaps = {},
): ConstituentView {
  const meta = db.select().from(symbols).where(eq(symbols.symbol, symbol)).get();

  const quote = quoteDate
    ? db
        .select()
        .from(quotesDaily)
        .where(
          and(eq(quotesDaily.symbol, symbol), eq(quotesDaily.date, quoteDate)),
        )
        .get()
    : undefined;

  const stats = db
    .select()
    .from(companyStats)
    .where(eq(companyStats.symbol, symbol))
    .orderBy(desc(companyStats.date))
    .limit(1)
    .get();

  const close = quote?.close ?? null;
  const ldcp = quote?.ldcp ?? null;
  const changePct =
    close != null && ldcp != null && ldcp !== 0
      ? ((close - ldcp) / ldcp) * 100
      : null;

  const freeFloatCap =
    close != null && stats?.freeFloatShares != null
      ? close * stats.freeFloatShares
      : null;

  const drawdown =
    close != null && stats?.week52High != null && stats.week52High > 0
      ? ((stats.week52High - close) / stats.week52High) * 100
      : null;

  // Callers doing many symbols pass prebuilt maps; a lone lookup builds them.
  const dps = (maps.dividends ?? getTrailingDividendMap()).get(symbol) ?? null;
  const epsGrowth =
    (maps.epsGrowth ?? getLatestMetricMap(METRIC_EPS_GROWTH)).get(symbol) ??
    null;
  const netMargin =
    (maps.netMargin ?? getLatestMetricMap(METRIC_NET_MARGIN)).get(symbol) ??
    null;

  return {
    symbol,
    name: meta?.name ?? null,
    sectorName: meta?.sectorName ?? null,
    sectorCode: meta?.sectorCode ?? null,
    close,
    ldcp,
    open: quote?.open ?? null,
    high: quote?.high ?? null,
    low: quote?.low ?? null,
    volume: quote?.volume ?? null,
    changePct,
    peTtm: stats?.peTtm ?? null,
    marketCap: stats?.marketCap ?? null,
    freeFloatShares: stats?.freeFloatShares ?? null,
    freeFloatPct: stats?.freeFloatPct ?? null,
    week52High: stats?.week52High ?? null,
    week52Low: stats?.week52Low ?? null,
    ytdChangePct: stats?.ytdChangePct ?? null,
    year1ChangePct: stats?.year1ChangePct ?? null,
    freeFloatCap,
    indexWeightPct: null,
    drawdownFrom52wPct: drawdown,
    dividendPerShare: dps,
    dividendYieldPct:
      dps != null && close != null && close > 0 ? (dps / close) * 100 : null,
    epsGrowthPct: epsGrowth,
    netMarginPct: netMargin,
  };
}

/**
 * Constituents of an index, with weights.
 *
 * Weights are free-float market cap as a share of the index total — how PSX
 * constructs its free-float indices. PSX applies a per-scrip cap that we do
 * not model, so the largest names read slightly high. Weights always sum
 * to 100 across the returned set.
 */
export function getConstituents(
  indexCode: string = TRACKED_INDEX,
): ConstituentView[] {
  const memberDate = latestConstituentDate(indexCode);
  if (!memberDate) return [];

  const quoteDate = latestQuoteDate();

  const members = db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(
        eq(constituents.indexCode, indexCode),
        eq(constituents.date, memberDate),
      ),
    )
    .all()
    .map((r) => r.symbol);

  if (members.length === 0) return [];

  const maps: ViewMaps = {
    dividends: getTrailingDividendMap(),
    epsGrowth: getLatestMetricMap(METRIC_EPS_GROWTH, members),
    netMargin: getLatestMetricMap(METRIC_NET_MARGIN, members),
  };
  const rows = members.map((symbol) => buildView(symbol, quoteDate, maps));

  const totalCap = rows.reduce((sum, r) => sum + (r.freeFloatCap ?? 0), 0);
  if (totalCap > 0) {
    for (const row of rows) {
      row.indexWeightPct =
        row.freeFloatCap == null ? null : (row.freeFloatCap / totalCap) * 100;
    }
  }

  return rows.sort(
    (a, b) => (b.indexWeightPct ?? -1) - (a.indexWeightPct ?? -1),
  );
}

/**
 * View for a single symbol. Falls back to a standalone view when the symbol
 * isn't in `indexCode`, so pages work for any listed company — not only the
 * 30 in KMI30.
 */
export function getConstituent(
  symbol: string,
  indexCode: string = TRACKED_INDEX,
): ConstituentView | null {
  const inIndex = getConstituents(indexCode).find((c) => c.symbol === symbol);
  if (inIndex) return inIndex;

  const meta = db.select().from(symbols).where(eq(symbols.symbol, symbol)).get();
  if (!meta) return null;
  // Known symbol, just not a member — no index weight applies.
  return buildView(symbol, latestQuoteDate());
}

/** Index codes a symbol currently belongs to, newest snapshot per index. */
export function getIndexesForSymbol(symbol: string): string[] {
  const meta = db.select().from(symbols).where(eq(symbols.symbol, symbol)).get();
  if (!meta?.indexes) return [];
  return meta.indexes.split(",").map((s) => s.trim()).filter(Boolean);
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number | null;
}

/** Daily closes for a symbol, oldest first. */
export function getPriceHistory(symbol: string, fromDate?: string): PricePoint[] {
  const where = fromDate
    ? and(eq(quotesDaily.symbol, symbol), gte(quotesDaily.date, fromDate))
    : eq(quotesDaily.symbol, symbol);

  return db
    .select({
      date: quotesDaily.date,
      close: quotesDaily.close,
      volume: quotesDaily.volume,
    })
    .from(quotesDaily)
    .where(where)
    .orderBy(quotesDaily.date)
    .all();
}

/** KMI30 index level history, oldest first. */
export function getIndexHistory(
  indexCode = TRACKED_INDEX,
  fromDate?: string,
): { date: string; current: number }[] {
  const where = fromDate
    ? and(eq(indexLevels.indexCode, indexCode), gte(indexLevels.date, fromDate))
    : eq(indexLevels.indexCode, indexCode);

  return db
    .select({ date: indexLevels.date, current: indexLevels.current })
    .from(indexLevels)
    .where(where)
    .orderBy(indexLevels.date)
    .all();
}

export function getLatestIndexLevel(indexCode = TRACKED_INDEX) {
  return (
    db
      .select()
      .from(indexLevels)
      .where(eq(indexLevels.indexCode, indexCode))
      .orderBy(desc(indexLevels.date))
      .limit(1)
      .get() ?? null
  );
}

/** Year-to-date return for a symbol, computed from stored closes. */
export function getYtdReturn(symbol: string, asOf: string): number | null {
  const history = getPriceHistory(symbol, startOfYear(asOf));
  if (history.length < 2) return null;
  const first = history[0].close;
  const last = history[history.length - 1].close;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

/** Sector rollup for the dashboard breakdown. */
export function getSectorBreakdown(rows: ConstituentView[]) {
  const bySector = new Map<
    string,
    { sector: string; weightPct: number; count: number; changePct: number }
  >();

  for (const row of rows) {
    const sector = row.sectorName ?? row.sectorCode ?? "Unknown";
    const existing = bySector.get(sector) ?? {
      sector,
      weightPct: 0,
      count: 0,
      changePct: 0,
    };
    existing.weightPct += row.indexWeightPct ?? 0;
    existing.count += 1;
    // Weight each name's move by its index weight so the sector move is
    // comparable to the index move rather than a naive average.
    existing.changePct += (row.changePct ?? 0) * (row.indexWeightPct ?? 0);
    bySector.set(sector, existing);
  }

  return [...bySector.values()]
    .map((s) => ({
      ...s,
      changePct: s.weightPct > 0 ? s.changePct / s.weightPct : 0,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);
}

export interface IndexSummary {
  code: string;
  level: number | null;
  changePct: number | null;
  memberCount: number;
  snapshotDate: string | null;
}

/**
 * One row per index for the index browser: latest level plus how many
 * constituents we last snapshotted.
 */
export function getIndexSummaries(): IndexSummary[] {
  const codes = new Set<string>([
    ...getTrackedIndexCodes(),
    ...db
      .selectDistinct({ indexCode: indexLevels.indexCode })
      .from(indexLevels)
      .all()
      .map((r) => r.indexCode),
  ]);

  return [...codes].map((code) => {
    const level = getLatestIndexLevel(code);
    const snapshotDate = latestConstituentDate(code);
    const memberCount = snapshotDate
      ? db
          .select({ symbol: constituents.symbol })
          .from(constituents)
          .where(
            and(
              eq(constituents.indexCode, code),
              eq(constituents.date, snapshotDate),
            ),
          )
          .all().length
      : 0;

    return {
      code,
      level: level?.current ?? null,
      changePct: level?.changePct ?? null,
      memberCount,
      snapshotDate,
    };
  });
}

/** Most recent ingest run, for the data-freshness indicator. */
export function getLastIngest() {
  return (
    db
      .select()
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt))
      .limit(1)
      .get() ?? null
  );
}

export function getSymbolMeta(symbol: string) {
  return db.select().from(symbols).where(eq(symbols.symbol, symbol)).get() ?? null;
}

/** True when the local database has never been populated. */
export function isDatabaseEmpty(): boolean {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(symbols)
    .get();
  return (row?.count ?? 0) === 0;
}
