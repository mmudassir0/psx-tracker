"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * Link Google to the logged-in account. Done here, while logged in, because
 * linking at sign-in is disabled: an unverified email alone must never let a
 * Google login into someone's account.
 */
export function ConnectGoogleButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await authClient
            .linkSocial({
              provider: "google",
              callbackURL: "/account?linked=google",
              errorCallbackURL: "/account",
            })
            .catch(() => null);
          if (!result || result.error) {
            setError(result?.error?.message || "Couldn't reach Google. Try again.");
            setPending(false);
          }
        }}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        {pending ? "Opening Google…" : "Connect Google"}
      </button>
      {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
