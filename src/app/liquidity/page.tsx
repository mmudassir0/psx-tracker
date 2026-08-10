import {
  buildLiquidityReport,
  TIER_LABELS,
  TIER_TONES,
  PARTICIPATION_RATE,
} from "@/lib/liquidity";
import { isDatabaseEmpty, getTrackedIndexCodes } from "@/lib/market";
import { indexLabel, sortIndexCodes, DEFAULT_INDEX } from "@/lib/psx/indices";
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
import { money, compactPkr, count, prettyDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const WINDOWS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "180", label: "180 days", days: 180 },
];

export default async function LiquidityPage({
  searchParams,
}: {
  searchParams: Promise<{ index?: string; window?: string; held?: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate volume history.
      </EmptyState>
    );
  }

  const sp = await searchParams;
  const trackedCodes = await getTrackedIndexCodes();
  const available = sortIndexCodes(trackedCodes);
  const indexCode =
    sp.index && available.includes(sp.index.toUpperCase())
      ? sp.index.toUpperCase()
      : DEFAULT_INDEX;
  const windowKey = WINDOWS.some((w) => w.key === sp.window)
    ? sp.window!
    : "90";
  const days = WINDOWS.find((w) => w.key === windowKey)!.days;
  const heldOnly = sp.held === "1";

  const report = await buildLiquidityReport({ indexCode, days, heldOnly });

  const link = (o: Record<string, string>) => {
    const p = new URLSearchParams({
      index: indexCode,
      window: windowKey,
      ...(heldOnly ? { held: "1" } : {}),
      ...o,
    });
    return `/liquidity?${p.toString()}`;
  };

  const tierCounts = (["deep", "adequate", "thin", "illiquid"] as const).map(
    (t) => ({ tier: t, count: report.rows.filter((r) => r.tier === t).length }),
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Liquidity"
        description={
          <>
            Traded value per session for {indexLabel(indexCode)}, since{" "}
            {prettyDate(report.fromDate)}. Index membership says nothing about
            whether you can get out of a name in size.
          </>
        }
      />

      {/* One filter row above everything it scopes. */}
      <div className="flex flex-col gap-2 text-sm">
        <ChipRow label="Index">
          {available.map((code) => (
            <Chip key={code} href={link({ index: code })} active={code === indexCode}>
              {code}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Window">
          {WINDOWS.map((w) => (
            <Chip key={w.key} href={link({ window: w.key })} active={w.key === windowKey}>
              {w.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Scope">
          <Chip href={`/liquidity?index=${indexCode}&window=${windowKey}`} active={!heldOnly}>
            All constituents
          </Chip>
          <Chip href={link({ held: "1" })} active={heldOnly}>
            My holdings
          </Chip>
        </ChipRow>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tierCounts.map((t) => (
          <StatTile
            key={t.tier}
            label={TIER_LABELS[t.tier]}
            value={t.count}
            hint={TIER_HINTS[t.tier]}
          />
        ))}
      </div>

      {report.concerns.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium">
            {report.concerns.length} position
            {report.concerns.length === 1 ? "" : "s"} would take more than 2
            sessions to exit
          </p>
          <ul className="mt-1 space-y-0.5">
            {report.concerns.slice(0, 5).map((r) => (
              <li key={r.symbol}>
                <SymbolLink symbol={r.symbol} /> — about{" "}
                <span className="tabular font-medium">
                  {r.daysToExit!.toFixed(1)} sessions
                </span>{" "}
                at {Math.round(PARTICIPATION_RATE * 100)}% of median daily value
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card
        title="Traded value by symbol"
        subtitle={`Median is used for the tier because a single block trade can double a mean. Exit estimate assumes you are ${Math.round(PARTICIPATION_RATE * 100)}% of a session's value.`}
      >
        {report.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Nothing to show for this scope.
          </p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Symbol</Th>
                  <Th align="right">Median daily value</Th>
                  <Th align="right">Mean</Th>
                  <Th align="right">Avg volume</Th>
                  <Th align="right">Traded sessions</Th>
                  <Th align="right">Your position</Th>
                  <Th align="right">Sessions to exit</Th>
                  <Th>Tier</Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {report.rows.map((r) => (
                  <tr
                    key={r.symbol}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <Td>
                      <SymbolLink symbol={r.symbol} />
                    </Td>
                    <Td align="right">{compactPkr(r.medianValue)}</Td>
                    <Td align="right" className="text-slate-500">
                      {compactPkr(r.avgValue)}
                    </Td>
                    <Td align="right" className="text-slate-500">
                      {count(r.avgVolume ? Math.round(r.avgVolume) : null)}
                    </Td>
                    <Td align="right" className="text-slate-500">
                      {r.tradedSessions}/{r.totalSessions}
                    </Td>
                    <Td align="right">
                      {r.positionValue ? money(r.positionValue) : "—"}
                    </Td>
                    <Td
                      align="right"
                      className={
                        (r.daysToExit ?? 0) > 2
                          ? "font-medium text-amber-700 dark:text-amber-400"
                          : ""
                      }
                    >
                      {r.daysToExit != null ? r.daysToExit.toFixed(1) : "—"}
                    </Td>
                    <Td>
                      <Badge tone={TIER_TONES[r.tier]}>
                        {TIER_LABELS[r.tier]}
                      </Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        PSX does not publish order-book depth on this portal, so this is a
        volume-based proxy — it does not model bid/ask spread or the price
        impact of your own trading. Treat the exit estimate as an order of
        magnitude, not a schedule.
      </p>
    </div>
  );
}

const TIER_HINTS: Record<string, string> = {
  deep: "PKR 100mn+ a day",
  adequate: "PKR 20–100mn",
  thin: "PKR 2–20mn",
  illiquid: "under PKR 2mn",
};

function ChipRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        active
          ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
      }
    >
      {children}
    </a>
  );
}
