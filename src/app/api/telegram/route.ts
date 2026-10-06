import { timingSafeEqual } from "node:crypto";
import { redeemTelegramCode, sendTelegram, unlinkTelegramChat } from "@/lib/user-notify";

export const dynamic = "force-dynamic";

function secretMatches(given: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Telegram bot webhook. Telegram sends the secret registered by
 * `npm run telegram:setup` in a header; anything without it is ignored.
 *
 *   /start <code>  link this chat to the account that made the code
 *   /stop          stop sending alerts to this chat
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("forbidden", { status: 403 });
  }

  const update = (await request.json().catch(() => null)) as {
    message?: { chat?: { id?: number; type?: string }; text?: string };
  } | null;
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text?.trim() ?? "";
  // Always 200: Telegram retries anything else.
  if (!chatId) return Response.json({ ok: true });
  const chat = String(chatId);

  if (update?.message?.chat?.type !== "private") {
    await sendTelegram(chat, "Please message me directly, not in a group.");
  } else if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1] ?? "";
    const name = code ? await redeemTelegramCode(code, chat) : null;
    await sendTelegram(
      chat,
      name
        ? `Connected to ${name}. Your PSX alerts will arrive here. Send /stop to turn them off.`
        : "That link has expired or was already used. Open your Account page on the site and press Connect Telegram again.",
    );
  } else if (text.startsWith("/stop")) {
    const n = await unlinkTelegramChat(chat);
    await sendTelegram(chat, n ? "Done. No more alerts here." : "This chat wasn't receiving alerts.");
  } else {
    await sendTelegram(chat, "I only send PSX alerts. Connect me from your Account page on the site.");
  }
  return Response.json({ ok: true });
}
