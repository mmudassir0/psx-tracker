import Link from "next/link";
import { getConstituents, getTrackedIndexCodes, isDatabaseEmpty } from "@/lib/market";
import { DEFAULT_INDEX, indexLabel, sortIndexCodes } from "@/lib/psx/indices";
import { ScreenerTable } from "@/components/ScreenerTable";
import { toScreenerRow } from "@/lib/screener-row";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const tracked = sortIndexCodes(await getTrackedIndexCodes());
  const requested = (await searchParams).index?.toUpperCase();
  const code = requested && tracked.includes(requested) ? requested : DEFAULT_INDEX;
  const rows = await getConstituents(code);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Screener"
        description={
          `Sort and filter the ${rows.length} ${indexLabel(code)} companies on valuation, momentum and size. Click any column header to sort.` +
          (code === "ALLSHR" ? "" : " Pick ALLSHR for the whole market.")
        }
      />
      <div className="-mx-4 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0">
        <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">Index</span>
        {tracked.map((c) => (
          <Link
            key={c}
            href={`/screener?index=${c}`}
            className={
              c === code
                ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
            }
          >
            {c}
          </Link>
        ))}
      </div>
      <Card>
        <ScreenerTable rows={rows.map(toScreenerRow)} />
      </Card>
    </div>
  );
}
