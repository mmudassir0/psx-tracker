"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { importTransactionsAction, type ImportState } from "@/app/actions";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  guessDateOrder,
  guessMapping,
  normaliseRow,
  parseCsv,
  type ColumnMapping,
  type DateOrder,
} from "@/lib/csv-import";

const INITIAL: ImportState = { ok: false, message: "" };
const selectClass =
  "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900";
const PREVIEW_ROWS = 15;

export function CsvImporter({
  portfolios,
  defaultPortfolioId,
}: {
  portfolios: { id: string; name: string }[];
  defaultPortfolioId: string;
}) {
  const [state, formAction, pending] = useActionState(importTransactionsAction, INITIAL);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [overrides, setOverrides] = useState<Partial<ColumnMapping>>({});
  const [orderOverride, setOrderOverride] = useState<DateOrder | null>(null);

  const rows = useMemo(() => (text ? parseCsv(text) : []), [text]);
  const headers = hasHeader ? (rows[0] ?? []) : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  const guessed = useMemo(() => guessMapping(hasHeader ? (rows[0] ?? []) : []), [rows, hasHeader]);
  const mapping = { ...guessed, ...overrides } as ColumnMapping;
  const dateOrder =
    orderOverride ?? guessDateOrder(body.slice(0, 50).map((r) => (mapping.date >= 0 ? r[mapping.date] ?? "" : "")));

  // Cheap even at the row limit, so recomputed on every render.
  const results = body.map((r) => normaliseRow(r, mapping, dateOrder));
  const okCount = results.filter((r) => r.ok).length;
  const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] < 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
          Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setOverrides({});
              setOrderOverride(null);
              setText(await file.text());
            }}
          />
        </label>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {fileName ?? "or paste the CSV below"}
        </span>
      </div>

      {!fileName && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={"Date,Symbol,Type,Quantity,Price,Commission\n05/10/2026,MEBL,Buy,100,548.79,150"}
          className="w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
        />
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-sm font-medium">Which column is which?</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {IMPORT_FIELDS.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {field.label}
                    {field.required ? "" : " (optional)"}
                  </span>
                  <select
                    value={mapping[field.key]}
                    onChange={(e) => setOverrides((o) => ({ ...o, [field.key]: Number(e.target.value) }))}
                    className={selectClass}
                  >
                    <option value={-1}>{field.required ? "— choose —" : "— none —"}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500 dark:text-slate-400">Dates like 05/10/2026 mean</span>
                <select value={dateOrder} onChange={(e) => setOrderOverride(e.target.value as DateOrder)} className={selectClass}>
                  <option value="dmy">5 October (day first)</option>
                  <option value="mdy">May 10 (month first)</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              First row is a header
            </label>
            {mapping.type < 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No buy/sell column chosen: positive quantities import as buys, negative ones as sells.
              </p>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left dark:bg-slate-800/50">
                <tr>
                  {["Row", "Date", "Symbol", "Type", "Qty", "Price", "Fees", "Status"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {results.slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-2 py-1 text-slate-500">{i + 1 + (hasHeader ? 1 : 0)}</td>
                    {r.ok ? (
                      <>
                        <td className="px-2 py-1">{r.tx.date}</td>
                        <td className="px-2 py-1 font-medium">{r.tx.symbol}</td>
                        <td className="px-2 py-1">{r.tx.type}</td>
                        <td className="px-2 py-1">{r.tx.quantity}</td>
                        <td className="px-2 py-1">{r.tx.price}</td>
                        <td className="px-2 py-1">{r.tx.fees}</td>
                        <td className="px-2 py-1 text-emerald-600 dark:text-emerald-400">OK</td>
                      </>
                    ) : (
                      <td colSpan={7} className="px-2 py-1 text-rose-600 dark:text-rose-400">{r.error}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {results.length > PREVIEW_ROWS && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Showing the first {PREVIEW_ROWS} of {results.length} rows.
            </p>
          )}

          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="csv" value={text} />
            <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
            <input type="hidden" name="dateOrder" value={dateOrder} />
            <input type="hidden" name="hasHeader" value={String(hasHeader)} />
            {portfolios.length > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                Into
                <select name="portfolioId" defaultValue={defaultPortfolioId} className={selectClass}>
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="portfolioId" value={defaultPortfolioId} />
            )}
            <button
              type="submit"
              disabled={pending || missing.length > 0 || okCount === 0 || body.length > MAX_IMPORT_ROWS}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {pending ? "Importing…" : `Import ${okCount} of ${body.length} rows`}
            </button>
            {missing.length > 0 && (
              <span className="text-sm text-amber-700 dark:text-amber-400">
                Choose a column for: {missing.map((m) => m.label).join(", ")}
              </span>
            )}
            {body.length > MAX_IMPORT_ROWS && (
              <span className="text-sm text-rose-600 dark:text-rose-400">
                Up to {MAX_IMPORT_ROWS} rows per import; split the file.
              </span>
            )}
          </form>
        </>
      )}

      {state.message && (
        <p role="status" className={`text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
          {state.message}{" "}
          {state.ok && (
            <Link href="/portfolio" className="underline">
              View portfolio
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
