"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { saveScreenAction, type ActionState } from "@/app/actions";
import {
  BUILDER_METRICS,
  OP_LABELS,
  previewMatches,
  type PreviewRow,
  type ScreenOp,
  type ScreenMetric,
  type ScreenRule,
  type ScreenUniverse,
} from "@/lib/screen-types";
import { compactPkr } from "@/lib/format";

const INITIAL: ActionState = { ok: false, message: "" };

/**
 * Rule builder with a live match count.
 *
 * The whole market is passed down as slim rows and filtered in the browser, so
 * the count updates as you drag a threshold instead of after a round trip.
 * Saving still re-evaluates server-side — the preview is a convenience, never
 * the source of truth.
 */
export function ScreenBuilder({
  rows,
  existing,
}: {
  rows: PreviewRow[];
  existing?: {
    id: string;
    name: string;
    description: string;
    rules: ScreenRule[];
    universe: ScreenUniverse;
  };
}) {
  const [state, formAction, pending] = useActionState(
    saveScreenAction,
    INITIAL,
  );

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [universe, setUniverse] = useState<ScreenUniverse>(
    existing?.universe ?? "all",
  );
  const [rules, setRules] = useState<ScreenRule[]>(
    existing?.rules?.length
      ? existing.rules
      : [{ metric: "dividendYieldPct", op: "gte", value: 8 }],
  );

  const matches = useMemo(
    () => previewMatches(rows, rules, universe),
    [rows, rules, universe],
  );

  function updateRule(index: number, patch: Partial<ScreenRule>) {
    setRules((prev) =>
      prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  }

  function addRule() {
    setRules((prev) => [
      ...prev,
      { metric: "peTtm", op: "lte", value: 10 },
    ]);
  }

  function removeRule(index: number) {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }

  const universeSize =
    universe === "shariah" ? rows.filter((r) => r.shariah).length : rows.length;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      <input type="hidden" name="universe" value={universe} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            placeholder="Shariah value with growth"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Description</span>
          <input
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            placeholder="What this screen is looking for"
            className={inputClass}
          />
        </label>
      </div>

      <div>
        <span className="text-xs font-medium">Universe</span>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={() => setUniverse("all")}
            className={chipClass(universe === "all")}
          >
            Whole market
          </button>
          <button
            type="button"
            onClick={() => setUniverse("shariah")}
            className={chipClass(universe === "shariah")}
          >
            Shariah-screened only
          </button>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">
            Criteria — all must hold
          </span>
          <button
            type="button"
            onClick={addRule}
            disabled={rules.length >= 8}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-slate-600"
          >
            + Add rule
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {rules.map((rule, index) => {
            const meta = BUILDER_METRICS.find((m) => m.metric === rule.metric);
            return (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800"
              >
                <select
                  value={rule.metric}
                  onChange={(e) =>
                    updateRule(index, {
                      metric: e.target.value as ScreenMetric,
                    })
                  }
                  className={`${inputClass} w-56`}
                >
                  {BUILDER_METRICS.map((m) => (
                    <option key={m.metric} value={m.metric}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <select
                  value={rule.op}
                  onChange={(e) =>
                    updateRule(index, { op: e.target.value as ScreenOp })
                  }
                  className={`${inputClass} w-32`}
                >
                  {(Object.keys(OP_LABELS) as ScreenOp[]).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  step={meta?.step ?? 1}
                  value={rule.value}
                  onChange={(e) =>
                    updateRule(index, { value: Number(e.target.value) })
                  }
                  className={`${inputClass} w-36`}
                />

                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {meta?.unit === "PKR"
                    ? compactPkr(rule.value)
                    : (meta?.unit ?? "")}
                </span>

                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  disabled={rules.length <= 1}
                  className="ml-auto text-xs text-rose-600 disabled:opacity-30 dark:text-rose-400"
                  aria-label="Remove rule"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live preview — the whole point of building rather than guessing. */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Live preview</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            of {universeSize} symbols
          </span>
        </div>

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight">
            {matches.length}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {matches.length === 1 ? "match" : "matches"}
          </span>
        </div>

        {matches.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Nothing matches. Loosen a threshold, or check that the metric is one
            most companies actually report.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {matches.slice(0, 30).map((m) => (
              <span
                key={m.symbol}
                title={m.name ?? undefined}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800"
              >
                {m.symbol}
              </span>
            ))}
            {matches.length > 30 && (
              <span className="px-1 py-0.5 text-xs text-slate-500">
                +{matches.length - 30} more
              </span>
            )}
          </div>
        )}

        {matches.length > 120 && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            A screen matching {matches.length} names is not narrowing much —
            consider tightening it.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || rules.length === 0}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Saving…" : existing ? "Save changes" : "Create screen"}
        </button>
        <Link href="/screens" className="text-sm underline underline-offset-2">
          Cancel
        </Link>
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
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

function chipClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-400";
}
