"use client";

import { useActionState, useState } from "react";
import { addTransactionAction, type ActionState } from "@/app/actions";
import { todayPkt } from "@/lib/dates";

const INITIAL: ActionState = { ok: false, message: "" };

const TYPE_HINTS: Record<string, string> = {
  buy: "Price paid per share. Fees add to your cost basis.",
  sell: "Price received per share. Realised P&L uses your average cost.",
  dividend: "Quantity = shares held, price = PKR per share. Fees = tax withheld.",
  bonus: "Quantity = bonus shares received. Price stays 0 — it dilutes average cost.",
  rights: "Quantity = shares subscribed, price = subscription price.",
};

export function TransactionForm({ symbols }: { symbols: string[] }) {
  const [state, formAction, pending] = useActionState(
    addTransactionAction,
    INITIAL,
  );
  const [type, setType] = useState("buy");

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Symbol">
          <input
            name="symbol"
            list="symbol-options"
            required
            placeholder="MEBL"
            className={inputClass}
          />
          <datalist id="symbol-options">
            {symbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Type">
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={inputClass}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="dividend">Dividend</option>
            <option value="bonus">Bonus shares</option>
            <option value="rights">Rights issue</option>
          </select>
        </Field>

        <Field label="Date">
          <input
            name="date"
            type="date"
            required
            defaultValue={todayPkt()}
            className={inputClass}
          />
        </Field>

        <Field label="Quantity">
          <input
            name="quantity"
            type="number"
            step="any"
            min="0"
            required
            placeholder="100"
            className={inputClass}
          />
        </Field>

        <Field label={type === "dividend" ? "PKR per share" : "Price"}>
          <input
            name="price"
            type="number"
            step="any"
            min="0"
            required
            defaultValue={type === "bonus" ? "0" : undefined}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>

        <Field label={type === "dividend" ? "Tax withheld" : "Fees"}>
          <input
            name="fees"
            type="number"
            step="any"
            min="0"
            placeholder="0.00"
            className={inputClass}
          />
        </Field>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {TYPE_HINTS[type]}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Saving…" : "Add transaction"}
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}
