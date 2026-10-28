/**
 * Friday weekly digest. Run by .github/workflows/digest.yml after the last
 * ingest of the week; safe to re-run (each user gets one digest per session).
 *
 *   npx tsx src/scripts/digest.ts            send
 *   npx tsx src/scripts/digest.ts --dry-run  print instead of sending
 */
import { db } from "@/db";
import { user } from "@/db/schema";
import { latestQuoteDate } from "@/lib/market";
import { getUserSetting, setUserSetting } from "@/lib/settings";
import { buildDigest, formatDigest } from "@/lib/digest";
import { emailConfigured, getNotifySettingsFor, sendEmail, sendTelegram, telegramConfigured } from "@/lib/user-notify";
import { listDevices, pushConfigured, sendPushToUser } from "@/lib/push";

const SENT_KEY = "digest-last-sent";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const asOf = await latestQuoteDate();
  if (!asOf) {
    console.log("No market data; nothing to send.");
    return;
  }
  const siteUrl = process.env.SITE_URL || undefined;
  const users = await db.select({ id: user.id, email: user.email, emailVerified: user.emailVerified }).from(user).all();

  let sentTo = 0;
  for (const u of users) {
    const settings = await getNotifySettingsFor(u.id);
    if (settings.weeklyDigest === false) continue;
    const telegram = settings.telegramChatId && telegramConfigured() ? settings.telegramChatId : null;
    const email = settings.email && emailConfigured() && u.emailVerified ? u.email : null;

    const push = pushConfigured() && (await listDevices(u.id)).length > 0;
    if (!telegram && !email && !push) continue;

    const last = await getUserSetting<{ asOf: string | null }>(u.id, SENT_KEY, { asOf: null });
    if (last.asOf === asOf) continue;

    const message = formatDigest(await buildDigest(u.id, asOf), siteUrl);
    if (dryRun) {
      console.log(`--- ${u.email} (telegram: ${Boolean(telegram)}, email: ${Boolean(email)}, push: ${push})\n${message.text}\n`);
      continue;
    }

    let delivered = 0;
    if (telegram && (await sendTelegram(telegram, message.text))) delivered++;
    if (email && (await sendEmail(email, message.subject, message.text))) delivered++;
    if (push) delivered += await sendPushToUser(u.id, { title: "PSX weekly", body: message.short, url: "/portfolio", tag: "psx-digest" });

    if (delivered > 0) {
      await setUserSetting(u.id, SENT_KEY, { asOf });
      sentTo++;
    }
  }
  console.log(dryRun ? "Dry run: nothing sent." : `Weekly digest sent to ${sentTo} user(s) for ${asOf}.`);
}

main().catch((err) => {
  console.error("digest failed:", err);
  process.exit(1);
});
