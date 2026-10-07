"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { money, pct } from "@/lib/format";
import { heatFill, heatIsStrong } from "@/lib/heat-colour";
import type { HeatmapDatum } from "@/components/MarketHeatmap";

/** Drawing units: the chart is a 600×600 box centred on 0,0. */
const R_CENTRE = 112;
const R_SECTOR = 196;
const R_OUTER = 296;
const TAU = Math.PI * 2;
const ZOOM_MS = 550;
/** Gap between neighbouring slices, in radians at the outer edge. */
const PAD = 0.0025;

interface Arc {
  a0: number;
  a1: number;
  r0: number;
  r1: number;
}

interface SectorNode {
  sector: string;
  size: number;
  changePct: number | null;
  stocks: HeatmapDatum[];
}

function arcPath({ a0, a1, r0, r1 }: Arc): string | null {
  let span = a1 - a0;
  if (span <= 1e-5 || r1 - r0 <= 0.5) return null;
  // A full circle is drawn a hair short so the arc flags stay defined.
  if (span >= TAU - 1e-4) span = TAU - 1e-4;
  const pad = span > PAD * 4 ? PAD : 0;
  const s = a0 + pad / 2;
  const e = a0 + span - pad / 2;
  const large = e - s > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(r * Math.sin(a)).toFixed(2)},${(-r * Math.cos(a)).toFixed(2)}`;
  return [
    `M${p(r1, s)}`,
    `A${r1},${r1} 0 ${large} 1 ${p(r1, e)}`,
    `L${p(r0, e)}`,
    r0 > 0 ? `A${r0},${r0} 0 ${large} 0 ${p(r0, s)}` : "",
    "Z",
  ].join(" ");
}

function weightedChange(items: { size: number; changePct: number | null }[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const i of items) {
    if (i.changePct == null) continue;
    sum += i.changePct * i.size;
    weight += i.size;
  }
  return weight > 0 ? sum / weight : null;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(And|Of|&)\b/g, (m) => m.toLowerCase());
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Index → sectors → stocks as rings. Slice width is the stock's (or sector's)
 * share; colour is its change. Tap a sector to zoom in so its stocks fill the
 * ring; tap the centre to zoom back out.
 */
export function MarketSunburst({
  data,
  centreLabel,
  centreChangePct,
  sizeLabel = "Weight in the index",
  changeLabel = "Change",
  fullColourPct = 4,
  initialFocus = null,
}: {
  data: HeatmapDatum[];
  centreLabel: string;
  /** The index's own change, shown in the centre when zoomed out. */
  centreChangePct?: number | null;
  sizeLabel?: string;
  changeLabel?: string;
  fullColourPct?: number;
  /** Open already zoomed into this sector. */
  initialFocus?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<string | null>(initialFocus);
  // A tapped stock stays open (its card has a link); hover only previews.
  const [pinned, setPinned] = useState<HeatmapDatum | null>(null);
  const [hover, setHover] = useState<HeatmapDatum | null>(null);
  const selected = pinned ?? hover;
  const [hoverSector, setHoverSector] = useState<SectorNode | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sectors = useMemo<SectorNode[]>(() => {
    const by = new Map<string, HeatmapDatum[]>();
    for (const d of data) {
      if (!(d.size > 0)) continue;
      const list = by.get(d.sector);
      if (list) list.push(d);
      else by.set(d.sector, [d]);
    }
    return [...by.entries()]
      .map(([sector, stocks]) => ({
        sector,
        stocks: stocks.sort((a, b) => b.size - a.size),
        size: stocks.reduce((s, x) => s + x.size, 0),
        changePct: weightedChange(stocks),
      }))
      .sort((a, b) => b.size - a.size);
  }, [data]);

  // Zoomed-out angles for every sector and stock.
  const base = useMemo(() => {
    const total = sectors.reduce((s, x) => s + x.size, 0) || 1;
    const sectorArcs = new Map<string, [number, number]>();
    const stockArcs = new Map<string, [number, number]>();
    let a = 0;
    for (const s of sectors) {
      const span = (s.size / total) * TAU;
      sectorArcs.set(s.sector, [a, a + span]);
      let b = a;
      for (const st of s.stocks) {
        const w = (st.size / total) * TAU;
        stockArcs.set(st.symbol, [b, b + w]);
        b += w;
      }
      a += span;
    }
    return { sectorArcs, stockArcs };
  }, [sectors]);

  // Where every slice sits for a given focus.
  const target = (f: string | null): Map<string, Arc> => {
    const out = new Map<string, Arc>();
    const range = f ? base.sectorArcs.get(f) : null;
    const project = (a: number) =>
      range ? Math.max(0, Math.min(TAU, ((a - range[0]) / (range[1] - range[0])) * TAU)) : a;
    for (const [sector, [a0, a1]] of base.sectorArcs) {
      out.set(`s:${sector}`, f
        ? { a0: project(a0), a1: project(a1), r0: R_CENTRE, r1: R_CENTRE }
        : { a0, a1, r0: R_CENTRE, r1: R_SECTOR });
    }
    for (const [symbol, [a0, a1]] of base.stockArcs) {
      out.set(`k:${symbol}`, f
        ? { a0: project(a0), a1: project(a1), r0: R_CENTRE, r1: R_OUTER }
        : { a0, a1, r0: R_SECTOR, r1: R_OUTER });
    }
    return out;
  };

  // The parent remounts this (key) for a new index or period, so the
  // zoomed-out layout is only computed once here.
  const [frame, setFrame] = useState<Map<string, Arc>>(() => target(initialFocus));

  const zoomTo = (next: string | null) => {
    setPinned(null);
    setHover(null);
    setHoverSector(null);
    setFocus(next);
    const from = frame;
    const to = target(next);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setFrame(to);
      return;
    }
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = ease(Math.min(1, (now - start) / ZOOM_MS));
      const mid = new Map<string, Arc>();
      for (const [key, end] of to) {
        const begin = from.get(key) ?? end;
        mid.set(key, {
          a0: lerp(begin.a0, end.a0, t),
          a1: lerp(begin.a1, end.a1, t),
          r0: lerp(begin.r0, end.r0, t),
          r1: lerp(begin.r1, end.r1, t),
        });
      }
      setFrame(mid);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Keep text about 11px on screen whatever the chart's size.
  const unit = width > 0 ? 600 / Math.min(width, 640) : 1;
  const font = 11 * unit;

  const focusNode = focus ? sectors.find((s) => s.sector === focus) ?? null : null;
  const centreChange = focusNode ? focusNode.changePct : centreChangePct ?? weightedChange(data);
  const total = sectors.reduce((s, x) => s + x.size, 0) || 1;

  /**
   * Slice label. Reads across the ring (outward) when the slice is thick
   * enough, otherwise along the curve when the slice is long enough; small
   * slices go unlabelled and rely on the hover card.
   */
  const label = (arc: Arc, lines: string[], white: boolean, key: string) => {
    const span = arc.a1 - arc.a0;
    const thick = arc.r1 - arc.r0;
    const rm = (arc.r0 + arc.r1) / 2;
    const room = span * rm;
    const textLen = (l: string) => l.length * font * 0.58;
    const lineH = font * 1.15;
    const mid = ((arc.a0 + arc.a1) / 2) * (180 / Math.PI);
    const fill = white ? "#ffffff" : "var(--chart-text-primary)";

    const render = (transform: string, shown: string[]) => (
      <text key={key} transform={transform} textAnchor="middle" className="pointer-events-none select-none" fill={fill} fontSize={font}>
        {shown.map((l, i) => (
          <tspan key={i} x={0} dy={i === 0 ? (shown.length > 1 ? -font * 0.15 : font * 0.35) : font * 1.1} fontWeight={i === 0 ? 600 : 400}>
            {l}
          </tspan>
        ))}
      </text>
    );

    // Across the ring.
    const across = lines.filter((l, i) => textLen(l) <= thick - 10 && room >= lineH * (i + 1));
    if (across.length > 0 && across[0] === lines[0]) {
      const flip = mid > 180;
      return render(`rotate(${mid - 90}) translate(${rm},0) rotate(${flip ? 180 : 0})`, across);
    }
    // Along the curve: upright on the bottom half.
    const along = lines.filter((l, i) => textLen(l) <= room - 12 && thick >= lineH * (i + 1) + 4);
    if (along.length > 0 && along[0] === lines[0]) {
      const bottom = mid > 90 && mid < 270;
      return render(`rotate(${mid}) translate(0,${-rm}) rotate(${bottom ? 180 : 0})`, along);
    }
    return null;
  };

  const tip = selected
    ? {
        title: selected.symbol,
        name: selected.name,
        rows: [
          ["Close", money(selected.close)],
          [changeLabel, pct(selected.changePct)],
          [sizeLabel, selected.sizeText],
          ["Sector", titleCase(selected.sector)],
        ],
        held: selected.held,
        link: pinned ? `/symbol/${selected.symbol}` : null,
      }
    : hoverSector
      ? {
          title: titleCase(hoverSector.sector),
          name: `${hoverSector.stocks.length} compan${hoverSector.stocks.length === 1 ? "y" : "ies"}`,
          rows: [
            [changeLabel, pct(hoverSector.changePct)],
            ["Share", pct((hoverSector.size / total) * 100, 1, false)],
          ],
          held: false,
          link: null,
        }
      : null;

  return (
    <div>
      <div ref={ref} className="relative mx-auto w-full max-w-[640px]">
        <svg
          viewBox="-300 -300 600 600"
          className="block h-auto w-full"
          role="group"
          aria-label={`${focusNode ? titleCase(focusNode.sector) : centreLabel}: rings of sectors and stocks coloured by ${changeLabel.toLowerCase()}`}
        >
          {sectors.map((s) => {
            const arc = frame.get(`s:${s.sector}`);
            const d = arc && arcPath(arc);
            if (!arc || !d) return null;
            return (
              <g key={`s:${s.sector}`}>
                <path
                  d={d}
                  fill={heatFill(s.changePct, fullColourPct)}
                  className="cursor-pointer stroke-white outline-none hover:opacity-90 focus-visible:opacity-80 dark:stroke-slate-900"
                  strokeWidth={unit}
                  tabIndex={0}
                  role="button"
                  aria-label={`${titleCase(s.sector)} ${pct(s.changePct)}. Zoom in.`}
                  onClick={() => zoomTo(s.sector)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      zoomTo(s.sector);
                    }
                  }}
                  onMouseEnter={() => setHoverSector(s)}
                  onMouseLeave={() => setHoverSector(null)}
                />
                {label(arc, [titleCase(s.sector)], heatIsStrong(s.changePct, fullColourPct), `sl:${s.sector}`)}
              </g>
            );
          })}

          {sectors.flatMap((s) =>
            s.stocks.map((st) => {
              const arc = frame.get(`k:${st.symbol}`);
              const d = arc && arcPath(arc);
              if (!arc || !d) return null;
              return (
                <g key={`k:${st.symbol}`}>
                  <path
                    d={d}
                    fill={heatFill(st.changePct, fullColourPct)}
                    className={`cursor-pointer hover:opacity-90 ${st.held ? "stroke-amber-400" : "stroke-white dark:stroke-slate-900"}`}
                    strokeWidth={st.held ? unit * 2.5 : unit}
                    onClick={() => (focus ? setPinned(pinned?.symbol === st.symbol ? null : st) : zoomTo(st.sector))}
                    onMouseEnter={() => setHover(st)}
                    onMouseLeave={() => setHover(null)}
                  />
                  {label(arc, [st.symbol, pct(st.changePct)], heatIsStrong(st.changePct, fullColourPct), `kl:${st.symbol}`)}
                </g>
              );
            }),
          )}

          {/* Centre: the index, or the zoomed sector; tap to zoom out. */}
          <g
            className={focus ? "cursor-pointer" : undefined}
            onClick={focus ? () => zoomTo(null) : undefined}
            role={focus ? "button" : undefined}
            tabIndex={focus ? 0 : undefined}
            aria-label={focus ? "Zoom out" : undefined}
            onKeyDown={(e) => {
              if (focus && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                zoomTo(null);
              }
            }}
          >
            <circle
              r={R_CENTRE - 2}
              fill={heatFill(centreChange, fullColourPct)}
              className="stroke-white dark:stroke-slate-900"
              strokeWidth={unit}
            />
            <text
              textAnchor="middle"
              className="pointer-events-none select-none"
              fill={heatIsStrong(centreChange, fullColourPct) ? "#ffffff" : "var(--chart-text-primary)"}
            >
              <tspan x={0} dy={-font * 0.4} fontSize={font * 1.35} fontWeight={600}>
                {focusNode ? truncate(titleCase(focusNode.sector), 18) : centreLabel}
              </tspan>
              <tspan x={0} dy={font * 1.5} fontSize={font * 1.2}>
                {pct(centreChange)}
              </tspan>
              {focus && (
                <tspan x={0} dy={font * 1.5} fontSize={font * 0.9} opacity={0.85}>
                  tap to zoom out
                </tspan>
              )}
            </text>
          </g>
        </svg>

        {tip && (
          <div className="absolute right-0 top-0 z-10 w-52 rounded-lg border border-slate-200 bg-white p-2.5 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <div className="font-medium">
              {tip.title}
              {tip.held && <span className="ml-1 text-amber-600 dark:text-amber-400">· you hold this</span>}
            </div>
            {tip.name && <div className="mt-0.5 text-slate-500 dark:text-slate-400">{tip.name}</div>}
            <dl className="tabular mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {tip.rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                  <dd className="truncate text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {tip.link && (
              <Link href={tip.link} className="mt-1.5 inline-block font-medium underline underline-offset-2">
                Open {tip.title} →
              </Link>
            )}
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
        <span>Slice size: {sizeLabel.toLowerCase()}</span>
        <span>{focus ? "Tap a stock for details, the centre to zoom out" : "Tap a sector to zoom in"}</span>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
