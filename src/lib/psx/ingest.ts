import { createHash, randomUUID } from "node:crypto";
import { and, eq, desc, sql, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  symbols,
  quotesDaily,
  indexLevels,
  constituents,
  companyStats,
  announcements as announcementsTable,
  financials as financialsTable,
  ingestRuns,
} from "@/db/schema";
import { psxFetch, mapLimit, PsxError } from "./client";
import {
  parseMarketWatch,
  parseIndices,
  parseCompanyPage,
  categorise,
  parseFinancials,
  type MarketWatchRow,
} from "./parse";
import { todayPkt, isMarketOpen, addDays, pktDateToUtc } from "@/lib/dates";

export const TRACKED_INDEX = "KMI30";

/** KMI30 holds exactly 30 constituents, as the name says. */
export const EXPECTED_KMI30_SIZE = 30;

/** Below this share of the previous snapshot, a listing is treated as partial. */
const MEMBERSHIP_COMPLETENESS_RATIO = 0.9;

/**
 * Is this constituent count complete enough to record as a membership snapshot?
 *
 * Early in a session, market-watch only lists symbols that have already traded,
 * so an index can appear to have a fraction of its members. Recording that
 * would make the recomposition tracker report mass "drops" the next time it
 * diffed. A short list is missing data, not a recomposition.
 *
 * KMI30's size is fixed by definition so it gets an exact check; every other
 * index is judged against its own previous snapshot, since sizes vary (KSE30
 * currently carries 29 members, ALLSHR several hundred).
 *
 * @param previousCount members in the most recent prior snapshot, if any
 */
export function isPlausibleMembership(
  indexCode: string,
  count: number,
  previousCount: number | null,
): boolean {
  if (count === 0) return false;
  if (indexCode === TRACKED_INDEX) return count >= EXPECTED_KMI30_SIZE;
  // No baseline yet: accept, otherwise the index could never bootstrap.
  if (previousCount == null || previousCount === 0) return true;
  return count >= previousCount * MEMBERSHIP_COMPLETENESS_RATIO;
}

/** Symbols a previous run found to have no PSX company page. */
async function missingPageSymbols(): Promise<Set<string>> {
  const rows = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.noCompanyPage, true))
    .all();
  return new Set(rows.map((r) => r.symbol));
}

/** Does a membership snapshot already exist for this index on this date? */
async function hasSnapshot(indexCode: string, date: string): Promise<boolean> {
  if (!date || !indexCode) return false;
  const row = await db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(
        eq(constituents.indexCode, indexCode),
        eq(constituents.date, date),
      ),
    )
    .limit(1)
    .get();
  return Boolean(row);
}

/** Members in the most recent snapshot before `date`, or null if none. */
async function previousMemberCount(indexCode: string, date: string): Promise<number | null> {
  if (!date || !indexCode) return null;
  const row = await db
    .select({ date: constituents.date })
    .from(constituents)
    .where(
      and(eq(constituents.indexCode, indexCode), lt(constituents.date, date)),
    )
    .orderBy(desc(constituents.date))
    .limit(1)
    .get();

  if (!row?.date) return null;

  const rows = await db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(
        eq(constituents.indexCode, indexCode),
        eq(constituents.date, row.date),
      ),
    )
    .all();
  return rows.length;
}

/**
 * Work out which trading session /screener is showing.
 *
 * When the market is closed, PSX still displays the *previous* session's
 * numbers. Stamping those with today's date would invent a duplicate flat
 * day, so outside trading hours we read the session from the "As of" stamp
 * on the home page's index tiles.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function resolveSessionDate(): Promise<string> {
  if (isMarketOpen()) return todayPkt();

  // e.g. "As of Oct 2, 2026 4:50 PM"
  try {
    const home = await psxFetch("/", { ttlMs: 60_000 });
    const m = home.match(/As of\s+([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
    if (m) {
      const month = MONTHS.indexOf(m[1]) + 1;
      if (month > 0) {
        return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      }
    }
  } catch {
    // Fall through.
  }

  // The home page was unreachable. Today is the least-wrong fallback, but
  // never a weekend: those quotes belong to Friday's session.
  let fallback = todayPkt();
  while ([0, 6].includes(pktDateToUtc(fallback).getUTCDay())) {
    fallback = addDays(fallback, -1);
  }
  return fallback;
}

/** Stable id so re-ingesting the same announcement updates instead of duplicating. */
function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);
}

