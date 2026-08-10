import { db } from "@/db";
import {
  symbols,
  constituents,
  quotesDaily,
  companyStats,
  announcements,
  payouts,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { runIngest } from "@/lib/psx/ingest";

async function main() {
  console.log("Cleaning up temporary ex-entitlement symbols (e.g. FFCXD -> FFC)...");

  const pattern = sql`symbol LIKE '%XD' OR symbol LIKE '%XB' OR symbol LIKE '%XR' OR symbol LIKE '%XA'`;

  const deadSymbols = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(pattern)
    .all();

  console.log(`Found ${deadSymbols.length} ex-entitlement symbols in DB:`, deadSymbols.map(s => s.symbol).join(", "));

  if (deadSymbols.length > 0) {
    await db.delete(constituents).where(pattern).run();
    await db.delete(quotesDaily).where(pattern).run();
    await db.delete(companyStats).where(pattern).run();
    await db.delete(announcements).where(pattern).run();
    await db.delete(payouts).where(pattern).run();
    await db.delete(symbols).where(pattern).run();
    console.log("Deleted temporary ex-entitlement rows.");
  }

  console.log("\nRe-running ingest with recheckCompanyPages: true to populate base symbols...");
  const result = await runIngest({
    recheckCompanyPages: true,
    concurrency: 8,
    onProgress: (m) => console.log(m),
  });

  console.log("\n--- Ingest Complete ---");
  console.log(`symbols seen: ${result.symbolsSeen}`);
  console.log(`quotes written: ${result.quotesWritten}`);
  console.log(`fundamentals fetched: ${result.fundamentalsFetched}`);
}

main().catch((err) => {
  console.error("Failed to clean and re-ingest:", err);
  process.exit(1);
});
