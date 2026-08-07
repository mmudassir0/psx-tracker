"use client";

import { useState } from "react";
import type { PairStat } from "@/lib/risk";

/**
 * Correlation heatmap.
 *
 * Correlation is a polarity scale centred on zero, so this uses the diverging
 * ramp (cool = moves together, warm = moves opposite) with a neutral midpoint
 * — not a rainbow, and not the red-green pair. Every cell prints its own
 * value, so colour is never the only encoding, and the table view below
 * carries the same numbers with overlap counts.
 */
export function CorrelationMatrix({
  symbols,
  matrix,
  minOverlap,
}: {
  symbols: string[];
  matrix: PairStat[];
  minOverlap: number;
}) {
  const [hover, setHover] = useState<{ a: string; b: string } | null>(null);

  if (symbols.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        At least two holdings with enough price history are needed.
      </p>
    );
  }

  const lookup = new Map<string, PairStat>();
  for (const p of matrix) {
    lookup.set(`${p.a}|${p.b}`, p);
    lookup.set(`${p.b}|${p.a}`, p);
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-xs">
          <thead>
            <tr>
              <th />
              {symbols.map((s) => (
                <th
                  key={s}
                  className="px-1 pb-1 text-center font-medium text-slate-500 dark:text-slate-400"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((row) => (
              <tr key={row}>
                <th className="pr-2 text-right font-medium text-slate-500 dark:text-slate-400">
                  {row}
                </th>
                {symbols.map((col) => {
                  const self = row === col;
                  const pair = self ? null : lookup.get(`${row}|${col}`);
                  const value = self ? 1 : (pair?.correlation ?? null);
                  const thin = !self && (pair?.overlap ?? 0) < minOverlap;
                  const active =
                    hover && (hover.a === row || hover.b === col);

                  return (
                    <td
                      key={col}
                      onMouseEnter={() => setHover({ a: row, b: col })}
                      onMouseLeave={() => setHover(null)}
                      className="tabular h-9 w-14 rounded-[3px] text-center transition-opacity"
                      style={{
                        background: cellColour(value),
                        color: textColour(value),
                        opacity: hover && !active ? 0.5 : 1,
                      }}
                      title={
                        pair
                          ? `${row} ~ ${col}: ${value?.toFixed(3)} over ${pair.overlap} sessions`
                          : undefined
                      }
                    >
                      {value == null ? "—" : value.toFixed(2)}
                      {thin && "*"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-4 rounded-[2px]"
            style={{ background: "var(--diverge-pos-strong)" }}
          />
          Move together (+1)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-4 rounded-[2px]"
            style={{ background: "var(--diverge-neutral)" }}
          />
          Unrelated (0)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-4 rounded-[2px]"
            style={{ background: "var(--diverge-neg-strong)" }}
          />
          Move opposite (−1)
        </span>
        <span>* fewer than {minOverlap} shared sessions — treat with caution</span>
      </div>
    </div>
  );
}

/** Diverging ramp: cool for positive, warm for negative, neutral at zero. */
function cellColour(value: number | null): string {
  if (value == null) return "var(--diverge-neutral)";
  const magnitude = Math.abs(value);
  if (value >= 0) {
    if (magnitude >= 0.8) return "var(--diverge-pos-strong)";
    if (magnitude >= 0.5) return "var(--diverge-pos-mid)";
    if (magnitude >= 0.2) return "var(--diverge-pos-weak)";
    return "var(--diverge-neutral)";
  }
  if (magnitude >= 0.8) return "var(--diverge-neg-strong)";
  if (magnitude >= 0.5) return "var(--diverge-neg-mid)";
  if (magnitude >= 0.2) return "var(--diverge-neg-weak)";
  return "var(--diverge-neutral)";
}

/** Saturated steps need light text; the pale ends keep primary ink. */
function textColour(value: number | null): string {
  if (value == null) return "var(--chart-text-secondary)";
  return Math.abs(value) >= 0.5 ? "#ffffff" : "var(--chart-text-primary)";
}
