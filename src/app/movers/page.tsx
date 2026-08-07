import {
  getAllSymbolViews,
  getMarketBreadth,
  getMovers,
  isDatabaseEmpty,
  type ConstituentView,
} from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
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
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MoversPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const { scope } = await searchParams;
  const shariahOnly = scope === "shariah";

  const all = getAllSymbolViews();
  const rows = shariahOnly ? all.filter((r) => r.shariah) : all;

  const breadth = getMarketBreadth(rows);
  const movers = getMovers(rows, 15);

  const held = new Set(
    getPortfolio()
      .holdings.filter((h) => h.quantity > 0)
      .map((h) => h.symbol),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Movers & breadth"
        description={
          <>
            {rows.length} symbols, session {prettyDate(breadth.date)}. The index
            pages only cover constituents — this is the whole market.
          </>
        }
      />

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">
          Universe
        </span>
        <a href="/movers" className={chipClass(!shariahOnly)}>
          Whole market
        </a>
        <a href="/movers?scope=shariah" className={chipClass(shariahOnly)}>
          Shariah-screened only
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Advancing / Declining"
          value={
            <span>
              <span style={{ color: "var(--diverge-pos-mid)" }}>
                {breadth.advancing}
              </span>
              <span className="text-slate-400"> / </span>
              <span style={{ color: "var(--diverge-neg-mid)" }}>
                {breadth.declining}
              </span>
            </span>
          }
          hint={`${breadth.unchanged} unchanged of ${breadth.total}`}
          large
        />
        <StatTile
          label="Advance ratio"
          value={pct(breadth.advanceRatioPct, 1, false)}
          hint={
            breadth.advanceRatioPct == null
              ? undefined
              : breadth.advanceRatioPct >= 60
                ? "Broad-based strength"
                : breadth.advanceRatioPct <= 40
                  ? "Broad-based weakness"
                  : "Mixed"
          }
        />
        <StatTile
          label="Limit up"
          value={breadth.limitUp}
          hint="Closed at the +10% circuit"
        />
        <StatTile
          label="Limit down"
          value={breadth.limitDown}
          hint="Closed at the −10% circuit"
        />
      </div>

      <BreadthBar breadth={breadth} />

      <div className="grid gap-4 lg:grid-cols-2">
        <MoverTable
          title="Top gainers"
          subtitle="Largest percentage rise today"
          rows={movers.gainers}
          held={held}
        />
        <MoverTable
          title="Top losers"
          subtitle="Largest percentage fall today"
          rows={movers.losers}
          held={held}
        />
      </div>

      <Card
        title="Most active"
        subtitle="By traded value, not share count — volume alone just surfaces penny stocks"
      >
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th>Symbol</Th>
                <Th>Company</Th>
                <Th align="right">Close</Th>
                <Th align="right">Change</Th>
                <Th align="right">Volume</Th>
                <Th align="right">Traded value</Th>
              </tr>
            </thead>
            <tbody className="tabular">
              {movers.mostActive.map((r) => (
                <tr
                  key={r.symbol}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <SymbolLink symbol={r.symbol} />
                      {held.has(r.symbol) && <Badge tone="warning">held</Badge>}
                      {r.shariah && <Badge tone="good">S</Badge>}
                    </div>
                  </Td>
                  <Td className="max-w-[220px] truncate text-slate-600 dark:text-slate-400">
                    {r.name ?? "—"}
                  </Td>
                  <Td align="right">{money(r.close)}</Td>
                  <Td align="right" className={toneClass(r.changePct)}>
                    {pct(r.changePct)}
                  </Td>
                  <Td align="right" className="text-slate-500">
                    {count(r.volume)}
                  </Td>
                  <Td align="right" className="font-medium">
                    {compactPkr((r.volume ?? 0) * (r.close ?? 0))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        PSX applies a 10% daily circuit breaker, so a cluster of names at
        exactly ±10% is the limit being hit rather than a data error. The{" "}
        <Badge tone="good">S</Badge> badge marks membership of a
        Shariah-screened index.
      </p>
    </div>
  );
}

/** Single stacked bar: advancing vs declining vs unchanged. */
function BreadthBar({
  breadth,
}: {
  breadth: ReturnType<typeof getMarketBreadth>;
}) {
  const total = Math.max(1, breadth.total);
  const segments = [
    {
      label: "Advancing",
      value: breadth.advancing,
      colour: "var(--diverge-pos-mid)",
    },
    {
      label: "Unchanged",
      value: breadth.unchanged,
      colour: "var(--diverge-neutral)",
    },
    {
      label: "Declining",
      value: breadth.declining,
      colour: "var(--diverge-neg-mid)",
    },
  ];

  return (
    <Card title="Market breadth" subtitle="Every symbol with a price today">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-md">
        {segments.map((s) => (
          <div
            key={s.label}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.colour,
            }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-4 rounded-[2px]"
              style={{ background: s.colour }}
            />
            {s.label} <span className="tabular font-medium">{s.value}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}

function MoverTable({
  title,
  subtitle,
  rows,
  held,
}: {
  title: string;
  subtitle: string;
  rows: ConstituentView[];
  held: Set<string>;
}) {
  return (
    <Card title={title} subtitle={subtitle}>
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Symbol</Th>
              <Th align="right">Close</Th>
              <Th align="right">Change</Th>
              <Th align="right">Value</Th>
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr
                key={r.symbol}
                className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <Td>
                  <div className="flex items-center gap-1.5">
                    <SymbolLink symbol={r.symbol} />
                    {held.has(r.symbol) && <Badge tone="warning">held</Badge>}
                    {r.shariah && <Badge tone="good">S</Badge>}
                  </div>
                </Td>
                <Td align="right">{money(r.close)}</Td>
                <Td align="right" className={toneClass(r.changePct)}>
                  {pct(r.changePct)}
                </Td>
                <Td align="right" className="text-slate-500">
                  {compactPkr((r.volume ?? 0) * (r.close ?? 0))}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
    : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800";
}
