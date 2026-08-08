import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { isDatabaseEmpty } from "@/lib/market";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "kmi30.db");

function main() {
  console.log("=== Railway Startup Sequence ===");
  
  // 1. Ensure directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    console.log(`Creating database directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }

  // 2. Run Drizzle schema migrations
  console.log("Running database migrations...");
  execSync("npx drizzle-kit push --force", { stdio: "inherit" });

  // 3. Backfill data if database is empty
  if (isDatabaseEmpty()) {
    console.log("Database is empty. Running initial market data backfill (~20s)...");
    execSync("npx tsx src/scripts/ingest.ts --backfill", { stdio: "inherit" });
  } else {
    console.log("Database initialized. Skipping backfill.");
  }

  // 4. Start Next.js server
  console.log("Starting Next.js production server...");
  execSync("npx next start", { stdio: "inherit" });
}

main();
