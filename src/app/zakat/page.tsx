import Link from "next/link";
import { computeZakat, getZakatSettings } from "@/lib/zakat";
import { isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { ZakatForm } from "@/components/ZakatForm";
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
import { money, pct, count, prettyDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ZakatPage() {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No market data yet">
        Run <code>npm run setup</code> so holdings can be valued.
      </EmptyState>
    );
  }

  const settings = getZakatSettings();
  const result = computeZakat(settings);
  const quoteDate = latestQuoteDate();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Zakat calculator"
        description={
          <>
            Values your holdings at the {prettyDate(quoteDate)} close and applies
            the method you choose below.
          </>
        }
      />

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
        <p className="font-medium">This is a calculator, not a religious ruling.</p>
        <p className="mt-1">
          Scholars differ on how zakat applies to shares — particularly whether
          the full market value is assessed, or only the company&apos;s own
          zakatable assets. Every judgement call here is yours to set, and
          nothing is defaulted to a figure that takes a position. Confirm the
          method with a scholar you trust.
        </p>
        <p className="mt-1">
          If zakat has already been deducted at source on some assets, don&apos;t
          count those twice.
        </p>
      </div>

      {result.lines.length === 0 ? (
        <EmptyState title="No open positions">
          <Link href="/portfolio" className="underline">
            Add your holdings
          </Link>{" "}
          and they will be valued here automatically.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Zakat due"
            value={
              result.aboveNisab === null ? "—" : money(result.zakatDue)
            }
            hint={
              result.aboveNisab === null
                ? "Enter a metal price to test nisab"
                : result.aboveNisab
                  ? `${(result.rate * 100).toFixed(3)}% of net zakatable wealth`
                  : "Below nisab — no zakat due on this basis"
            }
            large
          />
          <StatTile
            label="Net zakatable wealth"
            value={money(result.netZakatableWealth)}
            hint="Shares + other assets − liabilities"
          />
          <StatTile
            label="Nisab threshold"
            value={
              result.nisabValue > 0 ? money(result.nisabValue) : "—"
            }
            hint={`${result.nisabGrams} g ${settings.nisabBasis}`}
          />
          <StatTile
            label="Above nisab?"
            value={
              result.aboveNisab === null ? (
                <span className="text-slate-400">Unknown</span>
              ) : result.aboveNisab ? (
                <Badge tone="good">Yes</Badge>
              ) : (
                <Badge tone="neutral">No</Badge>
              )
            }
            hint={
              result.aboveNisab === null
                ? "Needs a current metal price"
                : undefined
            }
          />
        </div>
      )}

      <Card title="Your method">
        <ZakatForm
          settings={{
            nisabBasis: settings.nisabBasis,
            metalPricePerGram: settings.metalPricePerGram,
            year: settings.year,
            otherAssets: settings.otherAssets,
            liabilities: settings.liabilities,
            defaultZakatablePct: settings.defaultZakatablePct,
          }}
          holdings={result.lines.map((l) => ({
            symbol: l.symbol,
            name: l.name,
            marketValue: l.marketValue,
            zakatablePct: l.zakatablePct,
          }))}
        />
      </Card>

      {result.lines.length > 0 && (
        <Card
          title="Holdings assessed"
          subtitle="Every figure below is arithmetic you can check by hand"
        >
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Quantity</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Market value</Th>
                  <Th align="right">Zakatable %</Th>
                  <Th align="right">Zakatable value</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {result.lines.map((line) => (
                  <tr key={line.symbol}>
                    <Td>
                      <SymbolLink symbol={line.symbol} />
                    </Td>
                    <Td align="right">{count(line.quantity)}</Td>
                    <Td align="right">{money(line.price)}</Td>
                    <Td align="right">{money(line.marketValue)}</Td>
                    <Td align="right" className="text-slate-500">
                      {pct(line.zakatablePct, 0, false)}
                    </Td>
                    <Td align="right" className="font-medium">
                      {money(line.zakatableValue)}
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="tabular border-t-2 border-slate-300 font-medium dark:border-slate-700">
                  <Td>Total</Td>
                  <Td align="right" />
                  <Td align="right" />
                  <Td align="right">{money(result.portfolioValue)}</Td>
                  <Td align="right" />
                  <Td align="right">{money(result.zakatableFromShares)}</Td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        </Card>
      )}

      <Card title="Working" subtitle="How the figure above was reached">
        <dl className="tabular flex flex-col gap-1.5 text-sm">
          <Row label="Zakatable value of shares" value={money(result.zakatableFromShares)} />
          <Row label="+ Other zakatable assets" value={money(result.otherAssets)} />
          <Row label="− Deductible liabilities" value={money(result.liabilities)} />
          <Row
            label="= Net zakatable wealth"
            value={money(result.netZakatableWealth)}
            emphasis
          />
          <Row
            label={`Nisab (${result.nisabGrams} g ${settings.nisabBasis})`}
            value={result.nisabValue > 0 ? money(result.nisabValue) : "not set"}
          />
          <Row
            label={`× Rate (${settings.year})`}
            value={`${(result.rate * 100).toFixed(3)}%`}
          />
          <Row
            label="= Zakat due"
            value={result.aboveNisab === null ? "—" : money(result.zakatDue)}
            emphasis
          />
        </dl>

        {result.dividendIncome > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            For context, your ledger records {money(result.dividendIncome)} of
            dividend income. If that cash is still held, include it under
            &ldquo;other zakatable assets&rdquo; — it is not counted
            automatically, because it may already have been spent.
          </p>
        )}
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 border-b border-slate-100 pb-1.5 dark:border-slate-800 ${
        emphasis ? "font-semibold" : ""
      }`}
    >
      <dt className={emphasis ? "" : "text-slate-500 dark:text-slate-400"}>
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
