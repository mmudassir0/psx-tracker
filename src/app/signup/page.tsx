import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { SignupForm } from "@/components/LoginForm";
import { getCurrentUser, googleLoginEnabled, safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNextPath((await searchParams).next);
  if (await getCurrentUser()) redirect(next);

  return (
    <div className="mx-auto w-full max-w-sm pt-8">
      <Card title="Create an account">
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Track your own portfolio, watchlist and alerts. Only you can see them.
        </p>
        <SignupForm
          next={next}
          google={googleLoginEnabled()}
          captchaSiteKey={
            process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : undefined
          }
        />
      </Card>
    </div>
  );
}
