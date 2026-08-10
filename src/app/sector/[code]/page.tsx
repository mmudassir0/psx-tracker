import Link from "next/link";
import { notFound } from "next/navigation";
import { getSectorMembers, getSectorName } from "@/lib/sectors";
import { isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { ScreenerTable } from "@/components/ScreenerTable";
import { DivergingBars } from "@/components/DivergingBars";
import {
  Card, StatTile, PageHeader, EmptyState, SymbolLink,
} from "@/components/ui";
import { pct, compactPkr, prettyDate, sectorLabel } from "@/lib/format";

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
  const portfolio = await getPortfolio();
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

      <Card title="Day change" subtitle={byChange.length < members.length ? `Top ${byChange.length} of ${members.length}` : "All companies"}>
        {byChange.length > 0 ? (
          <DivergingBars
            data={byChange.map((c) => ({
              symbol: c.symbol,
              name: c.name,
              value: c.changePct,
              close: c.close,
              volume: c.volume,
              weightPct: c.indexWeightPct,
            }))}
          />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No quote data.</p>
        )}
      </Card>

      <Card title="Companies">
        <ScreenerTable rows={members} />
      </Card>
    </div>
  );
}
