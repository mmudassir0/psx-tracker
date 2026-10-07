"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { addDays } from "@/lib/dates";
import { prettyDate } from "@/lib/format";

import { COMPARE_COLOURS } from "@/lib/compare-colours";

const RANGES = [
  { key: "1M", days: 30 },
  { key: "3M", days: 90 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
  { key: "3Y", days: 1095 },
] as const;

/**
 * Several stocks on one chart as % change from the start of the window, so a
 * Rs 30 share and a Rs 500 share compare fairly. Days a stock didn't trade
 * carry its last close forward.
 */
export function CompareChart({ series }: { series: { symbol: string; data: { date: string; close: number }[] }[] }) {
  const [rangeKey, setRangeKey] = useState<string>("1Y");

  const rows = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[3];
    const newest = series.flatMap((s) => s.data.map((d) => d.date)).sort().pop();
    if (!newest) return [];
    const cutoff = addDays(newest, -range.days);
    const dates = [...new Set(series.flatMap((s) => s.data.map((d) => d.date)))].filter((d) => d >= cutoff).sort();
    const state = series.map((s) => {
      // Last close on or before the window start is the base.
      let last: number | null = null;
      let i = 0;
      while (i < s.data.length && s.data[i].date < (dates[0] ?? cutoff)) last = s.data[i++].close;
      return { s, i, last, base: last };
    });
    return dates.map((date) => {
      const row: Record<string, number | string | null> = { date };
      for (const st of state) {
        while (st.i < st.s.data.length && st.s.data[st.i].date <= date) st.last = st.s.data[st.i++].close;
        st.base ??= st.last;
        row[st.s.symbol] = st.base && st.last != null ? (st.last / st.base - 1) * 100 : null;
      }
      return row;
    });
  }, [series, rangeKey]);

  const last = rows[rows.length - 1];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {series.map((s, i) => {
            const v = last?.[s.symbol] as number | null | undefined;
            return (
              <li key={s.symbol} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4" style={{ background: COMPARE_COLOURS[i] }} />
                <span className="font-medium">{s.symbol}</span>
                <span className="tabular" style={{ color: v == null ? undefined : v >= 0 ? "var(--diverge-pos-mid)" : "var(--diverge-neg-mid)" }}>
                  {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRangeKey(r.key)}
              className={
                rangeKey === r.key
                  ? "rounded px-2 py-1 text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
              }
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-baseline)" }}
              minTickGap={40}
              tickFormatter={(d: string) => d.slice(2, 7)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <ReferenceLine y={0} stroke="var(--chart-baseline)" />
            <Tooltip
              cursor={{ stroke: "var(--chart-baseline)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number | string | null>;
                return (
                  <div className="tabular rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">{prettyDate(row.date as string)}</div>
                    {series.map((s, i) => {
                      const v = row[s.symbol] as number | null;
                      return (
                        <div key={s.symbol} className="mt-0.5 flex items-center gap-1.5">
                          <span className="inline-block h-0.5 w-3" style={{ background: COMPARE_COLOURS[i] }} />
                          {s.symbol}: {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map((s, i) => (
              <Line
                key={s.symbol}
                type="monotone"
                dataKey={s.symbol}
                stroke={COMPARE_COLOURS[i]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