export interface IngestOptions {
  /** Pull company fundamentals + announcements. */
  includeFundamentals?: boolean;
  /**
   * Which symbols get fundamentals and announcements. Membership snapshots and
   * quotes always cover everything market-watch lists — those are free, they
   * come from one page. Company pages are one request each, so this is the
   * knob that decides whether a run costs 30 requests or ~380.
   *
   * - "all"      every symbol belonging to at least one index (~382)
   * - "indices"  members of `fundamentalIndices` only
   */
  fundamentalScope?: "all" | "indices";
  /** Index codes used when fundamentalScope is "indices". */
  fundamentalIndices?: string[];
  /** Clear the no-company-page marks and retry every symbol. */
  recheckCompanyPages?: boolean;
  /** Parallel requests against the PSX portal. */
  concurrency?: number;
  /** How this run was launched, recorded for the run history. */
  trigger?: "cli" | "ui" | "schedule";
  onProgress?: (message: string) => void;
}

export interface IngestResult {
  date: string;
  symbolsSeen: number;
  /** Members of KMI30, kept for the existing summary line. */
  constituentCount: number;
  /** Per-index member counts actually snapshotted this run. */
  indexMemberCounts: Record<string, number>;
  /** Indices whose snapshot was withheld as incomplete. */
  skippedIndices: string[];
  fundamentalsFetched: number;
  /** Symbols newly found to have no PSX company page. */
  pagesMarkedMissing: number;
  /** Symbols skipped because a previous run found no company page. */
  pagesSkipped: number;
  quotesWritten: number;
  announcementsWritten: number;
  /** Financial/ratio cells written. */
  financialCellsWritten: number;
  /** True when KMI30's snapshot specifically was withheld. */
  membershipSkipped: boolean;
  errors: string[];
}

/**
 * One full ingest pass. Safe to run repeatedly — every write is an upsert
 * keyed on (symbol, date), so re-running the same day just refreshes values.
 */
