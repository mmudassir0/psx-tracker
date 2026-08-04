import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "kmi30.db");

// Next dev reloads modules on every edit; without this the process leaks
// SQLite handles until it hits the open-file limit.
const globalForDb = globalThis as unknown as {
  __kmi30Sqlite?: Database.Database;
};

function createClient() {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  // WAL lets the dashboard read while an ingest run is writing.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

const sqlite = globalForDb.__kmi30Sqlite ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__kmi30Sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema, DB_PATH };
