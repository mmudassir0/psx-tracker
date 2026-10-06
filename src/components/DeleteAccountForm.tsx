"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const inputClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

/**
 * Permanently delete the account and every personal row. Password accounts
 * confirm with their password; Google-only accounts need a recent login.
 */
export function DeleteAccountForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      method="post"
      className="flex max-w-sm flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        const result = await authClient
          .deleteUser(hasPassword ? { password: String(form.get("password") ?? "") } : {})
          .catch(() => null);
        if (!result || result.error) {
          const e = result?.error;
          setError(
            !e
              ? "Couldn't reach the server. Try again."
              : e.code === "INVALID_PASSWORD"
                ? "Wrong password."
                : e.code === "SESSION_EXPIRED"
                  ? "For safety, log out and back in, then delete within a few minutes."
                  : e.message || "Couldn't delete the account.",
          );
          setPending(false);
          return;
        }
        router.replace("/");
        router.refresh();
      }}
    >
      {hasPassword && (
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Your password</span>
          <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">Type DELETE to confirm</span>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={pending || confirmText !== "DELETE"}
        className="self-start rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : "Delete my account and data"}
      </button>
      {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </form>
  );
}
