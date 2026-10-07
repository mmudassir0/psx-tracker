import { asc } from "drizzle-orm";
import { db } from "@/db";
import { symbols } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Every listed symbol with its name and sector, for the search box. Public
 * market data; the list changes at most once a day, so browsers and Vercel's
 * edge keep it for an hour.
 */
export async function GET() {
  const rows = await db
    .select({ s: symbols.symbol, n: symbols.name, sec: symbols.sectorName })
    .from(symbols)
    .orderBy(asc(symbols.symbol))
    .all();
  return Response.json(rows, {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
