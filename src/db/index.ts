import Database from "better-sqlite3";
import { drizzle as drizzleBetterSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { createClient as createLibsqlClient, type Client } from "@libsql/client";
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

// Automatically load .env and .env.local variables when running scripts/CLI
loadEnvConfig(process.cwd());

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "kmi30.db");
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

/**
 * Typed as the synchronous local driver; on Turso the same calls return
 * promises, which is why every call site awaits. `$client` is the raw
 * better-sqlite3 handle the tests use to rebuild their scratch schema.
 */
export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** Errors where the request never reached Turso or the reply was lost. */
const NETWORK_ERROR_CODES = new Set([
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

function isNetworkError(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true;
    if (e.message === "fetch failed") return true;
  }
  return false;
}

function isReadOnly(sql: string): boolean {
  const s = sql.trimStart().toLowerCase();
  if (s.startsWith("select") || s.startsWith("pragma") || s.startsWith("explain")) {
    return true;
  }
  return s.startsWith("with") && !/(insert|update|delete|replace)/.test(s);
}

const READ_RETRY_DELAYS_MS = [300, 1000];

/**
 * Retry read-only statements on dropped connections. Some networks cut idle
 * keep-alive sockets to Turso, so the first query on a reused socket fails
 * with "other side closed" even though nothing is wrong. Writes are never
 * retried: if the reply was lost the write may have landed, and running it
 * twice could duplicate a transaction.
 */
function withReadRetry(client: Client): Client {
  const execute = client.execute.bind(client) as (
    ...args: unknown[]
  ) => ReturnType<Client["execute"]>;

  client.execute = (async (...args: unknown[]) => {
    const first = args[0];
    const sql =
      typeof first === "string" ? first : (first as { sql?: string })?.sql ?? "";
    for (let attempt = 0; ; attempt++) {
      try {
        return await execute(...args);
      } catch (err) {
        const delay = READ_RETRY_DELAYS_MS[attempt];
        if (delay == null || !isReadOnly(sql) || !isNetworkError(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }) as Client["execute"];

  return client;
}

const globalForDb = globalThis as unknown as {
  __kmi30Db?: AppDatabase;
};

function createDbInstance(): AppDatabase {
  if (TURSO_DATABASE_URL) {
    console.log(`Connecting to Turso Cloud SQLite database (${TURSO_DATABASE_URL})...`);
    const client = withReadRetry(
      createLibsqlClient({
        url: TURSO_DATABASE_URL,
        authToken: TURSO_AUTH_TOKEN,
      }),
    );
    return drizzleLibsql(client, { schema }) as unknown as AppDatabase;
  }

  console.log("Connecting to local SQLite database...");
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