export async function runIngest(
  options: IngestOptions = {},
): Promise<IngestResult> {
  const {
    includeFundamentals = true,
    fundamentalScope = "all",
    fundamentalIndices = [TRACKED_INDEX],
    recheckCompanyPages = false,
    concurrency = 4,
    trigger = "cli",
    onProgress: onProgressOption = () => {},
  } = options;

  const runId = randomUUID();
  const errors: string[] = [];

  await db
    .insert(ingestRuns)
    .values({ id: runId, startedAt: new Date(), status: "running", trigger })
    .run();

  // Mirror every progress line into the run row. SQLite writes are cheap and
  // this is what lets the browser show real progress instead of a spinner.
  const onProgress = (message: string) => {
    onProgressOption(message);
    // Fire-and-forget, so the rejection must be caught here: an unhandled
    // one (a Turso network blip) would kill the whole process.
    // Promise.resolve().then also covers the local driver, which is
    // synchronous and would throw instead of rejecting.
    void Promise.resolve()
      .then(() =>
        db
          .update(ingestRuns)
          .set({ progress: message.trim() })
          .where(eq(ingestRuns.id, runId))
          .run(),
      )
      .catch(() => {
        // Progress reporting must never break the ingest itself.
      });
  };

  onProgress("Resolving session date…");
  const date = await resolveSessionDate();
  onProgress(`Session date: ${date}${isMarketOpen() ? " (market open)" : ""}`);

  const result: IngestResult = {
    date,
    symbolsSeen: 0,
    constituentCount: 0,
    indexMemberCounts: {},
    skippedIndices: [],
    fundamentalsFetched: 0,
    pagesMarkedMissing: 0,
    pagesSkipped: 0,
    quotesWritten: 0,
    announcementsWritten: 0,
    financialCellsWritten: 0,
    membershipSkipped: false,
    errors,
  };

  try {
    // --- 1. Index levels -----------------------------------------------
    onProgress("Fetching index levels…");
    const indices = parseIndices(await psxFetch("/indices", { ttlMs: 0 }));
    for (const row of indices) {
      if (row.current == null) continue;
      await db
        .insert(indexLevels)
        .values({
          indexCode: row.indexCode,
          date,
          current: row.current,
          high: row.high,
          low: row.low,
          change: row.change,
          changePct: row.changePct,
        })
        .onConflictDoUpdate({
          target: [indexLevels.indexCode, indexLevels.date],
          set: {
            current: row.current,
            high: row.high,
            low: row.low,
            change: row.change,
            changePct: row.changePct,
          },
        })
        .run();
    }
    onProgress(`  ${indices.length} indices`);

    // --- 2. Market watch: symbols, quotes, membership -------------------
    onProgress("Fetching market watch…");
    const marketRows = parseMarketWatch(
      await psxFetch("/screener", { ttlMs: 0 }),
    );
    result.symbolsSeen = marketRows.length;

    const members = marketRows.filter((r) => r.isKmi30);
    result.constituentCount = members.length;

    if (marketRows.length === 0) {
      throw new Error(
        "market-watch returned no rows — page layout may have changed",
      );
    }

    await upsertSymbols(marketRows);
    result.quotesWritten = await writeMarketWatchQuotes(marketRows, date);

    // Group every symbol by every index it belongs to. The membership column
    // covers all 17 PSX indices, so this costs nothing beyond the page we
    // already fetched.
    const byIndex = new Map<string, string[]>();
    for (const row of marketRows) {
      for (const code of row.indexes) {
        const list = byIndex.get(code);
        if (list) list.push(row.symbol);
        else byIndex.set(code, [row.symbol]);
      }
    }

    // Snapshot membership per index (drives the recomposition tracker).
    //
    // Mid-session, market-watch lists only symbols that have already traded,
    // so a listing can be partial. Two things make that safe:
    //   1. Inserts only ever ADD, so a later run the same day tops a partial
    //      snapshot back up to the full set.
    //   2. The completeness guard compares against the previous snapshot, so a
    //      partial listing can never shrink an established index and fake a
    //      wave of "drops".
    // A first-ever snapshot has nothing to diff against, so bootstrapping is
    // allowed — it just needs a post-close run the same day to fill out.
    const marketOpen = isMarketOpen();
    const bootstrapped: string[] = [];

    for (const [code, symbolsInIndex] of byIndex) {
      const previous = await previousMemberCount(code, date);

      if (marketOpen && previous == null && !(await hasSnapshot(code, date))) {
        bootstrapped.push(code);
      }

      if (!isPlausibleMembership(code, symbolsInIndex.length, previous)) {
        result.skippedIndices.push(code);
        if (code === TRACKED_INDEX) result.membershipSkipped = true;
        const note =
          `${code}: only ${symbolsInIndex.length} members visible` +
          (previous ? ` (previous snapshot had ${previous})` : "") +
          " — snapshot skipped as an incomplete listing, not a recomposition.";
        errors.push(note);
        onProgress(`  ! ${note}`);
        continue;
      }

      for (let i = 0; i < symbolsInIndex.length; i += WRITE_CHUNK) {
        await db
          .insert(constituents)
          .values(
            symbolsInIndex
              .slice(i, i + WRITE_CHUNK)
              .map((symbol) => ({ date, indexCode: code, symbol })),
          )
          .onConflictDoNothing()
          .run();
      }
      result.indexMemberCounts[code] = symbolsInIndex.length;
    }

    onProgress(
      `  ${marketRows.length} symbols across ${byIndex.size} indices ` +
        `(${members.length} in ${TRACKED_INDEX})`,
    );

    if (bootstrapped.length > 0) {
      onProgress(
        `  note: first snapshot for ${bootstrapped.length} index/indices taken ` +
          `mid-session — run again after 15:30 PKT so they capture every member`,
      );
    }

    // --- 3. Fundamentals + announcements --------------------------------
    // Symbols in at least one index — the universe worth fetching pages for.
    const indexedSymbols = [...new Set([...byIndex.values()].flat())];
    const fundamentalSymbols =
      fundamentalScope === "all"
        ? indexedSymbols
        : [
            ...new Set(
              fundamentalIndices.flatMap((code) => byIndex.get(code) ?? []),
            ),
          ];
    if (includeFundamentals) {
      const dead = recheckCompanyPages ? new Set<string>() : await missingPageSymbols();
      const toFetch = fundamentalSymbols.filter((s) => !dead.has(s));
      result.pagesSkipped = fundamentalSymbols.length - toFetch.length;

      if (recheckCompanyPages) {
        await db.update(symbols).set({ noCompanyPage: false }).run();
      }

      onProgress(
        `Fetching fundamentals for ${toFetch.length} symbols` +
          ` (scope: ${fundamentalScope}` +
          (result.pagesSkipped
            ? `, ${result.pagesSkipped} known-missing skipped`
            : "") +
          ")…",
      );
      let done = 0;
      await mapLimit(toFetch, concurrency, async (symbol) => {
        try {
          // Extra retries: PSX rate-limits bursts of company pages (429).
          const companyHtml = await psxFetch(`/company/${symbol}`, {
            ttlMs: 0,
            retries: 4,
          });
          const page = parseCompanyPage(companyHtml);

          // Financials and ratios are server-rendered in the same document,
          // so this costs no extra request.
          const cells = parseFinancials(companyHtml);
          for (let i = 0; i < cells.length; i += WRITE_CHUNK) {
            await db
              .insert(financialsTable)
              .values(
                cells.slice(i, i + WRITE_CHUNK).map((cell) => ({
                  symbol,
                  fiscalYear: cell.fiscalYear,
                  section: cell.section,
                  lineItem: cell.lineItem,
                  value: cell.value,
                  unit: cell.unit,
                })),
              )
              .onConflictDoUpdate({
                target: [
                  financialsTable.symbol,
                  financialsTable.fiscalYear,
                  financialsTable.section,
                  financialsTable.lineItem,
                ],
                set: { value: sql`excluded.value`, unit: sql`excluded.unit` },
              })
              .run();
          }
          result.financialCellsWritten += cells.length;

          await db
            .insert(companyStats)
            .values({
              symbol,
              date,
              peTtm: page.peTtm,
              marketCap: page.marketCap,
              shares: page.shares,
              freeFloatShares: page.freeFloatShares,
              freeFloatPct: page.freeFloatPct,
              week52High: page.week52High,
              week52Low: page.week52Low,
              ytdChangePct: page.ytdChangePct,
              year1ChangePct: page.year1ChangePct,
            })
            .onConflictDoUpdate({
              target: [companyStats.symbol, companyStats.date],
              set: {
                peTtm: page.peTtm,
                marketCap: page.marketCap,
                shares: page.shares,
                freeFloatShares: page.freeFloatShares,
                freeFloatPct: page.freeFloatPct,
                week52High: page.week52High,
                week52Low: page.week52Low,
                ytdChangePct: page.ytdChangePct,
                year1ChangePct: page.year1ChangePct,
              },
            })
            .run();

          if (page.name) {
            await db
              .update(symbols)
              .set({ name: page.name, sectorName: page.sectorName })
              .where(eq(symbols.symbol, symbol))
              .run();
          }

          const announcementRows = page.announcements.map((a) => ({
            id: stableId(symbol, a.date, a.title),
            symbol,
            date: a.date,
            title: a.title,
            url: a.url,
            category: categorise(a.title),
          }));
          for (let i = 0; i < announcementRows.length; i += WRITE_CHUNK) {
            await db
              .insert(announcementsTable)
              .values(announcementRows.slice(i, i + WRITE_CHUNK))
              .onConflictDoUpdate({
                target: announcementsTable.id,
                set: { url: sql`excluded.url`, category: sql`excluded.category` },
              })
              .run();
          }
          result.announcementsWritten += announcementRows.length;

          result.fundamentalsFetched++;
        } catch (err) {
          // A 500 here means PSX has no company page for this counter at all.
          // Record that so we stop paying for it on every future run.
          if (err instanceof PsxError && err.status === 500) {
            await db
              .update(symbols)
              .set({ noCompanyPage: true })
              .where(eq(symbols.symbol, symbol))
              .run();
            result.pagesMarkedMissing++;
          } else {
            errors.push(`company ${symbol}: ${String(err)}`);
          }
        } finally {
          // Progress matters here: this loop can be ~380 requests.
          done++;
          if (done % 25 === 0 || done === toFetch.length) {
            onProgress(`  ${done}/${toFetch.length} companies`);
          }
        }
      });
    }

    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: errors.length ? "error" : "ok",
        detail: errors.length
          ? errors.slice(0, 6).join("; ")
          : `${result.constituentCount} constituents, ${result.quotesWritten} quotes`,
      })
      .where(eq(ingestRuns.id, runId))
      .run();

    return result;
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: "error",
        detail: String(err),
      })
      .where(eq(ingestRuns.id, runId))
      .run();
    throw err;
  }
}

