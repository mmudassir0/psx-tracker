import type { Config } from "drizzle-kit";
import path from "node:path";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH ?? path.join(process.cwd(), "data", "kmi30.db"),
  },
} satisfies Config;
