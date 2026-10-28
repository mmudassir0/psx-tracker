/**
 * A stock's P/E over time against its own range: is it cheap or expensive
 * compared with how the market has usually priced it?
 *
 * The series is the P/E PSX showed on each day we captured fundamentals
 * (company_stats keeps one row per day), so it grows with every ingest.
 */
import { cache } from "react";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { companyStats } from "@/db/schema";
import { marketCached } from "@/lib/market-cache";

export interface ValuationPoint {
  date: string;
  pe: number;
}

export interface ValuationSummary {
  points: ValuationPoint[];
  current: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
  /** Share of recorded days with a lower P/E than today (ties count half), 0-100. */
  percentile: number | null;
}

/** Days needed before "cheap vs its history" means anything. */
export const MIN_VALUATION_POINTS = 20;

/** Pure: summary statistics for a P/E series (losses, P/E <= 0, excluded). */
export function summariseValuation(series: ValuationPoint[]): ValuationSummary {
  const points = series.filter((p) => Number.isFinite(p.pe) && p.pe > 0);
  if (points.length === 0) {
    return { points, current: null, median: null, low: null, high: null, percentile: null };
  }
  const sorted = points.map((p) => p.pe).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const current = points[points.length - 1].pe;
  // Mid-rank: ties count half, so a flat history reads as typical (50), not cheap.
  const below = sorted.filter((v) => v < current).length + sorted.filter((v) => v === current).length / 2;
  return {
    points,
    current,
    median,
    low: sorted[0],
    high: sorted[sorted.length - 1],
    percentile: points.length >= MIN_VALUATION_POINTS ? (below / sorted.length) * 100 : null,
  };
}

async function getValuationHistoryUncached(symbol: string): Promise<ValuationSummary> {
  const rows = await db
    .select({ date: companyStats.date, pe: companyStats.peTtm })
    .from(companyStats)
    .where(and(eq(companyStats.symbol, symbol), isNotNull(companyStats.peTtm)))
    .orderBy(asc(companyStats.date))
    .all();
  return summariseValuation(rows.map((r) => ({ date: r.date, pe: r.pe as number })));
}

export const getValuationHistory = cache(marketCached("valuation-history", getValuationHistoryUncached));
