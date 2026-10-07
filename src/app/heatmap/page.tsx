import Link from "next/link";
import { getCurrentUserId } from "@/lib/auth";
import {
  getAllSymbolViews,
  getConstituents,
  getTrackedIndexCodes,
  isDatabaseEmpty,
  latestQuoteDate,
  type ConstituentView,
} from "@/lib/market";
import { getHoldings } from "@/lib/portfolio";
import { getClosesAsOf } from "@/lib/dashboard-data";
import { addDays } from "@/lib/dates";
import { indexLabel, sortIndexCodes } from "@/lib/psx/indices";
import { MarketHeatmap } from "@/components/MarketHeatmap";
import { MarketSunburst } from "@/components/MarketSunburst";
import { SectorTable } from "@/components/SectorTable";
import { Card, EmptyState, PageHeader, StatTile, SymbolLink } from "@/components/ui";
import { compactPkr, money, pct, prettyDate, toneClass } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Colour periods, with the change that reaches full colour for each. */
const PERIODS = [
  { key: "1D", label: "Today", fullAt: 4 },
  { key: "1W", label: "1 week", fullAt: 8, days: 7 },
  { key: "1M", label: "1 month", fullAt: 15, days: 30 },
  { key: "YTD", label: "Year to date", fullAt: 30 },
  { key: "1Y", label: "1 year", fullAt: 50 },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

const ALL = "ALL";
const TOP_MOVERS = 5;

export const metadata = { title: "Heatmap · PSX Tracker" };

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string; period?: string; view?: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const sp = await searchParams;
  const tracked = sortIndexCodes(await getTrackedIndexCodes());
  const requested = sp.index?.toUpperCase();
  const code = requested && tracked.includes(requested) ? requested : ALL;
  const period = PERIODS.find((p) => p.key === sp.period?.toUpperCase()) ?? PERIODS[0];
  const view = sp.view === "rings" ? "rings" : "boxes";

  const userId = await getCurrentUserId();
  const [views, quoteDate, members, holdings] = await Promise.all([
    getAllSymbolViews(),
    latestQuoteDate(),
    code === ALL ? null : getConstituents(code),
    userId ? getHoldings(userId) : [],
  ]);
  const held = new Set(holdings.filter((h) => h.quantity > 0).map((h) => h.symbol));

  // Past closes only for the week and month views; the rest are on the view.
  const base =
    quoteDate && "days" in period
      ? await getClosesAsOf(quoteDate, addDays(quoteDate, -period.days))
      : null;
  const changeOf = (v: ConstituentView): number | null => {
    switch (period.key as PeriodKey) {
      case "1D":
        return v.changePct;
      case "YTD":
        return v.ytdChangePct;
      case "1Y":
        return v.year1ChangePct;
      default: {
        const then = base?.get(v.symbol);
        return then && v.close != null ? (v.close / then - 1) * 100 : null;
      }
    }
  };

  const memberSet = members ? new Set(members.map((m) => m.symbol)) : null;
  const rows = views
    .filter((v) => (v.marketCap ?? 0) > 0 && (!memberSet || memberSet.has(v.symbol)))
    .map((v) => ({ view: v, change: changeOf(v) }))
    .sort((a, b) => (b.view.marketCap ?? 0) - (a.view.marketCap ?? 0));

  const totalCap = rows.reduce((s, r) => s + (r.view.marketCap ?? 0), 0);
  const priced = rows.filter((r) => r.change != null);
  const up = priced.filter((r) => r.change! > 0).length;
  const down = priced.filter((r) => r.change! < 0).length;
  const pricedCap = priced.reduce((s, r) => s + (r.view.marketCap ?? 0), 0);
  const capWeighted =
    pricedCap > 0 ? priced.reduce((s, r) => s + r.change! * (r.view.marketCap ?? 0), 0) / pricedCap : null;

  // Sector rollup weighted by market cap, the same weighting as the boxes.
  const bySector = new Map<string, { cap: number; moveCap: number; pricedCap: number; count: number }>();
  for (const r of rows) {
    const sector = r.view.sectorName ?? "Other";
    const s = bySector.get(sector) ?? { cap: 0, moveCap: 0, pricedCap: 0, count: 0 };
    const cap = r.view.marketCap ?? 0;
    s.cap += cap;
    s.count += 1;
    if (r.change != null) {
      s.moveCap += r.change * cap;
      s.pricedCap += cap;
    }
    bySector.set(sector, s);
  }
  const sectors = [...bySector.entries()]
    .map(([sector, s]) => ({
      sector,
      weightPct: totalCap > 0 ? (s.cap / totalCap) * 100 : 0,
      count: s.count,
      changePct: s.pricedCap > 0 ? s.moveCap / s.pricedCap : 0,
    }))
    .sort((a, b) => b.weightPct - a.weightPct);

  // Leaders among the 100 largest, so a tiny stock's 40% jump doesn't crowd
  // out the names that matter.
  const largest = priced.slice(0, 100);
  const leaders = [...largest].sort((a, b) => b.change! - a.change!).slice(0, TOP_MOVERS);
  const laggards = [...largest].sort((a, b) => a.change! - b.change!).slice(0, TOP_MOVERS);

  const scopeLabel = code === ALL ? "the whole market" : indexLabel(code);
  const href = (next: { index?: string; period?: string; view?: string }) => {
    const params = new URLSearchParams();
    const idx = next.index ?? code;
    const per = next.period ?? period.key;
    const vw = next.view ?? view;
    if (idx !== ALL) params.set("index", idx);
    if (per !== "1D") params.set("period", per);
    if (vw !== "boxes") params.set("view", vw);
    const qs = params.toString();
    return qs ? `/heatmap?${qs}` : "/heatmap";
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Market heatmap"
        description={
          <>
            {rows.length} companies in {scopeLabel}, each box sized by market cap, grouped by sector and coloured
            by its change over {period.label.toLowerCase()}. Session {prettyDate(quoteDate)}.
          </>
        }
      />

      <div className="flex flex-col gap-2">
        <div className="-mx-4 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0">
          <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">Show</span>
          <Link href={href({ index: ALL })} className={chipClass(code === ALL)}>
            Whole market
          </Link>
          {tracked.map((c) => (
            <Link key={c} href={href({ index: c })} className={chipClass(c === code)}>
              {c}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-1">
            <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">Change over</span>
            {PERIODS.map((p) => (
              <Link key={p.key} href={href({ period: p.key })} className={chipClass(p.key === period.key)}>
                {p.key}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">View</span>
            <Link href={href({ view: "boxes" })} className={chipClass(view === "boxes")}>
              Boxes
            </Link>
            <Link href={href({ view: "rings" })} className={chipClass(view === "rings")}>
              Rings
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Market cap" value={compactPkr(totalCap)} hint={`PKR, ${rows.length} companies`} />
        <StatTile
          label="Up / down"
          value={
            <span>
              <span style={{ color: "var(--heat-pos)" }}>{up}</span>
              <span className="text-slate-400"> / </span>
              <span style={{ color: "var(--heat-neg)" }}>{down}</span>
            </span>
          }
          hint={`over ${period.label.toLowerCase()}`}
        />
        <StatTile
          label="Cap-weighted change"
          value={<span className={toneClass(capWeighted)}>{pct(capWeighted)}</span>}
          hint="Bigger companies count for more"
        />
        <StatTile
          label="Largest company"
          value={rows[0] ? rows[0].view.symbol : "—"}
          hint={rows[0] ? `${compactPkr(rows[0].view.marketCap)} · ${pct((rows[0].view.marketCap! / totalCap) * 100, 1, false)} of the total` : undefined}
        />
      </div>

      <Card
        title={`Heatmap · ${period.label}`}
        subtitle={
          held.size > 0
            ? `${view === "rings" ? "Tap a sector to zoom in." : "Tap a box to open the stock."} Gold outline: you hold it.`
            : view === "rings" ? "Index in the centre, sectors around it, stocks on the outside. Tap a sector to zoom in." : "Tap a box to open the stock."
        }
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No market-cap data for this selection yet.</p>
        ) : (
          (() => {
            const data = rows.map(({ view: v, change }) => ({
              symbol: v.symbol,
              name: v.name,
              sector: v.sectorName ?? "Other",
              size: v.marketCap ?? 0,
              sizeText: `PKR ${compactPkr(v.marketCap)}`,
              changePct: change,
              close: v.close,
              held: held.has(v.symbol),
            }));
            return view === "rings" ? (
              <MarketSunburst
                key={`${code}-${period.key}`}
                data={data}
                centreLabel={code === ALL ? "PSX" : code}
                centreChangePct={capWeighted}
                sizeLabel="Market cap"
                changeLabel={period.label}
                fullColourPct={period.fullAt}
              />
            ) : (
              <MarketHeatmap
                tall
                sizeLabel="Market cap"
                changeLabel={period.label}
                fullColourPct={period.fullAt}
                data={data}
              />
            );
          })()
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sectors" subtitle={`Share of market cap and change over ${period.label.toLowerCase()}`} className="lg:col-span-2">
          <SectorTable data={sectors} />
        </Card>
        <Card title="Leaders and laggards" subtitle={`Among the 100 largest companies, ${period.label.toLowerCase()}`}>
          <div className="flex flex-col gap-4">
            <MoverList title="Best" rows={leaders} />
            <MoverList title="Worst" rows={laggards} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function MoverList({ title, rows }: { title: string; rows: { view: ConstituentView; change: number | null }[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      <ul className="tabular flex flex-col gap-1 text-sm">
        {rows.map(({ view, change }) => (
          <li key={view.symbol} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              <SymbolLink symbol={view.symbol} />
              <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">{view.name ?? ""}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="text-slate-600 dark:text-slate-400">{money(view.close)}</span>{" "}
              <span className={`font-medium ${toneClass(change)}`}>{pct(change)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
}
