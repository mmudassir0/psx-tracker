"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { rankSymbols, type SymbolEntry as Entry } from "@/lib/symbol-search";

/**
 * Find any listed stock by symbol or company name. The list loads once, on
 * first focus. Press "/" anywhere to jump here.
 */
export function SymbolSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const load = () => {
    if (list || failed) return;
    fetch("/api/symbols")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Entry[]) => setList(rows))
      .catch(() => setFailed(true));
  };

  // "/" focuses the box, unless you're already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => (list ? rankSymbols(list, query) : []), [list, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  const go = (symbol: string) => {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/symbol/${encodeURIComponent(symbol)}`);
  };

  const showList = open && query.trim() !== "";

  return (
    <div className="relative w-full sm:w-60">
      <label htmlFor="symbol-search" className="sr-only">
        Search stocks
      </label>
      <input
        ref={inputRef}
        id="symbol-search"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls="symbol-search-results"
        aria-activedescendant={showList && results[current] ? `sym-${results[current].s}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Search stocks  ( / )"
        value={query}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(Math.min(current + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = results[current];
            if (pick) go(pick.s);
            else if (query.trim()) go(query.trim().toUpperCase());
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900"
      />
      {showList && (
        <ul
          id="symbol-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {list == null ? (
            <li className="px-2 py-1.5 text-sm text-slate-500">{failed ? "Couldn't load the stock list." : "Loading…"}</li>
          ) : results.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-slate-500">No stock matches &ldquo;{query.trim()}&rdquo;.</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.s}
                id={`sym-${r.s}`}
                role="option"
                aria-selected={i === current}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(r.s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-md px-2 py-1.5 ${i === current ? "bg-slate-100 dark:bg-slate-700" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{r.s}</span>
                  {r.sec && <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">{r.sec}</span>}
                </div>
                {r.n && <div className="truncate text-xs text-slate-600 dark:text-slate-300">{r.n}</div>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
