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

/**
 * Walk every consecutive pair of membership snapshots and report the ones that
 * actually changed.
 *
 * KMI30 is rebalanced periodically; a symbol leaving means it stopped meeting
 * the index's Shariah screen or was displaced on review. Because we only learn
 * about changes by diffing snapshots, history starts on the day of the first
 * ingest — there is no way to reconstruct changes from before that.
 */
export function getRecompositionHistory(
  indexCode = TRACKED_INDEX,
): RecompositionEvent[] {
  const dates = db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .all()
    .map((r) => r.date);

  const events: RecompositionEvent[] = [];

  for (let i = 0; i < dates.length - 1; i++) {
    const current = dates[i];
    const previous = dates[i + 1];
    const currentSet = new Set(membersOn(indexCode, current));
    const previousSet = new Set(membersOn(indexCode, previous));

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
  /** Number of snapshots the symbol appeared in. */
  snapshots: number;
  current: boolean;
}

/** Per-symbol membership span across all captured snapshots. */
export function getMembershipRuns(
  indexCode = TRACKED_INDEX,
): MembershipRun[] {
  const rows = db
    .select({ date: constituents.date, symbol: constituents.symbol })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .all();

  const latest = db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(1)
    .get()?.date;

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

/** Total distinct snapshots captured, for the "coverage" note in the UI. */
export function getSnapshotCoverage(indexCode = TRACKED_INDEX): {
  count: number;
  first: string | null;
  last: string | null;
} {
  const dates = db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(constituents.date)
    .all()
    .map((r) => r.date);

  return {
    count: dates.length,
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}
