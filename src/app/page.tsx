import { Suspense, type ReactNode } from "react";
import { getCurrentUserId } from "@/lib/auth";
import Link from "next/link";
import {
  getAllSymbolViews,
  getConstituents,
  getIndexHistory,
  getIndexSummaries,
  getLastIngest,
  getLatestIndexLevel,
  getMarketBreadth,
  getMovers,
  getSectorBreakdown,
  getTrackedIndexCodes,
  isDatabaseEmpty,
  latestQuoteDate,
  type ConstituentView,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { getPortfolioHistory } from "@/lib/portfolio-history";
import { getBenchmarkIndex } from "@/lib/benchmark";
import { detectRecomposition } from "@/lib/psx/ingest";
import {
  DEFAULT_INDEX,
  SHARIAH_INDEX_CODES,
  indexLabel,
  sortIndexCodes,
} from "@/lib/psx/indices";
import {
  checkStaleness,
  getBreadthHistory,
  getRecentCloses,
  getWatchlistGlance,
  periodReturns,
  streakOf,
  type Staleness,
} from "@/lib/dashboard-data";
import {
  cardOrder,
  hiddenCards,
  type DashboardCardId,
  type DashboardPrefs,
} from "@/lib/dashboard-layout";
import { DivergingBars } from "@/components/DivergingBars";
import { IngestButton } from "@/components/IngestButton";
import { PriceChart } from "@/components/PriceChart";
import { YourDay } from "@/components/YourDay";
import { MarketHeatmap } from "@/components/MarketHeatmap";
import { Sparkline } from "@/components/Sparkline";
import { BreadthChart } from "@/components/BreadthChart";
import { SectorTable } from "@/components/SectorTable";
import { DashboardCustomizer } from "@/components/DashboardCustomizer";
import { PortfolioHistoryChart } from "@/components/PortfolioHistoryChart";
import { computeIndexMovers } from "@/lib/index-movers";
import { listAlertEvents } from "@/lib/alerts";
import { WelcomeChecklist } from "@/components/WelcomeChecklist";
import { getOnboarding } from "@/lib/onboarding";
import { getUserSetting } from "@/lib/settings";
import { emailConfigured, telegramConfigured } from "@/lib/user-notify";
import { setDashboardIndexAction } from "@/app/actions";
import {
  Card,
  StatTile,
  EmptyState,
  PageHeader,
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
  relativeTime,
} from "@/lib/format";

// Reads SQLite on every request; nothing here can be statically prerendered.
export const dynamic = "force-dynamic";

/** Up to this many stocks get a bar each; bigger indices (ALLSHR has ~550) show the extremes. */
const MAX_MOVER_BARS = 40;
const MOVER_BARS_EACH_WAY = 10;
const MAX_TABLE_ROWS = 50;
/** "Near" a 52-week extreme: within this many percent of it. */
const NEAR_EXTREME_PCT = 3;
/** Indices offered for comparison in the "Market today" tile. */
const COMPARE_CODES = ["KSE100", "KMI30", "ALLSHR", "KMIALLSHR"];
/** Whole-market gainers and losers shown each way. */
const MARKET_MOVERS = 5;
/** Sessions in a row before a run counts as a streak. */
const MIN_STREAK = 3;
/** Sessions drawn in each table sparkline. */
const SPARK_SESSIONS = 30;
/** Heatmap boxes for big indices; smaller names would be too thin to see. */
const MAX_HEATMAP_BOXES = 150;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string }>;
}) {
  if (await isDatabaseEmpty()) return <FirstRun />;
  const userId = await getCurrentUserId();

  // ?index= wins; otherwise the user's saved default; otherwise KSE100.
  const tracked = sortIndexCodes(await getTrackedIndexCodes());
  const prefs = await getUserSetting<DashboardPrefs>(userId, "dashboard", { index: DEFAULT_INDEX });
  const requested = (await searchParams).index?.toUpperCase();
  const code =
    requested && tracked.includes(requested)
      ? requested
      : tracked.includes(prefs.index)
        ? prefs.index
        : DEFAULT_INDEX;
  const unlocked = userId != null;
  const benchmark = await getBenchmarkIndex(userId);

  // Personal cards only for a logged-in user; hidden cards aren't loaded at all.
  const order = cardOrder(prefs).filter(
    (id) => unlocked || (id !== "watchlist" && id !== "vs-index"),
  );
  const hidden = unlocked ? hiddenCards(prefs) : new Set<DashboardCardId>();
  const shows = (id: DashboardCardId) => order.includes(id) && !hidden.has(id);

  const [
    constituents,
    index,
    portfolio,
    recomposition,
    lastIngest,
    quoteDate,
    history,
    events,
    summaries,
    allSymbols,
  ] = await Promise.all([
    getConstituents(code),
    getLatestIndexLevel(code),
    getPortfolio(userId),
    detectRecomposition(code),
    getLastIngest(),
    latestQuoteDate(),
    getIndexHistory(code),
    listAlertEvents(userId, 30),
    getIndexSummaries(),
    getAllSymbolViews(),
  ]);

  const [breadth, recent, watchRows, portfolioHistory, onboarding] = await Promise.all([
    getMarketBreadth(allSymbols),
    quoteDate && (shows("constituents") || shows("extremes"))
      ? getRecentCloses(quoteDate)
      : new Map<string, number[]>(),
    userId && shows("watchlist") ? getWatchlistGlance(userId, allSymbols) : [],
    userId && shows("vs-index") ? getPortfolioHistory(userId, {}, benchmark) : [],
    getOnboarding(userId, {
      telegramAvailable: telegramConfigured(),
      emailAvailable: emailConfigured(),
    }),
  ]);

  const stale = checkStaleness(quoteDate, lastIngest);
  const alertsToday = events
    .filter((e) => e.date === quoteDate)
    .map((e) => ({ id: e.id, message: e.message }));
  const movers = computeIndexMovers(constituents, index);
  const returns = periodReturns(history);
  const held = new Set(portfolio.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol));

  const sectors = getSectorBreakdown(constituents);
  const advancers = constituents.filter((c) => (c.changePct ?? 0) > 0).length;
  const decliners = constituents.filter((c) => (c.changePct ?? 0) < 0).length;
  const bySymbol = new Map(constituents.map((c) => [c.symbol, c]));

  // Big indices: the ones that added most and took most.
  const moverRows =
    movers.rows.length > MAX_MOVER_BARS
      ? [...movers.rows.slice(0, MOVER_BARS_EACH_WAY), ...movers.rows.slice(-MOVER_BARS_EACH_WAY)]
      : movers.rows;

  const nearHigh = constituents
    .filter((c) => c.drawdownFrom52wPct != null && c.drawdownFrom52wPct <= NEAR_EXTREME_PCT)
    .sort((a, b) => (a.drawdownFrom52wPct ?? 0) - (b.drawdownFrom52wPct ?? 0))
    .slice(0, 8);
  const nearLow = constituents
    .map((c) => ({ c, aboveLow: offLow(c) }))
    .filter((x): x is { c: ConstituentView; aboveLow: number } => x.aboveLow != null && x.aboveLow <= NEAR_EXTREME_PCT)
    .sort((a, b) => a.aboveLow - b.aboveLow)
    .slice(0, 8);
  const atHigh = constituents.filter((c) => c.drawdownFrom52wPct === 0).length;
  const atLow = constituents.filter((c) => offLow(c) === 0).length;

  const streaks = constituents
    .map((c) => ({ symbol: c.symbol, close: c.close, days: streakOf(recent.get(c.symbol) ?? []) }))
    .filter((s) => Math.abs(s.days) >= MIN_STREAK);
  const upStreaks = streaks.filter((s) => s.days > 0).sort((a, b) => b.days - a.days).slice(0, 6);
  const downStreaks = streaks.filter((s) => s.days < 0).sort((a, b) => a.days - b.days).slice(0, 6);

  const marketMovers = await getMovers(allSymbols, MARKET_MOVERS);

  const summaryByCode = new Map(summaries.map((s) => [s.code, s]));
  const compare = COMPARE_CODES.filter((c) => c !== code && summaryByCode.has(c)).slice(0, 3);
  const shariah = SHARIAH_INDEX_CODES.includes(code);
  const tableRows = constituents.slice(0, MAX_TABLE_ROWS);

  const cards: Record<DashboardCardId, ReactNode> = {
    trend: (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title={`${code} over time`}
          subtitle="Index level at each session's close"
          className={unlocked ? "lg:col-span-2" : "lg:col-span-3"}
        >
          <PeriodReturns returns={returns} />
          <PriceChart
            data={history.map((h) => ({ date: h.date, close: h.current }))}
            label={code}
            height={260}
          />
        </Card>
        {unlocked && <YourDay portfolio={portfolio} alertsToday={alertsToday} />}
      </div>
    ),

    heatmap: (
      <Card
        title="Market heatmap"
        actions={
          <Link href="/heatmap" className="text-xs font-medium underline underline-offset-2">
            Whole market →
          </Link>
        }
        subtitle={
          (constituents.length > MAX_HEATMAP_BOXES
            ? `The ${MAX_HEATMAP_BOXES} largest of ${constituents.length} ${code} members`
            : `Every ${code} member`) +
          ", sized by its weight and coloured by today's change. Tap a box to open the stock."
        }
      >
        {constituents.some((c) => (c.indexWeightPct ?? 0) > 0) ? (
          <MarketHeatmap
            data={constituents.slice(0, MAX_HEATMAP_BOXES).map((c) => ({
              symbol: c.symbol,
              name: c.name,
              sector: c.sectorName ?? c.sectorCode ?? "Other",
              size: c.indexWeightPct ?? 0,
              sizeText: pct(c.indexWeightPct, 2, false),
              changePct: c.changePct,
              close: c.close,
              held: held.has(c.symbol),
            }))}
          />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No weight data yet.</p>
        )}
      </Card>
    ),

    movers: (
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="What moved the index"
          subtitle={
            movers.rows.length > 0
              ? `Index points each stock added or took away today: weight × its own change. Together they explain ${signed(movers.explainedPoints)} points` +
                (movers.actualPoints != null
                  ? ` of today's ${signed(movers.actualPoints)}; the difference is PSX's own weighting (single-stock caps and free-float bands).`
                  : ".") +
                (movers.rows.length > MAX_MOVER_BARS
                  ? ` Showing the ${MOVER_BARS_EACH_WAY} biggest each way of the ${movers.rows.length} with free-float data.`
                  : "")
              : "Index points each stock added or took away today."
          }
          className="lg:col-span-2"
        >
          {moverRows.length > 0 ? (
            <DivergingBars
              data={moverRows.map((r) => ({
                symbol: r.symbol,
                name: r.name,
                value: r.points,
                changePct: r.changePct,
                close: bySymbol.get(r.symbol)?.close ?? null,
                volume: bySymbol.get(r.symbol)?.avgVolume30d ?? null,
                weightPct: r.weightPct,
              }))}
              valueSuffix=" pts"
              positiveLabel="Added points"
              negativeLabel="Took points"
            />
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No quote data yet.
            </p>
          )}
        </Card>

        <Card title="Sectors" subtitle={`Share of ${code} and today's change, weighted by size`}>
          <SectorTable data={sectors} />
        </Card>
      </div>
    ),

    "market-movers": (
      <Card
        title="Top gainers and losers"
        subtitle={`Whole market, all ${breadth.total} listed stocks that traded. PSX limits a day's move to 10% or Rs 1, whichever is more, so very cheap shares can jump much further.`}
        actions={
          <Link href="/screener" className="text-xs font-medium underline underline-offset-2">
            Screener →
          </Link>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <MoverList title="Gainers" rows={marketMovers.gainers} held={held} />
          <MoverList title="Losers" rows={marketMovers.losers} held={held} />
        </div>
      </Card>
    ),

    watchlist: (
      <Card
        title="Your watchlist"
        subtitle="Today's move, change since you added it, and distance from the 52-week high and low"
        actions={
          <Link href="/watchlist" className="text-xs font-medium underline underline-offset-2">
            Edit →
          </Link>
        }
      >
        {watchRows.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nothing watched yet.{" "}
            <Link href="/watchlist" className="underline">
              Add stocks to follow
            </Link>
            .
          </p>
        ) : (
          <TableWrap>
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Close</Th>
                  <Th align="right">Today</Th>
                  <Th align="right" className="hidden sm:table-cell">Since added</Th>
                  <Th align="right">
                    <span className="sm:hidden">Off high</span>
                    <span className="hidden sm:inline">Below 52w high</span>
                  </Th>
                  <Th align="right" className="hidden sm:table-cell">Above 52w low</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {watchRows.slice(0, 12).map((w) => (
                  <tr key={w.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td>
                      <SymbolLink symbol={w.symbol} />
                      {w.name && (
                        <span className="block max-w-[140px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {w.name}
                        </span>
                      )}
                    </Td>
                    <Td align="right">{money(w.close)}</Td>
                    <Td align="right" className={toneClass(w.changePct)}>{pct(w.changePct)}</Td>
                    <Td align="right" className={`hidden sm:table-cell ${toneClass(w.sinceAddedPct)}`}>
                      {pct(w.sinceAddedPct)}
                    </Td>
                    <Td align="right" className="text-slate-600 dark:text-slate-400">{pct(w.offHighPct, 1, false)}</Td>
                    <Td align="right" className="hidden text-slate-600 sm:table-cell dark:text-slate-400">
                      {pct(w.aboveLowPct, 1, false)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {watchRows.length > 12 && (
          <Link href="/watchlist" className="mt-2 inline-block text-xs underline">
            All {watchRows.length} →
          </Link>
        )}
      </Card>
    ),

    "vs-index": (
      <Card
        title={`Your portfolio against ${benchmark}`}
        subtitle={`Your holdings' market value next to the same money put into ${benchmark} on the same days. Change the index on the Portfolio page.`}
        actions={
          <Link href="/portfolio" className="text-xs font-medium underline underline-offset-2">
            Portfolio →
          </Link>
        }
      >
        {portfolioHistory.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <Link href="/portfolio" className="underline">
              Record your trades
            </Link>{" "}
            to compare your returns with the index.
          </p>
        ) : (
          <PortfolioHistoryChart data={portfolioHistory} indexCode={benchmark} />
        )}
      </Card>
    ),

    extremes: (
      <Card
        title="52-week extremes and streaks"
        subtitle={
          <>
            {code} members within {NEAR_EXTREME_PCT}% of their 52-week high or low, and runs of{" "}
            {MIN_STREAK}+ sessions in one direction. Today:{" "}
            <span style={{ color: "var(--diverge-pos-mid)" }}>{atHigh} at a 52-week high</span>,{" "}
            <span style={{ color: "var(--diverge-neg-mid)" }}>{atLow} at a low</span>.
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <ExtremeList
            title="Near the high"
            rows={nearHigh.map((c) => ({
              symbol: c.symbol,
              close: c.close,
              note: c.drawdownFrom52wPct === 0 ? "at the high" : `${pct(c.drawdownFrom52wPct, 1, false)} below`,
              level: c.week52High,
            }))}
          />
          <ExtremeList
            title="Near the low"
            rows={nearLow.map(({ c, aboveLow }) => ({
              symbol: c.symbol,
              close: c.close,
              note: aboveLow === 0 ? "at the low" : `${pct(aboveLow, 1, false)} above`,
              level: c.week52Low,
            }))}
          />
          <StreakList title="Up days in a row" rows={upStreaks} />
          <StreakList title="Down days in a row" rows={downStreaks} />
        </div>
      </Card>
    ),

    breadth: (
      <Card
        title="Rising and falling stocks"
        subtitle="Whole market: how many stocks closed up and down each session"
      >
        {/* The heaviest read on the page; stream it in after the rest. */}
        <Suspense fallback={<div className="h-[240px] animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/50" />}>
          <BreadthSection quoteDate={quoteDate} />
        </Suspense>
      </Card>
    ),

    constituents: (
      <Card
        title="Constituents"
        subtitle={
          (constituents.length > MAX_TABLE_ROWS
            ? `The ${MAX_TABLE_ROWS} largest of ${constituents.length}. `
            : "") +
          "Weights are computed from free-float market cap. PSX caps individual weights in the live index; these are uncapped, so the largest names read slightly high." +
          (held.size > 0 ? " ● marks stocks you hold." : "")
        }
        actions={
          <Link
            href={constituents.length > MAX_TABLE_ROWS ? `/index/${code}` : "/screener"}
            className="text-xs font-medium underline underline-offset-2"
          >
            {constituents.length > MAX_TABLE_ROWS ? `All ${constituents.length} →` : "Open screener →"}
          </Link>
        }
      >
        <TableWrap>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr>
                <Th>Symbol</Th>
                {/* Phones show the essentials; the rest appear on wider screens. */}
                <Th className="hidden sm:table-cell">Company</Th>
                <Th align="right">Close</Th>
                <Th align="right">
                  <span className="sm:hidden">Chg</span>
                  <span className="hidden sm:inline">Change</span>
                </Th>
                <Th align="right" className="hidden md:table-cell">30 sessions</Th>
                <Th align="right">
                  <span className="sm:hidden">Wt</span>
                  <span className="hidden sm:inline">Weight</span>
                </Th>
                <Th align="right" className="hidden sm:table-cell">P/E</Th>
                <Th align="right" className="hidden lg:table-cell">Avg vol 30D</Th>
                <Th align="right" className="hidden lg:table-cell">Off 52w high</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {tableRows.map((c) => (
                <tr
                  key={c.symbol}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${held.has(c.symbol) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
                >
                  <Td>
                    {held.has(c.symbol) && (
                      <span className="mr-1 text-amber-500" title="You hold this">●</span>
                    )}
                    <SymbolLink symbol={c.symbol} />
                    <span className="block max-w-[110px] truncate text-[11px] text-slate-500 sm:hidden dark:text-slate-400">
                      {c.name ?? c.sectorName ?? ""}
                    </span>
                  </Td>
                  <Td className="hidden max-w-[220px] truncate text-slate-600 sm:table-cell dark:text-slate-400">
                    {c.name ?? (c.sectorName ?? c.symbol)}
                  </Td>
                  <Td align="right">{money(c.close)}</Td>
                  <Td align="right" className={toneClass(c.changePct)}>
                    {pct(c.changePct)}
                  </Td>
                  <Td align="right" className="hidden md:table-cell">
                    <Sparkline values={(recent.get(c.symbol) ?? []).slice(-SPARK_SESSIONS)} />
                  </Td>
                  <Td align="right">{pct(c.indexWeightPct, 2, false)}</Td>
                  <Td align="right" className="hidden sm:table-cell">
                    {c.peTtm != null ? c.peTtm.toFixed(2) : "—"}
                  </Td>
                  <Td align="right" className="hidden lg:table-cell">
                    {count(c.avgVolume30d == null ? null : Math.round(c.avgVolume30d))}
                  </Td>
                  <Td align="right" className="hidden text-slate-500 lg:table-cell">
                    {pct(c.drawdownFrom52wPct, 1, false)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    ),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${code} Dashboard`}
        description={
          <>
            {indexLabel(code) !== code ? `${indexLabel(code)}: ` : ""}
            {constituents.length} companies
            {shariah ? ", Shariah-screened" : ""}. Session {prettyDate(quoteDate)}.
          </>
        }
        actions={
          <div className="flex flex-col items-end gap-1">
            <IngestButton />
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Last ingest {relativeTime(lastIngest?.startedAt)}
              {lastIngest?.status === "error" && (
                <>
                  {" "}
                  <Badge tone="critical">errors</Badge>
                </>
              )}
            </span>
          </div>
        }
      />

      {stale && <StaleBanner stale={stale} />}

      {/* One filter row above everything it scopes; one swipeable line on phones. */}
      <div className="flex items-center gap-2">
        <div className="-mx-4 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0">
          <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">Index</span>
          {tracked.map((c) => (
            <Link key={c} href={`/?index=${c}`} className={chipClass(c === code)}>
              {c}
            </Link>
          ))}
          {unlocked && code !== prefs.index && (
            <form action={setDashboardIndexAction} className="ml-2">
              <input type="hidden" name="index" value={code} />
              <button type="submit" className="text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-400">
                Make {code} my default
              </button>
            </form>
          )}
        </div>
        {unlocked && <DashboardCustomizer order={order} hidden={[...hidden]} />}
      </div>

      {onboarding && <WelcomeChecklist steps={onboarding} />}

      {(recomposition.dropped.length > 0 || recomposition.added.length > 0) && (
        <RecompositionBanner
          indexCode={code}
          shariah={shariah}
          added={recomposition.added}
          dropped={recomposition.dropped}
          date={recomposition.currentDate}
        />
      )}

      {/* Headline numbers as stat tiles — not a one-bar chart. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`${code} Index`}
          value={
            index
              ? index.current.toLocaleString("en-PK", {
                  maximumFractionDigits: 2,
                })
              : "—"
          }
          delta={index?.changePct ?? null}
          large
        />
        <StatTile
          label="Advancers / Decliners"
          value={
            <span>
              <span style={{ color: "var(--diverge-pos-mid)" }}>
                {advancers}
              </span>
              <span className="text-slate-400"> / </span>
              <span style={{ color: "var(--diverge-neg-mid)" }}>
                {decliners}
              </span>
            </span>
          }
          hint={`of ${constituents.length} constituents`}
        />
        <StatTile
          label="Portfolio value"
          value={
            portfolio.marketValue > 0 ? compactPkr(portfolio.marketValue) : "—"
          }
          delta={portfolio.marketValue > 0 ? portfolio.unrealizedPct : null}
          hint={
            portfolio.marketValue > 0 ? (
              <span className={toneClass(portfolio.totalPnl)}>
                {signedMoney(portfolio.totalPnl)} total
              </span>
            ) : unlocked ? (
              <Link href="/portfolio" className="underline">
                Add your holdings
              </Link>
            ) : (
              <Link href="/login?next=%2F" className="underline">
                Log in to see yours
              </Link>
            )
          }
        />
        <StatTile
          label="Market today"
          value={
            <ul className="flex flex-col gap-0.5 text-sm font-normal">
              {compare.map((c) => {
                const s = summaryByCode.get(c)!;
                return (
                  <li key={c} className="flex justify-between gap-3">
                    <Link href={`/?index=${c}`} className="underline-offset-2 hover:underline">
                      {c}
                    </Link>
                    <span className={`tabular ${toneClass(s.changePct)}`}>{pct(s.changePct)}</span>
                  </li>
                );
              })}
            </ul>
          }
          hint={
            <>
              Whole market:{" "}
              <span style={{ color: "var(--diverge-pos-mid)" }}>{breadth.advancing} up</span>
              {" / "}
              <span style={{ color: "var(--diverge-neg-mid)" }}>{breadth.declining} down</span>
            </>
          }
        />
      </div>

      {order
        .filter((id) => !hidden.has(id))
        .map((id) => (
          <div key={id} id={`card-${id}`}>
            {cards[id]}
          </div>
        ))}

      {unlocked && hidden.size > 0 && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {hidden.size} card{hidden.size === 1 ? "" : "s"} hidden. Use &ldquo;Choose cards&rdquo; at the top to show {hidden.size === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

async function BreadthSection({ quoteDate }: { quoteDate: string | null }) {
  return <BreadthChart data={quoteDate ? await getBreadthHistory(quoteDate) : []} />;
}

function PeriodReturns({ returns }: { returns: { label: string; pct: number | null }[] }) {
  if (returns.every((r) => r.pct == null)) return null;
  return (
    <dl className="mb-3 grid grid-cols-5 gap-1 rounded-lg bg-slate-50 p-2 text-center dark:bg-slate-800/50">
      {returns.map((r) => (
        <div key={r.label}>
          <dt className="text-[11px] text-slate-500 dark:text-slate-400">{r.label}</dt>
          <dd className={`tabular text-sm font-medium ${toneClass(r.pct)}`}>{pct(r.pct, 1)}</dd>
        </div>
      ))}
    </dl>
  );
}

function StaleBanner({ stale }: { stale: Staleness }) {
  return (
    <div role="status" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm dark:border-rose-800 dark:bg-rose-950/40">
      <p className="font-medium">
        Prices are from {prettyDate(stale.quoteDate)}, not the latest session ({prettyDate(stale.expected)}).
      </p>
      <p className="mt-1 text-slate-700 dark:text-slate-300">
        {stale.ingestFailed
          ? "The last daily update failed, so everything below is out of date."
          : `About ${stale.missedSessions} weekday sessions are missing. The daily update may not have run, or the market was closed.`}{" "}
        Check the update history on the{" "}
        <Link href="/health" className="underline">
          Data health page
        </Link>
        .
      </p>
    </div>
  );
}

function MoverList({
  title,
  rows,
  held,
}: {
  title: string;
  rows: ConstituentView[];
  held: Set<string>;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">None today.</p>
      ) : (
        <ul className="tabular flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.symbol} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">
                {held.has(r.symbol) && <span className="mr-1 text-amber-500" title="You hold this">●</span>}
                <SymbolLink symbol={r.symbol} />
                <span className="ml-1.5 hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
                  {r.name ?? ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="text-slate-600 dark:text-slate-400">{money(r.close)}</span>{" "}
                <span className={`font-medium ${toneClass(r.changePct)}`}>{pct(r.changePct)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StreakList({
  title,
  rows,
}: {
  title: string;
  rows: { symbol: string; close: number | null; days: number }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">None right now.</p>
      ) : (
        <ul className="tabular flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.symbol} className="flex items-baseline justify-between gap-3">
              <SymbolLink symbol={r.symbol} />
              <span className="text-right text-slate-600 dark:text-slate-400">
                {money(r.close)}{" "}
                <span className={`text-xs font-medium ${toneClass(r.days)}`}>
                  {Math.abs(r.days)} {r.days > 0 ? "up" : "down"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** % above the 52-week low, or null without the data. */
function offLow(c: ConstituentView): number | null {
  if (c.close == null || c.week52Low == null || c.week52Low <= 0) return null;
  return Math.max(0, (c.close / c.week52Low - 1) * 100);
}

function ExtremeList({
  title,
  rows,
}: {
  title: string;
  rows: { symbol: string; close: number | null; note: string; level: number | null }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">None right now.</p>
      ) : (
        <ul className="tabular flex flex-col gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.symbol} className="flex items-baseline justify-between gap-3">
              <SymbolLink symbol={r.symbol} />
              <span className="text-right text-slate-600 dark:text-slate-400">
                {money(r.close)} <span className="text-xs">({r.note} {money(r.level)})</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecompositionBanner({
  indexCode,
  shariah,
  added,
  dropped,
  date,
}: {
  indexCode: string;
  shariah: boolean;
  added: string[];
  dropped: string[];
  date: string | null;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠️</span>
        <div className="text-sm">
          <p className="font-medium">
            {indexCode} recomposition detected as of {prettyDate(date)}
          </p>
          {dropped.length > 0 && (
            <p className="mt-1">
              <span className="font-medium">Dropped:</span> {dropped.join(", ")}
              {shariah ? " — these are no longer Shariah-screened for this index." : ""}
            </p>
          )}
          {added.length > 0 && (
            <p className="mt-0.5">
              <span className="font-medium">Added:</span> {added.join(", ")}
            </p>
          )}
          <Link
            href={`/recomposition?index=${indexCode}`}
            className="mt-1 inline-block underline underline-offset-2"
          >
            View recomposition history →
          </Link>
        </div>
      </div>
    </div>
  );
}

function FirstRun() {
  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState title="No data yet">
        <p>Run the first ingest to populate the database:</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-left text-xs text-slate-100">
          npm run setup
        </pre>
        <p className="mt-3">
          After that, <code>npm run ingest</code> refreshes the current session.
        </p>
      </EmptyState>
    </div>
  );
}

function signed(points: number): string {
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}`;
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
}
