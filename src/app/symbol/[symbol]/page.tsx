import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import { getPayouts } from "@/lib/dividends";
import { getCompanyFinancials } from "@/lib/financials";
import { FinancialsTable } from "@/components/FinancialsTable";
import {
  getConstituent,
  getPriceHistory,
  getSymbolMeta,
  latestQuoteDate,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { PriceChart } from "@/components/PriceChart";
import {
  Card,
  StatTile,
  PageHeader,
  Badge,
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
  sectorLabel,
} from "@/lib/format";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<
  string,
  "neutral" | "good" | "warning" | "critical"
> = {
  dividend: "good",
  bonus: "good",
  rights: "warning",
  result: "neutral",
  board_meeting: "neutral",
  meeting: "neutral",
  other: "neutral",
};

export default async function SymbolPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: raw } = await params;
  const symbol = raw.toUpperCase();

  const meta = await getSymbolMeta(symbol);
  if (!meta) notFound();

  const [
    view,
    history,
    quoteDate,
    news,
    payoutRows,
    companyFinancials,
    portfolio,
  ] = await Promise.all([
    getConstituent(symbol),
    getPriceHistory(symbol),
    latestQuoteDate(),
    db
      .select()
      .from(announcements)
      .where(eq(announcements.symbol, symbol))
      .orderBy(desc(announcements.date))
      .limit(25)
      .all(),
    getPayouts(symbol, 15),
    getCompanyFinancials(symbol),
    getPortfolio(),
  ]);

  const holding = portfolio.holdings.find((h) => h.symbol === symbol);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={symbol}
        description={
          <>
            {meta.name ?? "—"} ·{" "}
            {sectorLabel(meta.sectorName, meta.sectorCode)}
            {!meta.isKmi30 && (
              <>
                {" "}
                <Badge tone="critical">Not in KMI30</Badge>
              </>
            )}
          </>
        }
        actions={
          <a
            href={`https://dps.psx.com.pk/company/${symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline underline-offset-2"
          >
            View on PSX ↗
          </a>
        }
      />

      {!meta.isKmi30 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/40">
          {symbol} is not currently a KMI30 constituent, so it is outside this
          index&apos;s Shariah screen. Fundamentals below may be stale — the
          ingest only refreshes current constituents.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Close"
          value={money(view?.close ?? null)}
          delta={view?.changePct ?? null}
          hint={prettyDate(quoteDate)}
          large
        />
        <StatTile
          label="P/E (TTM)"
          value={view?.peTtm != null ? view.peTtm.toFixed(2) : "—"}
          hint="Trailing twelve months"
        />
        <StatTile
          label="52-week range"
          value={
            <span className="text-lg">
              {money(view?.week52Low ?? null)} – {money(view?.week52High ?? null)}
            </span>
          }
          hint={
            view?.drawdownFrom52wPct != null
              ? `${view.drawdownFrom52wPct.toFixed(1)}% off high`
              : undefined
          }
        />
        <StatTile
          label="Dividend yield"
          value={
            view?.dividendYieldPct != null
              ? `${view.dividendYieldPct.toFixed(2)}%`
              : "—"
          }
          hint={
            view?.dividendPerShare != null
              ? `${money(view.dividendPerShare)}/share over 12m`
              : "No cash dividend in 12 months"
          }
        />
        <StatTile
          label="Index weight"
          value={pct(view?.indexWeightPct ?? null, 2, false)}
          hint={
            view?.freeFloatPct != null
              ? `${view.freeFloatPct}% free float`
              : undefined
          }
        />
      </div>

      {holding && holding.quantity > 0 && (
        <Card title="Your position">
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Stat label="Quantity" value={count(holding.quantity)} />
            <Stat label="Avg cost" value={money(holding.avgCost)} />
            <Stat label="Market value" value={money(holding.marketValue)} />
            <Stat
              label="Unrealised P&L"
              value={
                <span className={toneClass(holding.unrealizedPnl)}>
                  {signedMoney(holding.unrealizedPnl)} (
                  {pct(holding.unrealizedPct)})
                </span>
              }
            />
          </dl>
        </Card>
      )}

      <Card title="Price history" subtitle={`Daily closes for ${symbol}`}>
        <PriceChart data={history} label={symbol} height={320} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Key statistics">
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Stat label="Open" value={money(view?.open ?? null)} />
            <Stat label="Previous close" value={money(view?.ldcp ?? null)} />
            <Stat label="Day high" value={money(view?.high ?? null)} />
            <Stat label="Day low" value={money(view?.low ?? null)} />
            <Stat label="Volume" value={count(view?.volume ?? null)} />
            <Stat label="Market cap" value={compactPkr(view?.marketCap ?? null)} />
            <Stat
              label="Free-float cap"
              value={compactPkr(view?.freeFloatCap ?? null)}
            />
            <Stat
              label="Free-float shares"
              value={count(view?.freeFloatShares ?? null)}
            />
            <Stat
              label="YTD change"
              value={
                <span className={toneClass(view?.ytdChangePct)}>
                  {pct(view?.ytdChangePct ?? null)}
                </span>
              }
            />
            <Stat
              label="1-year change"
              value={
                <span className={toneClass(view?.year1ChangePct)}>
                  {pct(view?.year1ChangePct ?? null)}
                </span>
              }
            />
          </dl>
        </Card>

        <Card
          title="Payout history"
          subtitle="Declared rates from PSX; per-share assumes the PKR 10 face value standard"
        >
          {payoutRows.length > 0 ? (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Announced</Th>
                    <Th>Type</Th>
                    <Th align="right">Rate</Th>
                    <Th align="right">Per share</Th>
                    <Th>Book closure</Th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {payoutRows.map((p) => (
                    <tr key={p.id}>
                      <Td>{prettyDate(p.date)}</Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={p.type === "rights" ? "warning" : "good"}>
                            {p.type.replace("_", " ")}
                          </Badge>
                          {p.instalment && (
                            <span className="text-xs text-slate-500">
                              {p.instalment === "F" ? "final" : `interim ${p.instalment}`}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td align="right">
                        {p.percent != null ? `${p.percent}%` : "—"}
                      </Td>
                      <Td align="right" className="font-medium">
                        {money(p.perShare)}
                      </Td>
                      <Td className="text-xs text-slate-500 dark:text-slate-400">
                        {p.bookClosureFrom
                          ? `${prettyDate(p.bookClosureFrom)} – ${prettyDate(p.bookClosureTo)}`
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No payouts parsed from recent announcements.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Financials & ratios"
        subtitle="Annual figures published by PSX"
      >
        <FinancialsTable data={companyFinancials} />
      </Card>

      <Card title="Announcements" subtitle="Most recent 25 from PSX">
        {news.length > 0 ? (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {news.map((a) => (
              <li key={a.id} className="flex gap-3 py-2">
                <span className="tabular w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {prettyDate(a.date)}
                </span>
                <Badge tone={CATEGORY_TONE[a.category] ?? "neutral"}>
                  {a.category.replace("_", " ")}
                </Badge>
                <span className="flex-1">
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {a.title}
                    </a>
                  ) : (
                    a.title
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">
            No announcements captured yet.
          </p>
        )}
      </Card>

      <Link
        href="/screener"
        className="text-sm underline underline-offset-2"
      >
        ← Back to screener
      </Link>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-1.5 dark:border-slate-800">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
