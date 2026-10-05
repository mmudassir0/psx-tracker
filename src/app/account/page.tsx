import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { googleLoginEnabled, requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { ConnectGoogleButton } from "@/components/ConnectGoogleButton";

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
    </div>
  );
}
