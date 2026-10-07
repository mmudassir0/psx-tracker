import { getCurrentUserId } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSectorMembers, getSectorName } from "@/lib/sectors";
import { isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { ScreenerTable } from "@/components/ScreenerTable";
import { toScreenerRow } from "@/lib/screener-row";
import { DivergingBars } from "@/components/DivergingBars";
import { MarketSunburst } from "@/components/MarketSunburst";
import {
  Card, StatTile, PageHeader, EmptyState,
} from "@/components/ui";
import { compactPkr, pct, prettyDate, sectorLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SectorPage({
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

  const { code } = await params;
  const members = await getSectorMembers(code);
  if (members.length === 0) return notFound();

  const name = await getSectorName(code);
  const portfolio = await getPortfolio(await getCurrentUserId());
  const held = new Set(
    portfolio.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol),
  );
  const heldHere = members.filter((m) => held.has(m.symbol));

  const advancers = members.filter((m) => (m.changePct ?? 0) > 0).length;
  const decliners = members.filter((m) => (m.changePct ?? 0) < 0).length;

  const byChange = [...members]
    .filter((m) => m.changePct != null)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))
    .slice(0, 30);

  const quoteDate = await latestQuoteDate();
  const capped = members.filter((m) => (m.marketCap ?? 0) > 0 && m.changePct != null);
  const capTotal = capped.reduce((s, m) => s + (m.marketCap ?? 0), 0);
  const weighted = capTotal > 0 ? capped.reduce((s, m) => s + m.changePct! * (m.marketCap ?? 0), 0) / capTotal : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={sectorLabel(name, code)}
        description={`PSX sector ${code} · session ${prettyDate(quoteDate)}`}
        actions={
          <Link href="/sectors" className="text-xs underline underline-offset-2">
            ← All sectors
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Companies" value={members.length} large />
        <StatTile
          label="Advancers / Decliners"
          value={
            <span>
              <span style={{ color: "var(--diverge-pos-mid)" }}>{advancers}</span>
              <span className="text-slate-400"> / </span>
              <span style={{ color: "var(--diverge-neg-mid)" }}>{decliners}</span>
            </span>
          }
        />
        <StatTile
          label="Free-float cap"
          value={compactPkr(members.reduce((s, m) => s + (m.freeFloatCap ?? 0), 0))}
        />
        <StatTile
          label="Your holdings here"
          value={heldHere.length}
          hint={
            heldHere.length > 0
              ? heldHere.map((h) => h.symbol).join(", ")
              : undefined
          }
        />
      </div>

      {members.some((m) => (m.marketCap ?? 0) > 0) && (
        <Card
          title="Sector map"
          subtitle={`Each company sized by market cap, coloured by today's change. Tap a company for details; tap the centre to see the whole ring.`}
        >
          <MarketSunburst
            initialFocus={sectorLabel(name, code)}
            centreLabel={sectorLabel(name, code)}
            sizeLabel="Market cap"
            changeLabel="Today"
            data={members
              .filter((m) => (m.marketCap ?? 0) > 0)
              .map((m) => ({
                symbol: m.symbol,
                name: m.name,
                sector: sectorLabel(name, code),
                size: m.marketCap ?? 0,
                sizeText: `PKR ${compactPkr(m.marketCap)}`,
                changePct: m.changePct,
                close: m.close,
                held: held.has(m.symbol),
              }))}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Whole market view:{" "}
            <Link href="/heatmap?view=rings" className="underline">
              Heatmap
            </Link>
            . Weighted change today: {pct(weighted)}.
          </p>
        </Card>
      )}

      <Card title="Day change" subtitle={byChange.length < members.length ? `Top ${byChange.length} of ${members.length}` : "All companies"}>
        {byChange.length > 0 ? (
          <DivergingBars
            data={byChange.map((c) => ({
              symbol: c.symbol,
              name: c.name,
              value: c.changePct,
              close: c.close,
              volume: c.avgVolume30d,
              weightPct: c.indexWeightPct,
            }))}
          />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No quote data.</p>
        )}
      </Card>

      <Card title="Companies">
        <ScreenerTable rows={members.map(toScreenerRow)} />
      </Card>
    </div>
  );
}
