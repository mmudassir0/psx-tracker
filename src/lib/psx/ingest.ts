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
  payouts as payoutsTable,
  financials as financialsTable,
  ingestRuns,
} from "@/db/schema";
import { psxFetch, psxFetchJson, mapLimit, PsxError, PSX_BASE } from "./client";
import {
  parseMarketWatch,
  parseIndices,
  parseEodSeries,
  parseCompanyPage,
  categorise,
  parsePayouts,
  parseFinancials,
  type MarketWatchRow,
  type PayoutRow,
} from "./parse";
import { todayPkt, isMarketOpen } from "@/lib/dates";

export const TRACKED_INDEX = "KMI30";

/** Liquid names used only to discover the latest completed session date. */
const REFERENCE_SYMBOLS = ["OGDC", "MEBL", "LUCK"];

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
function missingPageSymbols(): Set<string> {
  return new Set(
    db
      .select({ symbol: symbols.symbol })
      .from(symbols)
      .where(eq(symbols.noCompanyPage, true))
      .all()
      .map((r) => r.symbol),
  );
}

/** Does a membership snapshot already exist for this index on this date? */
function hasSnapshot(indexCode: string, date: string): boolean {
  return Boolean(
    db
      .select({ symbol: constituents.symbol })
      .from(constituents)
      .where(
        and(
          eq(constituents.indexCode, indexCode),
          eq(constituents.date, date),
        ),
      )
      .limit(1)
      .get(),
  );
}

/** Members in the most recent snapshot before `date`, or null if none. */
function previousMemberCount(indexCode: string, date: string): number | null {
  const row = db
    .select({ date: constituents.date })
    .from(constituents)
    .where(
      and(eq(constituents.indexCode, indexCode), lt(constituents.date, date)),
    )
    .orderBy(desc(constituents.date))
    .limit(1)
    .get();

  if (!row) return null;

  return db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(
        eq(constituents.indexCode, indexCode),
        eq(constituents.date, row.date),
      ),
    )
    .all().length;
}

/**
 * Work out which trading session the live market-watch page is showing.
 *
 * When the market is closed, market-watch still displays the *previous*
 * session's numbers. Stamping those with today's date would invent a
 * duplicate flat day, so outside trading hours we trust the EOD timeseries,
 * which is stamped at the closing bell.
 */
export async function resolveSessionDate(): Promise<string> {
  if (isMarketOpen()) return todayPkt();

  for (const symbol of REFERENCE_SYMBOLS) {
    try {
      const bars = parseEodSeries(
        await psxFetchJson(`/timeseries/eod/${symbol}`, { ttlMs: 60_000 }),
      );
      const newest = bars[bars.length - 1];
      if (newest?.date) return newest.date;
    } catch {
      // Try the next reference symbol.
    }
  }

  // Every reference lookup failed; today is the least-wrong fallback.
  return todayPkt();
}

/** Stable id so re-ingesting the same announcement updates instead of duplicating. */
function stableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);
}

export interface IngestOptions {
  /** Also pull full EOD history (slow; run on first setup). */
  backfillHistory?: boolean;
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
  barsWritten: number;
  /** Historical index-level bars written during a backfill. */
  indexBarsWritten: number;
  announcementsWritten: number;
  /** Payout rows written from the PSX payouts fragment. */
  payoutsWritten: number;
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
    backfillHistory = false,
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

  db.insert(ingestRuns)
    .values({ id: runId, startedAt: new Date(), status: "running", trigger })
    .run();

  // Mirror every progress line into the run row. SQLite writes are cheap and
  // this is what lets the browser show real progress instead of a spinner.
  const onProgress = (message: string) => {
    onProgressOption(message);
    try {
      db.update(ingestRuns)
        .set({ progress: message.trim() })
        .where(eq(ingestRuns.id, runId))
        .run();
    } catch {
      // Progress reporting must never break the ingest itself.
    }
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
    barsWritten: 0,
    indexBarsWritten: 0,
    announcementsWritten: 0,
    payoutsWritten: 0,
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
      db.insert(indexLevels)
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
      await psxFetch("/market-watch", { ttlMs: 0 }),
    );
    result.symbolsSeen = marketRows.length;

    const members = marketRows.filter((r) => r.isKmi30);
    result.constituentCount = members.length;

    if (marketRows.length === 0) {
      throw new Error(
        "market-watch returned no rows — page layout may have changed",
      );
    }

    for (const row of marketRows) {
      upsertSymbol(row);
      if (writeMarketWatchQuote(row, date)) result.quotesWritten++;
    }

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
      const previous = previousMemberCount(code, date);

