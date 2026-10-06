import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { googleLoginEnabled, requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { ConnectGoogleButton } from "@/components/ConnectGoogleButton";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";
import { EmailAlertSettings, TelegramSettings } from "@/components/NotificationSettings";
import { emailConfigured, getNotifySettingsFor, telegramConfigured } from "@/lib/user-notify";
import { listDevices, pushConfigured, vapidPublicKey } from "@/lib/push";
import { PushSettings } from "@/components/PushSettings";

export const dynamic = "force-dynamic";

/** Better Auth error codes that come back on the redirect from Google. */
const LINK_ERRORS: Record<string, string> = {
  email_does_not_match:
    "That Google account uses a different email. Connect the Google account that matches your email here.",
  account_already_linked_to_different_user:
    "That Google account already belongs to another account here.",
  email_not_verified: "Google hasn't verified that email, so it can't be connected.",
  unable_to_link_account: "Google couldn't be connected to this account. Try again.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; error?: string | string[] }>;
}) {
  const user = await requireUser("/account");
  const sp = await searchParams;
  const errors = ([] as string[]).concat(sp.error ?? []);
  const linkError = errors.map((e) => LINK_ERRORS[e]).find(Boolean)
    ?? (errors.length ? "Google couldn't be connected. Try again." : null);

  const notify = await getNotifySettingsFor(user.id);
  const pushDevices = pushConfigured()
    ? (await listDevices(user.id)).map(({ endpoint, device }) => ({ endpoint, device }))
    : [];

  const providers = new Set(
    (
      await db
        .select({ providerId: account.providerId })
        .from(account)
        .where(eq(account.userId, user.id))
        .all()
    ).map((a) => a.providerId),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Account" description={`${user.name} · ${user.email}`} />

      <Card title="Password">
        {providers.has("credential") ? (
          <ChangePasswordForm />
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            You log in with Google, so there is no password to change here.
          </p>
        )}
      </Card>

      {googleLoginEnabled() && (
        <Card title="Google">
          {providers.has("google") ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {sp.linked === "google" ? "Connected. " : ""}
              You can log in with &ldquo;Continue with Google&rdquo; as well as
              your password.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Connect your Google account ({user.email}) to log in with
                &ldquo;Continue with Google&rdquo; from now on.
              </p>
              {linkError && (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                  {linkError}
                </p>
              )}
              <ConnectGoogleButton />
            </div>
          )}
        </Card>
      )}

      {(pushConfigured() || telegramConfigured() || emailConfigured()) && (
        <section id="notifications" className="scroll-mt-4">
          <Card title="Alert notifications" subtitle="Where your alerts are sent after each daily update (weekdays around 4–6 PM PKT).">
            <div className="flex flex-col gap-5">
              {pushConfigured() && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Notifications on this device</h3>
                  <PushSettings publicKey={vapidPublicKey()!} devices={pushDevices} />
                </div>
              )}
              {telegramConfigured() && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Telegram</h3>
                  <TelegramSettings connected={Boolean(notify.telegramChatId)} />
                </div>
              )}
              {emailConfigured() && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Email</h3>
                  <EmailAlertSettings email={user.email} verified={user.emailVerified} enabled={notify.email} />
                </div>
              )}
            </div>
          </Card>
        </section>
      )}

      <Card title="Your data" subtitle="Download everything stored for your account.">
        <div className="flex flex-wrap gap-2 text-sm">
          <a href="/api/export?format=csv" className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
            Transactions (CSV)
          </a>
          <a href="/api/export?format=json" className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
            Everything (JSON)
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          The CSV can be imported again on the Portfolio page.
        </p>
      </Card>

      <Card title="Delete account" subtitle="Permanently removes your account, portfolios, transactions, watchlist, alerts, screens and settings. This can't be undone.">
        {user.role === "admin" ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            You are an admin. Make someone else admin before deleting your account, so the site isn&apos;t left without one.
          </p>
        ) : (
          <DeleteAccountForm hasPassword={providers.has("credential")} />
        )}
      </Card>
    </div>
  );
}
