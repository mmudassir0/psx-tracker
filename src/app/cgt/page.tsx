import Link from "next/link";
import { summariseByTaxYear, computeDisposals, type CostMethod } from "@/lib/cgt";
import { isDatabaseEmpty } from "@/lib/market";
import {
  Card,
  StatTile,
  PageHeader,
  EmptyState,
  SymbolLink,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
import { money, signedMoney, count, prettyDate, toneClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CgtPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string }>;
}) {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> first.
      </EmptyState>
    );
  }

  const { method: methodParam } = await searchParams;
  const method: CostMethod = methodParam === "fifo" ? "fifo" : "average";

  const years = summariseByTaxYear(method);
  const other: CostMethod = method === "fifo" ? "average" : "fifo";
  const otherTotal = computeDisposals(other).reduce((s, d) => s + d.gain, 0);
  const thisTotal = years.reduce((s, y) => s + y.netGain, 0);

  if (years.length === 0) {
    return (
      <div>
        <PageHeader
          title="Capital gains"
          description="Realised gains by tax year, from your transaction ledger."
        />
        <EmptyState title="No disposals yet">
          Realised gains appear here once you record a sell on the{" "}
          <Link href="/portfolio" className="underline">
            portfolio page
          </Link>
          .
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Capital gains"
        description="Realised gains by Pakistani tax year (1 July – 30 June), computed from your ledger."
      />

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
        <p className="font-medium">This is a working, not a tax return.</p>
        <p className="mt-1">
          CGT rates in Pakistan depend on holding period, acquisition date and
          filer status — none of which this models. It computes disposals and
          cost basis so your accountant has the arithmetic; it does not compute
          tax owed, and it is not tax advice.
        </p>
      </div>

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">
          Cost method
        </span>
        <a
          href="/cgt?method=average"
          className={chipClass(method === "average")}
        >
          Weighted average
        </a>
        <a href="/cgt?method=fifo" className={chipClass(method === "fifo")}>
          FIFO
        </a>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
        <p>
          <span className="font-medium">The method changes the answer.</span>{" "}
          Under{" "}
          <span className="font-medium">
            {method === "fifo" ? "FIFO" : "weighted average"}
          </span>{" "}
          your total realised gain is{" "}
          <span className="tabular font-medium">{money(thisTotal)}</span>; under{" "}
          {other === "fifo" ? "FIFO" : "weighted average"} it is{" "}
          <span className="tabular font-medium">{money(otherTotal)}</span> — a
          difference of{" "}
          <span className="tabular font-medium">
            {money(Math.abs(thisTotal - otherTotal))}
          </span>
          . The portfolio page uses weighted average. Which one applies to you
          is a question for your accountant.
        </p>
      </div>

      {years.map((year) => (
        <Card
          key={year.taxYear}
          title={`Tax year ${year.taxYear}`}
          subtitle={`${year.disposals.length} disposal${year.disposals.length === 1 ? "" : "s"}`}
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Net realised gain"
              value={
                <span className={toneClass(year.netGain)}>
                  {signedMoney(year.netGain)}
                </span>
              }
              hint="Proceeds less cost basis"
            />
            <StatTile label="Gains" value={money(year.realisedGains)} />
            <StatTile label="Losses" value={money(year.realisedLosses)} />
            <StatTile
              label="Dividend income"
              value={money(year.dividendIncome)}
              hint="Net of tax withheld, taxed separately"
            />
          </div>

          {year.disposals.length > 0 && (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Symbol</Th>
                    <Th align="right">Quantity</Th>
                    <Th align="right">Proceeds</Th>
                    <Th align="right">Cost basis</Th>
                    <Th align="right">Gain / (loss)</Th>
                    <Th align="right">Held</Th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {year.disposals.map((d, i) => (
                    <tr key={`${d.symbol}-${d.date}-${i}`}>
                      <Td>{prettyDate(d.date)}</Td>
                      <Td>
                        <SymbolLink symbol={d.symbol} />
                      </Td>
                      <Td align="right">{count(d.quantity)}</Td>
                      <Td align="right">{money(d.proceeds)}</Td>
                      <Td align="right">{money(d.costBasis)}</Td>
                      <Td align="right" className={toneClass(d.gain)}>
                        {signedMoney(d.gain)}
                      </Td>
                      <Td align="right" className="text-slate-500">
                        {d.holdingDays != null ? `${d.holdingDays}d` : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tabular border-t-2 border-slate-300 font-medium dark:border-slate-700">
                    <Td>Total</Td>
                    <Td />
                    <Td />
                    <Td align="right">{money(year.proceeds)}</Td>
                    <Td align="right">{money(year.costBasis)}</Td>
                    <Td align="right" className={toneClass(year.netGain)}>
                      {signedMoney(year.netGain)}
                    </Td>
                    <Td />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
        </Card>
      ))}

      <Card title="Export">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Download every disposal as CSV for your accountant.
        </p>
        <a
          href={`/api/cgt.csv?method=${method}`}
          className="inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Download CSV ({method === "fifo" ? "FIFO" : "weighted average"})
        </a>
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Holding period is only meaningful under FIFO, where each disposal is
        matched to a specific purchase lot. Weighted average has no single
        acquisition date, so that column stays blank.
      </p>
    </div>
  );
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
}
