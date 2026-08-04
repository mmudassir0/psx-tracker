"use client";

import { useActionState, useState } from "react";
import { createAlertAction, type ActionState } from "@/app/actions";
import {
  ALERT_LABELS,
  needsThreshold,
  type AlertKind,
} from "@/lib/alert-types";

const INITIAL: ActionState = { ok: false, message: "" };

const THRESHOLD_HINT: Partial<Record<AlertKind, string>> = {
  price_above: "PKR price level",
  price_below: "PKR price level",
  pe_above: "P/E multiple",
  pe_below: "P/E multiple",
  near_52w_high: "Percent below the high, e.g. 2",
  near_52w_low: "Percent above the low, e.g. 5",
};

export function AlertForm({ symbols }: { symbols: string[] }) {
  const [state, formAction, pending] = useActionState(
    createAlertAction,
    INITIAL,
  );
  const [kind, setKind] = useState<AlertKind>("price_below");

  const showThreshold = needsThreshold(kind);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Condition
          </span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertKind)}
            className={inputClass}
          >
            {(Object.keys(ALERT_LABELS) as AlertKind[]).map((k) => (
              <option key={k} value={k}>
                {ALERT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Symbol{!showThreshold && " (optional)"}
          </span>
          <input
            name="symbol"
            list="alert-symbol-options"
            placeholder={showThreshold ? "MEBL" : "Any holding"}
            className={inputClass}
          />
          <datalist id="alert-symbol-options">
            {symbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Threshold
          </span>
          <input
            name="threshold"
            type="number"
            step="any"
            disabled={!showThreshold}
            placeholder={showThreshold ? "0.00" : "n/a"}
            className={`${inputClass} disabled:opacity-40`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Note
          </span>
          <input name="note" placeholder="Optional" className={inputClass} />
        </label>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {showThreshold
          ? THRESHOLD_HINT[kind]
          : "Leave the symbol blank to watch every position you hold — that is usually what you want for this rule."}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Saving…" : "Create alert"}
        </button>
        {state.message && (
          <span
            className={`text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
          >
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";
