"use client";

import { useState } from "react";
import Link from "next/link";
import { pct, money, count, compactPkr } from "@/lib/format";

export interface DivergingDatum {
  symbol: string;
  name: string | null;
  value: number | null;
  close: number | null;
  volume: number | null;
  weightPct: number | null;
}

/**
 * Change-vs-zero is an above/below-baseline job, so this is a diverging bar
 * centred on zero — not a saturated heatmap grid.
 *
 * The diverging pair is blue (up) / red (down) with a neutral midpoint rather
 * than the conventional green/red, which is the classic red-green CVD trap.
 * Every bar is direct-labelled with its value, so colour is never the only
 * encoding and the tooltip only enriches.
 */
export function DivergingBars({
  data,
  valueSuffix = "%",
  positiveLabel = "Gain",
  negativeLabel = "Loss",
}: {
  data: DivergingDatum[];
  valueSuffix?: string;
  positiveLabel?: string;
  negativeLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Place the zero line where the data actually puts it. Hard-centring it
  // wastes half the width on a day when almost everything moved one way.
  const values = data.map((d) => d.value ?? 0).filter(Number.isFinite);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const zeroPct = ((0 - min) / range) * 100;

  return (
    <div className="relative">
      <ul className="flex flex-col gap-1">
        {data.map((d) => {
          const value = d.value ?? 0;
          const positive = value > 0;
          const isHovered = hovered === d.symbol;
          const widthPct = (Math.abs(value) / range) * 100;
          // Bars grow away from the zero line in the direction of their sign.
          const leftPct = positive ? zeroPct : zeroPct - widthPct;

          return (
            <li
              key={d.symbol}
              className="group relative flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/70"
              onMouseEnter={() => setHovered(d.symbol)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(d.symbol)}
              onBlur={() => setHovered(null)}
            >
              <Link
                href={`/symbol/${d.symbol}`}
                className="w-20 shrink-0 truncate text-xs font-medium underline-offset-2 hover:underline"
              >
                {d.symbol}
              </Link>

              {/* Track with a hairline zero baseline down the centre. */}
              <div className="relative h-5 flex-1">
                <div
                  className="absolute inset-y-0 w-px"
                  style={{
                    left: `${zeroPct}%`,
                    background: "var(--chart-baseline)",
                  }}
                  aria-hidden
                />
                <div
                  className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] transition-opacity"
                  style={{
                    width: `${widthPct}%`,
                    left: `${leftPct}%`,
                    background: positive
                      ? "var(--diverge-pos-mid)"
                      : "var(--diverge-neg-mid)",
                    opacity: hovered && !isHovered ? 0.45 : 1,
                  }}
                />
              </div>

              <span
                className="tabular w-16 shrink-0 text-right text-xs font-medium"
                style={{
                  color: positive
                    ? "var(--diverge-pos-mid)"
                    : value < 0
                      ? "var(--diverge-neg-mid)"
                      : "var(--chart-muted)",
                }}
              >
                {value > 0 ? "+" : ""}
                {value.toFixed(2)}
                {valueSuffix}
              </span>

              {isHovered && (
                <div className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <div className="font-medium">{d.symbol}</div>
                  {d.name && (
                    <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                      {d.name}
                    </div>
                  )}
                  <dl className="tabular mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <dt className="text-slate-500 dark:text-slate-400">Close</dt>
                    <dd className="text-right">{money(d.close)}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">
                      Change
                    </dt>
                    <dd className="text-right">{pct(d.value)}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">
                      Volume
                    </dt>
                    <dd className="text-right">{count(d.volume)}</dd>
                    <dt className="text-slate-500 dark:text-slate-400">
                      Index weight
                    </dt>
                    <dd className="text-right">{pct(d.weightPct, 2, false)}</dd>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Legend positiveLabel={positiveLabel} negativeLabel={negativeLabel} />
    </div>
  );
}

function Legend({
  positiveLabel,
  negativeLabel,
}: {
  positiveLabel: string;
  negativeLabel: string;
}) {
  return (
    <div className="mt-3 flex items-center gap-4 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-4 rounded-[3px]"
          style={{ background: "var(--diverge-pos-mid)" }}
        />
        {positiveLabel}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-4 rounded-[3px]"
          style={{ background: "var(--diverge-neg-mid)" }}
        />
        {negativeLabel}
      </span>
    </div>
  );
}

/**
 * Single-hue horizontal bars for nominal categories (sectors).
 * One colour for every bar — a value-ramp here would double-encode length.
 */
export function WeightBars({
  data,
}: {
  data: { label: string; value: number; secondary?: number | null }[];
}) {
  const max = Math.max(0.01, ...data.map((d) => d.value));

  return (
    <ul className="flex flex-col gap-2">
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-2">
          <span className="w-36 shrink-0 truncate text-xs" title={d.label}>
            {d.label}
          </span>
          <div className="h-4 flex-1">
            <div
              className="h-full rounded-[3px]"
              style={{
                width: `${(d.value / max) * 100}%`,
                background: "var(--series-1)",
                minWidth: d.value > 0 ? "2px" : 0,
              }}
            />
          </div>
          <span className="tabular w-14 shrink-0 text-right text-xs">
            {d.value.toFixed(1)}%
          </span>
          {d.secondary != null && (
            <span className="tabular w-20 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">
              {compactPkr(d.secondary)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
