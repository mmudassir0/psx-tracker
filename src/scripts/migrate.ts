/**
 * Idempotent schema migration for an existing database. Safe to run
 * repeatedly: it only creates what is missing.
 *
 *   npm run migrate
 *
 * Adds the Better Auth tables, a user_id owner column on every personal
 * table, per-user settings, the 30-day volume column, multiple portfolios per
 * user (existing trades go into a "Main" portfolio), and one-time link codes. The watchlist's key
 * changes from (symbol) to (user_id, symbol), which SQLite can only do by
 * rebuilding the table; its rows are copied across.
 *
 * The definitions match what drizzle-kit generates for src/db/schema.ts, so a
 * later `drizzle-kit push` finds nothing to change.
 *
 * Existing personal rows are left without an owner (user_id NULL, or '' for
 * the watchlist) and stay invisible until `npm run make-admin` assigns them.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureDefaultPortfolio } from "@/lib/portfolios";

async function exec(statement: string) {
  await db.run(sql.raw(statement));
}

async function columns(table: string): Promise<Set<string>> {
  const rows = (await db.all(sql.raw(`pragma table_info("${table}")`))) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

async function addColumn(table: string, column: string, type: string) {
  if ((await columns(table)).has(column)) return;
  await exec(`alter table "${table}" add column "${column}" ${type}`);
  console.log(`  + ${table}.${column}`);
}

const AUTH_TABLES = [
  `create table if not exists "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL,
    "email_verified" integer DEFAULT false NOT NULL,
    "image" text,
    "role" text DEFAULT 'user',
    "banned" integer DEFAULT false,
    "ban_reason" text,
    "ban_expires" integer,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL
  )`,
  `create unique index if not exists "user_email_unique" on "user" ("email")`,
  `create table if not exists "session" (
    "id" text PRIMARY KEY NOT NULL,
    "expires_at" integer NOT NULL,
    "token" text NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" text NOT NULL,
    "impersonated_by" text,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  )`,
  `create unique index if not exists "session_token_unique" on "session" ("token")`,
  `create index if not exists "session_user_idx" on "session" ("user_id")`,
  `create table if not exists "account" (
    "id" text PRIMARY KEY NOT NULL,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" integer,
    "refresh_token_expires_at" integer,
    "scope" text,
    "password" text,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  )`,
  `create index if not exists "account_user_idx" on "account" ("user_id")`,
  `create table if not exists "verification" (
    "id" text PRIMARY KEY NOT NULL,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" integer NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL
  )`,
  `create index if not exists "verification_identifier_idx" on "verification" ("identifier")`,
  `create table if not exists "rate_limit" (
    "id" text PRIMARY KEY NOT NULL,
    "key" text NOT NULL,
    "count" integer NOT NULL,
    "last_request" integer NOT NULL
  )`,
  `create unique index if not exists "rate_limit_key_unique" on "rate_limit" ("key")`,
];

async function main() {
  console.log("Account tables…");
  for (const statement of AUTH_TABLES) await exec(statement);

  console.log("Owner columns…");
  for (const table of ["transactions", "alerts", "alert_events", "custom_screens"]) {
    await addColumn(table, "user_id", "text");
  }
  await exec(`create index if not exists "transactions_user_idx" on "transactions" ("user_id")`);
  await exec(`create index if not exists "alert_events_user_idx" on "alert_events" ("user_id")`);

  console.log("Watchlist key…");
  if (!(await columns("watchlist")).has("user_id")) {
    await exec(`create table "watchlist_new" (
      "user_id" text NOT NULL,
      "symbol" text NOT NULL,
      "note" text,
      "added_price" real,
      "added_at" integer NOT NULL,
      PRIMARY KEY("user_id", "symbol")
    )`);
    await exec(`insert into "watchlist_new" ("user_id", "symbol", "note", "added_price", "added_at")
      select '', "symbol", "note", "added_price", "added_at" from "watchlist"`);
    await exec(`drop table "watchlist"`);
    await exec(`alter table "watchlist_new" rename to "watchlist"`);
    console.log("  rebuilt watchlist with (user_id, symbol) key");
  }

  console.log("Per-user settings…");
  await exec(`create table if not exists "user_settings" (
    "user_id" text NOT NULL,
    "key" text NOT NULL,
    "value" text NOT NULL,
    "updated_at" integer NOT NULL,
    PRIMARY KEY("user_id", "key")
  )`);

  console.log("30-day volume column…");
  await addColumn("symbols", "avg_volume_30d", "real");

  console.log("Portfolios…");
  await exec(`create table if not exists "portfolios" (
    "id" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "name" text NOT NULL,
    "created_at" integer NOT NULL
  )`);
  await exec(`create index if not exists "portfolios_user_idx" on "portfolios" ("user_id")`);
  await addColumn("transactions", "portfolio_id", "text");
  await exec(`create index if not exists "transactions_portfolio_idx" on "transactions" ("portfolio_id")`);
  // Every owned trade without a portfolio goes into its owner's default one.
  const owners = (await db.all(
    sql.raw(`select distinct user_id from "transactions" where user_id is not null and portfolio_id is null`),
  )) as { user_id: string }[];
  for (const { user_id } of owners) {
    const portfolioId = await ensureDefaultPortfolio(user_id);
    await db.run(
      sql`update "transactions" set portfolio_id = ${portfolioId} where user_id = ${user_id} and portfolio_id is null`,
    );
  }
  if (owners.length) console.log(`  moved trades of ${owners.length} user(s) into their default portfolio`);

  console.log("Link codes…");
  await exec(`create table if not exists "link_codes" (
    "code" text PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "purpose" text NOT NULL,
    "expires_at" integer NOT NULL
  )`);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
