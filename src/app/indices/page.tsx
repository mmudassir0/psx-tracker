import Link from "next/link";
import { getIndexSummaries, isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { getIndexMeta, sortIndexCodes } from "@/lib/psx/indices";
import { Card, PageHeader, EmptyState, Badge, TableWrap, Th, Td } from "@/components/ui";
import { pct, prettyDate, toneClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function IndicesPage() {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const summaries = getIndexSummaries();
  const order = sortIndexCodes(summaries.map((s) => s.code));
  const rows = order
    .map((code) => summaries.find((s) => s.code === code)!)
    .filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="PSX indices"
        description={
          <>
            Every index PSX quotes, with the constituents we last captured.
            Session {prettyDate(latestQuoteDate())}.
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const meta = getIndexMeta(row.code);
          return (
            <Link
              key={row.code}
              href={`/index/${row.code}`}
              className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold tracking-tight">
                      {meta.name ?? row.code}
                    </span>
                    {meta.shariah && <Badge tone="good">Shariah</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {meta.name ? row.code : "PSX code"}
                    {" · "}
                    {row.memberCount} constituents
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight">
                  {row.level != null
                    ? row.level.toLocaleString("en-PK", {
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </span>
                <span
                  className={`text-sm font-medium ${toneClass(row.changePct)}`}
                >
                  {pct(row.changePct)}
                </span>
              </div>

              {meta.note && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {meta.note}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <Card title="All indices" subtitle="Same data, sortable table view">
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th align="right">Level</Th>
                <Th align="right">Change</Th>
                <Th align="right">Constituents</Th>
                <Th>Snapshot</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((row) => {
                const meta = getIndexMeta(row.code);
                return (
                  <tr
                    key={row.code}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td>
                      <Link
                        href={`/index/${row.code}`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {row.code}
                      </Link>
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-400">
                      {meta.name ?? "—"}
                      {meta.shariah && (
                        <>
                          {" "}
                          <Badge tone="good">Shariah</Badge>
                        </>
                      )}
                    </Td>
                    <Td align="right">
                      {row.level != null
                        ? row.level.toLocaleString("en-PK", {
                            maximumFractionDigits: 2,
                          })
                        : "—"}
                    </Td>
                    <Td align="right" className={toneClass(row.changePct)}>
                      {pct(row.changePct)}
                    </Td>
                    <Td align="right">{row.memberCount}</Td>
                    <Td className="text-slate-500">
                      {prettyDate(row.snapshotDate)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        PSX publishes only the index code, so display names are filled in where
        they are unambiguous; sponsor-branded indices show their code rather
        than a guessed name. The Shariah badge marks indices that are
        Shariah-screened by construction — its absence is not a claim either
        way.
      </p>
    </div>
  );
}
