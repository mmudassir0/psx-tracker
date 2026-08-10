import Database from "better-sqlite3";
import { drizzle as drizzleBetterSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { createClient as createLibsqlClient } from "@libsql/client";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import * as schema from "./schema";

// Automatically load .env and .env.local variables when running scripts/CLI
loadEnvConfig(process.cwd());

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "kmi30.db");
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: any };

const globalForDb = globalThis as unknown as {
  __kmi30Db?: AppDatabase;
};

function createDbInstance(): AppDatabase {
  if (TURSO_DATABASE_URL) {
    console.log(`Connecting to Turso Cloud SQLite database (${TURSO_DATABASE_URL})...`);
    const client = createLibsqlClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    return drizzleLibsql(client, { schema }) as unknown as AppDatabase;
  }

  console.log("Connecting to local SQLite database...");
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  // WAL lets the dashboard read while an ingest run is writing.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzleBetterSqlite(sqlite, { schema }) as unknown as AppDatabase;
}

export const db: AppDatabase = globalForDb.__kmi30Db ?? createDbInstance();
if (process.env.NODE_ENV !== "production") globalForDb.__kmi30Db = db;

export { schema, DB_PATH };
