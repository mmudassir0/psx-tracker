"use client";

import { useState, useTransition } from "react";
import { saveDashboardCardsAction } from "@/app/actions";
import { DASHBOARD_CARDS, type DashboardCardId } from "@/lib/dashboard-layout";

const LABELS = new Map<string, string>(DASHBOARD_CARDS.map((c) => [c.id, c.label]));

/** "Choose cards": show or hide each dashboard card and move it up or down. */
export function DashboardCustomizer({
  order: initialOrder,
  hidden: initialHidden,
}: {
  order: DashboardCardId[];
  hidden: DashboardCardId[];
}) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(initialOrder);
  const [hidden, setHidden] = useState(new Set(initialHidden));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    setSaved(false);
  };

  const toggle = (id: DashboardCardId) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    setSaved(false);
  };

  const save = (nextOrder: DashboardCardId[], nextHidden: Set<DashboardCardId>) =>
    startTransition(async () => {
      await saveDashboardCardsAction({ order: nextOrder, hidden: [...nextHidden] });
      setSaved(true);
    });

  const reset = () => {
    const defaults = DASHBOARD_CARDS.map((c) => c.id) as DashboardCardId[];
    setOrder(defaults);
    setHidden(new Set());
    save(defaults, new Set());
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
      >
        Choose cards
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Tick the cards to show and use the arrows to order them.
          </p>
          <ul className="flex flex-col gap-1">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggle(id)} />
                  <span className={hidden.has(id) ? "text-slate-400" : ""}>{LABELS.get(id)}</span>
                </label>
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${LABELS.get(id)} up`}
                  className="rounded px-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-700"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  aria-label={`Move ${LABELS.get(id)} down`}
                  className="rounded px-1.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:hover:bg-slate-700"
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={reset} disabled={pending} className="text-xs text-slate-500 underline-offset-2 hover:underline">
              Reset
            </button>
            <span className="text-xs text-emerald-600 dark:text-emerald-400">{saved && !pending ? "Saved" : ""}</span>
            <button
              type="button"
              onClick={() => save(order, hidden)}
              disabled={pending}
              className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
