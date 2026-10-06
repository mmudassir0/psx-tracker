import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, transactions, watchlist } from "@/db/schema";
import { getUserSetting } from "@/lib/settings";
import { getNotifySettingsFor } from "@/lib/user-notify";
import { hasPushDevice, pushConfigured } from "@/lib/push";

export const ONBOARDING_KEY = "onboarding";

export interface OnboardingStep {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

async function hasAny(table: typeof transactions | typeof watchlist | typeof alerts, userId: string) {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(table)
    .where(eq(table.userId, userId))
    .get();
  return (row?.n ?? 0) > 0;
}

/** Welcome checklist for a new account; null once finished or dismissed. */
export async function getOnboarding(
  userId: string | null,
  { telegramAvailable, emailAvailable }: { telegramAvailable: boolean; emailAvailable: boolean },
): Promise<OnboardingStep[] | null> {
  if (!userId) return null;
  const state = await getUserSetting(userId, ONBOARDING_KEY, { dismissed: false });
  if (state.dismissed) return null;

  const pushAvailable = pushConfigured();
  const [trades, watching, alerting, notify, pushOn] = await Promise.all([
    hasAny(transactions, userId),
    hasAny(watchlist, userId),
    hasAny(alerts, userId),
    getNotifySettingsFor(userId),
    pushAvailable ? hasPushDevice(userId) : Promise.resolve(false),
  ]);

  const steps: OnboardingStep[] = [
    { key: "trade", label: "Record your holdings", hint: "Add a trade, or import your broker's CSV.", href: "/portfolio", done: trades },
    { key: "watch", label: "Follow a stock", hint: "Add names you don't own to your watchlist.", href: "/watchlist", done: watching },
    { key: "alert", label: "Set an alert", hint: "Get told when a price, P/E or KMI30 membership changes.", href: "/alerts", done: alerting },
  ];
  if (pushAvailable || telegramAvailable || emailAvailable) {
    steps.push({
      key: "notify",
      label: pushAvailable
        ? "Turn on notifications"
        : telegramAvailable
          ? "Get alerts on Telegram"
          : "Get alerts by email",
      hint: "Alerts reach you without opening the site.",
      href: "/account#notifications",
      done: pushOn || Boolean(notify.telegramChatId) || notify.email,
    });
  }
  return steps.every((s) => s.done) ? null : steps;
}
