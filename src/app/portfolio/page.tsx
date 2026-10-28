import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPortfolio, listTransactions } from "@/lib/portfolio";
import { ensureDefaultPortfolio, listPortfolios } from "@/lib/portfolios";
import { getPortfolioHistory } from "@/lib/portfolio-history";
import { getConstituents, getTrackedIndexCodes, isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { ledgerCashFlows, xirr } from "@/lib/xirr";
import { todayPkt, weekdaysBetween } from "@/lib/dates";
import { forecastDividends } from "@/lib/dividend-forecast";
import { getBenchmarkIndex } from "@/lib/benchmark";
import { BENCHMARK_CHOICES, SHARIAH_INDEX_CODES } from "@/lib/psx/indices";
import { BenchmarkPicker } from "@/components/BenchmarkPicker";
import { deleteTransactionAction, moveTransactionAction } from "@/app/actions";
import { TransactionForm } from "@/components/TransactionForm";
import { DividendForm } from "@/components/DividendForm";
import { EditPortfolioForm, NewPortfolioForm } from "@/components/PortfolioManager";
import { PortfolioHistoryChart } from "@/components/PortfolioHistoryChart";
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

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser("/portfolio");
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No market data yet">
        Run <code>npm run setup</code> first so holdings can be priced.
      </EmptyState>
    );
  }

  // Every user has at least one portfolio; "Main" is created on first visit.
  const defaultId = await ensureDefaultPortfolio(user.id);
  const portfolios = await listPortfolios(user.id);
  const { p } = await searchParams;
  // ?p=<id> views one portfolio; anything else is all of them combined.
  const selected = portfolios.find((x) => x.id === p) ?? null;
  const scope = { portfolioId: selected?.id ?? null };
  // With a single portfolio, "all" and that portfolio are the same view.
  const editable = selected ?? (portfolios.length === 1 ? portfolios[0] : null);

  const [benchmark, tracked] = await Promise.all([getBenchmarkIndex(user.id), getTrackedIndexCodes()]);
  const shariahBenchmark = SHARIAH_INDEX_CODES.includes(benchmark);
  const [portfolio, ledger, constituents, history] = await Promise.all([
    getPortfolio(user.id, scope, benchmark),
    listTransactions(user.id, scope),
    // Any listed stock can be recorded, not just index members.
    getConstituents("ALLSHR"),
    getPortfolioHistory(user.id, scope, benchmark),
  ]);
  const openPositions = portfolio.holdings.filter((h) => h.quantity > 0);

  // Yearly return that accounts for when money went in and out. Under three
  // months of history it swings wildly once annualised, so it waits.
  const quoteDate = await latestQuoteDate();
  const firstTrade = ledger.reduce<string | null>((min, t) => (min == null || t.date < min ? t.date : min), null);
  const historyLongEnough = firstTrade != null && quoteDate != null && weekdaysBetween(firstTrade, quoteDate) >= 63;
  const annualReturn =
    historyLongEnough && quoteDate ? xirr(ledgerCashFlows(ledger, portfolio.marketValue, quoteDate)) : null;
  const dividends = await forecastDividends(openPositions, ledger, quoteDate ?? todayPkt());
  const heldSymbols = [
    ...new Set([...openPositions.map((h) => h.symbol), ...ledger.map((t) => t.symbol)]),
  ];
  const formPortfolios = portfolios.map(({ id, name }) => ({ id, name }));
  const formDefault = selected?.id ?? defaultId;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={selected ? `Portfolio · ${selected.name}` : "Portfolio"}
        description="Your holdings priced against the latest session, with cost basis on a weighted-average method and your weights compared to the index."
        actions={
          <Link
            href="/portfolio/import"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Import CSV
          </Link>
        }
      />

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">Portfolio</span>
          {portfolios.length > 1 && (
            <Link href="/portfolio" className={chipClass(!selected)}>
              All
            </Link>
          )}
          {portfolios.map((x) => (
            <Link key={x.id} href={`/portfolio?p=${x.id}`} className={chipClass(editable?.id === x.id)}>
              {x.name}
            </Link>
          ))}
          <span className="ml-2">
            <NewPortfolioForm />
          </span>
        </div>
        {editable && <EditPortfolioForm key={editable.id} portfolioId={editable.id} name={editable.name} />}
        <BenchmarkPicker
          current={benchmark}
          codes={BENCHMARK_CHOICES.filter((c) => tracked.includes(c))}
          back={selected ? `/portfolio?p=${selected.id}` : "/portfolio"}
        />
      </div>

      {shariahBenchmark && portfolio.droppedHoldings.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-800 dark:bg-rose-950/40">
          <p className="font-medium">
            ⚠️ Holdings not in {benchmark}:{" "}
            {portfolio.droppedHoldings.join(", ")}
          </p>
          <p className="mt-1">
            These are outside the index&apos;s Shariah screen (either dropped
            from it or never in it). Check them against your own screening.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
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
        <StatTile
          label="Annual return"
          value={
            <span className={toneClass(annualReturn)}>
              {annualReturn == null ? "—" : pct(annualReturn, 1)}
            </span>
          }
          hint={
            annualReturn != null
              ? "Per year (XIRR): counts when you bought, sold and got dividends"
              : historyLongEnough
                ? "Not enough buys and sales to work out"
                : "Shown after 3 months of history"
          }
        />
      </div>

      {history.length >= 2 && (
        <Card title="Value over time" subtitle="Daily close of the positions held each day">
          <PortfolioHistoryChart data={history} indexCode={benchmark} />
        </Card>
      )}

      {openPositions.length === 0 ? (
        <Card title="Add your first transaction">
          <TransactionForm
            symbols={constituents.map((c) => c.symbol)}
            portfolios={formPortfolios}
            defaultPortfolioId={formDefault}
          />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Have a broker statement?{" "}
            <Link href="/portfolio/import" className="underline">
              Import it from a CSV
            </Link>{" "}
            instead.
          </p>
        </Card>
      ) : (
        <>
          <Card
            title="Holdings"
            subtitle={`Active weight is your weight minus the ${benchmark} weight — positive means overweight.`}
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
                          {shariahBenchmark && h.droppedFromIndex && (
                            <Badge tone="critical">not in {benchmark}</Badge>
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
              title={`Active weight vs ${benchmark}`}
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

          <DividendForecastCard forecast={dividends} />

          <Card title="Record a transaction">
            <TransactionForm
              symbols={constituents.map((c) => c.symbol)}
              portfolios={formPortfolios}
              defaultPortfolioId={formDefault}
            />
          </Card>

          <Card
            title="Record a dividend"
            subtitle="PSX no longer publishes payouts, so record the dividends you receive here. Leave shares blank to use what you held on that date."
          >
            <DividendForm symbols={heldSymbols} portfolios={formPortfolios} defaultPortfolioId={formDefault} />
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
                  {portfolios.length > 1 && <Th>Portfolio</Th>}
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
                    {portfolios.length > 1 && (
                      <Td>
                        <form action={moveTransactionAction} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={tx.id} />
                          <select
                            name="portfolioId"
                            defaultValue={tx.portfolioId ?? defaultId}
                            aria-label="Portfolio"
                            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                          >
                            {portfolios.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-400"
                          >
                            Move
                          </button>
                        </form>
                      </Td>
                    )}
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

function chipClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Next 12 months of dividends if each holding pays what it paid last year. */
function DividendForecastCard({ forecast }: { forecast: Awaited<ReturnType<typeof forecastDividends>> }) {
  const peak = Math.max(...forecast.byMonth.map((m) => m.amount), 0);
  return (
    <Card
      title="Expected dividends, next 12 months"
      subtitle="If each holding pays what it paid over the last 12 months, around the same time. Gross, before withholding tax. Dividends you record take priority over PSX's history."
    >
      {forecast.rows.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">
          None of your holdings paid a cash dividend in the last 12 months that we know of. Record the
          dividends you receive below and they will be projected here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile label="Expected income" value={compactPkr(forecast.total)} hint="Gross, next 12 months" />
            <StatTile
              label="Yield on market value"
              value={pct(forecast.yieldOnValuePct, 1, false)}
              hint="Expected income ÷ value of open positions"
            />
          </div>

          <div aria-label="Expected income by month" className="flex h-28 items-end gap-1">
            {forecast.byMonth.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                <div
                  title={`${MONTH_NAMES[Number(m.month) - 1]}: ${money(m.amount)}`}
                  className={`w-full rounded-sm ${m.amount > 0 ? "bg-emerald-500/80" : "bg-slate-200 dark:bg-slate-800"}`}
                  style={{ height: peak > 0 && m.amount > 0 ? `${Math.max(6, (m.amount / peak) * 88)}px` : "2px" }}
                />
                <span className="text-[10px] text-slate-500">{MONTH_NAMES[Number(m.month) - 1]}</span>
              </div>
            ))}
          </div>

          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Per share / yr</Th>
                  <Th align="right">Expected</Th>
                  <Th align="right">Yield</Th>
                  <Th align="right">Yield on cost</Th>
                  <Th>Based on</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {forecast.rows.map((r) => (
                  <tr key={r.symbol}>
                    <Td><SymbolLink symbol={r.symbol} /></Td>
                    <Td align="right">{count(r.quantity)}</Td>
                    <Td align="right">{money(r.annualPerShare)}</Td>
                    <Td align="right">{money(r.expectedIncome)}</Td>
                    <Td align="right">{pct(r.yieldOnValuePct, 1, false)}</Td>
                    <Td align="right">{pct(r.yieldOnCostPct, 1, false)}</Td>
                    <Td>
                      <Badge tone={r.source === "recorded" ? "good" : "neutral"}>
                        {r.source === "recorded" ? "your records" : "PSX history"}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {forecast.noHistory.length > 0 && (
            <p className="text-xs text-slate-500">
              No cash dividend in the last 12 months: {forecast.noHistory.join(", ")}.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
