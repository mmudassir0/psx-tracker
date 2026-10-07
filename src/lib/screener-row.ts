import type { ConstituentView } from "@/lib/market";

/** Only the fields the table shows, so ALLSHR's 550 rows stay a small payload. */
export const SCREENER_FIELDS = [
  "symbol", "name", "sectorName", "sectorCode", "close", "changePct", "ytdChangePct",
  "year1ChangePct", "peTtm", "dividendYieldPct", "dividendPerShare", "epsGrowthPct",
  "netMarginPct", "indexWeightPct", "marketCap", "avgVolume30d", "drawdownFrom52wPct",
] as const;
export type ScreenerRow = Pick<ConstituentView, (typeof SCREENER_FIELDS)[number]>;

export function toScreenerRow(v: ConstituentView): ScreenerRow {
  const out = {} as Record<string, unknown>;
  for (const k of SCREENER_FIELDS) out[k] = v[k];
  return out as ScreenerRow;
}
