import Link from "next/link";
import { getSectorSummaries } from "@/lib/sectors";
import { isDatabaseEmpty, getTrackedIndexCodes } from "@/lib/market";
import { indexLabel, sortIndexCodes, DEFAULT_INDEX } from "@/lib/psx/indices";
import { Card, PageHeader, EmptyState, TableWrap, Th, Td } from "@/components/ui";
import { pct, compactPkr, toneClass, sectorLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SectorsPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string }>;
}) {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const sp = await searchParams;
  const available = sortIndexCodes(getTrackedIndexCodes());
  const indexCode =
    sp.index && available.includes(sp.index.toUpperCase())
      ? sp.index.toUpperCase()
      : DEFAULT_INDEX;

  const sectors = getSectorSummaries(indexCode);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sectors"
        description={`Sector rollups within ${indexLabel(indexCode)}, ranked by free-float market cap.`}
      />

      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">Index</span>
        {available.map((code) => (
          <a
            key={code}
            href={`/sectors?index=${code}`}
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

      <Card title={`${sectors.length} sectors`}>
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Sector</Th>
                <Th align="right">Companies</Th>
                <Th align="right">Free-float cap</Th>
                <Th align="right">Avg day change</Th>
                <Th align="right">Avg P/E</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {sectors.map((s) => (
                <tr key={s.code} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <Td>
                    <Link
                      href={`/sector/${s.code}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {sectorLabel(s.name, s.code)}
                    </Link>
                  </Td>
                  <Td align="right">{s.memberCount}</Td>
                  <Td align="right">{compactPkr(s.totalFreeFloatCap)}</Td>
                  <Td align="right" className={toneClass(s.avgChangePct)}>
                    {pct(s.avgChangePct)}
                  </Td>
                  <Td align="right" className="text-slate-500">
                    {s.avgPe != null ? s.avgPe.toFixed(1) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Average P/E is a simple mean across companies that report one — it is not
        cap-weighted, and loss-making companies are excluded rather than counted
        as zero.
      </p>
    </div>
  );
}
