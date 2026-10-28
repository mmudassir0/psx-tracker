/**
 * Creates indexes added after a database was first set up. Every statement is
 * "if not exists", so once they exist this costs no row reads. Runs before
 * each scheduled ingest, so a new index reaches production without anyone
 * having to run `npm run migrate` by hand.
 *
 *   npx tsx src/scripts/ensure-indexes.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const INDEXES = [
  // Metric lookups filter on line_item (src/lib/financials.ts).
  `create index if not exists "financials_item_symbol_idx" on "financials" ("line_item","symbol")`,
  // Version check of the market cache (src/lib/market-cache.ts).
  `create index if not exists "ingest_runs_finished_idx" on "ingest_runs" ("finished_at")`,
  `create index if not exists "ingest_runs_started_idx" on "ingest_runs" ("started_at")`,
];

async function main() {
  for (const statement of INDEXES) await db.run(sql.raw(statement));
  console.log(`indexes ensured (${INDEXES.length})`);
}

main().catch((err) => {
  console.error("ensure-indexes failed:", err);
  process.exit(1);
});
