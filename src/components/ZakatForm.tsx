"use client";

import { useActionState, useState } from "react";
import { saveZakatSettingsAction, type ActionState } from "@/app/actions";
import { GRAMS_PER_TOLA } from "@/lib/zakat-constants";
import { money } from "@/lib/format";

const INITIAL: ActionState = { ok: false, message: "" };

export interface ZakatFormHolding {
  symbol: string;
  name: string | null;
  marketValue: number;
  zakatablePct: number;
}

export function ZakatForm({
  settings,
  holdings,
}: {
  settings: {
    nisabBasis: "gold" | "silver";
    metalPricePerGram: number;
    year: "lunar" | "solar";
    otherAssets: number;
    liabilities: number;
    defaultZakatablePct: number;
  };
  holdings: ZakatFormHolding[];
}) {
  const [state, formAction, pending] = useActionState(
    saveZakatSettingsAction,
    INITIAL,
  );
  const [basis, setBasis] = useState(settings.nisabBasis);
  const [perGram, setPerGram] = useState(
    settings.metalPricePerGram ? String(settings.metalPricePerGram) : "",
  );

  const perGramNumber = Number(perGram) || 0;
  const nisabGrams = basis === "gold" ? 87.48 : 612.36;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Nisab standard"
          hint="Which threshold your method uses"
        >
          <select
            name="nisabBasis"
            value={basis}
            onChange={(e) => setBasis(e.target.value as "gold" | "silver")}
            className={inputClass}
          >
            <option value="silver">Silver — 612.36 g (52.5 tola)</option>
            <option value="gold">Gold — 87.48 g (7.5 tola)</option>
          </select>
        </Field>

        <Field
          label={`${basis === "gold" ? "Gold" : "Silver"} price, PKR per gram`}
          hint={
            perGramNumber > 0
              ? `≈ ${money(perGramNumber * GRAMS_PER_TOLA)} per tola · nisab ${money(perGramNumber * nisabGrams)}`
              : "Enter today's rate — prices change daily, so nothing is assumed"
          }
        >
          <input
            name="metalPricePerGram"
            type="number"
            step="any"
            min="0"
            value={perGram}
            onChange={(e) => setPerGram(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>

        <Field label="Zakat year" hint="2.5% lunar, 2.577% solar">
          <select
            name="year"
            defaultValue={settings.year}
            className={inputClass}
          >
            <option value="lunar">Lunar (Hijri) — 2.5%</option>
            <option value="solar">Solar — 2.577%</option>
          </select>
        </Field>

        <Field
          label="Other zakatable assets, PKR"
          hint="Cash, bank balances, gold held outside this portfolio"
        >
          <input
            name="otherAssets"
            type="number"
            step="any"
            min="0"
            defaultValue={settings.otherAssets || ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>

        <Field
          label="Deductible liabilities, PKR"
          hint="Debts your method allows you to deduct"
        >
          <input
            name="liabilities"
            type="number"
            step="any"
            min="0"
            defaultValue={settings.liabilities || ""}
            placeholder="0.00"
            className={inputClass}
          />
        </Field>

        <Field
          label="Default zakatable share, %"
          hint="100 assesses full market value; lower it if your method assesses only underlying assets"
        >
          <input
            name="defaultZakatablePct"
            type="number"
            step="any"
            min="0"
            max="100"
            defaultValue={settings.defaultZakatablePct}
            className={inputClass}
          />
        </Field>
      </div>

      {holdings.length > 0 && (
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <summary className="cursor-pointer text-sm font-medium">
            Per-holding zakatable share ({holdings.length})
          </summary>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Override the default for individual companies — for example if you
            treat one position as held for resale and another as a long-term
            holding.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {holdings.map((h) => (
              <label key={h.symbol} className="flex items-center gap-2 text-sm">
                <span className="w-20 shrink-0 font-medium">{h.symbol}</span>
                <input
                  name={`zakatable_${h.symbol}`}
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  defaultValue={h.zakatablePct}
                  className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  % of {money(h.marketValue)}
                </span>
              </label>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "Saving…" : "Save and recalculate"}
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
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </span>
      )}
    </label>
  );
}
