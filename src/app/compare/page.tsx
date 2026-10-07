import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { symbols } from "@/db/schema";
import { getAllSymbolViews, getPriceHistory, isDatabaseEmpty, latestQuoteDate, type ConstituentView } from "@/lib/market";
import { addDays } from "@/lib/dates";
import { CompareChart } from "@/components/CompareChart";
import { COMPARE_COLOURS } from "@/lib/compare-colours";
import { CompareAdd } from "@/components/CompareAdd";
import { Card, EmptyState, PageHeader, TableWrap, Th, Td } from "@/components/ui";
import { compactPkr, count, money, pct, prettyDate, sectorLabel } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare · PSX Tracker" };

const MAX_STOCKS = 4;
const EXAMPLES = [
  ["MEBL", "MCB", "HBL", "UBL"],
  ["LUCK", "DGKC", "MLCF"],
  ["OGDC", "PPL", "MARI"],
];

type Better = "high" | "low" | null;

/** Rows of the comparison table; `better` bolds the best value in the row. */
const METRICS: { label: string; value: (v: ConstituentView) => number | null; show: (v: ConstituentView) => string; better: Better }[] = [
  { label: "Close (PKR)", value: (v) => v.close, show: (v) => money(v.close), better: null },
  { label: "Today", value: (v) => v.changePct, show: (v) => pct(v.changePct), better: "high" },
  { label: "Year to date", value: (v) => v.ytdChangePct, show: (v) => pct(v.ytdChangePct, 1), better: "high" },
  { label: "1 year", value: (v) => v.year1ChangePct, show: (v) => pct(v.year1ChangePct, 1), better: "high" },
  { label: "Below 52-week high", value: (v) => v.drawdownFrom52wPct, show: (v) => pct(v.drawdownFrom52wPct, 1, false), better: null },
  { label: "P/E", value: (v) => (v.peTtm != null && v.peTtm > 0 ? v.peTtm : null), show: (v) => (v.peTtm != null ? v.peTtm.toFixed(1) : "—"), better: "low" },
  { label: "Dividend yield", value: (v) => v.dividendYieldPct, show: (v) => pct(v.dividendYieldPct, 1, false), better: "high" },
  { label: "EPS growth", value: (v) => v.epsGrowthPct, show: (v) => pct(v.epsGrowthPct, 1), better: "high" },
  { label: "Revenue growth", value: (v) => v.revenueGrowthPct, show: (v) => pct(v.revenueGrowthPct, 1), better: "high" },
  { label: "Net margin", value: (v) => v.netMarginPct, show: (v) => pct(v.netMarginPct, 1, false), better: "high" },
  { label: "Market cap (PKR)", value: (v) => v.marketCap, show: (v) => compactPkr(v.marketCap), better: null },
  { label: "Avg volume (30 days)", value: (v) => v.avgVolume30d, show: (v) => count(v.avgVolume30d == null ? null : Math.round(v.avgVolume30d)), better: null },
  { label: "Free float", value: (v) => v.freeFloatPct, show: (v) => pct(v.freeFloatPct, 0, false), better: null },
];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return <EmptyState title="No data yet">Run <code>npm run setup</code> first.</EmptyState>;
  }

  const requested = [
    ...new Set(
      ((await searchParams).s ?? "")
        .split(",")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_STOCKS);
  const known = requested.length
    ? new Set(
        (await db.select({ s: symbols.symbol }).from(symbols).where(inArray(symbols.symbol, requested)).all()).map((r) => r.s),
      )
    : new Set<string>();
  const picked = requested.filter((s) => known.has(s));

  const quoteDate = await latestQuoteDate();
  const from = quoteDate ? addDays(quoteDate, -1100) : undefined;
  const [views, histories] = await Promise.all([
    getAllSymbolViews(),
    Promise.all(picked.map((s) => getPriceHistory(s, from))),
  ]);
  const bySymbol = new Map(views.map((v) => [v.symbol, v]));
  const rows = picked.map((s) => bySymbol.get(s)).filter((v): v is ConstituentView => v != null);

  const without = (s: string) => {
    const rest = picked.filter((x) => x !== s);
    return rest.length ? `/compare?s=${rest.join(",")}` : "/compare";
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Compare stocks"
        description={`Up to ${MAX_STOCKS} stocks side by side: price performance on one chart and the key numbers in one table. Session ${prettyDate(quoteDate)}.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {picked.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COMPARE_COLOURS[i] }} />
            <Link href={`/symbol/${s}`} className="font-medium underline-offset-2 hover:underline">
              {s}
            </Link>
            <Link href={without(s)} aria-label={`Remove ${s}`} className="text-slate-400 hover:text-slate-900 dark:hover:text-slate-100">
              ×
            </Link>
          </span>
        ))}
        <CompareAdd current={picked} max={MAX_STOCKS} />
      </div>

      {requested.length > picked.length && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Not found: {requested.filter((s) => !known.has(s)).join(", ")}.
        </p>
      )}

      {picked.length === 0 ? (
        <Card title="Pick stocks to compare">
          <p className="text-sm text-slate-600 dark:text-slate-400">Add stocks above, or try one of these:</p>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {EXAMPLES.map((set) => (
              <li key={set.join()}>
                <Link href={`/compare?s=${set.join(",")}`} className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
                  {set.join(" · ")}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <>
          <Card title="Price performance" subtitle="% change from the start of the chosen period">
            <CompareChart
              series={picked.map((s, i) => ({ symbol: s, data: histories[i].map((h) => ({ date: h.date, close: h.close })) }))}
            />
          </Card>

          <Card title="Key numbers" subtitle="Bold marks the best in each row where higher or lower is clearly better.">
            <TableWrap>
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr>
                    <Th> </Th>
                    {rows.map((v, i) => (
                      <Th key={v.symbol} align="right">
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: COMPARE_COLOURS[i] }} />
                          {v.symbol}
                        </span>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  <tr>
                    <Td className="text-slate-500 dark:text-slate-400">Sector</Td>
                    {rows.map((v) => (
                      <Td key={v.symbol} align="right" className="max-w-[140px] truncate">
                        {sectorLabel(v.sectorName, v.sectorCode)}
                      </Td>
                    ))}
                  </tr>
                  {METRICS.map((m) => {
                    const vals = rows.map((v) => m.value(v));
                    const present = vals.filter((x): x is number => x != null);
                    const best =
                      m.better && present.length > 1
                        ? m.better === "high"
                          ? Math.max(...present)
                          : Math.min(...present)
                        : null;
                    return (
                      <tr key={m.label} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <Td className="text-slate-500 dark:text-slate-400">{m.label}</Td>
                        {rows.map((v, i) => (
                          <Td key={v.symbol} align="right" className={best != null && vals[i] === best ? "font-semibold" : ""}>
                            {m.show(v)}
                          </Td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </>
      )}
    </div>
  );
}
