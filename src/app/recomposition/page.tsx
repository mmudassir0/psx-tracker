import {
  getRecompositionHistory,
  getMembershipRuns,
  getSnapshotCoverage,
} from "@/lib/recomposition";
import { getPortfolio } from "@/lib/portfolio";
import { isDatabaseEmpty, getTrackedIndexCodes } from "@/lib/market";
import {
  getIndexMeta,
  sortIndexCodes,
  DEFAULT_INDEX,
} from "@/lib/psx/indices";
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
import { prettyDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RecompositionPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string }>;
}) {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to capture the first membership snapshot.
      </EmptyState>
    );
  }

  const { index: indexParam } = await searchParams;
  const available = sortIndexCodes(getTrackedIndexCodes());
  const indexCode =
    indexParam && available.includes(indexParam.toUpperCase())
      ? indexParam.toUpperCase()
      : DEFAULT_INDEX;
  const meta = getIndexMeta(indexCode);

  const events = getRecompositionHistory(indexCode);
  const runs = getMembershipRuns(indexCode);
  const coverage = getSnapshotCoverage(indexCode);
  const portfolio = getPortfolio();
  const heldSymbols = new Set(
    portfolio.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol),
  );

  const formerMembers = runs.filter((r) => !r.current);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={
          meta.shariah ? "Shariah recomposition tracker" : "Recomposition tracker"
        }
        description={
          meta.shariah ? (
            <>
              {meta.name ?? indexCode} membership is a Shariah screen. When a
              company is dropped it no longer meets that screen — this page
              watches for that by diffing daily membership snapshots.
            </>
          ) : (
            <>
              Membership changes in {meta.name ?? indexCode}, found by diffing
              daily snapshots.
            </>
          )
        }
      />

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">
          Index
        </span>
        {available.map((code) => (
          <a
            key={code}
            href={`/recomposition?index=${code}`}
            className={
              code === indexCode
                ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
            }
          >
            {code}
          </a>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Snapshots captured"
          value={coverage.count}
          hint={
            coverage.first
              ? `Since ${prettyDate(coverage.first)}`
              : "None yet"
          }
          large
        />
        <StatTile
          label="Recomposition events"
          value={events.length}
          hint="Days where membership changed"
        />
        <StatTile
          label="Former constituents"
          value={formerMembers.length}
          hint="Seen in a snapshot, not in the latest"
        />
      </div>

      {coverage.count < 2 && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="font-medium">Only one snapshot so far</p>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Changes are detected by comparing snapshots, so this page needs at
            least two ingests on different days before it can report anything.
            History starts when you first ran the ingest — earlier changes
            cannot be reconstructed, because PSX does not publish a membership
            archive here.
          </p>
        </div>
      )}

      {events.length > 0 && (
        <Card
          title="Recomposition events"
          subtitle="Newest first. Dropped names left the Shariah screen for this index."
        >
          <ol className="flex flex-col gap-3">
            {events.map((event) => (
              <li
                key={event.date}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">
                    {prettyDate(event.date)}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    vs {prettyDate(event.previousDate)}
                  </span>
                </div>

                {event.dropped.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                    <Badge tone="critical">dropped</Badge>
                    {event.dropped.map((s) => (
                      <span key={s} className="flex items-center gap-1">
                        <SymbolLink symbol={s} />
                        {heldSymbols.has(s) && (
                          <Badge tone="warning">you hold this</Badge>
                        )}
                      </span>
                    ))}
                  </div>
                )}

                {event.added.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                    <Badge tone="good">added</Badge>
                    {event.added.map((s) => (
                      <SymbolLink key={s} symbol={s} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {formerMembers.length > 0 && (
        <Card
          title="Former constituents"
          subtitle="Present in an earlier snapshot but not the latest"
        >
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th>First seen</Th>
                  <Th>Last seen</Th>
                  <Th align="right">Snapshots</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {formerMembers.map((run) => (
                  <tr key={run.symbol}>
                    <Td>
                      <SymbolLink symbol={run.symbol} />
                    </Td>
                    <Td>{prettyDate(run.firstSeen)}</Td>
                    <Td>{prettyDate(run.lastSeen)}</Td>
                    <Td align="right">{run.snapshots}</Td>
                    <Td>
                      {heldSymbols.has(run.symbol) ? (
                        <Badge tone="critical">held and dropped</Badge>
                      ) : (
                        <Badge tone="neutral">not held</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <Card
        title="Current membership"
        subtitle={`${runs.filter((r) => r.current).length} constituents as of ${prettyDate(coverage.last)}`}
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Symbol</Th>
                <Th>First seen in snapshots</Th>
                <Th align="right">Snapshots</Th>
                <Th>Held</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {runs
                .filter((r) => r.current)
                .map((run) => (
                  <tr
                    key={run.symbol}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td>
                      <SymbolLink symbol={run.symbol} />
                    </Td>
                    <Td>{prettyDate(run.firstSeen)}</Td>
                    <Td align="right">{run.snapshots}</Td>
                    <Td>
                      {heldSymbols.has(run.symbol) ? (
                        <Badge tone="good">yes</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
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
