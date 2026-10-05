import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser, googleLoginEnabled, safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  // Better Auth appends its own ?error=<code> to our ?error=google.
  const errors = ([] as string[]).concat(sp.error ?? []);
  if (await getCurrentUser()) redirect(next);

  return (
    <div className="mx-auto w-full max-w-sm pt-8">
      <Card title="Log in">
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Your portfolio, watchlist, alerts and custom screens are private to
          your account. Market data stays public.
        </p>
        {errors.includes("account_not_linked") ? (
          <p role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-400">
            An account with this Google email already exists, created with a
            password. Log in with your email and password below, then use
            &ldquo;Connect Google&rdquo; on your Account page to log in with
            Google from then on.
          </p>
        ) : (
          errors.includes("google") && (
            <p role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-400">
              Google sign-in didn&apos;t complete. Try again, or log in with
              your email and password.
            </p>
          )
        )}
        <LoginForm next={next} google={googleLoginEnabled()} />
      </Card>
    </div>
  );
}
