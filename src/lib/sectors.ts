import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { symbols } from "@/db/schema";
import { getConstituents, type ConstituentView } from "@/lib/market";

/**
 * Sector rollups.
 *
 * Sector names arrive from company pages, but the numeric sector CODE comes
 * from market-watch and is present for every symbol — so codes are the key and
 * names are a display nicety that may be missing for counters without a
 * company page.
 */

export interface SectorSummary {
  code: string;
  name: string | null;
  memberCount: number;
  /** Members held in the portfolio. */
  totalFreeFloatCap: number;
  avgChangePct: number | null;
  avgPe: number | null;
}

function sectorKey(row: ConstituentView): string {
  return row.sectorCode ?? "unknown";
}

export function getSectorSummaries(indexCode?: string): SectorSummary[] {
  const rows = getConstituents(indexCode);
  const groups = new Map<string, ConstituentView[]>();

  for (const row of rows) {
    const key = sectorKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .map(([code, members]) => {
      const withChange = members.filter((m) => m.changePct != null);
      const withPe = members.filter((m) => m.peTtm != null && m.peTtm > 0);
      const cap = members.reduce((s, m) => s + (m.freeFloatCap ?? 0), 0);

      return {
        code,
        name: members.find((m) => m.sectorName)?.sectorName ?? null,
        memberCount: members.length,
        totalFreeFloatCap: cap,
        avgChangePct:
          withChange.length > 0
            ? withChange.reduce((s, m) => s + (m.changePct ?? 0), 0) /
              withChange.length
            : null,
        avgPe:
          withPe.length > 0
            ? withPe.reduce((s, m) => s + (m.peTtm ?? 0), 0) / withPe.length
            : null,
      };
    })
    .sort((a, b) => b.totalFreeFloatCap - a.totalFreeFloatCap);
}

/** Every symbol in a sector, across all indices — not just one index. */
export function getSectorMembers(code: string): ConstituentView[] {
  const all = getConstituents("ALLSHR");
  const inAllShr = all.filter((r) => (r.sectorCode ?? "unknown") === code);
  if (inAllShr.length > 0) return inAllShr;
  // Fall back to KMI30 when ALLSHR has no snapshot yet.
  return getConstituents().filter((r) => (r.sectorCode ?? "unknown") === code);
}

export function getSectorName(code: string): string | null {
  const row = db
    .select({ name: symbols.sectorName })
    .from(symbols)
    .where(eq(symbols.sectorCode, code))
    .all()
    .find((r) => r.name);
  return row?.name ?? null;
}

/** Distinct sector codes with a name, for the index page. */
export function listSectors(): { code: string; name: string | null }[] {
  return db
    .select({
      code: symbols.sectorCode,
      name: sql<string | null>`max(${symbols.sectorName})`,
    })
    .from(symbols)
    .groupBy(symbols.sectorCode)
    .all()
    .filter((r): r is { code: string; name: string | null } => r.code != null)
    .sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code));
}
