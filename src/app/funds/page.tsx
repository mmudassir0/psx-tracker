import { requireUser } from "@/lib/auth";
import { getFundLedger, getFundPortfolio } from "@/lib/funds";
import { deleteFundAction, deleteFundTransactionAction } from "@/app/actions";
import { AddFundForm, FundNavForm, FundTransactionForm } from "@/components/FundForms";
import { Badge, Card, PageHeader, StatTile, TableWrap, Td, Th } from "@/components/ui";
import { compactPkr, count, money, pct, prettyDate, signedMoney, toneClass } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL = { buy: "Purchase", redeem: "Redemption", dividend: "Dividend" } as const;

export default async function FundsPage() {
  const user = await requireUser("/funds");
  const [portfolio, ledger] = await Promise.all([
    getFundPortfolio(user.id),
    getFundLedger(user.id),
  ]);
  const fundNames = new Map(portfolio.holdings.map((h) => [h.id, h.name]));
  const fundOptions = portfolio.holdings.map((h) => ({ id: h.id, name: h.name }));
  const open = portfolio.holdings.filter((h) => h.units > 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mutual funds"
        description="Funds you hold, valued at the NAVs you record. MUFAP's daily NAVs can't be read automatically, so note a NAV from your statement or the AMC's site when you want the value refreshed."
      />

      {portfolio.holdings.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Value" value={compactPkr(portfolio.value)} hint="At the latest NAV of each fund" large />
          <StatTile
            label="Unrealised P&L"
            value={<span className={toneClass(portfolio.unrealizedPnl)}>{signedMoney(portfolio.unrealizedPnl)}</span>}
            hint={`On ${compactPkr(portfolio.costBasis)} invested`}
          />
          <StatTile
            label="Realised P&L"
            value={<span className={toneClass(portfolio.realizedPnl)}>{signedMoney(portfolio.realizedPnl)}</span>}
            hint="From redemptions, average cost"
          />
          <StatTile label="Cash dividends" value={money(portfolio.dividends)} hint="Received, all time" />
        </div>
      )}

      {portfolio.unpriced.length > 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          No NAV yet for {portfolio.unpriced.join(", ")}: record one below to include it in the value.
        </p>
      )}

      {open.length > 0 && (
        <Card title="Holdings">
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Fund</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">Avg cost</Th>
                  <Th align="right">NAV</Th>
                  <Th align="right">Value</Th>
                  <Th align="right">Unrealised</Th>
                  <Th align="right">Total return</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {open.map((h) => (
                  <tr key={h.id}>
                    <Td>
                      <div className="font-medium">{h.name}</div>
                      <div className="text-xs text-slate-500">
                        {[h.amc, h.category].filter(Boolean).join(" · ")}
                        {h.shariah && (
                          <>
                            {" "}<Badge tone="good">Shariah</Badge>
                          </>
                        )}
                      </div>
                    </Td>
                    <Td align="right">{count(Math.round(h.units * 10000) / 10000)}</Td>
                    <Td align="right">{money(h.avgCostPerUnit)}</Td>
                    <Td align="right">
                      {money(h.latestNav?.nav ?? null)}
                      {h.latestNav && <div className="text-xs text-slate-500">{prettyDate(h.latestNav.date)}</div>}
                    </Td>
                    <Td align="right">{money(h.value)}</Td>
                    <Td align="right" className={toneClass(h.unrealizedPnl)}>
                      {signedMoney(h.unrealizedPnl)}
                      <div className="text-xs">{pct(h.unrealizedPct, 1)}</div>
                    </Td>
                    <Td align="right" className={toneClass(h.totalReturn)}>{signedMoney(h.totalReturn)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {fundOptions.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Record a purchase, redemption or dividend">
            <FundTransactionForm funds={fundOptions} />
          </Card>
          <Card title="Update a NAV" subtitle="From your statement, the AMC's website or MUFAP">
            <FundNavForm funds={fundOptions} />
          </Card>
        </div>
      )}

      <Card
        title={portfolio.holdings.length ? "Add another fund" : "Add your first fund"}
        subtitle="Then record your purchases at the NAV on your statement."
      >
        <AddFundForm />
      </Card>

      {ledger.length > 0 && (
        <Card title="Fund transactions" subtitle={`${ledger.length} entries`}>
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Fund</Th>
                  <Th>Type</Th>
                  <Th align="right">Units</Th>
                  <Th align="right">NAV</Th>
                  <Th align="right">Amount</Th>
                  <Th>{""}</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...ledger].reverse().map((t) => (
                  <tr key={t.id}>
                    <Td>{prettyDate(t.date)}</Td>
                    <Td className="max-w-[220px] truncate">{fundNames.get(t.fundId) ?? "—"}</Td>
                    <Td>{TYPE_LABEL[t.type]}</Td>
                    <Td align="right">{t.type === "dividend" ? "—" : count(t.units)}</Td>
                    <Td align="right">{t.type === "dividend" ? "—" : money(t.nav)}</Td>
                    <Td align="right">{money(t.amount)}</Td>
                    <Td align="right">
                      <form action={deleteFundTransactionAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button type="submit" className="text-xs text-rose-600 hover:underline dark:text-rose-400">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {portfolio.holdings.length > 0 && (
        <Card title="Remove a fund" subtitle="Deletes the fund with all its transactions and NAVs.">
          <div className="flex flex-wrap gap-2">
            {portfolio.holdings.map((h) => (
              <form key={h.id} action={deleteFundAction}>
                <input type="hidden" name="id" value={h.id} />
                <button
                  type="submit"
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:border-rose-400 hover:text-rose-600 dark:border-slate-700"
                >
                  Remove {h.name}
                </button>
              </form>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
