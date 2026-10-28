import { getCurrentUserId } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import { getPayouts } from "@/lib/dividends";
import { getCompanyFinancials } from "@/lib/financials";
import { FinancialsTable } from "@/components/FinancialsTable";
import {
  getAllSymbolViews,
  getConstituent,
  getIndexHistory,
  getPriceHistory,
  getSymbolMeta,
  latestQuoteDate,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { SHARIAH_INDEX_CODES, sortIndexCodes } from "@/lib/psx/indices";
import { StockChart } from "@/components/StockChart";
import { getBenchmarkIndex } from "@/lib/benchmark";
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

/** Peers shown on a stock page; the stock itself is added if it ranks lower. */
const MAX_PEERS = 10;

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
    // ALLSHR covers every eligible stock, so the view has a weight when it can.
    getConstituent(symbol, "ALLSHR"),
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
    getPortfolio(await getCurrentUserId()),
  ]);

  const benchmarkCode = await getBenchmarkIndex(await getCurrentUserId());
  const [benchmarkHistory, allViews] = await Promise.all([
    getIndexHistory(benchmarkCode),
    getAllSymbolViews(),
  ]);

  // Same-sector companies, largest first, for the peers table.
  const peers = meta.sectorCode
    ? allViews
        .filter((v) => v.sectorCode === meta.sectorCode && (v.marketCap ?? 0) > 0)
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    : [];
  const peerIndex = peers.findIndex((p) => p.symbol === symbol);
  const peerRows = peers.slice(0, MAX_PEERS);
  if (peerIndex >= MAX_PEERS) peerRows.push(peers[peerIndex]);
  const self = peerIndex >= 0 ? peers[peerIndex] : null;
  const cheaperThan =
    self?.peTtm != null && self.peTtm > 0
      ? peers.filter((p) => p.symbol !== symbol && p.peTtm != null && p.peTtm > 0 && p.peTtm > self.peTtm!).length
      : null;
  const withPe = peers.filter((p) => p.symbol !== symbol && p.peTtm != null && p.peTtm > 0).length;
  const higherYieldThan =
    self?.dividendYieldPct != null
      ? peers.filter((p) => p.symbol !== symbol && (p.dividendYieldPct ?? 0) < self.dividendYieldPct!).length
      : null;

  const holding = portfolio.holdings.find((h) => h.symbol === symbol);
  const memberOf = sortIndexCodes(
    (meta.indexes ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const shariah = memberOf.some((c) => SHARIAH_INDEX_CODES.includes(c));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={symbol}
        description={
          <>
            {meta.name ?? "—"} ·{" "}
            {sectorLabel(meta.sectorName, meta.sectorCode)}
            {shariah && (
              <>
                {" "}
                <Badge tone="good">Shariah-compliant</Badge>
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

      {memberOf.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">In indices</span>
          {memberOf.map((code) => (
            <Link
              key={code}
              href={`/?index=${code}`}
              className="rounded-md border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {code}
            </Link>
          ))}
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

      <Card title="Price history" subtitle={`Daily closes for ${symbol}, with moving averages, RSI and a comparison with ${benchmarkCode}`}>
        <StockChart
          data={history.map((h) => ({ date: h.date, close: h.close }))}
          label={symbol}
          benchmark={{
            label: benchmarkCode,
            data: benchmarkHistory.map((h) => ({ date: h.date, close: h.current })),
          }}
        />
      </Card>

      {peers.length > 1 && (
        <Card
          title={`Similar companies · ${sectorLabel(meta.sectorName, meta.sectorCode)}`}
          subtitle={[
            peerIndex >= 0 ? `${symbol} is #${peerIndex + 1} of ${peers.length} by market cap` : null,
            cheaperThan != null && withPe > 0 ? `its P/E is lower than ${cheaperThan} of ${withPe} peers` : null,
            higherYieldThan != null ? `its dividend yield beats ${higherYieldThan} of ${peers.length - 1}` : null,
          ].filter(Boolean).join("; ") + "."}
          actions={
            <Link
              href={`/compare?s=${[symbol, ...peers.filter((p) => p.symbol !== symbol).slice(0, 3).map((p) => p.symbol)].join(",")}`}
              className="whitespace-nowrap text-xs font-medium underline underline-offset-2"
            >
              Compare →
            </Link>
          }
        >
          <TableWrap>
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr>
                  <Th>Company</Th>
                  <Th align="right">Close</Th>
                  <Th align="right">Day</Th>
                  <Th align="right">1Y</Th>
                  <Th align="right">P/E</Th>
                  <Th align="right" className="hidden sm:table-cell">Div yield</Th>
                  <Th align="right" className="hidden md:table-cell">Net margin</Th>
                  <Th align="right" className="hidden sm:table-cell">Mkt cap</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {peerRows.map((p) => (
                  <tr
                    key={p.symbol}
                    className={p.symbol === symbol ? "bg-amber-50/70 font-medium dark:bg-amber-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"}
                  >
                    <Td>
                      {p.symbol === symbol ? <span>{p.symbol}</span> : <Link href={`/symbol/${p.symbol}`} className="underline-offset-2 hover:underline">{p.symbol}</Link>}
                      <span className="block max-w-[150px] truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">{p.name ?? ""}</span>
                    </Td>
                    <Td align="right">{money(p.close)}</Td>
                    <Td align="right" className={toneClass(p.changePct)}>{pct(p.changePct)}</Td>
                    <Td align="right" className={toneClass(p.year1ChangePct)}>{pct(p.year1ChangePct, 1)}</Td>
                    <Td align="right">{p.peTtm != null ? p.peTtm.toFixed(1) : "—"}</Td>
                    <Td align="right" className="hidden sm:table-cell">{pct(p.dividendYieldPct, 1, false)}</Td>
                    <Td align="right" className="hidden md:table-cell">{pct(p.netMarginPct, 1, false)}</Td>
                    <Td align="right" className="hidden sm:table-cell">{compactPkr(p.marketCap)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {peers.length > peerRows.length && (
            <Link href={`/sector/${meta.sectorCode}`} className="mt-2 inline-block text-xs underline">
              All {peers.length} in the sector →
            </Link>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Key statistics">
          <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Stat label="Open" value={money(view?.open ?? null)} />
            <Stat label="Previous close" value={money(view?.ldcp ?? null)} />
            <Stat label="Day high" value={money(view?.high ?? null)} />
            <Stat label="Day low" value={money(view?.low ?? null)} />
            <Stat
              label="Avg vol (30D)"
              value={count(
                view?.avgVolume30d == null ? null : Math.round(view.avgVolume30d),
              )}
            />
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
