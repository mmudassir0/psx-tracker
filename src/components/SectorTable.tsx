import { pct } from "@/lib/format";

export interface SectorRow {
  sector: string;
  weightPct: number;
  count: number;
  changePct: number;
}

/**
 * Each sector's share of the index and how it did today (weighted by its
 * members' index weights). Weight is a single-hue bar; the change is a
 * diverging bar around zero, labelled so colour is never the only cue.
 */
export function SectorTable({ data }: { data: SectorRow[] }) {
  const maxWeight = Math.max(...data.map((s) => s.weightPct), 1);
  const maxMove = Math.max(...data.map((s) => Math.abs(s.changePct)), 0.5);

  return (
    <div>
      <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_64px_92px] gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>Sector</span>
        <span className="text-right">Weight</span>
        <span className="text-right">Today</span>
      </div>
      <ul className="flex flex-col gap-1">
        {data.map((s) => (
          <li key={s.sector} className="grid grid-cols-[minmax(0,1fr)_64px_92px] items-center gap-2 text-xs">
            <span className="truncate" title={`${s.sector} · ${s.count} compan${s.count === 1 ? "y" : "ies"}`}>
              {s.sector}
            </span>
            <span className="relative block h-4">
              <span
                className="absolute inset-y-0 right-0 rounded-[3px] opacity-25"
                style={{ width: `${(s.weightPct / maxWeight) * 100}%`, background: "var(--series-1)" }}
              />
              <span className="tabular relative block pr-1 text-right leading-4">{pct(s.weightPct, 1, false)}</span>
            </span>
            <span className="relative block h-4">
              <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--chart-baseline)]" />
              <span
                className="absolute inset-y-0.5 rounded-[2px]"
                style={{
                  width: `${(Math.abs(s.changePct) / maxMove) * 50}%`,
                  left: s.changePct >= 0 ? "50%" : `${50 - (Math.abs(s.changePct) / maxMove) * 50}%`,
                  background: s.changePct >= 0 ? "var(--diverge-pos-mid)" : "var(--diverge-neg-mid)",
                  opacity: 0.35,
                }}
              />
              <span
                className="tabular relative block text-center font-medium leading-4"
                style={{ color: s.changePct > 0 ? "var(--diverge-pos-mid)" : s.changePct < 0 ? "var(--diverge-neg-mid)" : undefined }}
              >
                {pct(s.changePct)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
