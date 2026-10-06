import Link from "next/link";
import { Card, SymbolLink } from "@/components/ui";
import { compactPkr, pct, signedMoney, toneClass } from "@/lib/format";
import type { PortfolioSummary } from "@/lib/portfolio";

interface FiredToday {
  id: string;
  message: string;
}

/** Today for the logged-in user: portfolio move, biggest movers, alerts. */
export function YourDay({
  portfolio,
  alertsToday,
}: {
  portfolio: PortfolioSummary;
  alertsToday: FiredToday[];
}) {
  const open = portfolio.holdings.filter((h) => h.quantity > 0);

  if (open.length === 0) {
    return (
      <Card title="Your day">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Record your holdings to see how your portfolio moved today.
        </p>
        <Link href="/portfolio" className="mt-3 inline-block text-sm underline">
          Go to your portfolio
        </Link>
      </Card>
    );
  }

  const movers = open
    .filter((h) => h.dayChange != null && h.dayChange !== 0)
    .sort((a, b) => (b.dayChange ?? 0) - (a.dayChange ?? 0));
  const gainers = movers.filter((h) => (h.dayChange ?? 0) > 0).slice(0, 3);
  const losers = movers.filter((h) => (h.dayChange ?? 0) < 0).reverse().slice(0, 3);

  return (
    <Card title="Your day" subtitle={`${open.length} open position${open.length === 1 ? "" : "s"}`}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Today</p>
          <p className={`tabular text-2xl font-semibold ${toneClass(portfolio.dayChange)}`}>
            {signedMoney(portfolio.dayChange)}
            {portfolio.dayChangePct != null && (
              <span className="ml-2 text-base font-medium">{pct(portfolio.dayChangePct)}</span>
            )}
          </p>
          <p className="tabular text-sm text-slate-500 dark:text-slate-400">
            Worth {compactPkr(portfolio.marketValue)} ·{" "}
            <span className={toneClass(portfolio.unrealizedPnl)}>
              {signedMoney(portfolio.unrealizedPnl)}
            </span>{" "}
            unrealised
          </p>
        </div>

        {(gainers.length > 0 || losers.length > 0) && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { title: "Up", rows: gainers },
              { title: "Down", rows: losers },
            ].map((group) => (
              <div key={group.title}>
                <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">{group.title}</p>
                {group.rows.length === 0 ? (
                  <p className="text-xs text-slate-400">—</p>
                ) : (
                  <ul className="tabular flex flex-col gap-1">
                    {group.rows.map((h) => (
                      <li key={h.symbol} className="flex items-baseline justify-between gap-2">
                        <SymbolLink symbol={h.symbol} />
                        <span className={toneClass(h.dayChange)}>{signedMoney(h.dayChange)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">Alerts today</p>
          {alertsToday.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">None fired.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {alertsToday.slice(0, 3).map((a) => (
                <li key={a.id}>{a.message}</li>
              ))}
              {alertsToday.length > 3 && (
                <li>
                  <Link href="/alerts" className="text-xs underline">
                    and {alertsToday.length - 3} more
                  </Link>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
