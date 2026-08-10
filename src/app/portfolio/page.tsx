import Link from "next/link";
import { getPortfolio, listTransactions } from "@/lib/portfolio";
import { getConstituents, isDatabaseEmpty } from "@/lib/market";
import { deleteTransactionAction } from "@/app/actions";
import { TransactionForm } from "@/components/TransactionForm";
import { DivergingBars } from "@/components/DivergingBars";
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
import {
  money,
  pct,
  count,
  compactPkr,
  prettyDate,
  toneClass,
  signedMoney,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No market data yet">
        Run <code>npm run setup</code> first so holdings can be priced.
      </EmptyState>
    );
  }

  const [portfolio, ledger, constituents] = await Promise.all([
    getPortfolio(),
    listTransactions(),
    getConstituents(),
  ]);
  const openPositions = portfolio.holdings.filter((h) => h.quantity > 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Portfolio"
        description="Your holdings priced against the latest session, with cost basis on a weighted-average method and your weights compared to the index."
      />

      {portfolio.droppedHoldings.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-800 dark:bg-rose-950/40">
          <p className="font-medium">
            ⚠️ Holdings no longer in KMI30:{" "}
            {portfolio.droppedHoldings.join(", ")}
          </p>
          <p className="mt-1">
            These are outside the index&apos;s Shariah screen. Prices for them
            stop updating because the ingest only tracks current constituents.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Market value"
          value={compactPkr(portfolio.marketValue)}
          hint={`${openPositions.length} open position${openPositions.length === 1 ? "" : "s"}`}
          large
        />
        <StatTile
          label="Invested"
          value={compactPkr(portfolio.investedValue)}
          hint="At weighted-average cost"
        />
        <StatTile
          label="Unrealised P&L"
          value={
            <span className={toneClass(portfolio.unrealizedPnl)}>
              {signedMoney(portfolio.unrealizedPnl)}
            </span>
          }
          delta={portfolio.investedValue > 0 ? portfolio.unrealizedPct : null}
        />
        <StatTile
          label="Realised P&L"
          value={
            <span className={toneClass(portfolio.realizedPnl)}>
              {signedMoney(portfolio.realizedPnl)}
            </span>
          }
          hint="From closed quantity"
        />
        <StatTile
          label="Dividend income"
          value={
            <span className={toneClass(portfolio.dividendIncome)}>
              {signedMoney(portfolio.dividendIncome)}
            </span>
          }
          hint="Net of tax withheld"
        />
      </div>

      {openPositions.length === 0 ? (
        <Card title="Add your first transaction">
          <TransactionForm symbols={constituents.map((c) => c.symbol)} />
        </Card>
      ) : (
        <>
          <Card
            title="Holdings"
            subtitle="Active weight is your weight minus the index weight — positive means overweight."
          >
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Symbol</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Avg cost</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">Unrealised</Th>
                    <Th align="right">Your wt</Th>
                    <Th align="right">Index wt</Th>
                    <Th align="right">Active wt</Th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {openPositions.map((h) => (
                    <tr
                      key={h.symbol}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <SymbolLink symbol={h.symbol} />
                          {h.droppedFromIndex && (
                            <Badge tone="critical">dropped</Badge>
                          )}
                        </div>
                      </Td>
                      <Td align="right">{count(h.quantity)}</Td>
                      <Td align="right">{money(h.avgCost)}</Td>
                      <Td align="right">{money(h.close)}</Td>
                      <Td align="right">{money(h.marketValue)}</Td>
                      <Td align="right" className={toneClass(h.unrealizedPnl)}>
                        {signedMoney(h.unrealizedPnl)}
                        <span className="ml-1 text-xs">
                          ({pct(h.unrealizedPct)})
                        </span>
                      </Td>
                      <Td align="right">
                        {pct(h.portfolioWeightPct, 1, false)}
                      </Td>
                      <Td align="right" className="text-slate-500">
                        {pct(h.indexWeightPct, 1, false)}
                      </Td>
                      <Td align="right" className={toneClass(h.activeWeightPct)}>
                        {pct(h.activeWeightPct, 1)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Active weight vs KMI30"
              subtitle="How far each position sits above or below its index weight"
            >
              <DivergingBars
                data={openPositions
                  .slice()
                  .sort(
                    (a, b) =>
                      (b.activeWeightPct ?? 0) - (a.activeWeightPct ?? 0),
                  )
                  .map((h) => ({
                    symbol: h.symbol,
                    name: h.name,
                    value: h.activeWeightPct,
                    close: h.close,
                    volume: null,
                    weightPct: h.indexWeightPct,
                  }))}
                valueSuffix="pp"
                positiveLabel="Overweight"
                negativeLabel="Underweight"
              />
            </Card>

            <Card
              title="Sector exposure"
              subtitle="Your sector weights against the index's"
            >
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>Sector</Th>
                      <Th align="right">Yours</Th>
                      <Th align="right">Index</Th>
                      <Th align="right">Active</Th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {portfolio.sectors.map((s) => (
                      <tr key={s.sector}>
                        <Td className="max-w-[200px] truncate">{s.sector}</Td>
                        <Td align="right">
                          {pct(s.portfolioWeightPct, 1, false)}
                        </Td>
                        <Td align="right" className="text-slate-500">
                          {pct(s.indexWeightPct, 1, false)}
                        </Td>
                        <Td
                          align="right"
                          className={toneClass(s.activeWeightPct)}
                        >
                          {pct(s.activeWeightPct, 1)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </div>

          <Card title="Record a transaction">
            <TransactionForm symbols={constituents.map((c) => c.symbol)} />
          </Card>
        </>
      )}

      {ledger.length > 0 && (
        <Card title="Transaction ledger" subtitle={`${ledger.length} entries`}>
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Symbol</Th>
                  <Th>Type</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Fees</Th>
                  <Th>Note</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {ledger.map((tx) => (
                  <tr key={tx.id}>
                    <Td>{prettyDate(tx.date)}</Td>
                    <Td>
                      <SymbolLink symbol={tx.symbol} />
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          tx.type === "sell"
                            ? "warning"
                            : tx.type === "dividend"
                              ? "good"
                              : "neutral"
                        }
                      >
                        {tx.type}
                      </Badge>
                    </Td>
                    <Td align="right">{count(tx.quantity)}</Td>
                    <Td align="right">{money(tx.price)}</Td>
                    <Td align="right">{money(tx.fees)}</Td>
                    <Td className="max-w-[200px] truncate text-slate-500">
                      {tx.note ?? "—"}
                    </Td>
                    <Td align="right">
                      <form action={deleteTransactionAction}>
                        <input type="hidden" name="id" value={tx.id} />
                        <button
                          type="submit"
                          className="text-xs text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                        >
                          Delete
                        </button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Positions are priced at the last stored close, not live. See{" "}
        <Link href="/" className="underline">
          the dashboard
        </Link>{" "}
        for session freshness.
      </p>
    </div>
  );
}
