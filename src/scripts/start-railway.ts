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
  try {
    execSync("npx drizzle-kit push --force", { stdio: "inherit" });
  } catch (err) {
    console.error("Migration warning (continuing startup):", err);
  }

  // 3. Populate initial data if database is empty
  if (isDatabaseEmpty()) {
    console.log("Database is empty. Running initial quick ingest...");
    try {
      execSync("npx tsx src/scripts/ingest.ts", { stdio: "inherit" });
    } catch (err) {
      console.warn("Initial ingest encountered warnings, continuing server boot.");
    }
  } else {
    console.log("Database already initialized.");
  }

  // 4. Start Next.js server
  console.log("Starting Next.js production server...");
  execSync("npx next start", { stdio: "inherit" });
}

main();
