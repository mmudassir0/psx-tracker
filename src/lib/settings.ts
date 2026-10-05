import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, userSettings } from "@/db/schema";

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

/**
 * Per-user settings. Async, unlike the app-wide pair above: on Turso every
 * query returns a promise, and the synchronous form silently fell back to
 * defaults there, so saved zakat inputs never came back.
 */
export async function getUserSetting<T>(
  userId: string | null,
  key: string,
  fallback: T,
): Promise<T> {
  if (!userId) return fallback;
  const row = await db
    .select()
    .from(userSettings)
    .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
    .get();
  if (!row) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value) as object) } as T;
  } catch {
    return fallback;
  }
}

export async function setUserSetting(userId: string, key: string, value: unknown) {
  const encoded = JSON.stringify(value);
  await db
    .insert(userSettings)
    .values({ userId, key, value: encoded, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [userSettings.userId, userSettings.key],
      set: { value: encoded, updatedAt: new Date() },
    })
    .run();
}
