"use client";

import { useActionState, useState } from "react";
import {
  createPortfolioAction,
  deletePortfolioAction,
  renamePortfolioAction,
  type ActionState,
} from "@/app/actions";

const INITIAL: ActionState = { ok: false, message: "" };
const inputClass =
  "w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900";
const smallButton =
  "rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

function Message({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <span className={`text-xs ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      {state.message}
    </span>
  );
}

export function NewPortfolioForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createPortfolioAction, INITIAL);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={smallButton}>
        + New portfolio
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input name="name" required maxLength={40} autoFocus placeholder="e.g. Long-term" className={inputClass} />
      <button type="submit" disabled={pending} className={smallButton}>
        {pending ? "Creating…" : "Create"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">
        Cancel
      </button>
      <Message state={state} />
    </form>
  );
}

/** Rename or delete the portfolio currently being viewed. */
export function EditPortfolioForm({ portfolioId, name }: { portfolioId: string; name: string }) {
  const [renameState, renameAction, renaming] = useActionState(renamePortfolioAction, INITIAL);
  const [deleteState, deleteAction, deleting] = useActionState(deletePortfolioAction, INITIAL);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={renameAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="portfolioId" value={portfolioId} />
        <input name="name" required maxLength={40} defaultValue={name} aria-label="Portfolio name" className={inputClass} />
        <button type="submit" disabled={renaming} className={smallButton}>
          {renaming ? "Saving…" : "Rename"}
        </button>
      </form>
      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (!confirm(`Delete the portfolio "${name}"? Only an empty portfolio can be deleted.`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="portfolioId" value={portfolioId} />
        <button type="submit" disabled={deleting} className="rounded-md px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/40">
          Delete
        </button>
      </form>
      <Message state={renameState} />
      <Message state={deleteState} />
    </div>
  );
}
