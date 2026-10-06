/**
 * Open an encrypted backup into readable JSON.
 *
 *   npm run backup:decrypt -- backups/psx-backup-2026-10-05.enc
 *
 * Writes <file>.json next to it, with every table as an array of rows. Uses
 * BACKUP_PASSPHRASE from .env. The output contains everyone's data and
 * password hashes: keep it private and delete it when you're done.
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";
import { decryptBackup } from "@/lib/backup-crypto";

loadEnvConfig(process.cwd());

const file = process.argv[2];
const passphrase = process.env.BACKUP_PASSPHRASE;
if (!file || !passphrase) {
  console.error("usage: npm run backup:decrypt -- <file.enc>   (BACKUP_PASSPHRASE in .env)");
  process.exit(1);
}

try {
  const json = decryptBackup(fs.readFileSync(file), passphrase);
  const out = file.replace(/\.enc$/, "") + ".json";
  fs.writeFileSync(out, json);
  const { createdAt, tables } = JSON.parse(json) as { createdAt: string; tables: Record<string, unknown[]> };
  console.log(`Backup from ${createdAt}:`);
  for (const [name, rows] of Object.entries(tables)) console.log(`  ${name.padEnd(16)} ${rows.length}`);
  console.log(`\nWrote ${out}`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
