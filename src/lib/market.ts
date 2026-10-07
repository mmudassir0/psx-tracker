import { cache } from "react";
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

import { startOfYear } from "@/lib/dates";
import { getTrailingDividendMap } from "@/lib/dividends";
import {
  getLatestMetricMap,
  getRevenueGrowthMap,
  METRIC_EPS_GROWTH,
  METRIC_NET_MARGIN,
} from "@/lib/financials";
import { DEFAULT_INDEX, SHARIAH_INDEX_CODES } from "@/lib/psx/indices";

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
  /** PSX's 30-session average share volume (daily volume is no longer published). */
  avgVolume30d: number | null;
  /** avgVolume30d × close: average PKR traded per session. */
  avgTradedValue30d: number | null;
  changePct: number | null;
  peTtm: number | null;
  marketCap: number | null;
  freeFloatShares: number | null;
  freeFloatPct: number | null;
  week52High: number | null;
  week52Low: number | null;
  ytdChangePct: number | null;
  year1ChangePct: number | null;
  freeFloatCap: number | null;
  indexWeightPct: number | null;
  drawdownFrom52wPct: number | null;
  dividendPerShare: number | null;
  dividendYieldPct: number | null;
  epsGrowthPct: number | null;
  netMarginPct: number | null;
  revenueGrowthPct: number | null;
  shariah: boolean;
}

/** Most recent date for which we have any quote data. */
async function latestQuoteDateUncached(): Promise<string | null> {
  const row = await db
    .select({ date: quotesDaily.date })
    .from(quotesDaily)
    .orderBy(desc(quotesDaily.date))
    .limit(1)
    .get();
  return row?.date ?? null;
}

/** Most recent date on which we captured a membership snapshot for an index. */
async function latestConstituentDateUncached(
  indexCode: string = DEFAULT_INDEX,
): Promise<string | null> {
  const row = await db
    .select({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(1)
    .get();
  return row?.date ?? null;
}

/** Every index we hold a membership snapshot for. */
async function getTrackedIndexCodesUncached(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ indexCode: constituents.indexCode })
    .from(constituents)
    .all();
  return rows.map((r) => r.indexCode);
}

interface ViewMaps {
  symbols?: Map<string, typeof symbols.$inferSelect>;
  quotes?: Map<string, typeof quotesDaily.$inferSelect>;
  stats?: Map<string, typeof companyStats.$inferSelect>;
  dividends?: Map<string, number>;
  epsGrowth?: Map<string, number>;
  netMargin?: Map<string, number>;
  revenueGrowth?: Map<string, number>;
}

export async function buildView(
  symbol: string,
  quoteDate: string | null,
  maps: ViewMaps = {},
): Promise<ConstituentView> {
  const meta = maps.symbols
    ? maps.symbols.get(symbol)
    : await db.select().from(symbols).where(eq(symbols.symbol, symbol)).get();

  const quote = maps.quotes
    ? maps.quotes.get(symbol)
    : quoteDate
    ? await db
        .select()
        .from(quotesDaily)
        .where(
          and(eq(quotesDaily.symbol, symbol), eq(quotesDaily.date, quoteDate)),
        )
        .get()
    : undefined;

  const stats = maps.stats
    ? maps.stats.get(symbol)
    : await db
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

  const avgVolume30d = meta?.avgVolume30d ?? null;

  const freeFloatCap =
    close != null && stats?.freeFloatShares != null
      ? close * stats.freeFloatShares
      : null;

  const drawdown =
    close != null && stats?.week52High != null && stats.week52High > 0
      ? ((stats.week52High - close) / stats.week52High) * 100
      : null;

  const dps =
    (maps.dividends ?? (await getTrailingDividendMap())).get(symbol) ?? null;
  const epsGrowth =
    (maps.epsGrowth ?? (await getLatestMetricMap(METRIC_EPS_GROWTH))).get(
      symbol,
    ) ?? null;
  const netMargin =
    (maps.netMargin ?? (await getLatestMetricMap(METRIC_NET_MARGIN))).get(
      symbol,
    ) ?? null;
  const revenueGrowth =
    (maps.revenueGrowth ?? (await getRevenueGrowthMap())).get(symbol) ?? null;

  const memberOf = (meta?.indexes ?? "").split(",").map((x) => x.trim());
  const shariah = memberOf.some((code) => SHARIAH_INDEX_CODES.includes(code));

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
    avgVolume30d,
    avgTradedValue30d:
      avgVolume30d != null && close != null ? avgVolume30d * close : null,
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
    revenueGrowthPct: revenueGrowth,
    shariah,
  };
}

