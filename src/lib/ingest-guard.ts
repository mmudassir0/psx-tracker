/**
 * Guards for the scheduled daily update.
 *
 * GitHub starts scheduled jobs late or not at all, so the job runs several
 * times a day. These keep that safe and quiet:
 * - a run during trading hours saves nothing (half-day prices would be stored
 *   as that day's close);
 * - a run after the session was already captured stops early;
 * - when a weekday's prices still haven't arrived by the evening, or a run
 *   crashes, the admins get one phone notification (and email if set up).
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, ingestRuns, quotesDaily, user } from "@/db/schema";
import { expectedSessionDate, pktDateToUtc, todayPkt } from "@/lib/dates";
import { sendPushToUser } from "@/lib/push";
import { sendEmail } from "@/lib/user-notify";

/** PSX closes at 15:30 PKT; runs from 15:45 on count as after the close. */
const AFTER_CLOSE_UTC_MINUTES = 10 * 60 + 45;
/** A captured session has quotes for most of the market. */
const MIN_QUOTES = 400;
/** From this PKT hour, a weekday with no prices yet is reported. */
const STALE_ALERT_HOUR_PKT = 20;

/** When session `date`'s prices are final: 15:45 PKT that day. */
export function afterCloseOf(date: string): Date {
  return new Date(pktDateToUtc(date).getTime() + AFTER_CLOSE_UTC_MINUTES * 60_000);
}

/** True once a finished run has saved `date`'s prices after the close. */
export async function sessionCaptured(date: string): Promise<boolean> {
  const quotes = await db
    .select({ n: sql<number>`count(*)` })
    .from(quotesDaily)
    .where(eq(quotesDaily.date, date))
    .get();
  if ((quotes?.n ?? 0) < MIN_QUOTES) return false;
  const run = await db
    .select({ id: ingestRuns.id })
    .from(ingestRuns)
    .where(
      and(
        inArray(ingestRuns.status, ["ok", "error"]),
        gte(ingestRuns.startedAt, afterCloseOf(date)),
      ),
    )
    .limit(1)
    .get();
  return run != null;
}

/**
 * The session that should be in the database but isn't, once it's late
 * enough in the evening to say so. Pure, for tests.
 */
export function missingSession(latestQuoteDate: string | null, now: Date = new Date()): string | null {
  const expected = expectedSessionDate(now);
  if (latestQuoteDate != null && latestQuoteDate >= expected) return null;
  // Only complain after the evening runs have had their chance.
  const pktHour = new Date(now.getTime() + 5 * 3600_000).getUTCHours();
  if (expected === todayPkt(now) && pktHour < STALE_ALERT_HOUR_PKT) return null;
  return expected;
}

/** Send once per `key`: the same problem is reported a single time. */
async function once(key: string, send: () => Promise<void>): Promise<boolean> {
  const done = await db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (done) return false;
  await send();
  await db
    .insert(appSettings)
    .values({ key, value: JSON.stringify({ at: new Date().toISOString() }), updatedAt: new Date() })
    .onConflictDoNothing()
    .run();
  return true;
}

/** Phone notification (and email when configured) to every admin. */
export async function notifyAdmins(title: string, body: string, url = "/health"): Promise<number> {
  const admins = await db
    .select({ id: user.id, email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.role, "admin"))
    .all();
  let sent = 0;
  for (const a of admins) {
    sent += await sendPushToUser(a.id, { title, body, url, tag: "admin-ingest" });
    if (a.verified && (await sendEmail(a.email, title, body))) sent++;
  }
  return sent;
}

/** After a scheduled run (or skip): report a weekday that never arrived. */
export async function reportMissingSession(
  latestQuoteDate: string | null,
  log: (m: string) => void = console.log,
): Promise<void> {
  const missing = missingSession(latestQuoteDate);
  if (!missing) return;
  const reported = await once(`admin-alert:missing:${missing}`, async () => {
    const sent = await notifyAdmins(
      "PSX Tracker: prices missing",
      `No prices saved for ${missing} yet (newest is ${latestQuoteDate ?? "none"}). ` +
        "If PSX was open that day, the daily update didn't run or failed. Check GitHub Actions.",
    );
    log(`Admins told prices for ${missing} are missing (${sent} notification(s)).`);
  });
  if (!reported) log(`Prices for ${missing} still missing (admins already told).`);
}

/** A crashed scheduled run: one notification per day. */
export async function reportCrash(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await once(`admin-alert:crash:${todayPkt()}`, async () => {
    await notifyAdmins(
      "PSX Tracker: daily update failed",
      `The update crashed: ${message.slice(0, 180)}. Later runs today will retry.`,
    );
  });
}
