import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { quotesDaily, watchlist } from "@/db/schema";
import { addDays, expectedSessionDate, startOfYear, weekdaysBetween } from "@/lib/dates";
import type { ConstituentView } from "@/lib/market";

/**
 * Market data changes once a day, so whole-market reads are kept per server
 * instance and keyed by the newest session: a warm instance serves every
 * dashboard view from memory until the next ingest lands.
 */
const memo = new Map<string, { date: string; value: unknown }>();
async function perSession<T>(key: string, date: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.date === date) return hit.value as T;
  const value = await load();
  memo.set(key, { date, value });
  return value;
}

/** Calendar days of closes kept for sparklines and streaks (~30 sessions). */
const RECENT_DAYS = 45;
/** Calendar days of breadth history (~4 months of sessions). */
const BREADTH_DAYS = 120;

/** Recent closes for every symbol, oldest first. */
export async function getRecentCloses(quoteDate: string): Promise<Map<string, number[]>> {
  return perSession("recent-closes", quoteDate, async () => {
    const rows = await db
      .select({ symbol: quotesDaily.symbol, close: quotesDaily.close })
      .from(quotesDaily)
      .where(gte(quotesDaily.date, addDays(quoteDate, -RECENT_DAYS)))
      .orderBy(quotesDaily.date)
      .all();
    const out = new Map<string, number[]>();
    for (const r of rows) {
      const list = out.get(r.symbol);
      if (list) list.push(r.close);
      else out.set(r.symbol, [r.close]);
    }
    return out;
  });
}

/**
 * Sessions in a row a stock closed up (positive) or down (negative), counting
 * back from the newest close. An unchanged close ends the streak.
 */
export function streakOf(closes: number[]): number {
  let n = 0;
  for (let i = closes.length - 1; i > 0; i--) {
    const diff = closes[i] - closes[i - 1];
    if (diff === 0) break;
    const dir = diff > 0 ? 1 : -1;
    if (n !== 0 && Math.sign(n) !== dir) break;
    n += dir;
  }
  return n;
}

/**
 * Each symbol's close on the last session on or before `date`, for "change
 * over 1W / 1M" views. Keyed by the newest session like the other reads.
 */
export async function getClosesAsOf(quoteDate: string, date: string): Promise<Map<string, number>> {
  return perSession(`closes-asof-${date}`, quoteDate, async () => {
    const rows = (await db.all(sql`
      select symbol, close from quotes_daily
      where date = (select max(date) from quotes_daily where date <= ${date})
    `)) as { symbol: string; close: number }[];
    return new Map(rows.map((r) => [r.symbol, Number(r.close)]));
  });
}

export interface BreadthPoint {
  date: string;
  up: number;
  down: number;
}

/** Stocks that closed up and down on each session, across the whole market. */
export async function getBreadthHistory(quoteDate: string): Promise<BreadthPoint[]> {
  return perSession("breadth", quoteDate, async () => {
    const from = addDays(quoteDate, -BREADTH_DAYS);
    // LDCP when PSX gave it; otherwise the symbol's previous stored close.
    const rows = (await db.all(sql`
      select date,
             sum(case when close > prev then 1 else 0 end) as up,
             sum(case when close < prev then 1 else 0 end) as down
      from (
        select date, close,
               coalesce(ldcp, lag(close) over (partition by symbol order by date)) as prev
        from quotes_daily
        where date >= ${addDays(from, -10)}
      )
      where date >= ${from} and prev is not null
      group by date
      order by date
    `)) as { date: string; up: number; down: number }[];
    return rows.map((r) => ({ date: r.date, up: Number(r.up), down: Number(r.down) }));
  });
}

export interface PeriodReturn {
  label: string;
  pct: number | null;
}

/** Index return over the usual windows, measured from the newest level. */
export function periodReturns(history: { date: string; current: number }[]): PeriodReturn[] {
  const last = history[history.length - 1];
  if (!last) return [];
  const since = (from: string): number | null => {
    // The last level on or before `from`; none means the history is too short.
    let base: number | null = null;
    for (const h of history) {
      if (h.date > from) break;
      base = h.current;
    }
    return base && base > 0 ? (last.current / base - 1) * 100 : null;
  };
  return [
    { label: "1W", pct: since(addDays(last.date, -7)) },
    { label: "1M", pct: since(addDays(last.date, -30)) },
    { label: "3M", pct: since(addDays(last.date, -91)) },
    { label: "YTD", pct: since(addDays(startOfYear(last.date), -1)) },
    { label: "1Y", pct: since(addDays(last.date, -365)) },
  ];
}

export interface Staleness {
  quoteDate: string;
  expected: string;
  missedSessions: number;
  ingestFailed: boolean;
}

/**
 * Null when the data is current. One missed weekday is allowed (a holiday, or
 * the job running late); two or more, or a failed last run, is reported.
 */
export function checkStaleness(
  quoteDate: string | null,
  lastIngest: { status: string } | null,
  now: Date = new Date(),
): Staleness | null {
  if (!quoteDate) return null;
  const expected = expectedSessionDate(now);
  const missedSessions = quoteDate < expected ? weekdaysBetween(quoteDate, expected) : 0;
  const ingestFailed = lastIngest?.status === "error";
  if (missedSessions < 2 && !(ingestFailed && missedSessions > 0)) return null;
  return { quoteDate, expected, missedSessions, ingestFailed };
}

export interface WatchRow {
  symbol: string;
  name: string | null;
  close: number | null;
  changePct: number | null;
  sinceAddedPct: number | null;
  offHighPct: number | null;
  aboveLowPct: number | null;
}

/** The user's watchlist priced from today's views, newest addition first. */
export async function getWatchlistGlance(
  userId: string,
  views: ConstituentView[],
): Promise<WatchRow[]> {
  const rows = await db
    .select({ symbol: watchlist.symbol, addedPrice: watchlist.addedPrice })
    .from(watchlist)
    .where(and(eq(watchlist.userId, userId)))
    .orderBy(desc(watchlist.addedAt))
    .all();
  const bySymbol = new Map(views.map((v) => [v.symbol, v]));
  return rows.map((r) => {
    const v = bySymbol.get(r.symbol);
    const close = v?.close ?? null;
    return {
      symbol: r.symbol,
      name: v?.name ?? null,
      close,
      changePct: v?.changePct ?? null,
      sinceAddedPct:
        close != null && r.addedPrice && r.addedPrice > 0 ? (close / r.addedPrice - 1) * 100 : null,
      offHighPct: v?.drawdownFrom52wPct ?? null,
      aboveLowPct:
        close != null && v?.week52Low && v.week52Low > 0 ? Math.max(0, (close / v.week52Low - 1) * 100) : null,
    };
  });
}
