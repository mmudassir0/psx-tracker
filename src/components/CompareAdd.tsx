"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rankSymbols, type SymbolEntry } from "@/lib/symbol-search";

/** Type to add a stock to the comparison. */
export function CompareAdd({ current, max }: { current: string[]; max: number }) {
  const router = useRouter();
  const [list, setList] = useState<SymbolEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(
    () => (list ? rankSymbols(list, query).filter((r) => !current.includes(r.s)).slice(0, 6) : []),
    [list, query, current],
  );

  if (current.length >= max) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">Up to {max} stocks. Remove one to add another.</p>;
  }

  const add = (symbol: string) => {
    setQuery("");
    setOpen(false);
    router.push(`/compare?s=${[...current, symbol].join(",")}`);
  };

  return (
    <div className="relative w-full max-w-xs">
      <input
        type="search"
        aria-label="Add a stock to compare"
        placeholder="Add a stock…"
        autoComplete="off"
        value={query}
        onFocus={() => {
          setOpen(true);
          if (!list) fetch("/api/symbols").then((r) => r.json()).then(setList).catch(() => setList([]));
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            add(results[0].s);
          }
        }}
        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      {open && query.trim() && (
        <ul className="absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-slate-500">{list ? "No match." : "Loading…"}</li>
          ) : (
            results.map((r) => (
              <li
                key={r.s}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(r.s);
                }}
                className="cursor-pointer rounded-md px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <span className="text-sm font-semibold">{r.s}</span>{" "}
                <span className="text-xs text-slate-500 dark:text-slate-400">{r.n ?? ""}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