async function fetchBulkViewMaps(
  symbolsList: string[],
  quoteDate: string | null,
): Promise<ViewMaps> {
  if (symbolsList.length === 0) return {};

  const [
    symbolRows,
    quoteRows,
    statsRows,
    dividends,
    epsGrowth,
    netMargin,
    revenueGrowth,
  ] = await Promise.all([
    db
      .select()
      .from(symbols)
      .where(inArray(symbols.symbol, symbolsList))
      .all(),
    quoteDate
      ? db
          .select()
          .from(quotesDaily)
          .where(
            and(
              eq(quotesDaily.date, quoteDate),
              inArray(quotesDaily.symbol, symbolsList),
            ),
          )
          .all()
      : Promise.resolve([]),
    // Newest row per symbol only. A fundamentals run adds a row per company
    // per day, so fetching every row and keeping the first grows forever.
    db
      .select()
      .from(companyStats)
      .where(
        and(
          inArray(companyStats.symbol, symbolsList),
          sql`(${companyStats.symbol}, ${companyStats.date}) in (
            select symbol, max(date) from company_stats group by symbol
          )`,
        ),
      )
      .all(),
    getTrailingDividendMap(),
    getLatestMetricMap(METRIC_EPS_GROWTH, symbolsList),
    getLatestMetricMap(METRIC_NET_MARGIN, symbolsList),
    getRevenueGrowthMap(symbolsList),
  ]);

  const symbolsMap = new Map(symbolRows.map((s) => [s.symbol, s]));
  const quotesMap = new Map(quoteRows.map((q) => [q.symbol, q]));
  const statsMap = new Map<string, typeof companyStats.$inferSelect>();
  for (const s of statsRows) {
    if (!statsMap.has(s.symbol)) statsMap.set(s.symbol, s);
  }

  return {
    symbols: symbolsMap,
    quotes: quotesMap,
    stats: statsMap,
    dividends,
    epsGrowth,
    netMargin,
    revenueGrowth,
  };
}

async function getConstituentsUncached(
  indexCode: string = DEFAULT_INDEX,
): Promise<ConstituentView[]> {
  const memberDate = await latestConstituentDate(indexCode);
  if (!memberDate) return [];

  const quoteDate = await latestQuoteDate();

  const memberRows = await db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(
        eq(constituents.indexCode, indexCode),
        eq(constituents.date, memberDate),
      ),
    )
    .all();
  const members = memberRows.map((r) => r.symbol);

  if (members.length === 0) return [];

  const maps = await fetchBulkViewMaps(members, quoteDate);
  const rows = await Promise.all(
    members.map((symbol) => buildView(symbol, quoteDate, maps)),
  );

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

export async function getConstituent(
  symbol: string,
  indexCode: string = DEFAULT_INDEX,
): Promise<ConstituentView | null> {
  const quoteDate = await latestQuoteDate();
  const maps = await fetchBulkViewMaps([symbol], quoteDate);
  const meta = maps.symbols?.get(symbol);
  if (!meta) return null;

  const view = await buildView(symbol, quoteDate, maps);

  const memberDate = await latestConstituentDate(indexCode);
  if (memberDate) {
    const isMember = await db
      .select({ symbol: constituents.symbol })
      .from(constituents)
      .where(
        and(
          eq(constituents.indexCode, indexCode),
          eq(constituents.date, memberDate),
          eq(constituents.symbol, symbol),
        ),
      )
      .limit(1)
      .get();

    if (isMember) {
      const fullList = await getConstituents(indexCode);
      const match = fullList.find((c) => c.symbol === symbol);
      if (match) return match;
    }
  }

  return view;
}

export async function getIndexesForSymbol(symbol: string): Promise<string[]> {
  const meta = await db
    .select()
    .from(symbols)
    .where(eq(symbols.symbol, symbol))
    .get();
  if (!meta?.indexes) return [];
  return meta.indexes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number | null;
}

export async function getPriceHistory(
  symbol: string,
  fromDate?: string,
): Promise<PricePoint[]> {
  const where = fromDate
    ? and(eq(quotesDaily.symbol, symbol), gte(quotesDaily.date, fromDate))
    : eq(quotesDaily.symbol, symbol);

  return await db
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

export async function getIndexHistory(
  indexCode = DEFAULT_INDEX,
  fromDate?: string,
): Promise<{ date: string; current: number }[]> {
  const where = fromDate
    ? and(
        eq(indexLevels.indexCode, indexCode),
        gte(indexLevels.date, fromDate),
      )
    : eq(indexLevels.indexCode, indexCode);

  return await db
    .select({ date: indexLevels.date, current: indexLevels.current })
    .from(indexLevels)
    .where(where)
    .orderBy(indexLevels.date)
    .all();
}

export async function getLatestIndexLevel(indexCode = DEFAULT_INDEX) {
  return (
    (await db
      .select()
      .from(indexLevels)
      .where(eq(indexLevels.indexCode, indexCode))
      .orderBy(desc(indexLevels.date))
      .limit(1)
      .get()) ?? null
  );
}

export async function getYtdReturn(
  symbol: string,
  asOf: string,
): Promise<number | null> {
  const history = await getPriceHistory(symbol, startOfYear(asOf));
  if (history.length < 2) return null;
  const first = history[0].close;
  const last = history[history.length - 1].close;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

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

export async function getIndexSummaries(): Promise<IndexSummary[]> {
  // Aggregate in SQL: these tables hold one row per index (or member) per
  // day, and only the newest of each is wanted.
  const [levelRows, snapshotRows] = await Promise.all([
    db
      .select({
        code: indexLevels.indexCode,
        current: indexLevels.current,
        changePct: indexLevels.changePct,
      })
      .from(indexLevels)
      .where(
        sql`(${indexLevels.indexCode}, ${indexLevels.date}) in (
          select index_code, max(date) from index_levels group by index_code
        )`,
      )
      .all(),
    db
      .select({
        code: constituents.indexCode,
        date: constituents.date,
        count: sql<number>`count(*)`,
      })
      .from(constituents)
      .where(
        sql`(${constituents.indexCode}, ${constituents.date}) in (
          select index_code, max(date) from constituents group by index_code
        )`,
      )
      .groupBy(constituents.indexCode, constituents.date)
      .all(),
  ]);

  const levelMap = new Map(levelRows.map((l) => [l.code, l]));
  const snapshotMap = new Map(snapshotRows.map((s) => [s.code, s]));
  const codes = [...new Set([...snapshotMap.keys(), ...levelMap.keys()])];

  return codes.map((code) => ({
    code,
    level: levelMap.get(code)?.current ?? null,
    changePct: levelMap.get(code)?.changePct ?? null,
    memberCount: snapshotMap.get(code)?.count ?? 0,
    snapshotDate: snapshotMap.get(code)?.date ?? null,
  }));
}

export async function getLastIngest() {
  return (
    (await db
      .select()
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt))
      .limit(1)
      .get()) ?? null
  );
}

