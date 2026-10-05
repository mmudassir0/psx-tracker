/**
 * Make an existing account the admin and give it the data from before
 * accounts existed (rows with no owner).
 *
 *   npm run make-admin -- you@example.com
 *
 * Deliberately a command, not "first sign-up wins": sign-up is open and
 * emails are unverified, so anyone could otherwise register first and take
 * both the admin role and your data. Running this needs the database
 * credentials, which only you have.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  user,
  transactions,
  alerts,
  alertEvents,
  customScreens,
  watchlist,
  appSettings,
  userSettings,
} from "@/db/schema";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("usage: npm run make-admin -- you@example.com");
    process.exit(1);
  }

  const account = await db.select().from(user).where(eq(user.email, email)).get();
  if (!account) {
    console.error(`No account with email ${email}. Sign up on the site first.`);
    process.exit(1);
  }

  await db.update(user).set({ role: "admin" }).where(eq(user.id, account.id)).run();
  console.log(`${account.name} <${email}> is now an admin.`);

  const unowned = <T extends { userId: unknown }>(t: T) =>
    isNull(t.userId as never);
  const claimed: Record<string, number> = {};
  for (const [name, table] of [
    ["transactions", transactions],
    ["alerts", alerts],
    ["alert events", alertEvents],
    ["custom screens", customScreens],
  ] as const) {
    const rows = await db.select({ n: sql<number>`count(*)` }).from(table).where(unowned(table)).get();
    claimed[name] = rows?.n ?? 0;
    if (claimed[name] > 0) {
      await db.update(table).set({ userId: account.id }).where(unowned(table)).run();
    }
  }

  // The migration copied old watchlist rows in with an empty owner.
  const wl = await db
    .select({ n: sql<number>`count(*)` })
    .from(watchlist)
    .where(or(eq(watchlist.userId, ""), isNull(watchlist.userId)))
    .get();
  claimed["watchlist"] = wl?.n ?? 0;
  if (claimed["watchlist"] > 0) {
    await db
      .update(watchlist)
      .set({ userId: account.id })
      .where(or(eq(watchlist.userId, ""), isNull(watchlist.userId)))
      .run();
  }

  // Zakat inputs were app-wide before accounts; copy them over once.
  const zakat = await db.select().from(appSettings).where(eq(appSettings.key, "zakat")).get();
  if (zakat) {
    const existing = await db
      .select()
      .from(userSettings)
      .where(and(eq(userSettings.userId, account.id), eq(userSettings.key, "zakat")))
      .get();
    if (!existing) {
      await db
        .insert(userSettings)
        .values({ userId: account.id, key: "zakat", value: zakat.value, updatedAt: new Date() })
        .run();
      claimed["zakat settings"] = 1;
    }
  }

  const summary = Object.entries(claimed)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${name}`)
    .join(", ");
  console.log(summary ? `Assigned to this account: ${summary}.` : "No unowned data to assign.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
