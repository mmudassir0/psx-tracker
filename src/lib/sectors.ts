import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { symbols } from "@/db/schema";
import { getConstituents, type ConstituentView } from "@/lib/market";

export interface SectorSummary {
  code: string;
  name: string | null;
  memberCount: number;
  totalFreeFloatCap: number;
  avgChangePct: number | null;
  avgPe: number | null;
}

function sectorKey(row: ConstituentView): string {
  return row.sectorCode ?? "unknown";
}

export async function getSectorSummaries(indexCode?: string): Promise<SectorSummary[]> {
  const rows = await getConstituents(indexCode);
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

export async function getSectorMembers(code: string): Promise<ConstituentView[]> {
  const all = await getConstituents("ALLSHR");
  const inAllShr = all.filter((r) => (r.sectorCode ?? "unknown") === code);
  if (inAllShr.length > 0) return inAllShr;
  const kmi30 = await getConstituents();
  return kmi30.filter((r) => (r.sectorCode ?? "unknown") === code);
}

export async function getSectorName(code: string): Promise<string | null> {
  const rows = await db
    .select({ name: symbols.sectorName })
    .from(symbols)
    .where(eq(symbols.sectorCode, code))
    .all();
  const row = rows.find((r) => r.name);
  return row?.name ?? null;
}

export async function listSectors(): Promise<{ code: string; name: string | null }[]> {
  const rows = await db
    .select({
      code: symbols.sectorCode,
      name: sql<string | null>`max(${symbols.sectorName})`,
    })
    .from(symbols)
    .groupBy(symbols.sectorCode)
    .all();

  return rows
    .filter((r): r is { code: string; name: string | null } => r.code != null)
    .sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code));
}
