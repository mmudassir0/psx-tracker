"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, prettyDate } from "@/lib/format";
import { addDays } from "@/lib/dates";
import { rsi, sma, trendNotes } from "@/lib/indicators";

export interface ClosePoint {
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

const SMA_FAST = "var(--series-2)";
const SMA_SLOW = "var(--chart-muted)";

function chip(active: boolean) {
  return active
    ? "rounded px-2 py-1 text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
}

/**
 * Stock price with optional 50/200-day averages, an RSI panel, and a "vs
 * index" mode that rebases both lines to 0% at the start of the range.
 * Indicators are computed on the full history, so a 200-day average is
 * already valid on the first day of a 3-month window.
 */
export function StockChart({
  data,
  label,
  benchmark,
}: {
  data: ClosePoint[];
  label: string;
  benchmark?: { label: string; data: ClosePoint[] };
}) {
  const [rangeKey, setRangeKey] = useState<string>("1Y");
  const [showFast, setShowFast] = useState(true);
  const [showSlow, setShowSlow] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [compare, setCompare] = useState(false);

  const full = useMemo(() => {
    const closes = data.map((d) => d.close);
    const fast = sma(closes, 50);
    const slow = sma(closes, 200);
    const r = rsi(closes, 14);
    return data.map((d, i) => ({ ...d, sma50: fast[i], sma200: slow[i], rsi: r[i] }));
  }, [data]);

  const filtered = useMemo(() => {
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[3];
    const newest = full[full.length - 1]?.date;
    if (!newest || range.days === Number.MAX_SAFE_INTEGER) return full;
    const cutoff = addDays(newest, -range.days);
    const sliced = full.filter((d) => d.date >= cutoff);
    return sliced.length >= 2 ? sliced : full;
  }, [full, rangeKey]);

  // Both lines as % change from the first day of the window.
  const compared = useMemo(() => {
    if (!benchmark || filtered.length === 0) return [];
    const levels = new Map(benchmark.data.map((b) => [b.date, b.close]));
    const sortedBench = benchmark.data;
    let j = 0;
    let lastBench: number | null = null;
    // Carry the index forward across days it has no level.
    for (; j < sortedBench.length && sortedBench[j].date <= filtered[0].date; j++) lastBench = sortedBench[j].close;
    const base = filtered[0].close;
    const benchBase = lastBench;
    return filtered.map((d) => {
      const lvl = levels.get(d.date);
      if (lvl != null) lastBench = lvl;
      return {
        date: d.date,
        stock: base > 0 ? (d.close / base - 1) * 100 : null,
        index: benchBase && lastBench ? (lastBench / benchBase - 1) * 100 : null,
      };
    });
  }, [benchmark, filtered]);

  const last = full[full.length - 1];
  const notes = last ? trendNotes(last.close, last.sma50, last.sma200, last.rsi) : [];
  const first = filtered[0]?.close;
  const changePct = first && last ? ((filtered[filtered.length - 1].close - first) / first) * 100 : null;
  const lastCompared = compared[compared.length - 1];

  if (data.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Not enough price history yet.
      </p>
    );
  }

