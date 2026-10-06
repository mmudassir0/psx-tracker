"use client";

import { useActionState, useState } from "react";
import {
  disconnectTelegramAction,
  setEmailAlertsAction,
  telegramLinkAction,
  testTelegramAction,
  type ActionState,
  type TelegramLinkState,
} from "@/app/actions";
import { authClient } from "@/lib/auth-client";

const button =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

function Note({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p className={`text-sm ${state.ok ? "text-slate-600 dark:text-slate-300" : "text-rose-600 dark:text-rose-400"}`}>
      {state.message}
    </p>
  );
}

export function TelegramSettings({ connected }: { connected: boolean }) {
  const [linkState, linkAction, linking] = useActionState<TelegramLinkState, FormData>(telegramLinkAction, { ok: false, message: "" });
  const [testState, testAction, testing] = useActionState<ActionState, FormData>(testTelegramAction, { ok: false, message: "" });

  if (connected) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">Connected. Alerts are sent to your Telegram chat.</p>
        <div className="flex flex-wrap gap-2">
          <form action={testAction}>
            <button type="submit" disabled={testing} className={button}>{testing ? "Sending…" : "Send a test"}</button>
          </form>
          <form action={disconnectTelegramAction}>
            <button type="submit" className="rounded-md px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
              Disconnect
            </button>
          </form>
        </div>
        <Note state={testState} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <form action={linkAction}>
        <button type="submit" disabled={linking} className={button}>{linking ? "Creating link…" : "Connect Telegram"}</button>
      </form>
      <Note state={linkState} />
      {linkState.link && (
        <a href={linkState.link} target="_blank" rel="noopener noreferrer"
          className="self-start rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
          Open Telegram
        </a>
      )}
      {linkState.link && (
        <p className="text-xs text-slate-500 dark:text-slate-400">After pressing Start in Telegram, reload this page.</p>
      )}
    </div>
  );
}

export function EmailAlertSettings({
  email,
  verified,
  enabled,
}: {
  email: string;
  verified: boolean;
  enabled: boolean;
}) {
  const [message, setMessage] = useState<ActionState>({ ok: false, message: "" });
  const [sending, setSending] = useState(false);

  if (!verified) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Confirm {email} first, so alerts only ever go to an address you own.
        </p>
        <button
          type="button"
          disabled={sending}
          className={`${button} self-start`}
          onClick={async () => {
            setSending(true);
            const result = await authClient
              .sendVerificationEmail({ email, callbackURL: "/account?verified=1#notifications" })
              .catch(() => null);
            setSending(false);
            setMessage(
              result && !result.error
                ? { ok: true, message: `Sent. Open the link in the email to ${email}.` }
                : { ok: false, message: result?.error?.status === 429 ? "Too many requests. Try again later." : "Couldn't send the email." },
            );
          }}
        >
          {sending ? "Sending…" : "Send confirmation email"}
        </button>
        <Note state={message} />
      </div>
    );
  }

  return (
    <form action={setEmailAlertsAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <span className="text-sm text-slate-600 dark:text-slate-400">
        {enabled ? `Alerts are emailed to ${email}.` : `Email alerts to ${email}?`}
      </span>
      <button type="submit" className={button}>{enabled ? "Turn off" : "Turn on"}</button>
    </form>
  );
}
