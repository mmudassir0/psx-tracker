import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { constituents } from "@/db/schema";
import { TRACKED_INDEX, membersOn } from "@/lib/psx/ingest";

export interface RecompositionEvent {
  date: string;
  previousDate: string;
  added: string[];
  dropped: string[];
}

export async function getRecompositionHistory(
  indexCode = TRACKED_INDEX,
): Promise<RecompositionEvent[]> {
  const datesRows = await db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .all();
  const dates = datesRows.map((r) => r.date);

  const events: RecompositionEvent[] = [];

  for (let i = 0; i < dates.length - 1; i++) {
    const current = dates[i];
    const previous = dates[i + 1];
    const currentSet = new Set(await membersOn(indexCode, current));
    const previousSet = new Set(await membersOn(indexCode, previous));

    const added = [...currentSet].filter((s) => !previousSet.has(s)).sort();
    const dropped = [...previousSet].filter((s) => !currentSet.has(s)).sort();

    if (added.length || dropped.length) {
      events.push({ date: current, previousDate: previous, added, dropped });
    }
  }

  return events;
}

export interface MembershipRun {
  symbol: string;
  firstSeen: string;
  lastSeen: string;
  snapshots: number;
  current: boolean;
}

export async function getMembershipRuns(
  indexCode = TRACKED_INDEX,
): Promise<MembershipRun[]> {
  const rows = await db
    .select({ date: constituents.date, symbol: constituents.symbol })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .all();

  const latestRow = await db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(1)
    .get();
  const latest = latestRow?.date;

  const bySymbol = new Map<string, MembershipRun>();
  for (const row of rows) {
    const existing = bySymbol.get(row.symbol);
    if (existing) {
      existing.firstSeen =
        row.date < existing.firstSeen ? row.date : existing.firstSeen;
      existing.lastSeen =
        row.date > existing.lastSeen ? row.date : existing.lastSeen;
      existing.snapshots += 1;
    } else {
      bySymbol.set(row.symbol, {
        symbol: row.symbol,
        firstSeen: row.date,
        lastSeen: row.date,
        snapshots: 1,
        current: false,
      });
    }
  }

  for (const run of bySymbol.values()) {
    run.current = run.lastSeen === latest;
  }

  return [...bySymbol.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.symbol.localeCompare(b.symbol);
  });
}

export async function getSnapshotCoverage(indexCode = TRACKED_INDEX): Promise<{
  count: number;
  first: string | null;
  last: string | null;
}> {
  const datesRows = await db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(constituents.date)
    .all();
  const dates = datesRows.map((r) => r.date);

  return {
    count: dates.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}