      if (marketOpen && previous == null && !hasSnapshot(code, date)) {
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

      for (const symbol of symbolsInIndex) {
        db.insert(constituents)
          .values({ date, indexCode: code, symbol })
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

    // --- 3. EOD history -------------------------------------------------
    // Symbols in at least one index — the universe worth keeping history for.
    const indexedSymbols = [...new Set([...byIndex.values()].flat())];
    const fundamentalSymbols =
      fundamentalScope === "all"
        ? indexedSymbols
        : [
            ...new Set(
              fundamentalIndices.flatMap((code) => byIndex.get(code) ?? []),
            ),
          ];
    const memberSymbols = indexedSymbols;
    if (backfillHistory) {
      // Index codes work on the same timeseries endpoint as equities, which is
      // what makes a benchmark comparison possible at all.
      const indexCodes = [...byIndex.keys()];
      onProgress(`Backfilling level history for ${indexCodes.length} indices…`);
      await mapLimit(indexCodes, concurrency, async (code) => {
        try {
          const bars = parseEodSeries(
            await psxFetchJson(`/timeseries/eod/${code}`, { ttlMs: 0 }),
          );
          for (const bar of bars) writeIndexLevelBar(code, bar);
          result.indexBarsWritten += bars.length;
        } catch (err) {
          errors.push(`index eod ${code}: ${String(err)}`);
        }
      });
      onProgress(`  ${result.indexBarsWritten} index bars`);

      onProgress(`Backfilling EOD history for ${memberSymbols.length} symbols…`);
      let backfilled = 0;
      await mapLimit(memberSymbols, concurrency, async (symbol) => {
        try {
          const bars = parseEodSeries(
            await psxFetchJson(`/timeseries/eod/${symbol}`, { ttlMs: 0 }),
          );
          for (const bar of bars) {
            writeEodBar(symbol, bar);
          }
          result.barsWritten += bars.length;
        } catch (err) {
          errors.push(`eod ${symbol}: ${String(err)}`);
        } finally {
          backfilled++;
          if (backfilled % 50 === 0 || backfilled === memberSymbols.length) {
            onProgress(`  ${backfilled}/${memberSymbols.length} symbols`);
          }
        }
      });
    }

    // --- 4. Fundamentals + announcements --------------------------------
    if (includeFundamentals) {
      const dead = recheckCompanyPages ? new Set<string>() : missingPageSymbols();
      const toFetch = fundamentalSymbols.filter((s) => !dead.has(s));
      result.pagesSkipped = fundamentalSymbols.length - toFetch.length;

      if (recheckCompanyPages) {
        db.update(symbols).set({ noCompanyPage: false }).run();
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
          const companyHtml = await psxFetch(`/company/${symbol}`, {
            ttlMs: 0,
          });
          const page = parseCompanyPage(companyHtml);

          // Financials and ratios are server-rendered in the same document,
          // so this costs no extra request.
          for (const cell of parseFinancials(companyHtml)) {
            db.insert(financialsTable)
              .values({
                symbol,
                fiscalYear: cell.fiscalYear,
                section: cell.section,
                lineItem: cell.lineItem,
                value: cell.value,
                unit: cell.unit,
              })
              .onConflictDoUpdate({
                target: [
                  financialsTable.symbol,
                  financialsTable.fiscalYear,
                  financialsTable.section,
                  financialsTable.lineItem,
                ],
                set: { value: cell.value, unit: cell.unit },
              })
              .run();
            result.financialCellsWritten++;
          }

          db.insert(companyStats)
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
            db.update(symbols)
              .set({ name: page.name, sectorName: page.sectorName })
              .where(eq(symbols.symbol, symbol))
              .run();
          }

          for (const a of page.announcements) {
            const category = categorise(a.title);
            const id = stableId(symbol, a.date, a.title);
            db.insert(announcementsTable)
              .values({
                id,
                symbol,
                date: a.date,
                title: a.title,
                url: a.url,
                category,
              })
              .onConflictDoUpdate({
                target: announcementsTable.id,
                set: { url: a.url, category },
              })
              .run();
            result.announcementsWritten++;
          }

          // Real payout rates come from a separate POST fragment. Announcement
          // titles normally omit the rate, so this is the only source for it.
          try {
            const payoutRows = parsePayouts(
              await psxFetch("/company/payouts", {
                form: { symbol },
                referer: `${PSX_BASE}/company/${symbol}`,
                ttlMs: 0,
              }),
            );
            for (const p of payoutRows) {
              writePayout(symbol, p);
            }
            result.payoutsWritten += payoutRows.length;
          } catch (err) {
            errors.push(`payouts ${symbol}: ${String(err)}`);
          }

          result.fundamentalsFetched++;
        } catch (err) {
          // A 500 here means PSX has no company page for this counter at all.
          // Record that so we stop paying for it on every future run.
          if (err instanceof PsxError && err.status === 500) {
            db.update(symbols)
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
          if (done % 50 === 0 || done === toFetch.length) {
            onProgress(`  ${done}/${toFetch.length} companies`);
          }
        }
      });
    }

