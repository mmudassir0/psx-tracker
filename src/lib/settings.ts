import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Read a JSON-encoded setting, falling back when absent or corrupt. */
export function getSetting<T>(key: string, fallback: T): T {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  if (!row) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value) as object) } as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  const encoded = JSON.stringify(value);
  db.insert(appSettings)
    .values({ key, value: encoded, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: encoded, updatedAt: new Date() },
    })
    .run();
}
