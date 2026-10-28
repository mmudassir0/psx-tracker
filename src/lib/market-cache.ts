/**
 * Cross-request cache for market data.
 *
 * Prices, fundamentals and index membership only change when an ingest
 * finishes, yet every page used to re-read them from the database on every
 * view. Each cached loader is keyed by the newest finished ingest, so:
 * - a page view costs one indexed row read (the version check) once the
 *   cache is warm, instead of tens of thousands;
 * - the moment an ingest finishes, the key changes and fresh data is read.
 *
 * The cache is Next's Data Cache (shared across Vercel instances). Outside a
 * Next server (ingest, scripts, tests) the loaders run uncached.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Safety net: even with an unchanged version, re-read twice a day. */
const MAX_AGE_SECONDS = 12 * 60 * 60;

function insideNextServer(): boolean {
  return Boolean(process.env.NEXT_RUNTIME) && process.env.MARKET_CACHE !== "off";
}

/**
 * Identifies the data currently in the database: when the newest ingest
 * finished. One row read via ingest_runs_finished_idx.
 */
export const marketVersion = cache(async (): Promise<string> => {
  const rows = (await db.all(
    sql`select max(finished_at) as v from ingest_runs`,
  )) as { v: number | null }[];
  return String(rows[0]?.v ?? 0);
});

/**
 * Wraps a loader so its result is shared across requests until the next
 * ingest finishes. Arguments become part of the key, so they and the result
 * must be JSON-serialisable (no Map/Set/Date: convert at the edges).
 */
export function marketCached<A extends unknown[], R>(
  name: string,
  load: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    if (!insideNextServer()) return load(...args);
    const version = await marketVersion();
    return unstable_cache(load, ["market", name, version], {
      revalidate: MAX_AGE_SECONDS,
      tags: ["market"],
    })(...args);
  };
}
