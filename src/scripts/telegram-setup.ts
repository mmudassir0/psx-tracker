/**
 * Point the Telegram bot at this site's webhook. Run once after deploying,
 * and again if the domain or TELEGRAM_WEBHOOK_SECRET changes.
 *
 *   npm run telegram:setup -- https://your-site.example
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const base = (process.argv[2] ?? process.env.SITE_URL ?? "").replace(/\/+$/, "");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!base.startsWith("https://")) {
    console.error("usage: npm run telegram:setup -- https://your-site.example   (must be https)");
    process.exit(1);
  }
  if (!token || !secret) {
    console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env first.");
    process.exit(1);
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${base}/api/telegram`,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  });
  const body = (await res.json()) as { ok: boolean; description?: string };
  console.log(body.ok ? `Webhook set to ${base}/api/telegram` : `Failed: ${body.description}`);
  if (!body.ok) process.exit(1);
}

main().catch(() => {
  console.error(
    "Couldn't reach api.telegram.org from this computer (some networks block it).\n" +
      "Use the 'Set up Telegram webhook' button on the site's /admin page instead: it runs from the server.",
  );
  process.exit(1);
});