    db.update(ingestRuns)
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
    db.update(ingestRuns)
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

function upsertSymbol(row: MarketWatchRow) {
  db.insert(symbols)
    .values({
      symbol: row.symbol,
      sectorCode: row.sectorCode,
      indexes: row.indexes.join(","),
      isKmi30: row.isKmi30,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: symbols.symbol,
      set: {
        sectorCode: row.sectorCode,
        indexes: row.indexes.join(","),
        isKmi30: row.isKmi30,
        updatedAt: new Date(),
      },
    })
    .run();
}

/** Live quote carries full OHLC, so it always wins over an EOD row. */
function writeMarketWatchQuote(row: MarketWatchRow, date: string): boolean {
  const close = row.current ?? row.ldcp;
  if (close == null) return false;

  db.insert(quotesDaily)
    .values({
      symbol: row.symbol,
      date,
      open: row.open,
      high: row.high,
      low: row.low,
      close,
      ldcp: row.ldcp,
      volume: row.volume,
      source: "market-watch",
    })
    .onConflictDoUpdate({
      target: [quotesDaily.symbol, quotesDaily.date],
      set: {
        open: row.open,
        high: row.high,
        low: row.low,
        close,
        ldcp: row.ldcp,
        volume: row.volume,
        source: "market-watch",
      },
    })
    .run();
  return true;
}

/**
 * Historical index levels. Same tuple shape as equities —
 * [timestamp, close, volume, open] — because it is the same endpoint; the
 * open position was verified against market-watch on the equity side.
 *
 * Never clobber high/low/change captured live from the /indices page, which
 * the timeseries does not carry.
 */
function writeIndexLevelBar(
  indexCode: string,
  bar: { date: string; close: number; open: number | null; volume: number | null },
) {
  db.insert(indexLevels)
    .values({
      indexCode,
      date: bar.date,
      current: bar.close,
      open: bar.open,
      volume: bar.volume,
    })
    .onConflictDoUpdate({
      target: [indexLevels.indexCode, indexLevels.date],
      set: {
        current: bar.close,
        open: sql`coalesce(excluded.open, ${indexLevels.open})`,
        volume: sql`coalesce(excluded.volume, ${indexLevels.volume})`,
      },
    })
    .run();
}

/**
 * EOD bars have no high/low. Never overwrite a richer market-watch row's
 * intraday range — coalesce keeps whatever was already captured.
 */
function writeEodBar(
  symbol: string,
  bar: { date: string; close: number; open: number | null; volume: number | null },
) {
  db.insert(quotesDaily)
    .values({
      symbol,
      date: bar.date,
      open: bar.open,
      high: null,
      low: null,
      close: bar.close,
      volume: bar.volume,
      source: "eod",
    })
    .onConflictDoUpdate({
      target: [quotesDaily.symbol, quotesDaily.date],
      set: {
        close: bar.close,
        volume: sql`coalesce(excluded.volume, ${quotesDaily.volume})`,
        open: sql`coalesce(excluded.open, ${quotesDaily.open})`,
      },
    })
    .run();
}

/** Store a payout row from the PSX payouts fragment. */
function writePayout(symbol: string, p: PayoutRow) {
  db.insert(payoutsTable)
    .values({
      // Keyed on symbol+date+raw so a corrected rate updates in place.
      id: stableId("payout", symbol, p.date, p.raw),
      symbol,
      date: p.date,
      type: p.kind,
      percent: p.percent,
      perShare: p.perShare,
      period: p.period,
      instalment: p.instalment,
      bookClosureFrom: p.bookClosureFrom,
      bookClosureTo: p.bookClosureTo,
      raw: p.raw,
    })
    .onConflictDoUpdate({
      target: payoutsTable.id,
      set: {
        type: p.kind,
        percent: p.percent,
        perShare: p.perShare,
        period: p.period,
        instalment: p.instalment,
        bookClosureFrom: p.bookClosureFrom,
        bookClosureTo: p.bookClosureTo,
      },
    })
    .run();
}

/**
 * Compare the two most recent membership snapshots.
 * `added`/`dropped` are empty when there is only one snapshot so far.
 */
export function detectRecomposition(indexCode = TRACKED_INDEX): {
  previousDate: string | null;
  currentDate: string | null;
  added: string[];
  dropped: string[];
} {
  const dates = db
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
  const currentSet = new Set(membersOn(indexCode, current.date));
  const previousSet = new Set(membersOn(indexCode, previous.date));

  return {
    previousDate: previous.date,
    currentDate: current.date,
    added: [...currentSet].filter((s) => !previousSet.has(s)).sort(),
    dropped: [...previousSet].filter((s) => !currentSet.has(s)).sort(),
  };
}

export function membersOn(indexCode: string, date: string): string[] {
  return db
    .select({ symbol: constituents.symbol })
    .from(constituents)
    .where(
      and(eq(constituents.indexCode, indexCode), eq(constituents.date, date)),
    )
    .all()
    .map((r) => r.symbol);
}

/** Every date on which we captured a membership snapshot, newest first. */
export function snapshotDates(indexCode = TRACKED_INDEX, limit = 400): string[] {
  return db
    .selectDistinct({ date: constituents.date })
    .from(constituents)
    .where(eq(constituents.indexCode, indexCode))
    .orderBy(desc(constituents.date))
    .limit(limit)
    .all()
    .map((r) => r.date);
}

/** Trim quote history older than `keepDays` to keep the local DB small. */
export function pruneOldQuotes(keepDays: number) {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  db.delete(quotesDaily).where(lt(quotesDaily.date, cutoff)).run();
}
