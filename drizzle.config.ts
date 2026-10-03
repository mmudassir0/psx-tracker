import type { Config } from "drizzle-kit";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

export default (TURSO_DATABASE_URL
  ? {
      schema: "./src/db/schema.ts",
      out: "./drizzle",
      dialect: "turso",
      dbCredentials: {
        url: TURSO_DATABASE_URL,
        authToken: TURSO_AUTH_TOKEN,
      },
    }
  : {
      schema: "./src/db/schema.ts",
      out: "./drizzle",
      dialect: "sqlite",
      dbCredentials: {
        url: process.env.DB_PATH ?? "./data/kmi30.db",
      },
    }) satisfies Config;
