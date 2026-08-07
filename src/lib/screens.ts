import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { screenHits, customScreens } from "@/db/schema";
import {
  getAllSymbolViews,
  latestQuoteDate,
  type ConstituentView,
} from "@/lib/market";
import { SHARIAH_INDEX_CODES } from "@/lib/psx/indices";

/**
 * Rule-based stock screens, evaluated after every ingest.
 *
 * The matches for each day are stored, so "what newly triggered today" is a
 * diff between consecutive dates rather than a guess — the same approach the
 * recomposition tracker uses, for the same reason: a snapshot you can diff
 * beats a number you have to trust.
 *
 * These describe what the numbers say. Nothing here ranks, recommends or
 * scores a company as worth buying.
 */

// Vocabulary and pure rule logic live in a client-safe module.
export * from "@/lib/screen-types";

import {
  type ScreenDefinition,
  type ScreenMetric,
  type ScreenRule,
  type ScreenUniverse,
  type PreviewRow,
  ruleHolds,
} from "@/lib/screen-types";

const MIN_MARKET_CAP = 1_000_000_000; // PKR 1bn

export const BUILT_IN_SCREENS: ScreenDefinition[] = [
  {
    id: "high-yield",
    name: "High dividend yield",
    description: "Trailing 12-month yield of 8% or more",
    rules: [{ metric: "dividendYieldPct", op: "gte", value: 8 }],
    universe: "all",
    builtIn: true,
  },
  {
    id: "shariah-income",
    name: "Shariah income",
    description: "Shariah-screened names yielding 6% or more",
    rules: [{ metric: "dividendYieldPct", op: "gte", value: 6 }],
    universe: "shariah",
    builtIn: true,
  },
  {
    id: "dividend-growth",
    name: "Dividend with growth",
    description: "Yield of 5%+ alongside positive earnings growth",
    rules: [
      { metric: "dividendYieldPct", op: "gte", value: 5 },
      { metric: "epsGrowthPct", op: "gt", value: 0 },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "eps-growth",
    name: "High EPS growth",
    description: "Earnings per share up 25%+ in the latest year",
    rules: [
      { metric: "epsGrowthPct", op: "gte", value: 25 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "revenue-growth",
    name: "Highest revenue growth",
    description: "Revenue up 20%+ year on year",
    rules: [
      { metric: "revenueGrowthPct", op: "gte", value: 20 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "low-pe",
    name: "Low P/E",
    description: "Trading under 8x trailing earnings",
    rules: [
      { metric: "peTtm", op: "lte", value: 8 },
      { metric: "peTtm", op: "gt", value: 0 },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "garp",
    name: "Growth at a reasonable price",
    description: "Under 12x earnings with 15%+ EPS growth",
    rules: [
      { metric: "peTtm", op: "lte", value: 12 },
      { metric: "peTtm", op: "gt", value: 0 },
      { metric: "epsGrowthPct", op: "gte", value: 15 },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "quality",
    name: "Quality compounders",
    description: "15%+ net margin with both earnings and revenue growing",
    rules: [
      { metric: "netMarginPct", op: "gte", value: 15 },
      { metric: "epsGrowthPct", op: "gte", value: 10 },
      { metric: "revenueGrowthPct", op: "gte", value: 10 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "near-high",
    name: "Near 52-week high",
    description: "Within 2% of the 12-month high",
    rules: [{ metric: "drawdownFrom52wPct", op: "lte", value: 2 }],
    universe: "all",
    builtIn: true,
  },
  {
    id: "deep-drawdown",
    name: "Well off the high",
    description: "25% or more below the 52-week high",
    rules: [
      { metric: "drawdownFrom52wPct", op: "gte", value: 25 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "momentum",
    name: "Twelve-month momentum",
    description: "Up 40%+ over one year",
    rules: [
      { metric: "year1ChangePct", op: "gte", value: 40 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "laggards",
    name: "Year-to-date laggards",
    description: "Down 10%+ so far this year",
    rules: [
      { metric: "ytdChangePct", op: "lte", value: -10 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "high-margin",
    name: "High net margin",
    description: "Net profit margin of 20% or more",
    rules: [
      { metric: "netMarginPct", op: "gte", value: 20 },
      { metric: "marketCap", op: "gte", value: MIN_MARKET_CAP },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "liquid-movers",
    name: "Liquid movers",
    description: "Up 3%+ today on PKR 50mn or more of turnover",
    rules: [
      { metric: "changePct", op: "gte", value: 3 },
      { metric: "tradedValue", op: "gte", value: 50_000_000 },
    ],
    universe: "all",
    builtIn: true,
  },
];

function metricValue(
  row: ConstituentView,
  metric: ScreenMetric,
): number | null {
  if (metric === "tradedValue") {
    if (row.volume == null || row.close == null) return null;
    return row.volume * row.close;
  }
  return row[metric] ?? null;
}

function passesRule(row: ConstituentView, rule: ScreenRule): boolean {
  // Same implementation the browser preview uses, so the two cannot drift.
  return ruleHolds(metricValue(row, rule.metric), rule);
}

function inUniverse(row: ConstituentView, universe: ScreenUniverse): boolean {
  if (universe === "all") return true;
  if (universe === "shariah") return row.shariah;
  // Otherwise treat it as an index code.
  return SHARIAH_INDEX_CODES.includes(universe)
    ? row.shariah
    : true;
}

export function evaluateScreen(
  screen: ScreenDefinition,
  rows: ConstituentView[],
): ConstituentView[] {
  return rows.filter(
    (row) =>
      inUniverse(row, screen.universe) &&
      screen.rules.every((rule) => passesRule(row, rule)),
  );
}

// ---------------------------------------------------------------------------
// Custom screens
// ---------------------------------------------------------------------------

export function listCustomScreens(): ScreenDefinition[] {
  return db
    .select()
    .from(customScreens)
    .orderBy(desc(customScreens.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      rules: safeParseRules(row.rules),
      universe: row.universe,
      builtIn: false,
    }));
}

function safeParseRules(raw: string): ScreenRule[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScreenRule[]) : [];
  } catch {
    return [];
  }
}

export function createCustomScreen(input: {
  name: string;
  description?: string;
  rules: ScreenRule[];
  universe: ScreenUniverse;
}): string {
  const id = `custom-${randomUUID().slice(0, 8)}`;
  db.insert(customScreens)
    .values({
      id,
      name: input.name,
      description: input.description ?? null,
      rules: JSON.stringify(input.rules),
      universe: input.universe,
      createdAt: new Date(),
    })
    .run();
  return id;
}

export function deleteCustomScreen(id: string) {
  db.delete(customScreens).where(eq(customScreens.id, id)).run();
  db.delete(screenHits).where(eq(screenHits.screenId, id)).run();
}

export function getAllScreens(): ScreenDefinition[] {
  return [...BUILT_IN_SCREENS, ...listCustomScreens()];
}

export function getScreen(id: string): ScreenDefinition | null {
  return getAllScreens().find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Daily evaluation and the "new today" diff
// ---------------------------------------------------------------------------

export interface ScreenResult {
  screen: ScreenDefinition;
  matches: ConstituentView[];
  /** Symbols matching today that did not match on the previous stored date. */
  newSymbols: string[];
  /** Symbols that matched previously and no longer do. */
  droppedSymbols: string[];
  previousDate: string | null;
}

/** Record today's matches for every screen. Safe to re-run. */
export function recordScreenHits(date?: string): number {
  const asOf = date ?? latestQuoteDate();
  if (!asOf) return 0;

  const rows = getAllSymbolViews();
  let written = 0;

  for (const screen of getAllScreens()) {
    const matches = evaluateScreen(screen, rows);
    for (const match of matches) {
      db.insert(screenHits)
        .values({ screenId: screen.id, date: asOf, symbol: match.symbol })
        .onConflictDoNothing()
        .run();
      written++;
    }
  }

  return written;
}

/** Most recent stored hit date strictly before `before`, if any. */
function previousHitDate(screenId: string, before: string): string | null {
  const dates = db
    .selectDistinct({ date: screenHits.date })
    .from(screenHits)
    .where(eq(screenHits.screenId, screenId))
    .orderBy(desc(screenHits.date))
    .all()
    .map((r) => r.date)
    .filter((d) => d < before);

  return dates[0] ?? null;
}

function hitsOn(screenId: string, date: string): string[] {
  return db
    .select({ symbol: screenHits.symbol })
    .from(screenHits)
    .where(and(eq(screenHits.screenId, screenId), eq(screenHits.date, date)))
    .all()
    .map((r) => r.symbol);
}

/** Evaluate every screen against today, with the diff versus last time. */
export function runAllScreens(): ScreenResult[] {
  const asOf = latestQuoteDate();
  const rows = getAllSymbolViews();

  return getAllScreens().map((screen) => {
    const matches = evaluateScreen(screen, rows);
    const current = new Set(matches.map((m) => m.symbol));

    const previousDate = asOf ? previousHitDate(screen.id, asOf) : null;
    const previous = previousDate
      ? new Set(hitsOn(screen.id, previousDate))
      : null;

    return {
      screen,
      matches,
      // Without a prior snapshot everything would look "new", which is noise.
      newSymbols: previous
        ? [...current].filter((s) => !previous.has(s)).sort()
        : [],
      droppedSymbols: previous
        ? [...previous].filter((s) => !current.has(s)).sort()
        : [],
      previousDate,
    };
  });
}

export function runScreen(id: string): ScreenResult | null {
  const screen = getScreen(id);
  if (!screen) return null;

  const asOf = latestQuoteDate();
  const matches = evaluateScreen(screen, getAllSymbolViews());
  const current = new Set(matches.map((m) => m.symbol));
  const previousDate = asOf ? previousHitDate(screen.id, asOf) : null;
  const previous = previousDate
    ? new Set(hitsOn(screen.id, previousDate))
    : null;

  return {
    screen,
    matches,
    newSymbols: previous
      ? [...current].filter((s) => !previous.has(s)).sort()
      : [],
    droppedSymbols: previous
      ? [...previous].filter((s) => !current.has(s)).sort()
      : [],
    previousDate,
  };
}

// ---------------------------------------------------------------------------
// Rule builder support
// ---------------------------------------------------------------------------

/**
 * A slim projection of the whole market, for the rule builder.
 *
 * The builder filters live in the browser so the match count updates as you
 * type. Shipping full ConstituentView rows would be a few hundred KB of mostly
 * unused fields; this carries only what a rule can actually test.
 */

export function toPreviewRows(
  rows: ConstituentView[] = getAllSymbolViews(),
): PreviewRow[] {
  const metrics: ScreenMetric[] = [
    "dividendYieldPct",
    "peTtm",
    "epsGrowthPct",
    "revenueGrowthPct",
    "netMarginPct",
    "ytdChangePct",
    "year1ChangePct",
    "drawdownFrom52wPct",
    "changePct",
    "marketCap",
    "tradedValue",
  ];

  return rows.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    shariah: row.shariah,
    metrics: Object.fromEntries(
      metrics.map((m) => [m, metricValue(row, m)]),
    ) as Partial<Record<ScreenMetric, number | null>>,
  }));
}

export function updateCustomScreen(
  id: string,
  input: {
    name: string;
    description?: string;
    rules: ScreenRule[];
    universe: ScreenUniverse;
  },
) {
  db.update(customScreens)
    .set({
      name: input.name,
      description: input.description ?? null,
      rules: JSON.stringify(input.rules),
      universe: input.universe,
    })
    .where(eq(customScreens.id, id))
    .run();

  // Stored hits were produced by the old criteria, so they would make the
  // next "new today" diff meaningless.
  db.delete(screenHits).where(eq(screenHits.screenId, id)).run();
}
