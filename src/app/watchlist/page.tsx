import Link from "next/link";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getConstituent, getConstituents, isDatabaseEmpty } from "@/lib/market";
import { removeFromWatchlistAction } from "@/app/actions";
import { WatchlistForm } from "@/components/WatchlistForm";
import {
  Card, PageHeader, EmptyState, SymbolLink, TableWrap, Th, Td, Badge,
} from "@/components/ui";
import { money, pct, prettyDate, toneClass } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const rows = await db.select().from(watchlist).orderBy(desc(watchlist.addedAt)).all();
  const universe = await getConstituents("ALLSHR");
  const suggestions = universe.map((c) => c.symbol);

  const enriched = await Promise.all(
    rows.map(async (row) => {
      const view = await getConstituent(row.symbol, "ALLSHR");
      const since =
        row.addedPrice && view?.close != null && row.addedPrice > 0
          ? ((view.close - row.addedPrice) / row.addedPrice) * 100
          : null;
      return { ...row, view, since };
    }),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Watchlist"
        description="Names you are following but do not own. Nothing here touches the portfolio ledger or any P&L figure."
      />

      <Card title="Add a symbol">
        <WatchlistForm symbols={suggestions} />
      </Card>

      {enriched.length === 0 ? (
        <EmptyState title="Nothing on the watchlist">
          Add a symbol above, or browse the{" "}
          <Link href="/screener" className="underline">screener</Link>.
        </EmptyState>
      ) : (
        <Card title={`${enriched.length} watched`}>
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Day</Th>
                  <Th align="right">Added at</Th>
                  <Th align="right">Since added</Th>
                  <Th align="right">P/E</Th>
                  <Th align="right">Div yield</Th>
                  <Th>Note</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {enriched.map((r) => (
                  <tr key={r.symbol} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <SymbolLink symbol={r.symbol} />
                        {r.view?.name == null && <Badge tone="neutral">no data</Badge>}
                      </div>
                    </Td>
                    <Td align="right">{money(r.view?.close ?? null)}</Td>
                    <Td align="right" className={toneClass(r.view?.changePct)}>
                      {pct(r.view?.changePct ?? null)}
                    </Td>
                    <Td align="right" className="text-slate-500">
                      {money(r.addedPrice)}
                    </Td>
                    <Td align="right" className={toneClass(r.since)}>
                      {pct(r.since)}
                    </Td>
                    <Td align="right">
                      {r.view?.peTtm != null ? r.view.peTtm.toFixed(2) : "—"}
                    </Td>
                    <Td align="right">
                      {r.view?.dividendYieldPct != null
                        ? `${r.view.dividendYieldPct.toFixed(2)}%`
                        : "—"}
                    </Td>
                    <Td className="max-w-[220px] truncate text-slate-500">
                      {r.note ?? "—"}
                    </Td>
                    <Td align="right">
                      <form action={removeFromWatchlistAction}>
                        <input type="hidden" name="symbol" value={r.symbol} />
                        <button
                          type="submit"
                          className="text-xs text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                        >
                          Remove
                        </button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            &ldquo;Since added&rdquo; compares today&apos;s close to the price when you added
            the symbol — it is not a return, since you hold none of it.
          </p>
        </Card>
      )}
    </div>
  );
}
