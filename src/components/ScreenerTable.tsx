"use client";

import { useMemo, useState } from "react";
import type { ConstituentView } from "@/lib/market";
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
  | "volume"
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
  { key: "volume", label: "Volume", align: "right" },
  { key: "drawdownFrom52wPct", label: "Off 52w hi", align: "right" },
];

export function ScreenerTable({ rows }: { rows: ConstituentView[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("indexWeightPct");
  const [ascending, setAscending] = useState(false);
  const [sector, setSector] = useState("all");
  const [query, setQuery] = useState("");
  const [maxPe, setMaxPe] = useState("");

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

  function toggleSort(key: SortKey) {
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
            onChange={(e) => setQuery(e.target.value)}
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
            onChange={(e) => setSector(e.target.value)}
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
            onChange={(e) => setMaxPe(e.target.value)}
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
            {filtered.map((r) => (
              <tr
                key={r.symbol}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <Td>
                  <div className="flex flex-col">
                    <SymbolLink symbol={r.symbol} />
                    <span className="max-w-[180px] truncate text-xs text-slate-500 dark:text-slate-400">
                      {r.name ?? sectorLabel(r.sectorName, r.sectorCode)}
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
                <Td align="right">{count(r.volume)}</Td>
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
    </div>
  );
}
