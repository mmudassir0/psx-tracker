import Link from "next/link";
import { runAllScreens, describeRule } from "@/lib/screens";
import { isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import {
  Card,
  StatTile,
  PageHeader,
  EmptyState,
  Badge,
  SymbolLink,
} from "@/components/ui";
import { prettyDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ScreensPage() {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const results = runAllScreens();
  const quoteDate = latestQuoteDate();

  const totalNew = results.reduce((sum, r) => sum + r.newSymbols.length, 0);
  const withMatches = results.filter((r) => r.matches.length > 0).length;
  const anyHistory = results.some((r) => r.previousDate != null);

  const triggered = results
    .filter((r) => r.newSymbols.length > 0)
    .sort((a, b) => b.newSymbols.length - a.newSymbols.length);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Screens"
        description={
          <>
            {results.length} screens run across the whole market on every
            ingest. Session {prettyDate(quoteDate)}.
          </>
        }
        actions={
          <Link
            href="/screens/new"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            New screen
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="New today"
          value={anyHistory ? totalNew : "—"}
          hint={
            anyHistory
              ? "Symbols that newly entered a screen"
              : "Needs a second day of history"
          }
          large
        />
        <StatTile label="Screens" value={results.length} hint={`${withMatches} with matches`} />
        <StatTile
          label="Total matches"
          value={results.reduce((s, r) => s + r.matches.length, 0)}
          hint="Across all screens; names can appear in several"
        />
        <StatTile
          label="Universe"
          value="Whole market"
          hint="~494 symbols, not just KMI30"
        />
      </div>

      {!anyHistory && (
        <div className="rounded-xl border border-slate-300 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="font-medium">Today is the first recorded run</p>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            &ldquo;New today&rdquo; is a diff against the previous stored run,
            so it stays empty until there are two. Everything below is still
            live — only the change detection needs a second day.
          </p>
        </div>
      )}

      {triggered.length > 0 && (
        <Card
          title="Triggered today"
          subtitle="Symbols that entered a screen since the previous run"
        >
          <ul className="flex flex-col gap-2.5">
            {triggered.map((r) => (
              <li key={r.screen.id} className="text-sm">
                <Link
                  href={`/screens/${r.screen.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {r.screen.name}
                </Link>
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                  +{r.newSymbols.length} since {prettyDate(r.previousDate)}
                </span>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                  {r.newSymbols.slice(0, 12).map((s) => (
                    <SymbolLink key={s} symbol={s} />
                  ))}
                  {r.newSymbols.length > 12 && (
                    <span className="text-xs text-slate-500">
                      +{r.newSymbols.length - 12} more
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r) => (
          <Link
            key={r.screen.id}
            href={`/screens/${r.screen.id}`}
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold tracking-tight">
                {r.screen.name}
              </span>
              <span className="tabular shrink-0 text-lg font-semibold">
                {r.matches.length}
              </span>
            </div>

            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {r.screen.description}
            </p>

            <div className="mt-2 flex flex-wrap gap-1">
              {r.screen.universe === "shariah" && (
                <Badge tone="good">Shariah only</Badge>
              )}
              {!r.screen.builtIn && <Badge tone="neutral">custom</Badge>}
              {r.newSymbols.length > 0 && (
                <Badge tone="warning">+{r.newSymbols.length} new</Badge>
              )}
            </div>

            <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {r.screen.rules.map((rule, i) => (
                <li key={i}>{describeRule(rule)}</li>
              ))}
            </ul>
          </Link>
        ))}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Screens describe what the numbers say — they do not rank, recommend or
        score anything as worth buying. Growth screens carry a PKR 1bn market
        cap floor, because percentage growth off a near-zero base produces
        arithmetically true but useless figures.
      </p>
    </div>
  );
}
