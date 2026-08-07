import Link from "next/link";
import { notFound } from "next/navigation";
import { runScreen, describeRule } from "@/lib/screens";
import { deleteScreenAction } from "@/app/actions";
import { isDatabaseEmpty, latestQuoteDate } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { ScreenerTable } from "@/components/ScreenerTable";
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

export default async function ScreenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> first.
      </EmptyState>
    );
  }

  const { id } = await params;
  const result = runScreen(id);
  if (!result) notFound();

  const { screen, matches, newSymbols, droppedSymbols, previousDate } = result;

  const held = new Set(
    getPortfolio()
      .holdings.filter((h) => h.quantity > 0)
      .map((h) => h.symbol),
  );
  const heldMatches = matches.filter((m) => held.has(m.symbol));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={screen.name}
        description={
          <>
            {screen.description} · Session {prettyDate(latestQuoteDate())}
          </>
        }
        actions={
          <div className="flex items-center gap-3">
            {!screen.builtIn && (
              <>
                <Link
                  href={`/screens/${screen.id}/edit`}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                >
                  Edit
                </Link>
                <form action={deleteScreenAction}>
                  <input type="hidden" name="id" value={screen.id} />
                  <button
                    type="submit"
                    className="text-xs text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                  >
                    Delete
                  </button>
                </form>
              </>
            )}
            <Link href="/screens" className="text-xs underline underline-offset-2">
              ← All screens
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Matches" value={matches.length} large />
        <StatTile
          label="New since last run"
          value={previousDate ? newSymbols.length : "—"}
          hint={previousDate ? prettyDate(previousDate) : "No prior run stored"}
        />
        <StatTile
          label="No longer matching"
          value={previousDate ? droppedSymbols.length : "—"}
        />
        <StatTile
          label="You hold"
          value={heldMatches.length}
          hint={
            heldMatches.length > 0
              ? heldMatches.map((m) => m.symbol).join(", ")
              : "None of your positions match"
          }
        />
      </div>

      <Card title="Criteria" subtitle={`Universe: ${universeLabel(screen.universe)}`}>
        <ul className="flex flex-col gap-1 text-sm">
          {screen.rules.map((rule, i) => (
            <li key={i} className="flex items-center gap-2">
              <Badge tone="neutral">{i + 1}</Badge>
              {describeRule(rule)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          All criteria must hold. A symbol with a missing value for any
          criterion never matches — absence is not treated as a pass.
        </p>
      </Card>

      {(newSymbols.length > 0 || droppedSymbols.length > 0) && (
        <Card
          title="Changes since the previous run"
          subtitle={`Compared with ${prettyDate(previousDate)}`}
        >
          {newSymbols.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="good">entered</Badge>
              {newSymbols.map((s) => (
                <SymbolLink key={s} symbol={s} />
              ))}
            </div>
          )}
          {droppedSymbols.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="warning">left</Badge>
              {droppedSymbols.map((s) => (
                <SymbolLink key={s} symbol={s} />
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title="Matching companies" subtitle={`${matches.length} of the whole market`}>
        {matches.length > 0 ? (
          <ScreenerTable rows={matches} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Nothing currently meets these criteria.
          </p>
        )}
      </Card>
    </div>
  );
}

function universeLabel(universe: string): string {
  if (universe === "all") return "whole market";
  if (universe === "shariah") return "Shariah-screened names only";
  return universe;
}
