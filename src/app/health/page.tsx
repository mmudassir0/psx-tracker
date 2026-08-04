import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  symbols,
  quotesDaily,
  companyStats,
  announcements,
  payouts,
  financials,
  constituents,
  indexLevels,
  ingestRuns,
} from "@/db/schema";
import {
  isDatabaseEmpty,
  latestQuoteDate,
  getLastIngest,
  getTrackedIndexCodes,
} from "@/lib/market";
import { sortIndexCodes, indexLabel } from "@/lib/psx/indices";
import {
  Card,
  StatTile,
  PageHeader,
  EmptyState,
  Badge,
  SymbolLink,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
import { count as fmtCount, prettyDate, relativeTime } from "@/lib/format";
import { IngestButton } from "@/components/IngestButton";

export const dynamic = "force-dynamic";

/**
 * Data health.
 *
 * Coverage from PSX is uneven — some counters have no company page at all,
 * some have only weeks of price history — and silently incomplete data is
 * worse than visibly incomplete data. This page makes the gaps explicit.
 */
export default function HealthPage() {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const totals = {
    symbols: db.select({ c: sql<number>`count(*)` }).from(symbols).get()?.c ?? 0,
    quotes:
      db.select({ c: sql<number>`count(*)` }).from(quotesDaily).get()?.c ?? 0,
    stats:
      db
        .select({ c: sql<number>`count(distinct ${companyStats.symbol})` })
        .from(companyStats)
        .get()?.c ?? 0,
    announcements:
      db.select({ c: sql<number>`count(*)` }).from(announcements).get()?.c ?? 0,
    payouts:
      db.select({ c: sql<number>`count(*)` }).from(payouts).get()?.c ?? 0,
    financialCells:
      db.select({ c: sql<number>`count(*)` }).from(financials).get()?.c ?? 0,
    indexLevels:
      db.select({ c: sql<number>`count(*)` }).from(indexLevels).get()?.c ?? 0,
  };

  const noPage = db
    .select({ symbol: symbols.symbol, indexes: symbols.indexes })
    .from(symbols)
    .where(sql`${symbols.noCompanyPage} = 1`)
    .all();

  // History depth per symbol, so thin coverage is visible before it misleads
  // a backtest.
  const depth = db
    .select({
      symbol: quotesDaily.symbol,
      bars: sql<number>`count(*)`,
      first: sql<string>`min(${quotesDaily.date})`,
      last: sql<string>`max(${quotesDaily.date})`,
    })
    .from(quotesDaily)
    .groupBy(quotesDaily.symbol)
    .all();

  const buckets = [
    { label: "1000+ sessions", test: (n: number) => n > 1000 },
    { label: "250–1000", test: (n: number) => n > 250 && n <= 1000 },
    { label: "20–250", test: (n: number) => n > 20 && n <= 250 },
    { label: "under 20", test: (n: number) => n <= 20 },
  ].map((b) => ({
    label: b.label,
    count: depth.filter((d) => b.test(d.bars)).length,
  }));

  const thin = depth
    .filter((d) => d.bars <= 20)
    .sort((a, b) => a.bars - b.bars)
    .slice(0, 20);

  const quoteDate = latestQuoteDate();
  const stale = depth
    .filter((d) => quoteDate != null && d.last < quoteDate)
    .sort((a, b) => a.last.localeCompare(b.last))
    .slice(0, 20);

  const missingFundamentals = db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(
      sql`${symbols.noCompanyPage} = 0 and ${symbols.symbol} not in (select symbol from company_stats)`,
    )
    .all();

  const indexCodes = sortIndexCodes(getTrackedIndexCodes());
  const snapshotCounts = indexCodes.map((code) => {
    const row = db
      .select({ dates: sql<number>`count(distinct ${constituents.date})` })
      .from(constituents)
      .where(sql`${constituents.indexCode} = ${code}`)
      .get();
    return { code, snapshots: row?.dates ?? 0 };
  });

  const lastIngest = getLastIngest();
  const runs = db
    .select()
    .from(ingestRuns)
    .orderBy(sql`${ingestRuns.startedAt} desc`)
    .limit(8)
    .all();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Data health"
        description="What the database actually holds, and where PSX coverage is thin. Silently incomplete data is worse than visibly incomplete data."
        actions={<IngestButton />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Last ingest"
          value={relativeTime(lastIngest?.startedAt)}
          hint={
            lastIngest?.status === "ok" ? (
              <Badge tone="good">ok</Badge>
            ) : lastIngest?.status ? (
              <Badge tone="critical">{lastIngest.status}</Badge>
            ) : undefined
          }
          large
        />
        <StatTile
          label="Symbols tracked"
          value={fmtCount(totals.symbols)}
          hint={`${totals.stats} with fundamentals`}
        />
        <StatTile
          label="Price rows"
          value={fmtCount(totals.quotes)}
          hint={`latest ${prettyDate(quoteDate)}`}
        />
        <StatTile
          label="Index level rows"
          value={fmtCount(totals.indexLevels)}
          hint={`${indexCodes.length} indices`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Price history depth" subtitle="Sessions stored per symbol">
          <ul className="flex flex-col gap-2">
            {buckets.map((b) => {
              const max = Math.max(1, ...buckets.map((x) => x.count));
              return (
                <li key={b.label} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-xs">{b.label}</span>
                  <div className="h-4 flex-1">
                    <div
                      className="h-full rounded-[3px]"
                      style={{
                        width: `${(b.count / max) * 100}%`,
                        background: "var(--series-1)",
                        minWidth: b.count > 0 ? "2px" : 0,
                      }}
                    />
                  </div>
                  <span className="tabular w-12 shrink-0 text-right text-xs">
                    {b.count}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Symbols with thin history are excluded from backtests automatically
            — the strategy page reports how many it dropped.
          </p>
        </Card>

        <Card
          title="Content coverage"
          subtitle="Rows captured across the dataset"
        >
          <dl className="tabular flex flex-col gap-1.5 text-sm">
            <Row label="Announcements" value={fmtCount(totals.announcements)} />
            <Row label="Payouts (with rates)" value={fmtCount(totals.payouts)} />
            <Row
              label="Financial / ratio cells"
              value={fmtCount(totals.financialCells)}
            />
            <Row
              label="Companies with fundamentals"
              value={`${totals.stats} of ${totals.symbols}`}
            />
          </dl>
        </Card>
      </div>

      <Card
        title="Membership snapshots per index"
        subtitle="Recomposition needs at least two snapshots before it can detect anything"
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Index</Th>
                <Th>Name</Th>
                <Th align="right">Snapshots</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {snapshotCounts.map((s) => (
                <tr key={s.code}>
                  <Td>
                    <a
                      href={`/index/${s.code}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {s.code}
                    </a>
                  </Td>
                  <Td className="text-slate-600 dark:text-slate-400">
                    {indexLabel(s.code) === s.code ? "—" : indexLabel(s.code)}
                  </Td>
                  <Td align="right">{s.snapshots}</Td>
                  <Td>
                    {s.snapshots >= 2 ? (
                      <Badge tone="good">can detect changes</Badge>
                    ) : (
                      <Badge tone="warning">needs another day</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={`No PSX company page (${noPage.length})`}
          subtitle="PSX returns HTTP 500 for these; they get quotes and index membership but no fundamentals, so they carry no index weight"
        >
          {noPage.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {noPage.map((s) => (
                <span
                  key={s.symbol}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800"
                  title={s.indexes ?? undefined}
                >
                  {s.symbol}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">None.</p>
          )}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Mostly ex-dividend (XD), ex-bonus (XB) and non-compliant (NC)
            counters. Run{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
              npm run ingest -- --recheck-pages
            </code>{" "}
            to retry them.
          </p>
        </Card>

        <Card
          title={`Thinnest price history (${thin.length} shown)`}
          subtitle="Recently listed, or rarely traded"
        >
          {thin.length > 0 ? (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Symbol</Th>
                    <Th align="right">Sessions</Th>
                    <Th>First</Th>
                    <Th>Last</Th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {thin.map((d) => (
                    <tr key={d.symbol}>
                      <Td>
                        <SymbolLink symbol={d.symbol} />
                      </Td>
                      <Td align="right">{d.bars}</Td>
                      <Td className="text-slate-500">{prettyDate(d.first)}</Td>
                      <Td className="text-slate-500">{prettyDate(d.last)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-sm text-slate-500">
              Every symbol has meaningful history.
            </p>
          )}
        </Card>
      </div>

      {stale.length > 0 && (
        <Card
          title={`Not quoted in the latest session (${stale.length} shown)`}
          subtitle={`No price on ${prettyDate(quoteDate)} — usually suspended or simply untraded that day`}
        >
          <div className="flex flex-wrap gap-1.5">
            {stale.map((d) => (
              <span
                key={d.symbol}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800"
                title={`last seen ${d.last}`}
              >
                {d.symbol}
                <span className="ml-1 text-slate-500">{d.last.slice(5)}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {missingFundamentals.length > 0 && (
        <Card
          title={`Company page exists but no fundamentals yet (${missingFundamentals.length})`}
          subtitle="Will fill in on the next full ingest"
        >
          <div className="flex flex-wrap gap-1.5">
            {missingFundamentals.slice(0, 60).map((s) => (
              <span
                key={s.symbol}
                className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800"
              >
                {s.symbol}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card title="Recent ingest runs">
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Status</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td className="tabular whitespace-nowrap">
                    {r.startedAt
                      ? new Date(r.startedAt).toLocaleString("en-GB")
                      : "—"}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        r.status === "ok"
                          ? "good"
                          : r.status === "error"
                            ? "critical"
                            : "neutral"
                      }
                    >
                      {r.status}
                    </Badge>
                  </Td>
                  <Td className="max-w-[520px] truncate text-slate-500">
                    {r.detail ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-1.5 dark:border-slate-800">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