  const domain = (() => {
    const vals = filtered.flatMap((d) => [
      d.close,
      ...(showFast && d.sma50 != null ? [d.sma50] : []),
      ...(showSlow && d.sma200 != null ? [d.sma200] : []),
    ]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || max * 0.05 || 1;
    return [Math.max(0, min - pad), max + pad] as [number, number];
  })();

  const axisTick = { fontSize: 11, fill: "var(--chart-muted)" };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={chip(!compare)} onClick={() => setCompare(false)}>
            Price
          </button>
          {benchmark && (
            <button type="button" className={chip(compare)} onClick={() => setCompare(true)}>
              vs {benchmark.label}
            </button>
          )}
          {!compare && (
            <span className="ml-2 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showFast} onChange={(e) => setShowFast(e.target.checked)} />
                <span className="inline-block h-0.5 w-3" style={{ background: SMA_FAST }} />
                50-day avg
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showSlow} onChange={(e) => setShowSlow(e.target.checked)} />
                <span className="inline-block h-0.5 w-3" style={{ background: SMA_SLOW }} />
                200-day avg
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={showRsi} onChange={(e) => setShowRsi(e.target.checked)} />
                RSI
              </label>
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRangeKey(r.key)} className={chip(rangeKey === r.key)}>
              {r.key}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
        {compare && lastCompared ? (
          <>
            {rangeKey}: {label}{" "}
            <Signed value={lastCompared.stock} /> vs {benchmark?.label} <Signed value={lastCompared.index} />
          </>
        ) : (
          changePct != null && (
            <>
              {rangeKey} change: <Signed value={changePct} />
            </>
          )
        )}
      </p>

      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {compare ? (
            <LineChart data={compared} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-baseline)" }} minTickGap={40} tickFormatter={(d: string) => d.slice(2, 7)} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
              <ReferenceLine y={0} stroke="var(--chart-baseline)" />
              <Tooltip
                cursor={{ stroke: "var(--chart-baseline)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as { date: string; stock: number | null; index: number | null };
                  return (
                    <TipBox date={p.date}>
                      <div>{label}: <Signed value={p.stock} /></div>
                      <div>{benchmark?.label}: <Signed value={p.index} /></div>
                    </TipBox>
                  );
                }}
              />
              <Line type="monotone" dataKey="stock" name={label} stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="index" name={benchmark?.label} stroke="var(--series-2)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </LineChart>
          ) : (
            <ComposedChart data={filtered} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--chart-baseline)" }} minTickGap={40} tickFormatter={(d: string) => d.slice(2, 7)} />
              <YAxis domain={domain} tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => v.toFixed(0)} />
              <Tooltip
                cursor={{ stroke: "var(--chart-baseline)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof filtered)[number];
                  return (
                    <TipBox date={p.date}>
                      <div className="font-medium">{label} {money(p.close)}</div>
                      {showFast && p.sma50 != null && <div>50-day avg {money(p.sma50)}</div>}
                      {showSlow && p.sma200 != null && <div>200-day avg {money(p.sma200)}</div>}
                      {showRsi && p.rsi != null && <div>RSI {p.rsi.toFixed(0)}</div>}
                    </TipBox>
                  );
                }}
              />
              <Line type="monotone" dataKey="close" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              {showFast && <Line type="monotone" dataKey="sma50" stroke={SMA_FAST} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />}
              {showSlow && <Line type="monotone" dataKey="sma200" stroke={SMA_SLOW} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls />}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {!compare && showRsi && (
        <div className="mt-2">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">RSI (14 days): above 70 overbought, below 30 oversold</p>
          <div style={{ height: 90 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={filtered} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
                <XAxis dataKey="date" hide />
                <YAxis domain={[0, 100]} ticks={[30, 70]} tick={axisTick} tickLine={false} axisLine={false} width={56} />
                <ReferenceLine y={70} stroke="var(--diverge-neg-mid)" strokeDasharray="3 3" />
                <ReferenceLine y={30} stroke="var(--diverge-pos-mid)" strokeDasharray="3 3" />
                <Tooltip
                  cursor={{ stroke: "var(--chart-baseline)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof filtered)[number];
                    return <TipBox date={p.date}>RSI {p.rsi == null ? "—" : p.rsi.toFixed(0)}</TipBox>;
                  }}
                />
                <Line type="monotone" dataKey="rsi" stroke="var(--chart-text-secondary)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {notes.map((n) => (
            <li key={n.text} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{
                  background:
                    n.tone === "up" ? "var(--diverge-pos-mid)" : n.tone === "down" ? "var(--diverge-neg-mid)" : "var(--chart-muted)",
                }}
              />
              {n.text}
            </li>
          ))}
          <li className="text-xs text-slate-500 dark:text-slate-400">
            Signals describe past prices only. They are not advice.
          </li>
        </ul>
      )}
    </div>
  );
}

function Signed({ value }: { value: number | null }) {
  if (value == null) return <span>—</span>;
  return (
    <span className="tabular font-medium" style={{ color: value >= 0 ? "var(--diverge-pos-mid)" : "var(--diverge-neg-mid)" }}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

function TipBox({ date, children }: { date: string; children: React.ReactNode }) {
  return (
    <div className="tabular rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <div className="text-slate-500 dark:text-slate-400">{prettyDate(date)}</div>
      <div className="mt-0.5 flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
