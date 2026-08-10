import Link from "next/link";
import { runBacktest, planRebalance, type Weighting, type RebalanceFrequency } from "@/lib/backtest";
import { getTrackedIndexCodes, isDatabaseEmpty } from "@/lib/market";
import { indexLabel, sortIndexCodes, DEFAULT_INDEX } from "@/lib/psx/indices";
import { EquityCurve } from "@/components/EquityCurve";
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
import { addDays, todayPkt } from "@/lib/dates";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "1y", label: "1 year", days: 365 },
  { key: "3y", label: "3 years", days: 365 * 3 },
  { key: "5y", label: "5 years", days: 365 * 5 },
] as const;

const FREQUENCIES: { key: RebalanceFrequency; label: string }[] = [
  { key: "none", label: "Buy & hold" },
  { key: "annually", label: "Annually" },
  { key: "quarterly", label: "Quarterly" },
  { key: "monthly", label: "Monthly" },
];

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{
    index?: string;
    window?: string;
    weighting?: string;
    rebalance?: string;
    tolerance?: string;
  }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate price history.
      </EmptyState>
    );
  }

  const sp = await searchParams;
  const trackedCodes = await getTrackedIndexCodes();
  const available = sortIndexCodes(trackedCodes);
  const indexCode =
    sp.index && available.includes(sp.index.toUpperCase())
      ? sp.index.toUpperCase()
      : DEFAULT_INDEX;

  const windowKey = WINDOWS.some((w) => w.key === sp.window)
    ? (sp.window as string)
    : "5y";
  const windowDays =
    WINDOWS.find((w) => w.key === windowKey)?.days ?? 365 * 5;

  const weighting: Weighting = sp.weighting === "equal" ? "equal" : "index";
  const rebalance: RebalanceFrequency = FREQUENCIES.some(
    (f) => f.key === sp.rebalance,
  )
    ? (sp.rebalance as RebalanceFrequency)
    : "none";
  const tolerance = Number(sp.tolerance) >= 0 ? Number(sp.tolerance) : 0.5;

  const backtest = await runBacktest({
    indexCode,
    startDate: addDays(todayPkt(), -windowDays),
    weighting,
    rebalance,
  });

  const plan = await planRebalance({ indexCode, weighting, tolerancePct: tolerance });
  const tradeRows = plan.rows.filter((r) => r.action !== "hold");

  const base = (overrides: Record<string, string>) => {
    const p = new URLSearchParams({
      index: indexCode,
      window: windowKey,
      weighting,
      rebalance,
      tolerance: String(tolerance),
      ...overrides,
    });
    return `/strategy?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Strategy"
        description="Backtest an index basket against the index itself, and see the trades that would move your portfolio onto those weights."
      />

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-col gap-2 text-sm">
        <ChipRow label="Index">
          {available.map((code) => (
            <Chip key={code} href={base({ index: code })} active={code === indexCode}>
              {code}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Window">
          {WINDOWS.map((w) => (
            <Chip key={w.key} href={base({ window: w.key })} active={w.key === windowKey}>
              {w.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Weights">
          <Chip href={base({ weighting: "index" })} active={weighting === "index"}>
            Index weights
          </Chip>
          <Chip href={base({ weighting: "equal" })} active={weighting === "equal"}>
            Equal weight
          </Chip>
        </ChipRow>
        <ChipRow label="Rebalance">
          {FREQUENCIES.map((f) => (
            <Chip key={f.key} href={base({ rebalance: f.key })} active={f.key === rebalance}>
              {f.label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
        <p className="font-medium">Read the backtest with two caveats.</p>
        <ul className="mt-1 list-inside list-disc space-y-1">
          <li>
            <span className="font-medium">Survivorship bias.</span> The basket is
            built from {indexLabel(indexCode)}&apos;s constituents{" "}
            <em>today</em>. Membership snapshots only began when you first ran an
            ingest, so companies dropped along the way are missing and
            today&apos;s weights are applied retroactively. The index line has no
            such bias — the two are not strictly comparable.
          </li>
          <li>
            <span className="font-medium">Price return only.</span> Dividends are
            excluded on both lines, because PSX announcement titles often omit
            the rate. Real total returns would be higher for both.
          </li>
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Basket total return"
          value={pct(backtest.strategy.totalReturnPct, 1)}
          hint={`${backtest.strategy.cagrPct.toFixed(1)}% CAGR`}
          large
        />
        <StatTile
          label="Index total return"
          value={
            backtest.benchmark ? pct(backtest.benchmark.totalReturnPct, 1) : "—"
          }
          hint={
            backtest.benchmark
              ? `${backtest.benchmark.cagrPct.toFixed(1)}% CAGR`
              : "No index history"
          }
        />
        <StatTile
          label="Max drawdown"
          value={`−${backtest.strategy.maxDrawdownPct.toFixed(1)}%`}
          hint={
            backtest.benchmark
              ? `index −${backtest.benchmark.maxDrawdownPct.toFixed(1)}%`
              : undefined
          }
        />
        <StatTile
          label="Volatility"
          value={`${backtest.strategy.volatilityPct.toFixed(1)}%`}
          hint="Annualised, from daily closes"
        />
      </div>

      <Card
        title="Basket vs index"
        subtitle={`Both start at ${compactPkr(1_000_000)}. ${prettyDate(backtest.startDate)} → ${prettyDate(backtest.endDate)}, ${backtest.tradingDays} sessions${backtest.rebalanceDates.length ? `, ${backtest.rebalanceDates.length} rebalances` : ""}.`}
      >
        <EquityCurve points={backtest.points} />
        {backtest.excluded.length > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {backtest.excluded.length} constituent
            {backtest.excluded.length === 1 ? "" : "s"} excluded for having no
            price at the start of the window:{" "}
            {backtest.excluded.slice(0, 12).join(", ")}
            {backtest.excluded.length > 12 && " …"}
          </p>
        )}
      </Card>

      <Card
        title="Rebalance plan"
        subtitle={
          plan.portfolioValue > 0
            ? `Trades to move your ${compactPkr(plan.portfolioValue)} portfolio onto ${weighting === "equal" ? "equal" : indexLabel(indexCode)} weights, ignoring drift under ${tolerance}%.`
            : "Add holdings on the portfolio page to see a plan."
        }
        actions={
          <div className="flex gap-1">
            {[0, 0.5, 1, 2].map((t) => (
              <Chip key={t} href={base({ tolerance: String(t) })} active={t === tolerance}>
                ±{t}%
              </Chip>
            ))}
          </div>
        }
      >
        {plan.portfolioValue === 0 ? (
          <EmptyState title="No open positions">
            <Link href="/portfolio" className="underline">
              Record your holdings
            </Link>{" "}
            to get a rebalance plan.
          </EmptyState>
        ) : tradeRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Every position is within ±{tolerance}% of its target weight. Nothing
            to trade.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              <span>
                Buy{" "}
                <span className="tabular font-medium" style={{ color: "var(--diverge-pos-mid)" }}>
                  {money(plan.totalBuy)}
                </span>
              </span>
              <span>
                Sell{" "}
                <span className="tabular font-medium" style={{ color: "var(--diverge-neg-mid)" }}>
                  {money(plan.totalSell)}
                </span>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Turnover {plan.turnoverPct.toFixed(1)}%
              </span>
            </div>

            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Symbol</Th>
                    <Th align="right">Held</Th>
                    <Th align="right">Price</Th>
                    <Th align="right">Your wt</Th>
                    <Th align="right">Target wt</Th>
                    <Th align="right">Drift</Th>
                    <Th align="right">Trade</Th>
                    <Th align="right">Value</Th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {tradeRows.map((row) => (
                    <tr key={row.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <SymbolLink symbol={row.symbol} />
                          <Badge tone={row.action === "buy" ? "good" : "warning"}>
                            {row.action}
                          </Badge>
                        </div>
                      </Td>
                      <Td align="right">{count(row.currentQuantity)}</Td>
                      <Td align="right">{money(row.price)}</Td>
                      <Td align="right">{pct(row.currentWeightPct, 1, false)}</Td>
                      <Td align="right" className="text-slate-500">
                        {pct(row.targetWeightPct, 1, false)}
                      </Td>
                      <Td align="right" className={toneClass(row.driftPct)}>
                        {pct(row.driftPct, 1)}
                      </Td>
                      <Td align="right" className="font-medium">
                        {row.tradeShares > 0 ? "+" : ""}
                        {count(row.tradeShares)}
                      </Td>
                      <Td align="right" className={toneClass(row.tradeValue)}>
                        {signedMoney(row.tradeValue)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Share counts are whole numbers, priced at the last close — real
              fills will differ. Brokerage, CDC charges and taxes are not
              modelled, and they are what make frequent rebalancing expensive.
              {plan.missing.length > 0 && (
                <>
                  {" "}
                  {plan.missing.length} index constituent
                  {plan.missing.length === 1 ? "" : "s"} you hold none of are
                  excluded from the targets.
                </>
              )}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 w-16 shrink-0 text-xs text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        active
          ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
      }
    >
      {children}
    </a>
  );
}
