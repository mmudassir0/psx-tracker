import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getConstituents,
  getLatestIndexLevel,
  getSectorBreakdown,
  getTrackedIndexCodes,
  getIndexHistory,
  latestConstituentDate,
  latestQuoteDate,
  isDatabaseEmpty,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { getRecompositionHistory } from "@/lib/recomposition";
import { getIndexMeta } from "@/lib/psx/indices";
import { DivergingBars, WeightBars } from "@/components/DivergingBars";
import { PriceChart } from "@/components/PriceChart";
import { ScreenerTable } from "@/components/ScreenerTable";
import {
  Card,
  StatTile,
  PageHeader,
  EmptyState,
  Badge,
  SymbolLink,
} from "@/components/ui";
import {
  pct,
  compactPkr,
  prettyDate,
  toneClass,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function IndexPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const { code: raw } = await params;
  const code = raw.toUpperCase();

  const trackedCodes = await getTrackedIndexCodes();
  const known = new Set(trackedCodes);
  if (!known.has(code)) notFound();

  const meta = getIndexMeta(code);
  const constituents = await getConstituents(code);
  const level = await getLatestIndexLevel(code);
  const sectors = getSectorBreakdown(constituents);
  const snapshotDate = await latestConstituentDate(code);
  const recomposition = await getRecompositionHistory(code);
  const levelHistory = await getIndexHistory(code);
  const quoteDate = await latestQuoteDate();

  const portfolio = await getPortfolio();
  const held = new Set(
    portfolio.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol),
  );
  const heldInIndex = constituents.filter((c) => held.has(c.symbol));

  const advancers = constituents.filter((c) => (c.changePct ?? 0) > 0).length;
  const decliners = constituents.filter((c) => (c.changePct ?? 0) < 0).length;

  const byChange = [...constituents]
    .filter((c) => c.changePct != null)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));

  const topGainers = byChange.slice(0, 5);
  const topLosers = [...byChange].reverse().slice(0, 5);

  // A 400-name index would make an unreadable bar chart; show the extremes.
  const MAX_BARS = 40;
  const truncated = byChange.length > MAX_BARS;
  const bars = truncated
    ? [...byChange.slice(0, MAX_BARS / 2), ...byChange.slice(-MAX_BARS / 2)]
    : byChange;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={meta.name ?? code}
        description={
          <>
            {meta.name ? code : "PSX index code"}
            {meta.shariah && (
              <>
                {" "}
                <Badge tone="good">Shariah-screened</Badge>
              </>
            )}
            {" · Session "}
            {prettyDate(quoteDate)}
          </>
        }
        actions={
          <Link
            href="/indices"
            className="text-xs underline underline-offset-2"
          >
            ← All indices
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Index level"
          value={
            level
              ? level.current.toLocaleString("en-PK", {
                  maximumFractionDigits: 2,
                })
              : "—"
          }
          delta={level?.changePct ?? null}
          large
        />
        <StatTile
          label="Advancers / Decliners"
          value={
            <span>
              <span style={{ color: "var(--diverge-pos-mid)" }}>{advancers}</span>
              <span className="text-slate-400"> / </span>
              <span style={{ color: "var(--diverge-neg-mid)" }}>{decliners}</span>
            </span>
          }
          hint={`of ${constituents.length} constituents`}
        />
        <StatTile
          label="Free-float cap"
          value={compactPkr(
            constituents.reduce((sum, c) => sum + (c.freeFloatCap ?? 0), 0),
          )}
          hint="PKR, sum of constituents"
        />
        <StatTile
          label="Your holdings here"
          value={heldInIndex.length}
          hint={
            heldInIndex.length > 0 ? (
              <span>
                {compactPkr(
                  heldInIndex.reduce((sum, c) => {
                    const h = portfolio.holdings.find(
                      (x) => x.symbol === c.symbol,
                    );
                    return sum + (h?.marketValue ?? 0);
                  }, 0),
                )}{" "}
                at market
              </span>
            ) : (
              <Link href="/portfolio" className="underline">
                Add holdings
              </Link>
            )
          }
        />
      </div>

      {recomposition.length > 0 && (
        <Card
          title="Recent membership changes"
          subtitle={`${recomposition.length} change${recomposition.length === 1 ? "" : "s"} since tracking began`}
        >
          <ul className="flex flex-col gap-2 text-sm">
            {recomposition.slice(0, 5).map((event) => (
              <li key={event.date} className="flex flex-wrap items-center gap-2">
                <span className="tabular w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {prettyDate(event.date)}
                </span>
                {event.dropped.length > 0 && (
                  <>
                    <Badge tone="critical">out</Badge>
                    {event.dropped.map((s) => (
                      <SymbolLink key={s} symbol={s} />
                    ))}
                  </>
                )}
                {event.added.length > 0 && (
                  <>
                    <Badge tone="good">in</Badge>
                    {event.added.map((s) => (
                      <SymbolLink key={s} symbol={s} />
                    ))}
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Index level"
        subtitle={`${levelHistory.length} sessions of history`}
      >
        <PriceChart
          data={levelHistory.map((r) => ({ date: r.date, close: r.current }))}
          label={code}
          height={300}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Day change by constituent"
          subtitle={
            truncated
              ? `Top and bottom ${MAX_BARS / 2} of ${byChange.length} — see the table below for all`
              : "Sorted best to worst"
          }
          className="lg:col-span-2"
        >
          {bars.length > 0 ? (
            <DivergingBars
              data={bars.map((c) => ({
                symbol: c.symbol,
                name: c.name,
                value: c.changePct,
                close: c.close,
                volume: c.volume,
                weightPct: c.indexWeightPct,
              }))}
            />
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No quote data yet.
            </p>
          )}
        </Card>

        <Card title="Sector weights" subtitle="Share of free-float market cap">
          <WeightBars
            data={sectors
              .slice(0, 16)
              .map((s) => ({ label: s.sector, value: s.weightPct }))}
          />
        </Card>
      </div>

      <Card
        title="Constituents"
        subtitle={`${constituents.length} companies as of ${prettyDate(snapshotDate)}. Weights are uncapped free-float market cap.`}
      >
        <ScreenerTable rows={constituents} />
      </Card>

      <Link
        href={`/calendar?index=${code}`}
        className="text-sm underline underline-offset-2"
      >
        View corporate actions for {meta.name ?? code} →
      </Link>
    </div>
  );
}
