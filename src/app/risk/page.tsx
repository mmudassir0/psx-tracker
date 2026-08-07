import Link from "next/link";
import { buildRiskReport, MIN_OVERLAP } from "@/lib/risk";
import { isDatabaseEmpty } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { indexLabel } from "@/lib/psx/indices";
import { CorrelationMatrix } from "@/components/CorrelationMatrix";
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
import { pct, prettyDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "180", label: "6 months", days: 180 },
  { key: "365", label: "1 year", days: 365 },
  { key: "730", label: "2 years", days: 730 },
];

export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate price history.
      </EmptyState>
    );
  }

  const { window: windowParam } = await searchParams;
  const windowKey = WINDOWS.some((w) => w.key === windowParam)
    ? windowParam!
    : "365";
  const days = WINDOWS.find((w) => w.key === windowKey)!.days;

  const portfolio = getPortfolio();
  const open = portfolio.holdings.filter((h) => h.quantity > 0);

  if (open.length === 0) {
    return (
      <div>
        <PageHeader
          title="Risk & correlation"
          description="How your positions move relative to each other and to the index."
        />
        <EmptyState title="No open positions">
          <Link href="/portfolio" className="underline">
            Add holdings
          </Link>{" "}
          and this fills in automatically.
        </EmptyState>
      </div>
    );
  }

  const report = buildRiskReport({ days });

  // Herfindahl: 1/n is perfectly even, 1 is everything in one name.
  const evenHhi = open.length > 0 ? 1 / open.length : 0;
  const concentrationLabel =
    report.concentration >= 0.25
      ? "concentrated"
      : report.concentration >= 0.18
        ? "moderate"
        : "spread";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Risk & correlation"
        description={
          <>
            Daily returns since {prettyDate(report.fromDate)}, measured against{" "}
            {indexLabel(report.indexCode)}.
          </>
        }
      />

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">
          Window
        </span>
        {WINDOWS.map((w) => (
          <a
            key={w.key}
            href={`/risk?window=${w.key}`}
            className={
              w.key === windowKey
                ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
            }
          >
            {w.label}
          </a>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Portfolio beta"
          value={report.portfolioBeta?.toFixed(2) ?? "—"}
          hint={
            report.portfolioBeta == null
              ? "Not enough history"
              : report.portfolioBeta > 1
                ? "Moves more than the index"
                : "Moves less than the index"
          }
          large
        />
        <StatTile
          label="Average correlation"
          value={report.averageCorrelation?.toFixed(2) ?? "—"}
          hint={
            report.averageCorrelation == null
              ? undefined
              : report.averageCorrelation >= 0.6
                ? "Positions largely move together"
                : "Reasonably independent"
          }
        />
        <StatTile
          label="Concentration"
          value={report.concentration.toFixed(2)}
          hint={`${concentrationLabel} · evenly split would be ${evenHhi.toFixed(2)}`}
        />
        <StatTile
          label="Largest position"
          value={pct(report.topWeightPct, 1, false)}
          hint={`of ${open.length} holdings`}
        />
      </div>

      {report.highlyCorrelated.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium">
            {report.highlyCorrelated.length} pair
            {report.highlyCorrelated.length === 1 ? "" : "s"} move almost
            together (correlation ≥ 0.7)
          </p>
          <ul className="mt-1 space-y-0.5">
            {report.highlyCorrelated.slice(0, 5).map((p) => (
              <li key={`${p.a}-${p.b}`}>
                <SymbolLink symbol={p.a} /> and <SymbolLink symbol={p.b} /> —{" "}
                <span className="tabular font-medium">
                  {p.correlation?.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-slate-600 dark:text-slate-400">
            Holding both gives less diversification than the position count
            suggests. Whether that matters is your call — it is a fact about the
            prices, not a recommendation.
          </p>
        </div>
      )}

      <Card
        title="Correlation matrix"
        subtitle="1.00 means the two moved identically; 0 means unrelated; negative means opposite"
      >
        <CorrelationMatrix
          symbols={report.symbols}
          matrix={report.matrix}
          minOverlap={MIN_OVERLAP}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Beta vs index"
          subtitle="Above 1 amplifies index moves; below 1 dampens them"
        >
          <DivergingBars
            data={report.betas.map((b) => ({
              symbol: b.symbol,
              name: null,
              // Centre the bars on 1.0, the market's own beta.
              value: b.beta == null ? null : b.beta - 1,
              close: null,
              volume: null,
              weightPct: null,
            }))}
            valueSuffix=""
            positiveLabel="More volatile than index"
            negativeLabel="Less volatile"
          />
        </Card>

        <Card title="Per-holding detail" subtitle="Table view of the same data">
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Beta</Th>
                  <Th align="right">R²</Th>
                  <Th align="right">Volatility</Th>
                  <Th align="right">Sessions</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {report.betas.map((b) => (
                  <tr key={b.symbol}>
                    <Td>
                      <SymbolLink symbol={b.symbol} />
                    </Td>
                    <Td align="right">{b.beta?.toFixed(2) ?? "—"}</Td>
                    <Td align="right" className="text-slate-500">
                      {b.rSquared?.toFixed(2) ?? "—"}
                    </Td>
                    <Td align="right">
                      {b.volatilityPct != null
                        ? `${b.volatilityPct.toFixed(1)}%`
                        : "—"}
                    </Td>
                    <Td align="right" className="text-slate-500">
                      {b.overlap}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            R² is how much of each name&apos;s movement the index explains — a
            low value means beta alone describes it poorly.
          </p>
        </Card>
      </div>

      {report.excluded.length > 0 && (
        <Card title="Excluded from this analysis">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {report.excluded.map((s) => (
              <span key={s} className="mr-2">
                <SymbolLink symbol={s} />
              </span>
            ))}
            — fewer than {MIN_OVERLAP} sessions of price history in this window,
            which is too little to compute anything meaningful.
          </p>
        </Card>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Correlations are computed on sessions where both names traded, from
        closing prices only. Dividends are excluded. Past co-movement is a
        description of what happened, not a forecast.
      </p>
    </div>
  );
}
