"use client";

import { useMemo, useState } from "react";
import type { ScreenerRow } from "@/lib/screener-row";
import { SymbolLink, TableWrap, Th, Td } from "@/components/ui";
import {
  money,
  pct,
  count,
  compactPkr,
  toneClass,
  sectorLabel,
} from "@/lib/format";

type SortKey =
  | "symbol"
  | "close"
  | "changePct"
  | "indexWeightPct"
  | "peTtm"
  | "avgVolume30d"
  | "ytdChangePct"
  | "year1ChangePct"
  | "drawdownFrom52wPct"
  | "dividendYieldPct"
  | "epsGrowthPct"
  | "netMarginPct"
  | "marketCap";

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" }[] = [
  { key: "symbol", label: "Symbol", align: "left" },
  { key: "close", label: "Close", align: "right" },
  { key: "changePct", label: "Day", align: "right" },
  { key: "ytdChangePct", label: "YTD", align: "right" },
  { key: "year1ChangePct", label: "1Y", align: "right" },
  { key: "peTtm", label: "P/E", align: "right" },
  { key: "dividendYieldPct", label: "Div yield", align: "right" },
  { key: "epsGrowthPct", label: "EPS growth", align: "right" },
  { key: "netMarginPct", label: "Net margin", align: "right" },
  { key: "indexWeightPct", label: "Weight", align: "right" },
  { key: "marketCap", label: "Mkt cap", align: "right" },
  { key: "avgVolume30d", label: "Avg vol 30D", align: "right" },
  { key: "drawdownFrom52wPct", label: "Off 52w hi", align: "right" },
];

const PAGE_SIZE = 50;

function roundOrNull(n: number | null): number | null {
  return n == null ? null : Math.round(n);
}

export function ScreenerTable({ rows }: { rows: ScreenerRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("indexWeightPct");
  const [ascending, setAscending] = useState(false);
  const [sector, setSector] = useState("all");
  const [query, setQuery] = useState("");
  const [maxPe, setMaxPe] = useState("");
  const [page, setPage] = useState(0);

  const sectors = useMemo(() => {
    const set = new Set(
      rows.map((r) => sectorLabel(r.sectorName, r.sectorCode)),
    );
    return ["all", ...[...set].sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const peLimit = maxPe.trim() === "" ? null : Number(maxPe);
    const needle = query.trim().toUpperCase();

    const list = rows.filter((r) => {
      if (sector !== "all" && sectorLabel(r.sectorName, r.sectorCode) !== sector)
        return false;
      if (
        needle &&
        !r.symbol.includes(needle) &&
        !(r.name ?? "").toUpperCase().includes(needle)
      )
        return false;
      // A null P/E (loss-making or unreported) can't satisfy a P/E ceiling.
      if (peLimit != null && Number.isFinite(peLimit)) {
        if (r.peTtm == null || r.peTtm > peLimit) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortKey === "symbol") {
        return ascending
          ? a.symbol.localeCompare(b.symbol)
          : b.symbol.localeCompare(a.symbol);
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      // Missing values always sort last regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return ascending ? av - bv : bv - av;
    });
  }, [rows, sector, query, maxPe, sortKey, ascending]);

  // A filter that shrinks the list never leaves you on an empty page.
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setPage(0);
    if (key === sortKey) {
      setAscending((prev) => !prev);
    } else {
      setSortKey(key);
      setAscending(key === "symbol");
    }
  }

  return (
    <div>
      {/* One filter row above everything it scopes. */}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Search
          </span>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Symbol or company"
            className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Sector
          </span>
          <select
            value={sector}
            onChange={(e) => {
              setSector(e.target.value);
              setPage(0);
            }}
            className="w-52 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          >
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All sectors" : s}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Max P/E
          </span>
          <input
            value={maxPe}
            onChange={(e) => {
              setMaxPe(e.target.value);
              setPage(0);
            }}
            inputMode="decimal"
            placeholder="any"
            className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>

        <span className="pb-1.5 text-xs text-slate-500 dark:text-slate-400">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <Th key={col.key} align={col.align}>
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 uppercase hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span aria-hidden>{ascending ? "▲" : "▼"}</span>
                    )}
                  </button>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {shown.map((r) => (
              <tr
                key={r.symbol}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <Td>
                  <div className="flex flex-col">
                    <SymbolLink symbol={r.symbol} />
                    <span className="max-w-[180px] truncate text-xs text-slate-500 dark:text-slate-400">
                      {r.name ?? (r.sectorName ?? r.symbol)}
                    </span>
                  </div>
                </Td>
                <Td align="right">{money(r.close)}</Td>
                <Td align="right" className={toneClass(r.changePct)}>
                  {pct(r.changePct)}
                </Td>
                <Td align="right" className={toneClass(r.ytdChangePct)}>
                  {pct(r.ytdChangePct)}
                </Td>
                <Td align="right" className={toneClass(r.year1ChangePct)}>
                  {pct(r.year1ChangePct)}
                </Td>
                <Td align="right">
                  {r.peTtm != null ? r.peTtm.toFixed(2) : "—"}
                </Td>
                <Td align="right">
                  {r.dividendYieldPct != null ? (
                    <span title={`PKR ${r.dividendPerShare?.toFixed(2)}/share over 12m`}>
                      {r.dividendYieldPct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Td>
                <Td align="right" className={toneClass(r.epsGrowthPct)}>
                  {pct(r.epsGrowthPct, 1)}
                </Td>
                <Td align="right">{pct(r.netMarginPct, 1, false)}</Td>
                <Td align="right">{pct(r.indexWeightPct, 2, false)}</Td>
                <Td align="right">{compactPkr(r.marketCap)}</Td>
                <Td align="right">{count(roundOrNull(r.avgVolume30d))}</Td>
                <Td align="right" className="text-slate-500">
                  {pct(r.drawdownFrom52wPct, 1, false)}
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="py-8 text-center text-sm text-slate-500"
                >
                  No constituents match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrap>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {current * PAGE_SIZE + 1}–{Math.min(filtered.length, (current + 1) * PAGE_SIZE)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              ← Previous
            </button>
            <span className="px-2 text-xs text-slate-500 dark:text-slate-400">
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
