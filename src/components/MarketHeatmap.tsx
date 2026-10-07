"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { money, pct } from "@/lib/format";
import { heatFill, heatIsStrong } from "@/lib/heat-colour";

export interface HeatmapDatum {
  symbol: string;
  name: string | null;
  sector: string;
  /** Box area: index weight on the dashboard, market cap on the heatmap page. */
  size: number;
  /** `size` formatted for the tooltip. */
  sizeText: string;
  changePct: number | null;
  close: number | null;
  held: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SECTOR_HEADER = 16;

/**
 * Squarified treemap (Bruls et al.): lays items along the shorter side,
 * adding to a row while that keeps the worst aspect ratio from getting worse.
 */
function squarify<T extends { value: number }>(items: T[], box: Rect): (T & Rect)[] {
  const out: (T & Rect)[] = [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return out;
  const scale = (box.w * box.h) / total;
  const queue = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  let { x, y, w, h } = box;

  const worst = (row: number[], side: number) => {
    const sum = row.reduce((s, v) => s + v, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  while (queue.length > 0) {
    const side = Math.min(w, h);
    const row: T[] = [queue.shift()!];
    while (queue.length > 0) {
      const areas = row.map((r) => r.value * scale);
      const next = queue[0].value * scale;
      if (worst([...areas, next], side) > worst(areas, side)) break;
      row.push(queue.shift()!);
    }
    const rowArea = row.reduce((s, r) => s + r.value * scale, 0);
    const thick = rowArea / side;
    let offset = 0;
    for (const r of row) {
      const len = (r.value * scale) / thick;
      out.push(
        w >= h
          ? { ...r, x, y: y + offset, w: thick, h: len }
          : { ...r, x: x + offset, y, w: len, h: thick },
      );
      offset += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
  }
  return out;
}


/**
 * Every member as a box sized by its index weight and coloured by today's
 * change, grouped by sector. Green up / red down, like market portals.
 */
export function MarketHeatmap({
  data,
  sizeLabel = "Weight in the index",
  changeLabel = "Change",
  fullColourPct = 4,
  tall = false,
}: {
  data: HeatmapDatum[];
  sizeLabel?: string;
  changeLabel?: string;
  /** Change at which a box reaches full colour; longer periods need more. */
  fullColourPct?: number;
  /** Full-page map: more height so small companies still get a box. */
  tall?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<HeatmapDatum | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure now too: resize callbacks wait for the next paint, which a
    // background tab may not get for a while.
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Phones get a taller box so the small names still have room.
  const height =
    width === 0
      ? 0
      : width < 640
        ? Math.round(width * (tall ? 1.8 : 1.25))
        : Math.round(tall ? Math.min(820, width * 0.62) : Math.min(520, width * 0.5));

  const layout = useMemo(() => {
    if (width === 0) return { sectors: [], boxes: [] };
    const bySector = new Map<string, HeatmapDatum[]>();
    for (const d of data) {
      if (!(d.size > 0)) continue;
      const list = bySector.get(d.sector);
      if (list) list.push(d);
      else bySector.set(d.sector, [d]);
    }
    const sectors = squarify(
      [...bySector.entries()].map(([sector, items]) => ({
        sector,
        items,
        value: items.reduce((s, i) => s + i.size, 0),
      })),
      { x: 0, y: 0, w: width, h: height },
    );
    const boxes = sectors.flatMap((s) => {
      const header = s.h > 48 && s.w > 70 ? SECTOR_HEADER : 0;
      return squarify(
        s.items.map((i) => ({ ...i, value: i.size })),
        { x: s.x + 1, y: s.y + header + 1, w: s.w - 2, h: s.h - header - 2 },
      );
    });
    return { sectors, boxes };
  }, [data, width, height]);

  return (
    <div>
      <div ref={ref} className="relative w-full overflow-hidden rounded-md" style={{ height }}>
        {layout.sectors.map((s) => (
          <div
            key={s.sector}
            className="absolute border border-white dark:border-slate-900"
            style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
          >
            {s.h > 48 && s.w > 70 && (
              <div className="truncate px-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-slate-500 dark:text-slate-400">
                {s.sector}
              </div>
            )}
          </div>
        ))}
        {layout.boxes.map((b) => {
          const showLabel = b.w > 38 && b.h > 22;
          const showPct = b.w > 46 && b.h > 36;
          const strong = heatIsStrong(b.changePct, fullColourPct);
          return (
            <Link
              key={b.symbol}
              href={`/symbol/${b.symbol}`}
              onMouseEnter={() => setHover(b)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(b)}
              onBlur={() => setHover(null)}
              aria-label={`${b.symbol} ${pct(b.changePct)}`}
              className={`absolute flex flex-col items-center justify-center overflow-hidden border border-white text-center leading-tight dark:border-slate-900 ${
                strong ? "text-white" : "text-slate-900 dark:text-slate-100"
              } ${b.held ? "outline-2 -outline-offset-2 outline-amber-400" : ""}`}
              style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: heatFill(b.changePct, fullColourPct) }}
            >
              {showLabel && (
                <span className="max-w-full truncate px-0.5 text-[11px] font-semibold">
                  {b.held && <span aria-hidden>● </span>}
                  {b.symbol}
                </span>
              )}
              {showPct && <span className="tabular text-[10px]">{pct(b.changePct)}</span>}
            </Link>
          );
        })}
        {hover && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 w-52 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <div className="font-medium">
              {hover.symbol}
              {hover.held && <span className="ml-1 text-amber-600 dark:text-amber-400">· you hold this</span>}
            </div>
            {hover.name && <div className="mt-0.5 text-slate-500 dark:text-slate-400">{hover.name}</div>}
            <dl className="tabular mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              <dt className="text-slate-500 dark:text-slate-400">Close</dt>
              <dd className="text-right">{money(hover.close)}</dd>
              <dt className="text-slate-500 dark:text-slate-400">{changeLabel}</dt>
              <dd className="text-right">{pct(hover.changePct)}</dd>
              <dt className="text-slate-500 dark:text-slate-400">{sizeLabel}</dt>
              <dd className="text-right">{hover.sizeText}</dd>
              <dt className="text-slate-500 dark:text-slate-400">Sector</dt>
              <dd className="truncate text-right">{hover.sector}</dd>
            </dl>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <span>−{fullColourPct}%</span>
          {[-1, -0.5, -0.125, 0, 0.125, 0.5, 1].map((v) => (
            <span key={v} className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: heatFill(v * fullColourPct, fullColourPct) }} />
          ))}
          <span>+{fullColourPct}%</span>
        </span>
        <span>Box size: {sizeLabel.toLowerCase()}</span>
        {data.some((d) => d.held) && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-[2px] outline-2 -outline-offset-2 outline-amber-400" />
            You hold it
          </span>
        )}
      </div>
    </div>
  );
}
