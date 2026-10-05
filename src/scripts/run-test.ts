/**
 * Cross-platform test launcher: `tsx src/scripts/run-test.ts <name> [db]`.
 *
 * `DB_PATH=x tsx ...` only works in POSIX shells, and `.env` points the app
 * at the production Turso database. The env has to be fixed up BEFORE `@/db`
 * is imported, so the test module is loaded dynamically afterwards.
 * An empty TURSO_DATABASE_URL survives @next/env's .env loading, which never
 * overwrites a variable that is already defined.
 */
export {};

const [testName, dbPath] = process.argv.slice(2);
if (!testName) {
  console.error("usage: tsx src/scripts/run-test.ts <name> [scratch-db-path]");
  process.exit(1);
}

process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
if (dbPath) process.env.DB_PATH = dbPath;

import(`./test-${testName}.ts`).catch((err) => {
  console.error(err);
  process.exit(1);
});
