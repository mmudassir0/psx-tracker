"use client";

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
import { prettyDate } from "@/lib/format";
import type { ValuationPoint } from "@/lib/valuation";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** P/E over time with the stock's own median as the reference line. */
export function ValuationChart({ data, median }: { data: ValuationPoint[]; median: number | null }) {
  // Under a year of history, label days ("Oct 12"); beyond, months ("Oct '26").
  const long = data.length > 1 && data[0].date.slice(0, 4) !== data[data.length - 1].date.slice(0, 4) && data.length > 250;
  const tick = (d: string) => {
    const month = MONTHS[Number(d.slice(5, 7)) - 1] ?? "";
    return long ? `${month} '${d.slice(2, 4)}` : `${month} ${Number(d.slice(8, 10))}`;
  };
  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={tick}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--chart-muted)" }}
            tickLine={false}
            axisLine={false}
            width={36}
            domain={["auto", "auto"]}
          />
          {median != null && (
            <ReferenceLine
              y={median}
              stroke="var(--chart-baseline)"
              strokeDasharray="4 4"
              label={{ value: "median", position: "insideTopRight", fontSize: 10, fill: "var(--chart-muted)" }}
            />
          )}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as ValuationPoint;
              return (
                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <div className="text-slate-500 dark:text-slate-400">{prettyDate(p.date)}</div>
                  <div className="tabular mt-0.5 font-medium">P/E {p.pe.toFixed(1)}</div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="pe" stroke="var(--series-1)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