/**
 * Rows per multi-row write. One round-trip per row is fine on a local file but
 * costs minutes against Turso, which would blow a serverless time limit.
 */
const WRITE_CHUNK = 100;

async function upsertSymbols(rows: MarketWatchRow[]) {
  const now = new Date();
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    await db
      .insert(symbols)
      .values(
        rows.slice(i, i + WRITE_CHUNK).map((row) => ({
          symbol: row.symbol,
          sectorCode: row.sectorCode,
          indexes: row.indexes.join(","),
          isKmi30: row.isKmi30,
          avgVolume30d: row.avgVolume30d,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: symbols.symbol,
        set: {
          sectorCode: sql`excluded.sector_code`,
          indexes: sql`excluded.indexes`,
          isKmi30: sql`excluded.is_kmi30`,
          avgVolume30d: sql`excluded.avg_volume_30d`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
      .run();
  }
}

/**
 * Live quotes always win for close/LDCP. /screener has no OHLC or daily
 * volume, so coalesce keeps whatever older EOD history already stored.
 */
async function writeMarketWatchQuotes(rows: MarketWatchRow[], date: string): Promise<number> {
  const values = rows.flatMap((row) => {
    const close = row.current ?? row.ldcp;
    if (close == null) return [];
    return [{
      symbol: row.symbol,
      date,
      open: row.open,
      high: row.high,
      low: row.low,
      close,
      ldcp: row.ldcp,
      volume: row.volume,
      source: "market-watch" as const,
    }];
  });

  for (let i = 0; i < values.length; i += WRITE_CHUNK) {
    await db
      .insert(quotesDaily)
      .values(values.slice(i, i + WRITE_CHUNK))
      .onConflictDoUpdate({
        target: [quotesDaily.symbol, quotesDaily.date],
        set: {
          open: sql`coalesce(excluded.open, ${quotesDaily.open})`,
          high: sql`coalesce(excluded.high, ${quotesDaily.high})`,
          low: sql`coalesce(excluded.low, ${quotesDaily.low})`,
          close: sql`excluded.close`,
          ldcp: sql`excluded.ldcp`,
          volume: sql`coalesce(excluded.volume, ${quotesDaily.volume})`,
          source: sql`excluded.source`,
        },
      })
      .run();
  }
  return values.length;
}

/**
 * Compare the two most recent membership snapshots.
 * `added`/`dropped` are empty when there is only one snapshot so far.
 */
export async function detectRecomposition(indexCode = TRACKED_INDEX): Promise<{
  previousDate: string | null;
  currentDate: string | null;
  added: string[];
  dropped: string[];
}> {
  const dates = await db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(2)
    .all();

  if (dates.length < 2) {
    return {
      previousDate: null,
      currentDate: dates[0]?.date ?? null,
      added: [],
      dropped: [],
    };
  }

  const [current, previous] = dates;
  const currentSet = new Set(await membersOn(indexCode, current.date));
  const previousSet = new Set(await membersOn(indexCode, previous.date));

  return {
    previousDate: previous.date,
    currentDate: current.date,
    added: [...currentSet].filter((s) => !previousSet.has(s)).sort(),
    dropped: [...previousSet].filter((s) => !currentSet.has(s)).sort(),
  };
}

export async function membersOn(indexCode: string, date: string): Promise<string[]> {
  const rows = await db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(eq(constituents.indexCode, indexCode), eq(constituents.date, date)),
    )
    .all();
  return rows.map((r) => r.symbol);
}

export async function snapshotDates(indexCode = TRACKED_INDEX, limit = 400): Promise<string[]> {
  const rows = await db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(limit)
    .all();
  return rows.map((r) => r.date);
}

export async function pruneOldQuotes(keepDays: number) {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await db.delete(quotesDaily).where(lt(quotesDaily.date, cutoff)).run();
}
