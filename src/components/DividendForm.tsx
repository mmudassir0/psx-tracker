"use client";

import { useActionState, useState } from "react";
import { recordDividendAction, type ActionState } from "@/app/actions";
import { todayPkt } from "@/lib/dates";

const INITIAL: ActionState = { ok: false, message: "" };
const inputClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";

const RATES = { filer: 0.15, nonfiler: 0.3, none: 0 } as const;

/**
 * Record a dividend received. Quantity defaults to what the portfolio held on
 * the date; tax defaults to the filer rate. The preview shows the arithmetic
 * before anything is saved.
 */
export function DividendForm({
  symbols,
  portfolios,
  defaultPortfolioId,
}: {
  /** Symbols this user has held, most relevant first. */
  symbols: string[];
  portfolios: { id: string; name: string }[];
  defaultPortfolioId?: string;
}) {
  const [state, formAction, pending] = useActionState(recordDividendAction, INITIAL);
  const [perShare, setPerShare] = useState("");
  const [quantity, setQuantity] = useState("");
  const [taxMode, setTaxMode] = useState<"filer" | "nonfiler" | "none" | "custom">("filer");
  const [taxAmount, setTaxAmount] = useState("");

  const gross = Number(perShare) * Number(quantity);
  const tax =
    taxMode === "custom" ? Number(taxAmount) || 0 : gross * RATES[taxMode];
  const showPreview = Number(perShare) > 0 && Number(quantity) > 0;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {portfolios.length > 1 ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">Portfolio</span>
            <select name="portfolioId" defaultValue={defaultPortfolioId ?? portfolios[0]?.id} className={inputClass}>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        ) : (
          defaultPortfolioId && <input type="hidden" name="portfolioId" value={defaultPortfolioId} />
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Symbol</span>
          <input name="symbol" list="dividend-symbols" required placeholder="FFC" className={inputClass} />
          <datalist id="dividend-symbols">
            {symbols.map((s) => <option key={s} value={s} />)}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Date received (or book closure)</span>
          <input name="date" type="date" required defaultValue={todayPkt()} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Dividend per share (PKR)</span>
          <input name="perShare" type="number" step="any" min="0" required placeholder="8.50"
            value={perShare} onChange={(e) => setPerShare(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Shares (blank = what you held then)</span>
          <input name="quantity" type="number" step="any" min="0" placeholder="auto"
            value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Tax withheld</span>
          <select name="taxMode" value={taxMode}
            onChange={(e) => setTaxMode(e.target.value as typeof taxMode)} className={inputClass}>
            <option value="filer">15% (filer)</option>
            <option value="nonfiler">30% (non-filer)</option>
            <option value="none">None</option>
            <option value="custom">Exact amount…</option>
          </select>
        </label>
        {taxMode === "custom" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">Tax withheld (PKR)</span>
            <input name="taxAmount" type="number" step="any" min="0" required
              value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} className={inputClass} />
          </label>
        )}
      </div>

      {showPreview && (
        <p className="tabular text-xs text-slate-600 dark:text-slate-400">
          Gross {gross.toLocaleString("en-PK", { maximumFractionDigits: 2 })} − tax{" "}
          {tax.toLocaleString("en-PK", { maximumFractionDigits: 2 })} = net{" "}
          <span className="font-medium">{(gross - tax).toLocaleString("en-PK", { maximumFractionDigits: 2 })}</span> PKR
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {pending ? "Saving…" : "Record dividend"}
        </button>
        {state.message && (
          <span className={`text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
