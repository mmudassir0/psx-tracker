import { getConstituents } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { TRACKED_INDEX } from "@/lib/psx/ingest";

export const PARTICIPATION_RATE = 0.2;

/**
 * PSX stopped publishing daily volume, so liquidity is measured from the
 * 30-session average volume on /screener. A mean is pulled up by block
 * trades, so treat tiers and exit estimates as slightly optimistic.
 */
export interface LiquidityRow {
  symbol: string;
  name: string | null;
  close: number | null;
  /** Average PKR traded per session over the last 30 sessions. */
  avgValue: number | null;
  /** Average shares traded per session over the last 30 sessions. */
  avgVolume: number | null;
  positionValue: number | null;
  daysToExit: number | null;
  tier: "deep" | "adequate" | "thin" | "illiquid";
}

function tierFor(avgValue: number | null): LiquidityRow["tier"] {
  if (avgValue == null || avgValue <= 0) return "illiquid";
  if (avgValue >= 100_000_000) return "deep";
  if (avgValue >= 20_000_000) return "adequate";
  if (avgValue >= 2_000_000) return "thin";
  return "illiquid";
}

export interface LiquidityReport {
  rows: LiquidityRow[];
  indexCode: string;
  concerns: LiquidityRow[];
}

export async function buildLiquidityReport({
  indexCode = TRACKED_INDEX,
  heldOnly = false,
}: { indexCode?: string; heldOnly?: boolean } = {}): Promise<LiquidityReport> {
  const constituents = await getConstituents(indexCode);
  const portfolio = await getPortfolio();
  const held = new Map(
    portfolio.holdings
      .filter((h) => h.quantity > 0)
      .map((h) => [h.symbol, h.marketValue ?? 0]),
  );

  const universe = heldOnly
    ? constituents.filter((c) => held.has(c.symbol))
    : constituents;

  const rows: LiquidityRow[] = universe.map((c) => {
    const avgValue = c.avgTradedValue30d;
    const positionValue = held.get(c.symbol) ?? null;
    const capacity = avgValue != null ? avgValue * PARTICIPATION_RATE : 0;
    const daysToExit =
      positionValue != null && positionValue > 0 && capacity > 0
        ? positionValue / capacity
        : null;

    return {
      symbol: c.symbol,
      name: c.name,
      close: c.close,
      avgValue,
      avgVolume: c.avgVolume30d,
      positionValue,
      daysToExit,
      tier: tierFor(avgValue),
    };
  });

  rows.sort((a, b) => (b.avgValue ?? -1) - (a.avgValue ?? -1));

  return {
    rows,
    indexCode,
    concerns: rows.filter(
      (r) => r.positionValue != null && (r.daysToExit ?? 0) > 2,
    ),
  };
}

export const TIER_LABELS: Record<LiquidityRow["tier"], string> = {
  deep: "Deep",
  adequate: "Adequate",
  thin: "Thin",
  illiquid: "Illiquid",
};

export const TIER_TONES: Record<
  LiquidityRow["tier"],
  "good" | "neutral" | "warning" | "critical"
> = {
  deep: "good",
  adequate: "neutral",
  thin: "warning",
  illiquid: "critical",
};
