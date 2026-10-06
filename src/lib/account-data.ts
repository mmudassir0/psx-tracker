import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  alertEvents,
  alerts,
  customScreens,
  linkCodes,
  portfolios,
  pushSubscriptions,
  screenHits,
  transactions,
  userSettings,
  watchlist,
} from "@/db/schema";

/**
 * Everything personal stored for one user. Export and delete both use this
 * list, so anything added here is covered by both. Keep it in sync with the
 * tables that carry a user_id.
 */
export async function exportUserData(userId: string) {
  const [portfolioRows, transactionRows, watchlistRows, alertRows, alertEventRows, screenRows, settingRows] =
    await Promise.all([
      db.select().from(portfolios).where(eq(portfolios.userId, userId)).orderBy(asc(portfolios.createdAt)).all(),
      db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(asc(transactions.date)).all(),
      db.select().from(watchlist).where(eq(watchlist.userId, userId)).all(),
      db.select().from(alerts).where(eq(alerts.userId, userId)).all(),
      db.select().from(alertEvents).where(eq(alertEvents.userId, userId)).all(),
      db.select().from(customScreens).where(eq(customScreens.userId, userId)).all(),
      db.select().from(userSettings).where(eq(userSettings.userId, userId)).all(),
    ]);

  return {
    portfolios: portfolioRows,
    transactions: transactionRows,
    watchlist: watchlistRows,
    alerts: alertRows,
    alertEvents: alertEventRows,
    customScreens: screenRows.map((s) => ({ ...s, rules: safeJson(s.rules) })),
    settings: Object.fromEntries(settingRows.map((s) => [s.key, safeJson(s.value)])),
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Transactions as a CSV that the importer reads back unchanged. */
export function transactionsToCsv(
  rows: { date: string; symbol: string; type: string; quantity: number; price: number; fees: number; note: string | null; portfolioId: string | null }[],
  portfolioNames: Map<string, string>,
): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["Date,Symbol,Type,Quantity,Price,Fees,Note,Portfolio"];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.symbol,
        r.type,
        String(r.quantity),
        String(r.price),
        String(r.fees),
        r.note ?? "",
        (r.portfolioId && portfolioNames.get(r.portfolioId)) || "",
      ]
        .map(escape)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Remove every personal row. The account itself is removed by Better Auth. */
export async function deleteUserData(userId: string): Promise<void> {
  const screens = await db
    .select({ id: customScreens.id })
    .from(customScreens)
    .where(eq(customScreens.userId, userId))
    .all();
  if (screens.length > 0) {
    await db.delete(screenHits).where(inArray(screenHits.screenId, screens.map((s) => s.id))).run();
  }
  await db.delete(customScreens).where(eq(customScreens.userId, userId)).run();
  await db.delete(alertEvents).where(eq(alertEvents.userId, userId)).run();
  await db.delete(alerts).where(eq(alerts.userId, userId)).run();
  await db.delete(transactions).where(eq(transactions.userId, userId)).run();
  await db.delete(portfolios).where(eq(portfolios.userId, userId)).run();
  await db.delete(watchlist).where(eq(watchlist.userId, userId)).run();
  await db.delete(userSettings).where(eq(userSettings.userId, userId)).run();
  await db.delete(linkCodes).where(eq(linkCodes.userId, userId)).run();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).run();
}
