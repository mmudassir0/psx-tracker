import webpush from "web-push";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Browser push notifications (Web Push with VAPID). Delivery goes through the
 * browser vendor's push service (Google, Apple, Mozilla), so it works where
 * Telegram is blocked. Off until VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are set.
 */

export const MAX_DEVICES_PER_USER = 10;

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/** Safe to send to the browser: it identifies this site, it isn't a secret. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

let configured = false;
function configure(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "https://psx-tracker-plum.vercel.app",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    configured = true;
  }
  return true;
}

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Push services hand out https endpoints on their own hosts; anything else is refused. */
export function isValidSubscription(sub: unknown): sub is BrowserSubscription {
  const s = sub as BrowserSubscription | null;
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 1000) return false;
  try {
    if (new URL(s.endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  return (
    typeof s.keys?.p256dh === "string" &&
    typeof s.keys?.auth === "string" &&
    s.keys.p256dh.length < 200 &&
    s.keys.auth.length < 100
  );
}

export async function saveSubscription(
  userId: string,
  sub: BrowserSubscription,
  device: string | null,
): Promise<{ ok: boolean; message?: string }> {
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .get();
  if ((count?.n ?? 0) >= MAX_DEVICES_PER_USER) {
    return { ok: false, message: `Up to ${MAX_DEVICES_PER_USER} devices; turn one off first.` };
  }
  // An endpoint belongs to one browser: re-subscribing (or another account
  // logging in on the same browser) takes it over rather than duplicating it.
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: sub.endpoint,
      userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      device: device?.slice(0, 80) ?? null,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device: device?.slice(0, 80) ?? null },
    })
    .run();
  return { ok: true };
}

export async function removeSubscription(userId: string, endpoint: string) {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .run();
}

export async function listDevices(userId: string | null) {
  if (!userId) return [];
  return await db
    .select({ endpoint: pushSubscriptions.endpoint, device: pushSubscriptions.device, createdAt: pushSubscriptions.createdAt })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .all();
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped (same site only). */
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

/** Send to every device of a user. Returns how many accepted it. */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!configure()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).all();
  const payload = JSON.stringify(message);
  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: "normal" },
      );
      delivered++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Unsubscribed, uninstalled or expired: forget it.
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).run();
      } else {
        console.warn(`Push to one device of user ${userId} failed (${status ?? "network"})`);
      }
    }
  }
  return delivered;
}

/** Does this user have at least one device subscribed? */
export async function hasPushDevice(userId: string): Promise<boolean> {
  const row = await db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .limit(1)
    .get();
  return Boolean(row);
}
