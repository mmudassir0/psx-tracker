"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Turnstile } from "@/components/Turnstile";

/** A dropped connection rejects instead of returning an error; treat it as one. */
const NETWORK_ERROR = {
  data: null,
  error: { status: 0, code: "NETWORK", message: "Couldn't reach the server. Check your connection and try again." },
} as const;

const inputClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";
const buttonClass =
  "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

/** Better Auth error → something a person can act on. */
function describe(error: { status?: number; code?: string; message?: string }): string {
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.code === "INVALID_EMAIL_OR_PASSWORD") return "Wrong email or password.";
  if (error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    return "An account with this email already exists. Log in instead.";
  }
  if (error.code === "PASSWORD_TOO_SHORT") return "Use at least 10 characters for the password.";
  if (error.code === "BANNED_USER") return "This account has been disabled.";
  return error.message || "Something went wrong. Try again.";
}

function GoogleButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const { error } = await authClient.signIn.social({
            provider: "google",
            callbackURL: next,
            errorCallbackURL: "/login?error=google",
          }).catch(() => NETWORK_ERROR);
          if (error) {
            setError(describe(error));
            setPending(false);
          }
        }}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
        or
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}

export function LoginForm({ next, google }: { next: string; google: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {google && <GoogleButton next={next} />}
      <form
        // POST, so a submit before the page's JS loads never puts the
        // password in the URL (history, logs).
        method="post"
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPending(true);
          setError(null);
          const { error } = await authClient.signIn.email({
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          }).catch(() => NETWORK_ERROR);
          if (error) {
            setError(describe(error));
            setPending(false);
            return;
          }
          router.replace(next);
          router.refresh();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
          <input name="email" type="email" required autoFocus autoComplete="email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Logging in…" : "Log in"}
        </button>
        {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </form>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        No account?{" "}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="underline">
          Sign up
        </Link>
        . Forgot your password? Ask the site admin to reset it.
      </p>
    </div>
  );
}

export function SignupForm({
  next,
  google,
  captchaSiteKey,
}: {
  next: string;
  google: boolean;
  /** Cloudflare Turnstile site key, when bot protection is on. */
  captchaSiteKey?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaRound, setCaptchaRound] = useState(0);

  return (
    <div className="flex flex-col gap-3">
      {google && <GoogleButton next={next} />}
      <form
        // POST, so a submit before the page's JS loads never puts the
        // password in the URL (history, logs).
        method="post"
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const password = String(form.get("password") ?? "");
          if (password !== String(form.get("confirm") ?? "")) {
            setError("The two passwords don't match.");
            return;
          }
          setPending(true);
          setError(null);
          if (captchaSiteKey && !captchaToken) {
            setError("Please complete the check below first.");
            setPending(false);
            return;
          }
          const { error } = await authClient.signUp.email(
            {
              name: String(form.get("name") ?? "").trim(),
              email: String(form.get("email") ?? "").trim(),
              password,
            },
            captchaToken ? { headers: { "x-captcha-response": captchaToken } } : undefined,
          ).catch(() => NETWORK_ERROR);
          if (error) {
            setError(describe(error));
            setPending(false);
            // A Turnstile token is single-use: get a fresh one for the retry.
            if (captchaSiteKey) {
              setCaptchaToken(null);
              setCaptchaRound((n) => n + 1);
            }
            return;
          }
          router.replace(next);
          router.refresh();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Name</span>
          <input name="name" required maxLength={60} autoFocus autoComplete="name" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Email</span>
          <input name="email" type="email" required autoComplete="email" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Password (at least 10 characters)</span>
          <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Repeat password</span>
          <input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} />
        </label>
        {captchaSiteKey && (
          <Turnstile siteKey={captchaSiteKey} onToken={setCaptchaToken} resetKey={captchaRound} />
        )}
        <button type="submit" disabled={pending || Boolean(captchaSiteKey && !captchaToken)} className={buttonClass}>
          {pending ? "Creating account…" : "Create account"}
        </button>
        {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </form>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        By creating an account you agree to how your data is handled in the{" "}
        <Link href="/privacy" className="underline">
          privacy note
        </Link>
        .
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
