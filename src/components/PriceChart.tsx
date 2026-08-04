"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, prettyDate } from "@/lib/format";

export interface PricePoint {
  date: string;
  close: number;
}

const RANGES = [
  { key: "1M", days: 30 },
  { key: "3M", days: 90 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
  { key: "3Y", days: 1095 },
  { key: "Max", days: Number.MAX_SAFE_INTEGER },
] as const;

/**
 * Single-series price line. One series needs no legend — the title names it —
 * so the only colour is categorical slot 1, and the crosshair tooltip carries
 * per-point values while the axis carries the rest.
 */
export function PriceChart({
  data,
  label,
  height = 300,
}: {
  data: PricePoint[];
  label: string;
  height?: number;
}) {
  const [rangeKey, setRangeKey] = useState<string>("1Y");

  const filtered = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[3];
    if (range.days === Number.MAX_SAFE_INTEGER) return data;
    const cutoff = new Date(Date.now() - range.days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sliced = data.filter((d) => d.date >= cutoff);
    // Never render an empty plot just because the window outruns the history.
    return sliced.length >= 2 ? sliced : data;
  }, [data, rangeKey]);

  const domain = useMemo(() => {
    if (filtered.length === 0) return [0, 1] as [number, number];
    const values = filtered.map((d) => d.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.08 || max * 0.05 || 1;
    return [Math.max(0, min - pad), max + pad] as [number, number];
  }, [filtered]);

  const first = filtered[0]?.close;
  const last = filtered[filtered.length - 1]?.close;
  const changePct =
    first && last && first !== 0 ? ((last - first) / first) * 100 : null;

  if (data.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Not enough price history yet. Run an ingest with{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
          --backfill
        </code>
        .
      </p>
    );
  }

  return (
    <div>
      {/* One filter row above the plot, scoping everything below it. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {changePct != null && (
            <>
              {rangeKey} change:{" "}
              <span
                className="tabular font-medium"
                style={{
                  color:
                    changePct >= 0
                      ? "var(--diverge-pos-mid)"
                      : "var(--diverge-neg-mid)",
                }}
              >
                {changePct > 0 ? "+" : ""}
                {changePct.toFixed(2)}%
              </span>
            </>
          )}
        </div>
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

      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={filtered}
            margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
          >
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--series-1)"
                  stopOpacity={0.28}
                />
                <stop
                  offset="100%"
                  stopColor="var(--series-1)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            {/* Solid hairline grid, one shade off the surface. */}
            <CartesianGrid
              stroke="var(--chart-grid)"
              strokeWidth={1}
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-baseline)" }}
              minTickGap={40}
              tickFormatter={(d: string) => d.slice(2, 7)}
            />
            <YAxis
              domain={domain}
              tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <Tooltip
              cursor={{ stroke: "var(--chart-baseline)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as PricePoint;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">
                      {prettyDate(point.date)}
                    </div>
                    <div className="tabular mt-0.5 font-medium">
                      {label} {money(point.close)}
                    </div>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke="var(--series-1)"
              strokeWidth={2}
              fill="url(#priceFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
