"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { prettyDate } from "@/lib/format";
import type { BreadthPoint } from "@/lib/dashboard-data";

/**
 * Stocks up (above the line) and down (below) on each session. Mirrored bars
 * keep both counts readable and make one-sided days stand out.
 */
export function BreadthChart({ data }: { data: BreadthPoint[] }) {
  if (data.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        Not enough history yet.
      </p>
    );
  }
  const rows = data.map((d) => ({ date: d.date, up: d.up, down: -d.down }));
  const upDays = data.filter((d) => d.up > d.down).length;

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        More stocks rose than fell on{" "}
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {upDays} of {data.length}
        </span>{" "}
        sessions.
      </p>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} stackOffset="sign" margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(d: string) => d.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => String(Math.abs(v))}
            />
            <ReferenceLine y={0} stroke="var(--chart-baseline)" />
            <Tooltip
              cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.5 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { date: string; up: number; down: number };
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">{prettyDate(p.date)}</div>
                    <div className="tabular mt-0.5" style={{ color: "var(--diverge-pos-mid)" }}>{p.up} up</div>
                    <div className="tabular" style={{ color: "var(--diverge-neg-mid)" }}>{-p.down} down</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="up" stackId="b" fill="var(--diverge-pos-mid)" isAnimationActive={false} />
            <Bar dataKey="down" stackId="b" fill="var(--diverge-neg-mid)" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
