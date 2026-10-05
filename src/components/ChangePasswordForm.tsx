"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/** A dropped connection rejects instead of returning an error; treat it as one. */
const NETWORK_ERROR = {
  data: null,
  error: { status: 0, code: "NETWORK", message: "Couldn't reach the server. Check your connection and try again." },
} as const;

const inputClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

export function ChangePasswordForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      // POST, so a submit before the page's JS loads never puts the
      // password in the URL (history, logs).
      method="post"
      className="flex max-w-sm flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        const newPassword = String(form.get("newPassword") ?? "");
        if (newPassword !== String(form.get("confirm") ?? "")) {
          setMessage({ ok: false, text: "The new passwords don't match." });
          return;
        }
        setPending(true);
        setMessage(null);
        const { error } = await authClient.changePassword({
          currentPassword: String(form.get("currentPassword") ?? ""),
          newPassword,
          // Anyone who had your old password is logged out.
          revokeOtherSessions: true,
        }).catch(() => NETWORK_ERROR);
        setPending(false);
        if (error) {
          setMessage({
            ok: false,
            text:
              error.status === 429
                ? "Too many attempts. Wait a minute and try again."
                : error.code === "INVALID_PASSWORD"
                  ? "Your current password is wrong."
                  : error.message || "Couldn't change the password.",
          });
          return;
        }
        formEl.reset();
        setMessage({ ok: true, text: "Password changed. Other devices have been logged out." });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">Current password</span>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">New password (at least 10 characters)</span>
        <input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">Repeat new password</span>
        <input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? "Saving…" : "Change password"}
      </button>
      {message && (
        <p role="alert" className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
