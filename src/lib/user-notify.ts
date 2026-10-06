import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { linkCodes, user, userSettings } from "@/db/schema";
import { getUserSetting, setUserSetting } from "@/lib/settings";

/**
 * Per-user alert delivery by Telegram and email.
 *
 * Telegram: TELEGRAM_BOT_TOKEN + TELEGRAM_BOT_USERNAME (+ TELEGRAM_WEBHOOK_SECRET
 * for the webhook that links chats). Email: RESEND_API_KEY + EMAIL_FROM.
 * Each channel is off until its variables are set.
 */

export const NOTIFY_KEY = "notify";

export interface UserNotifySettings {
  telegramChatId: string | null;
  /** Email alerts; only ever sent to a verified address. */
  email: boolean;
}

const DEFAULT_NOTIFY: UserNotifySettings = { telegramChatId: null, email: false };

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function getNotifySettingsFor(userId: string | null): Promise<UserNotifySettings> {
  return getUserSetting(userId, NOTIFY_KEY, DEFAULT_NOTIFY);
}

export async function updateNotifySettings(userId: string, patch: Partial<UserNotifySettings>) {
  const current = await getNotifySettingsFor(userId);
  await setUserSetting(userId, NOTIFY_KEY, { ...current, ...patch });
}

// --- Telegram ------------------------------------------------------------

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/** One-time deep link: opening it in Telegram sends the bot "/start <code>". */
export async function createTelegramLink(userId: string): Promise<string> {
  const code = randomBytes(12).toString("base64url");
  await db.delete(linkCodes).where(and(eq(linkCodes.userId, userId), eq(linkCodes.purpose, "telegram"))).run();
  await db
    .insert(linkCodes)
    .values({ code, userId, purpose: "telegram", expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS) })
    .run();
  return `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${code}`;
}

/** Called by the webhook. Returns the linked user's name, or null if invalid. */
export async function redeemTelegramCode(code: string, chatId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return null;
  const row = await db
    .select()
    .from(linkCodes)
    .where(and(eq(linkCodes.code, code), eq(linkCodes.purpose, "telegram"), gt(linkCodes.expiresAt, new Date())))
    .get();
  if (!row) return null;
  await db.delete(linkCodes).where(eq(linkCodes.code, code)).run();
  await updateNotifySettings(row.userId, { telegramChatId: chatId });
  const owner = await db.select({ name: user.name }).from(user).where(eq(user.id, row.userId)).get();
  return owner?.name ?? "your account";
}

/** "/stop" from the chat: forget it for whichever user had it linked. */
export async function unlinkTelegramChat(chatId: string): Promise<number> {
  const rows = await db.select().from(userSettings).where(eq(userSettings.key, NOTIFY_KEY)).all();
  let unlinked = 0;
  for (const row of rows) {
    try {
      const value = JSON.parse(row.value) as UserNotifySettings;
      if (value.telegramChatId === chatId) {
        await updateNotifySettings(row.userId, { telegramChatId: null });
        unlinked++;
      }
    } catch {
      // ignore malformed rows
    }
  }
  return unlinked;
}

// --- Email ---------------------------------------------------------------

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Delivery after an ingest --------------------------------------------

export interface DeliverableAlert {
  userId: string | null;
  message: string;
}

/**
 * Send each user their fired alerts, one message per user per channel.
 * Failures are logged and never fail the ingest.
 */
export async function deliverAlerts(fired: DeliverableAlert[], siteUrl?: string): Promise<{ sent: number }> {
  const byUser = new Map<string, string[]>();
  for (const a of fired) {
    if (!a.userId) continue;
    const list = byUser.get(a.userId) ?? [];
    list.push(a.message);
    byUser.set(a.userId, list);
  }
  if (byUser.size === 0) return { sent: 0 };

  const owners = await db
    .select({ id: user.id, email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(inArray(user.id, [...byUser.keys()]))
    .all();
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  let sent = 0;
  for (const [userId, messages] of byUser) {
    const settings = await getNotifySettingsFor(userId);
    const lines = messages.map((m) => `• ${m}`).join("\n");
    const footer = siteUrl ? `\n\n${siteUrl}/alerts` : "";
    const text = `PSX alert${messages.length === 1 ? "" : "s"}:\n${lines}${footer}`;

    if (settings.telegramChatId && telegramConfigured()) {
      if (await sendTelegram(settings.telegramChatId, text)) sent++;
      else console.warn(`Telegram delivery failed for user ${userId}`);
    }
    const owner = ownerById.get(userId);
    if (settings.email && emailConfigured() && owner?.emailVerified) {
      const subject = messages.length === 1 ? messages[0] : `${messages.length} PSX alerts`;
      if (await sendEmail(owner.email, subject, text)) sent++;
      else console.warn(`Email delivery failed for user ${userId}`);
    }
  }
  return { sent };
}

/**
 * Point the bot's webhook at this site. Runs on the server (the admin page),
 * so it works even where the admin's own network blocks api.telegram.org.
 */
export async function setTelegramWebhook(siteUrl: string): Promise<{ ok: boolean; message: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) {
    return { ok: false, message: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first, then redeploy." };
  }
  if (!siteUrl.startsWith("https://")) {
    return { ok: false, message: `Telegram needs an https address; this site is ${siteUrl}.` };
  }
  const url = `${siteUrl.replace(/\/+$/, "")}/api/telegram`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      }),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    return body.ok
      ? { ok: true, message: `Telegram will deliver messages to ${url}.` }
      : { ok: false, message: `Telegram refused: ${body.description ?? res.status}` };
  } catch {
    return { ok: false, message: "Couldn't reach Telegram from the server." };
  }
}

/** Where Telegram currently delivers the bot's messages, for the admin page. */
export async function getTelegramWebhookInfo(): Promise<{ url: string; lastError: string | null } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { cache: "no-store" });
    const body = (await res.json()) as { ok: boolean; result?: { url?: string; last_error_message?: string } };
    if (!body.ok) return null;
    return { url: body.result?.url ?? "", lastError: body.result?.last_error_message ?? null };
  } catch {
    return null;
  }
}
