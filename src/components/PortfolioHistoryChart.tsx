"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { addDays } from "@/lib/dates";
import { compactPkr, money, prettyDate } from "@/lib/format";
import type { HistoryPoint } from "@/lib/portfolio-history";

const RANGES = [
  { key: "3M", days: 90 },
  { key: "6M", days: 180 },
  { key: "1Y", days: 365 },
  { key: "Max", days: Number.MAX_SAFE_INTEGER },
] as const;

const SERIES = [
  { key: "value", label: "Market value", colour: "var(--series-1)", dash: undefined },
  { key: "invested", label: "Invested", colour: "var(--chart-muted)", dash: "4 3" },
  { key: "benchmark", label: "Same money in KMI30", colour: "var(--series-2, #c2410c)", dash: undefined },
] as const;

export function PortfolioHistoryChart({ data }: { data: HistoryPoint[] }) {
  const [rangeKey, setRangeKey] = useState<string>("Max");

  const filtered = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[3];
    const newest = data[data.length - 1]?.date;
    if (!newest || range.days === Number.MAX_SAFE_INTEGER) return data;
    const cutoff = addDays(newest, -range.days);
    const sliced = data.filter((d) => d.date >= cutoff);
    return sliced.length >= 2 ? sliced : data;
  }, [data, rangeKey]);

  if (data.length < 2) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        The chart appears once your portfolio spans at least two trading days.
      </p>
    );
  }

  const last = filtered[filtered.length - 1];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden>
                <line x1="0" y1="3" x2="18" y2="3" stroke={s.colour} strokeWidth="2" strokeDasharray={s.dash} />
              </svg>
              {s.label}
              <span className="tabular font-medium text-slate-900 dark:text-slate-100">
                {last[s.key] == null ? "—" : compactPkr(last[s.key] as number)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRangeKey(r.key)}
              className={rangeKey === r.key
                ? "rounded px-2 py-1 text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"}>
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={filtered} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeWidth={1} vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-muted)" }} tickLine={false}
              axisLine={{ stroke: "var(--chart-baseline)" }} minTickGap={40} tickFormatter={(d: string) => d.slice(2, 7)} />
            <YAxis tick={{ fontSize: 11, fill: "var(--chart-muted)" }} tickLine={false} axisLine={false} width={64}
              tickFormatter={(v: number) => compactPkr(v)} />
            <Tooltip
              cursor={{ stroke: "var(--chart-baseline)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as HistoryPoint;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-slate-500 dark:text-slate-400">{prettyDate(p.date)}</div>
                    {SERIES.map((s) => (
                      <div key={s.key} className="tabular mt-0.5">
                        {s.label}: <span className="font-medium">{p[s.key] == null ? "—" : money(p[s.key] as number)}</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {SERIES.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.colour} strokeWidth={2}
                strokeDasharray={s.dash} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Price only: dividends are not added to the value line. The KMI30 line buys the index
        with each purchase and sells it with each sale, so timing is compared fairly.
      </p>
    </div>
  );
}
