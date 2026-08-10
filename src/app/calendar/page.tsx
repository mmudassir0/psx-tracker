import { desc, gte, and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import {
  isDatabaseEmpty,
  getConstituents,
  getTrackedIndexCodes,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { addDays, todayPkt } from "@/lib/dates";
import { indexLabel, sortIndexCodes } from "@/lib/psx/indices";
import { getUpcomingBookClosures } from "@/lib/dividends";
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
import { prettyDate, money } from "@/lib/format";

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

const CATEGORY_LABEL: Record<string, string> = {
  dividend: "Dividend",
  bonus: "Bonus",
  rights: "Rights",
  result: "Results",
  board_meeting: "Board meeting",
  meeting: "Meeting",
  other: "Other",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; scope?: string; index?: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to pull announcements.
      </EmptyState>
    );
  }

  const {
    filter = "all",
    scope = "all",
    index: indexParam,
  } = await searchParams;

  const trackedCodes = await getTrackedIndexCodes();
  const availableIndices = sortIndexCodes(trackedCodes);
  const indexCode =
    indexParam && availableIndices.includes(indexParam.toUpperCase())
      ? indexParam.toUpperCase()
      : null;

  const portfolio = await getPortfolio();
  const held = portfolio.holdings
    .filter((h) => h.quantity > 0)
    .map((h) => h.symbol);

  // 18 months back keeps a couple of full reporting cycles in view.
  const since = addDays(todayPkt(), -550);

  const conditions = [gte(announcements.date, since)];
  if (filter !== "all") conditions.push(eq(announcements.category, filter));
  if (scope === "held" && held.length > 0)
    conditions.push(inArray(announcements.symbol, held));

  // Scope to an index by restricting to its current constituents.
  const indexMembers = indexCode
    ? (await getConstituents(indexCode)).map((c) => c.symbol)
    : null;
  if (indexMembers && indexMembers.length > 0)
    conditions.push(inArray(announcements.symbol, indexMembers));

  const noResultsPossible =
    (scope === "held" && held.length === 0) ||
    (indexMembers != null && indexMembers.length === 0);

  const rows = noResultsPossible
    ? []
    : await db
        .select()
        .from(announcements)
        .where(and(...conditions))
        .orderBy(desc(announcements.date))
        .limit(400)
        .all();

  const heldSet = new Set(held);
  const allClosures = await getUpcomingBookClosures(todayPkt(), 60);
  const bookClosures = (
    indexMembers ? allClosures.filter((p) => indexMembers.includes(p.symbol)) : allClosures
  ).filter((p) => (scope === "held" ? heldSet.has(p.symbol) : true));

  const today = todayPkt();
  const upcoming = rows.filter((r) => r.date >= today);
  const past = rows.filter((r) => r.date < today);

  const counts = {
    dividend: rows.filter((r) => r.category === "dividend").length,
    result: rows.filter((r) => r.category === "result").length,
    board_meeting: rows.filter((r) => r.category === "board_meeting").length,
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Corporate actions calendar"
        description={
          indexCode
            ? `Dividends, bonus and rights issues, results and meetings for ${indexLabel(indexCode)} constituents.`
            : "Dividends, bonus and rights issues, results and meetings across every index we track, parsed from PSX announcements."
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Announcements" value={rows.length} hint="Last 18 months" large />
        <StatTile label="Dividends" value={counts.dividend} />
        <StatTile label="Results" value={counts.result} />
        <StatTile label="Board meetings" value={counts.board_meeting} />
      </div>

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 text-xs text-slate-500 dark:text-slate-400">
            Index
          </span>
          <FilterChip
            label="All"
            active={indexCode == null}
            params={{ filter, scope }}
          />
          {availableIndices.map((code) => (
            <FilterChip
              key={code}
              label={code}
              active={indexCode === code}
              params={{ filter, scope, index: code }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 text-xs text-slate-500 dark:text-slate-400">
            Type
          </span>
          <FilterChip
            label="All"
            active={filter === "all"}
            params={{ scope, index: indexCode ?? undefined }}
          />
          {Object.keys(CATEGORY_LABEL).map((key) => (
            <FilterChip
              key={key}
              label={CATEGORY_LABEL[key]}
              active={filter === key}
              params={{ filter: key, scope, index: indexCode ?? undefined }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 text-xs text-slate-500 dark:text-slate-400">
            Scope
          </span>
          <FilterChip
            label="Everything"
            active={scope === "all"}
            params={{ filter, index: indexCode ?? undefined }}
          />
          <FilterChip
            label={`My holdings${held.length ? ` (${held.length})` : ""}`}
            active={scope === "held"}
            params={{ filter, scope: "held", index: indexCode ?? undefined }}
          />
        </div>
      </div>

      {scope === "held" && held.length === 0 && (
        <EmptyState title="No holdings yet">
          Add positions on the portfolio page to filter the calendar to what you
          own.
        </EmptyState>
      )}

      {bookClosures.length > 0 && (
        <Card
          title="Upcoming book closures"
          subtitle="You must be on the register when the books close to receive the payout — the announcement date is not the entitlement date."
        >
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th>Type</Th>
                  <Th align="right">Rate</Th>
                  <Th align="right">Per share</Th>
                  <Th>Books closed</Th>
                  <Th align="right">In</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {bookClosures.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <SymbolLink symbol={p.symbol} />
                        {heldSet.has(p.symbol) && (
                          <Badge tone="warning">held</Badge>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={p.type === "rights" ? "warning" : "good"}>
                        {p.type.replace("_", " ")}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {p.percent != null ? `${p.percent}%` : "—"}
                    </Td>
                    <Td align="right" className="font-medium">
                      {money(p.perShare)}
                    </Td>
                    <Td className="text-slate-600 dark:text-slate-400">
                      {prettyDate(p.bookClosureFrom)} –{" "}
                      {prettyDate(p.bookClosureTo)}
                    </Td>
                    <Td align="right" className="text-slate-500">
                      {p.daysUntil <= 0 ? "open now" : `${p.daysUntil}d`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card
          title="Dated today or later"
          subtitle="Announcements whose stated date has not passed"
        >
          <AnnouncementList rows={upcoming} held={held} />
        </Card>
      )}

      <Card
        title="Recent announcements"
        subtitle={`${past.length} in the last 18 months`}
      >
        {past.length > 0 ? (
          <AnnouncementList rows={past} held={held} />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">
            Nothing matches these filters.
          </p>
        )}
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        PSX announcement titles usually state the event but not always the rate
        — where a percentage is not in the title, the payout rate shows as
        &ldquo;—&rdquo; rather than being guessed. Open the linked PDF for the
        exact terms.
      </p>
    </div>
  );
}

function AnnouncementList({
  rows,
  held,
}: {
  rows: {
    id: string;
    symbol: string;
    date: string;
    title: string;
    url: string | null;
    category: string;
  }[];
  held: string[];
}) {
  const heldSet = new Set(held);

  return (
    <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-start gap-2 py-2">
          <span className="tabular w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">
            {prettyDate(row.date)}
          </span>
          <span className="w-20 shrink-0">
            <SymbolLink symbol={row.symbol} />
          </span>
          <Badge tone={CATEGORY_TONE[row.category] ?? "neutral"}>
            {CATEGORY_LABEL[row.category] ?? row.category}
          </Badge>
          {heldSet.has(row.symbol) && <Badge tone="warning">held</Badge>}
          <span className="min-w-[240px] flex-1">
            {row.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {row.title}
              </a>
            ) : (
              row.title
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A filter chip. Carries the full filter state in its href so the three
 * dimensions (index, type, scope) compose instead of resetting each other.
 * Defaults are omitted to keep URLs readable.
 */
function FilterChip({
  label,
  active,
  params,
}: {
  label: string;
  active: boolean;
  params: { filter?: string; scope?: string; index?: string };
}) {
  const search = new URLSearchParams();
  if (params.filter && params.filter !== "all")
    search.set("filter", params.filter);
  if (params.scope && params.scope !== "all") search.set("scope", params.scope);
  if (params.index) search.set("index", params.index);

  const query = search.toString();

  return (
    <a
      href={query ? `/calendar?${query}` : "/calendar"}
      className={
        active
          ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
      }
    >
      {label}
    </a>
  );
}
