"use client";

import { useActionState } from "react";
import { addToWatchlistAction, type ActionState } from "@/app/actions";

const INITIAL: ActionState = { ok: false, message: "" };

export function WatchlistForm({ symbols }: { symbols: string[] }) {
  const [state, formAction, pending] = useActionState(
    addToWatchlistAction,
    INITIAL,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">Symbol</span>
        <input
          name="symbol"
          list="watchlist-symbols"
          required
          placeholder="MEBL"
          className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <datalist id="watchlist-symbols">
          {symbols.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Why are you watching it?
        </span>
        <input
          name="note"
          placeholder="Optional"
          className="w-72 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? "Adding…" : "Add"}
      </button>

      {state.message && (
        <span
          className={`pb-1.5 text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
