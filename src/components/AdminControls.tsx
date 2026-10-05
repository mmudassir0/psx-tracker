"use client";

import { useActionState } from "react";
import {
  resetPasswordAction,
  setBannedAction,
  type AdminActionState,
} from "@/app/admin/actions";

const INITIAL: AdminActionState = { ok: false, message: "" };

export function ResetPasswordButton({ userId, email }: { userId: string; email: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!confirm(`Reset the password for ${email}? They will be logged out everywhere.`)) {
          event.preventDefault();
        }
      }}
      className="flex flex-col items-start gap-1"
    >
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Resetting…" : "Reset password"}
      </button>
      {state.message && (
        <span className={`text-xs ${state.ok ? "text-slate-600 dark:text-slate-300" : "text-rose-600 dark:text-rose-400"}`}>
          {state.message}
          {state.tempPassword && (
            <code className="ml-1 select-all rounded bg-amber-100 px-1 font-mono text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {state.tempPassword}
            </code>
          )}
        </span>
      )}
    </form>
  );
}

export function BanToggle({ userId, banned }: { userId: string; banned: boolean }) {
  return (
    <form action={setBannedAction}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="banned" value={banned ? "false" : "true"} />
      <button
        type="submit"
        className={`rounded-md px-2 py-1 text-xs ${
          banned
            ? "border border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            : "text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
        }`}
      >
        {banned ? "Enable" : "Disable"}
      </button>
    </form>
  );
}
