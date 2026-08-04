"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compactPkr, prettyDate } from "@/lib/format";

export interface EquityPoint {
  date: string;
  strategy: number;
  benchmark: number | null;
}

/**
 * Two series on ONE axis — both are PKR values rebased to the same starting
 * capital, so they are directly comparable. Never a second y-scale.
 *
 * Colours are categorical slots 1 and 2, assigned by entity: the basket is
 * always blue, the index always orange, regardless of which is ahead.
 */
export function EquityCurve({
  points,
  height = 320,
}: {
  points: EquityPoint[];
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Not enough price history for this window.
      </p>
    );
  }

  const hasBenchmark = points.some((p) => p.benchmark != null);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-baseline)" }}
            minTickGap={50}
            tickFormatter={(d: string) => d.slice(0, 7)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => compactPkr(v)}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-baseline)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as EquityPoint;
              return (
                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <div className="text-slate-500 dark:text-slate-400">
                    {prettyDate(point.date)}
                  </div>
                  <div className="tabular mt-1 flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-3 rounded-[2px]"
                      style={{ background: "var(--series-1)" }}
                    />
                    Basket {compactPkr(point.strategy)}
                  </div>
                  {point.benchmark != null && (
                    <div className="tabular mt-0.5 flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-3 rounded-[2px]"
                        style={{ background: "var(--series-2)" }}
                      />
                      Index {compactPkr(point.benchmark)}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={28}
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: "var(--chart-text-secondary)" }}
          />
          <Line
            name="Basket"
            type="monotone"
            dataKey="strategy"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {hasBenchmark && (
            <Line
              name="Index"
              type="monotone"
              dataKey="benchmark"
              stroke="var(--series-2)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
