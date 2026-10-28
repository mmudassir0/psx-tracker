/**
 * Builds the full app schema (src/db/schema.ts) in the scratch database, so a
 * test exercises the real tables and indexes rather than a hand-written copy.
 */
import { createRequire } from "node:module";
import * as schema from "@/db/schema";
import { db } from "@/db";

const require = createRequire(import.meta.url);

export async function resetToAppSchema() {
  const drop = db.$client
    .prepare(
      "select group_concat('drop table if exists \"' || name || '\";', ' ') as s from sqlite_master where type='table' and name not like 'sqlite_%'",
    )
    .get() as { s: string | null };
  if (drop.s) db.$client.exec(drop.s);
  const { pushSQLiteSchema } = require("drizzle-kit/api") as typeof import("drizzle-kit/api");
  // Only the generated DDL is used; it runs on the raw handle.
  const { statementsToExecute } = await pushSQLiteSchema(schema, db as never);
  for (const statement of statementsToExecute) db.$client.exec(statement);
  // drizzle-kit/api adds an enumerable Array.prototype.random, which breaks
  // libraries that check for a clean prototype (pdf.js refuses to load).
  delete (Array.prototype as unknown as Record<string, unknown>).random;
}
