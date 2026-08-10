import { and, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { quotesDaily } from "@/db/schema";
import { getConstituents } from "@/lib/market";
import { getPortfolio } from "@/lib/portfolio";
import { TRACKED_INDEX } from "@/lib/psx/ingest";
import { addDays, todayPkt } from "@/lib/dates";

export const PARTICIPATION_RATE = 0.2;

export interface LiquidityRow {
  symbol: string;
  name: string | null;
  close: number | null;
  avgValue: number | null;
  medianValue: number | null;
  avgVolume: number | null;
  tradedSessions: number;
  totalSessions: number;
  positionValue: number | null;
  daysToExit: number | null;
  tier: "deep" | "adequate" | "thin" | "illiquid";
}

function tierFor(medianValue: number | null): LiquidityRow["tier"] {
  if (medianValue == null || medianValue <= 0) return "illiquid";
  if (medianValue >= 100_000_000) return "deep";
  if (medianValue >= 20_000_000) return "adequate";
  if (medianValue >= 2_000_000) return "thin";
  return "illiquid";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface LiquidityReport {
  rows: LiquidityRow[];
  fromDate: string;
  days: number;
  indexCode: string;
  concerns: LiquidityRow[];
}

export async function buildLiquidityReport({
  indexCode = TRACKED_INDEX,
  days = 90,
  heldOnly = false,
}: { indexCode?: string; days?: number; heldOnly?: boolean } = {}): Promise<LiquidityReport> {
  const fromDate = addDays(todayPkt(), -days);

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
  const symbols = universe.map((c) => c.symbol);
  if (symbols.length === 0) {
    return { rows: [], fromDate, days, indexCode, concerns: [] };
  }

  const bars = await db
    .select({
      symbol: quotesDaily.symbol,
      date: quotesDaily.date,
      close: quotesDaily.close,
      volume: quotesDaily.volume,
    })
    .from(quotesDaily)
    .where(
      and(inArray(quotesDaily.symbol, symbols), gte(quotesDaily.date, fromDate)),
    )
    .all();

  const bySymbol = new Map<string, { value: number; volume: number }[]>();
  const sessionCount = new Map<string, number>();
  for (const bar of bars) {
    sessionCount.set(bar.symbol, (sessionCount.get(bar.symbol) ?? 0) + 1);
    if (bar.volume == null || bar.volume <= 0) continue;
    const list = bySymbol.get(bar.symbol) ?? [];
    list.push({ value: bar.close * bar.volume, volume: bar.volume });
    bySymbol.set(bar.symbol, list);
  }

  const rows: LiquidityRow[] = universe.map((c) => {
    const traded = bySymbol.get(c.symbol) ?? [];
    const values = traded.map((t) => t.value);
    const volumes = traded.map((t) => t.volume);

    const avgValue =
      values.length > 0
        ? values.reduce((s, v) => s + v, 0) / values.length
        : null;
    const medianValue = median(values);
    const avgVolume =
      volumes.length > 0
        ? volumes.reduce((s, v) => s + v, 0) / volumes.length
        : null;

    const positionValue = held.get(c.symbol) ?? null;
    const capacity =
      medianValue != null ? medianValue * PARTICIPATION_RATE : 0;
    const daysToExit =
      positionValue != null && positionValue > 0 && capacity > 0
        ? positionValue / capacity
        : null;

    return {
      symbol: c.symbol,
      name: c.name,
      close: c.close,
      avgValue,
      medianValue,
      avgVolume,
      tradedSessions: traded.length,
      totalSessions: sessionCount.get(c.symbol) ?? 0,
      positionValue,
      daysToExit,
      tier: tierFor(medianValue),
    };
  });

  rows.sort((a, b) => (b.medianValue ?? -1) - (a.medianValue ?? -1));

  return {
    rows,
    fromDate,
    days,
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
