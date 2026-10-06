/**
 * Encrypted snapshot of the database: every user's data and accounts, plus
 * the price history (which PSX no longer serves, so it can't be re-fetched).
 *
 *   npm run backup                 -> backups/psx-backup-<date>.enc
 *
 * Needs BACKUP_PASSPHRASE (16+ characters). Keep it somewhere other than this
 * repo: without it a backup cannot be opened, by anyone.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { encryptBackup } from "@/lib/backup-crypto";
import { todayPkt } from "@/lib/dates";

/**
 * Left out on purpose: sessions and verification tokens (short-lived
 * secrets), rate-limit counters, and tables the next ingest rebuilds.
 */
const TABLES = [
  "user",
  "account",
  "portfolios",
  "transactions",
  "watchlist",
  "alerts",
  "alert_events",
  "custom_screens",
  "user_settings",
  "app_settings",
  "symbols",
  "constituents",
  "company_stats",
  "announcements",
  "payouts",
  "financials",
  "index_levels",
  "quotes_daily",
];

const PAGE = 20_000;

async function dumpTable(table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  // Page by rowid so a 450k-row table never has to fit one HTTP response.
  for (let after = -1; ; ) {
    const page = (await db.all(
      sql.raw(`select rowid as _rowid, * from "${table}" where rowid > ${after} order by rowid limit ${PAGE}`),
    )) as { _rowid: number }[];
    if (page.length === 0) break;
    after = page[page.length - 1]._rowid;
    for (const { _rowid, ...row } of page) {
      void _rowid;
      rows.push(row);
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase) {
    console.error("Set BACKUP_PASSPHRASE (16+ characters) first.");
    process.exit(1);
  }

  // Skip tables a not-yet-migrated database doesn't have, rather than fail.
  const existing = new Set(
    ((await db.all(sql.raw("select name from sqlite_master where type = 'table'"))) as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const tables: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    if (!existing.has(table)) {
      console.log(`${table.padEnd(16)} (not present, skipped)`);
      continue;
    }
    tables[table] = await dumpTable(table);
    console.log(`${table.padEnd(16)} ${tables[table].length}`);
  }

  const json = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables });
  const encrypted = encryptBackup(json, passphrase);

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `psx-backup-${todayPkt()}.enc`);
  fs.writeFileSync(file, encrypted);
  console.log(`\nWrote ${file} (${(encrypted.length / 1024 / 1024).toFixed(1)} MB, encrypted)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
