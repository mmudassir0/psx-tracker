/**
 * Creates tables and indexes added after a database was first set up. Every
 * statement is "if not exists", so once they exist this costs no row reads.
 * Runs before each scheduled ingest, so schema additions reach production
 * without anyone having to run `npm run migrate` by hand. The definitions
 * match what drizzle-kit generates for src/db/schema.ts.
 *
 *   npx tsx src/scripts/ensure-schema.ts
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

const STATEMENTS = [
  // Metric lookups filter on line_item (src/lib/financials.ts).
  `create index if not exists "financials_item_symbol_idx" on "financials" ("line_item","symbol")`,
  // Version check of the market cache (src/lib/market-cache.ts).
  `create index if not exists "ingest_runs_finished_idx" on "ingest_runs" ("finished_at")`,
  `create index if not exists "ingest_runs_started_idx" on "ingest_runs" ("started_at")`,

  // LLM summaries (src/lib/ai-summaries.ts).
  `create table if not exists "ai_summaries" (
    "id" text PRIMARY KEY NOT NULL,
    "kind" text NOT NULL,
    "symbol" text NOT NULL,
    "source_hash" text NOT NULL,
    "text" text NOT NULL,
    "model" text NOT NULL,
    "created_at" integer NOT NULL
  )`,
  `create index if not exists "ai_summaries_symbol_idx" on "ai_summaries" ("symbol","kind")`,

  // Mutual funds entered by users (src/lib/funds.ts).
  `create table if not exists "funds" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "name" text NOT NULL,
    "amc" text,
    "category" text,
    "shariah" integer DEFAULT false NOT NULL,
    "created_at" integer NOT NULL
  )`,
  `create index if not exists "funds_user_idx" on "funds" ("user_id")`,
  `create table if not exists "fund_transactions" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "fund_id" text NOT NULL,
    "date" text NOT NULL,
    "type" text NOT NULL,
    "units" real DEFAULT 0 NOT NULL,
    "nav" real DEFAULT 0 NOT NULL,
    "amount" real NOT NULL,
    "note" text,
    "created_at" integer NOT NULL
  )`,
  `create index if not exists "fund_transactions_user_idx" on "fund_transactions" ("user_id")`,
  `create index if not exists "fund_transactions_fund_idx" on "fund_transactions" ("fund_id","date")`,
  `create table if not exists "fund_navs" (
    "fund_id" text NOT NULL,
    "date" text NOT NULL,
    "nav" real NOT NULL,
    PRIMARY KEY("fund_id", "date")
  )`,
];

async function main() {
  for (const statement of STATEMENTS) await db.run(sql.raw(statement));
  console.log(`schema ensured (${STATEMENTS.length} statements)`);
}

main().catch((err) => {
  console.error("ensure-schema failed:", err);
  process.exit(1);
});