export async function getSymbolMeta(symbol: string) {
  return (
    (await db
      .select()
      .from(symbols)
      .where(eq(symbols.symbol, symbol))
      .get()) ?? null
  );
}

async function isDatabaseEmptyUncached(): Promise<boolean> {
  try {
    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(symbols)
      .get();
    return (row?.count ?? 0) === 0;
  } catch {
    return true;
  }
}

async function getAllSymbolViewsUncached(): Promise<ConstituentView[]> {
  const quoteDate = await latestQuoteDate();
  if (!quoteDate) return [];

  const universeRows = await db
    .selectDistinct({ symbol: quotesDaily.symbol })
    .from(quotesDaily)
    .where(eq(quotesDaily.date, quoteDate))
    .all();
  const universe = universeRows.map((r) => r.symbol);

  if (universe.length === 0) return [];

  const maps = await fetchBulkViewMaps(universe, quoteDate);
  return Promise.all(
    universe.map((symbol) => buildView(symbol, quoteDate, maps)),
  );
}

export interface MarketBreadth {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  advanceRatioPct: number | null;
  limitUp: number;
  limitDown: number;
  date: string | null;
}

export async function getMarketBreadth(
  rowsInput?: ConstituentView[],
): Promise<MarketBreadth> {
  const rows = rowsInput ?? (await getAllSymbolViews());
  const moved = rows.filter((r) => r.changePct != null);
  const advancing = moved.filter((r) => (r.changePct ?? 0) > 0).length;
  const declining = moved.filter((r) => (r.changePct ?? 0) < 0).length;
  const unchanged = moved.length - advancing - declining;

  const limitUp = moved.filter((r) => (r.changePct ?? 0) >= 9.95).length;
  const limitDown = moved.filter((r) => (r.changePct ?? 0) <= -9.95).length;

  const directional = advancing + declining;

  return {
    advancing,
    declining,
    unchanged,
    total: moved.length,
    advanceRatioPct: directional > 0 ? (advancing / directional) * 100 : null,
    limitUp,
    limitDown,
    date: await latestQuoteDate(),
  };
}

export interface Movers {
  gainers: ConstituentView[];
  losers: ConstituentView[];
  mostActive: ConstituentView[];
}

export async function getMovers(
  rowsInput?: ConstituentView[],
  limit = 15,
): Promise<Movers> {
  const rows = rowsInput ?? (await getAllSymbolViews());
  const withChange = rows.filter((r) => r.changePct != null);

  const byValue = rows
    .filter((r) => r.avgTradedValue30d != null)
    .sort((a, b) => (b.avgTradedValue30d ?? 0) - (a.avgTradedValue30d ?? 0))
    .slice(0, limit);

  return {
    gainers: [...withChange]
      .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
      .slice(0, limit),
    losers: [...withChange]
      .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))
      .slice(0, limit),
    mostActive: byValue,
  };
}

// Per-request memoisation (React cache): one page render calls these from
// many components, but market data only changes when the daily ingest runs.
// Outside a server render, cache() is a pass-through.
export const latestQuoteDate = cache(latestQuoteDateUncached);
const latestConstituentDateCached = cache(latestConstituentDateUncached);
export const latestConstituentDate = (arg: Parameters<typeof latestConstituentDateUncached>[0] = DEFAULT_INDEX) =>
  latestConstituentDateCached(arg);
export const getTrackedIndexCodes = cache(getTrackedIndexCodesUncached);
const getConstituentsCached = cache(getConstituentsUncached);
export const getConstituents = (arg: Parameters<typeof getConstituentsUncached>[0] = DEFAULT_INDEX) =>
  getConstituentsCached(arg);
export const isDatabaseEmpty = cache(isDatabaseEmptyUncached);
export const getAllSymbolViews = cache(getAllSymbolViewsUncached);
