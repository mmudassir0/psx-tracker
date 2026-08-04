import Link from "next/link";
import {
  getConstituents,
  getLatestIndexLevel,
  getSectorBreakdown,
  getLastIngest,
  latestQuoteDate,
  isDatabaseEmpty,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { detectRecomposition } from "@/lib/psx/ingest";
import { DivergingBars, WeightBars } from "@/components/DivergingBars";
import { IngestButton } from "@/components/IngestButton";
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
  sectorLabel,
  relativeTime,
} from "@/lib/format";

// Reads SQLite on every request; nothing here can be statically prerendered.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  if (isDatabaseEmpty()) return <FirstRun />;

  const constituents = getConstituents();
  const index = getLatestIndexLevel();
  const quoteDate = latestQuoteDate();
  const sectors = getSectorBreakdown(constituents);
  const portfolio = getPortfolio();
  const recomposition = detectRecomposition();
  const lastIngest = getLastIngest();

  const advancers = constituents.filter((c) => (c.changePct ?? 0) > 0).length;
  const decliners = constituents.filter((c) => (c.changePct ?? 0) < 0).length;

  const byChange = [...constituents]
    .filter((c) => c.changePct != null)
    .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="KMI30 Dashboard"
        description={
          <>
            Shariah-screened index of 30 PSX companies. Session{" "}
            {prettyDate(quoteDate)}.
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

      {(recomposition.dropped.length > 0 || recomposition.added.length > 0) && (
        <RecompositionBanner
          added={recomposition.added}
          dropped={recomposition.dropped}
          date={recomposition.currentDate}
        />
      )}

      {/* Headline numbers as stat tiles — not a one-bar chart. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="KMI30 Index"
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
            ) : (
              <Link href="/portfolio" className="underline">
                Add your holdings
              </Link>
            )
          }
        />
        <StatTile
          label="Index free-float cap"
          value={compactPkr(
            constituents.reduce((sum, c) => sum + (c.freeFloatCap ?? 0), 0),
          )}
          hint="PKR, sum of constituents"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Day change by constituent"
          subtitle="Sorted best to worst. Every bar is labelled, so colour is never the only signal."
          className="lg:col-span-2"
        >
          {byChange.length > 0 ? (
            <DivergingBars
              data={byChange.map((c) => ({
                symbol: c.symbol,
                name: c.name,
                value: c.changePct,
                close: c.close,
                volume: c.volume,
                weightPct: c.indexWeightPct,
              }))}
            />
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No quote data yet.
            </p>
          )}
        </Card>

        <Card
          title="Sector weights"
          subtitle="Share of KMI30 free-float market cap"
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
        title="Constituents"
        subtitle="Weights are computed from free-float market cap. PSX caps individual weights in the live index; these are uncapped, so the largest names read slightly high."
        actions={
          <Link
            href="/screener"
            className="text-xs font-medium underline underline-offset-2"
          >
            Open screener →
          </Link>
        }
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Symbol</Th>
                <Th>Company</Th>
                <Th align="right">Close</Th>
                <Th align="right">Change</Th>
                <Th align="right">Weight</Th>
                <Th align="right">P/E</Th>
                <Th align="right">Volume</Th>
                <Th align="right">Off 52w high</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {constituents.map((c) => (
                <tr
                  key={c.symbol}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <Td>
                    <SymbolLink symbol={c.symbol} />
                  </Td>
                  <Td className="max-w-[220px] truncate text-slate-600 dark:text-slate-400">
                    {c.name ?? sectorLabel(c.sectorName, c.sectorCode)}
                  </Td>
                  <Td align="right">{money(c.close)}</Td>
                  <Td align="right" className={toneClass(c.changePct)}>
                    {pct(c.changePct)}
                  </Td>
                  <Td align="right">{pct(c.indexWeightPct, 2, false)}</Td>
                  <Td align="right">
                    {c.peTtm != null ? c.peTtm.toFixed(2) : "—"}
                  </Td>
                  <Td align="right">{count(c.volume)}</Td>
                  <Td align="right" className="text-slate-500">
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

function RecompositionBanner({
  added,
  dropped,
  date,
}: {
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
            KMI30 recomposition detected as of {prettyDate(date)}
          </p>
          {dropped.length > 0 && (
            <p className="mt-1">
              <span className="font-medium">Dropped:</span> {dropped.join(", ")}{" "}
              — these are no longer Shariah-screened for this index.
            </p>
          )}
          {added.length > 0 && (
            <p className="mt-0.5">
              <span className="font-medium">Added:</span> {added.join(", ")}
            </p>
          )}
          <Link
            href="/recomposition"
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
        <p>Run the first ingest to populate five years of KMI30 history:</p>
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
