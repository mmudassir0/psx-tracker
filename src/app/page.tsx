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
  getSectorBreakdown,
  getTrackedIndexCodes,
  isDatabaseEmpty,
  latestQuoteDate,
  type ConstituentView,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { detectRecomposition } from "@/lib/psx/ingest";
import {
  DEFAULT_INDEX,
  SHARIAH_INDEX_CODES,
  indexLabel,
  sortIndexCodes,
} from "@/lib/psx/indices";
import { DivergingBars, WeightBars } from "@/components/DivergingBars";
import { IngestButton } from "@/components/IngestButton";
import { PriceChart } from "@/components/PriceChart";
import { YourDay } from "@/components/YourDay";
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
const COMPARE_CODES = ["KMI30", "KSE100", "KMIALLSHR", "ALLSHR"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string }>;
}) {
  if (await isDatabaseEmpty()) return <FirstRun />;
  const userId = await getCurrentUserId();

  // ?index= wins; otherwise the user's saved default; otherwise KMI30.
  const tracked = sortIndexCodes(await getTrackedIndexCodes());
  const saved = await getUserSetting(userId, "dashboard", { index: DEFAULT_INDEX });
  const requested = (await searchParams).index?.toUpperCase();
  const code =
    requested && tracked.includes(requested)
      ? requested
      : tracked.includes(saved.index)
        ? saved.index
        : DEFAULT_INDEX;

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
  const breadth = await getMarketBreadth(allSymbols);
  const alertsToday = events
    .filter((e) => e.date === quoteDate)
    .map((e) => ({ id: e.id, message: e.message }));
  const movers = computeIndexMovers(constituents, index);
  const unlocked = userId != null;
  const onboarding = await getOnboarding(userId, {
    telegramAvailable: telegramConfigured(),
    emailAvailable: emailConfigured(),
  });

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

  const summaryByCode = new Map(summaries.map((s) => [s.code, s]));
  const compare = COMPARE_CODES.filter((c) => c !== code && summaryByCode.has(c)).slice(0, 3);
  const shariah = SHARIAH_INDEX_CODES.includes(code);
  const tableRows = constituents.slice(0, MAX_TABLE_ROWS);

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

      {/* One filter row above everything it scopes; one swipeable line on phones. */}
      <div className="-mx-4 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm sm:mx-0 sm:flex-wrap sm:px-0">
        <span className="mr-1 shrink-0 text-xs text-slate-500 dark:text-slate-400">Index</span>
        {tracked.map((c) => (
          <Link key={c} href={`/?index=${c}`} className={chipClass(c === code)}>
            {c}
          </Link>
        ))}
        {unlocked && code !== saved.index && (
          <form action={setDashboardIndexAction} className="ml-2">
            <input type="hidden" name="index" value={code} />
            <button type="submit" className="text-xs text-slate-600 underline-offset-2 hover:underline dark:text-slate-400">
              Make {code} my default
            </button>
          </form>
        )}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title={`${code} over time`}
          subtitle="Index level at each session's close"
          className={unlocked ? "lg:col-span-2" : "lg:col-span-3"}
        >
          <PriceChart
            data={history.map((h) => ({ date: h.date, close: h.current }))}
            label={code}
            height={260}
          />
        </Card>
        {unlocked && <YourDay portfolio={portfolio} alertsToday={alertsToday} />}
      </div>

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

        <Card
          title="Sector weights"
          subtitle={`Share of ${code} free-float market cap`}
        >
          <WeightBars
            data={sectors.map((s) => ({
              label: s.sector,
              value: s.weightPct,
            }))}
          />
        </Card>
      </div>

      <Card
        title="Near 52-week extremes"
        subtitle={`${code} members within ${NEAR_EXTREME_PCT}% of their 52-week high or low`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      </Card>

      <Card
        title="Constituents"
        subtitle={
          (constituents.length > MAX_TABLE_ROWS
            ? `The ${MAX_TABLE_ROWS} largest of ${constituents.length}. `
            : "") +
          "Weights are computed from free-float market cap. PSX caps individual weights in the live index; these are uncapped, so the largest names read slightly high."
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
                <Th align="right">
                  <span className="sm:hidden">Wt</span>
                  <span className="hidden sm:inline">Weight</span>
                </Th>
                <Th align="right" className="hidden sm:table-cell">P/E</Th>
                <Th align="right" className="hidden md:table-cell">Avg vol 30D</Th>
                <Th align="right" className="hidden md:table-cell">Off 52w high</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {tableRows.map((c) => (
                <tr
                  key={c.symbol}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <Td>
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
                  <Td align="right">{pct(c.indexWeightPct, 2, false)}</Td>
                  <Td align="right" className="hidden sm:table-cell">
                    {c.peTtm != null ? c.peTtm.toFixed(2) : "—"}
                  </Td>
                  <Td align="right" className="hidden md:table-cell">
                    {count(c.avgVolume30d == null ? null : Math.round(c.avgVolume30d))}
                  </Td>
                  <Td align="right" className="hidden text-slate-500 md:table-cell">
                    {pct(c.drawdownFrom52wPct, 1, false)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
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
