"use client";

import { useActionState, useState } from "react";
import {
  addFundTransactionAction,
  createFundAction,
  recordFundNavAction,
  type ActionState,
} from "@/app/actions";
import { todayPkt } from "@/lib/dates";

const INITIAL: ActionState = { ok: false, message: "" };
const inputClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";
const buttonClass =
  "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

/** MUFAP's category names, offered as suggestions (free text is allowed). */
const CATEGORIES = [
  "Money Market",
  "Shariah Compliant Money Market",
  "Income",
  "Shariah Compliant Income",
  "Equity",
  "Shariah Compliant Equity",
  "Balanced",
  "Asset Allocation",
  "Shariah Compliant Asset Allocation",
  "Fixed Rate / Return",
  "Exchange Traded Fund",
  "Voluntary Pension Scheme",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Status({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <span className={`text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
      {state.message}
    </span>
  );
}

export function AddFundForm() {
  const [state, action, pending] = useActionState(createFundAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fund name">
          <input name="name" required placeholder="Meezan Cash Fund" className={inputClass} />
        </Field>
        <Field label="Fund manager (AMC)">
          <input name="amc" placeholder="Al Meezan Investment" className={inputClass} />
        </Field>
        <Field label="Category">
          <input name="category" list="fund-categories" placeholder="Money Market" className={inputClass} />
          <datalist id="fund-categories">
            {CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
          <input type="checkbox" name="shariah" /> Shariah-compliant
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Saving…" : "Add fund"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function FundTransactionForm({ funds }: { funds: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addFundTransactionAction, INITIAL);
  const [type, setType] = useState<"buy" | "redeem" | "dividend">("buy");
  const [units, setUnits] = useState("");
  const [nav, setNav] = useState("");
  const computed = Number(units) * Number(nav);

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Fund">
          <select name="fundId" required className={inputClass}>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputClass}>
            <option value="buy">Purchase</option>
            <option value="redeem">Redemption</option>
            <option value="dividend">Cash dividend</option>
          </select>
        </Field>
        <Field label="Date">
          <input name="date" type="date" required defaultValue={todayPkt()} className={inputClass} />
        </Field>
        {type !== "dividend" && (
          <>
            <Field label="Units">
              <input name="units" type="number" step="any" min="0" required value={units}
                onChange={(e) => setUnits(e.target.value)} className={inputClass} />
            </Field>
            <Field label="NAV per unit (PKR)">
              <input name="nav" type="number" step="any" min="0" required value={nav}
                onChange={(e) => setNav(e.target.value)} className={inputClass} />
            </Field>
          </>
        )}
        <Field label={type === "dividend" ? "Amount received (PKR)" : type === "buy" ? "Amount paid incl. load (blank = units × NAV)" : "Amount received (blank = units × NAV)"}>
          <input name="amount" type="number" step="any" min="0" required={type === "dividend"}
            placeholder={computed > 0 ? computed.toFixed(2) : ""} className={inputClass} />
        </Field>
        <Field label="Note">
          <input name="note" placeholder="Optional" className={inputClass} />
        </Field>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Dividends paid as extra units (reinvested) are a purchase at that day&apos;s NAV.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Saving…" : "Record"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function FundNavForm({ funds }: { funds: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(recordFundNavAction, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fund">
          <select name="fundId" required className={inputClass}>
            {funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="NAV date">
          <input name="date" type="date" required defaultValue={todayPkt()} className={inputClass} />
        </Field>
        <Field label="NAV per unit (PKR)">
          <input name="nav" type="number" step="any" min="0" required className={inputClass} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>{pending ? "Saving…" : "Save NAV"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}
