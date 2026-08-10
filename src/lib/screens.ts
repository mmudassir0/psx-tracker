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
    name: "GARP (Growth at reasonable price)",
    description: "EPS growth > 15% alongside a P/E under 12",
    rules: [
      { metric: "epsGrowthPct", op: "gte", value: 15 },
      { metric: "peTtm", op: "lte", value: 12 },
      { metric: "peTtm", op: "gt", value: 0 },
    ],
    universe: "all",
    builtIn: true,
  },
  {
    id: "quality-margin",
    name: "High margin",
    description: "Net profit margin of 15% or more",
    rules: [{ metric: "netMarginPct", op: "gte", value: 15 }],
    universe: "all",
    builtIn: true,
  },
  {
    id: "near-52w-high",
    name: "Near 52-week high",
    description: "Within 5% of 52-week high price",
    rules: [{ metric: "drawdownFrom52wPct", op: "lte", value: 5 }],
    universe: "all",
    builtIn: true,
  },
  {
    id: "deep-value",
    name: "Deep 52-week drawdown",
    description: "Down 30% or more from 52-week high",
    rules: [{ metric: "drawdownFrom52wPct", op: "gte", value: 30 }],
    universe: "all",
    builtIn: true,
  },
  {
    id: "ytd-movers",
    name: "Strong YTD momentum",
    description: "Up 30% or more since the start of the year",
    rules: [{ metric: "ytdChangePct", op: "gte", value: 30 }],
    universe: "all",
    builtIn: true,
  },
];

export function metricValue(
  row: ConstituentView,
  metric: ScreenMetric,
): number | null {
  if (metric === "tradedValue") {
    return row.volume != null && row.close != null
      ? row.volume * row.close
      : null;
  }
  return (row[metric] as number | null) ?? null;
}

export function passesRule(row: ConstituentView, rule: ScreenRule): boolean {
  const actual = metricValue(row, rule.metric);
  return ruleHolds(actual, rule);
}

export function inUniverse(
  row: ConstituentView,
  universe: ScreenUniverse,
): boolean {
  if (universe === "shariah") return row.shariah;
  return true;
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

export async function listCustomScreens(): Promise<ScreenDefinition[]> {
  const rows = await db
    .select()
    .from(customScreens)
    .orderBy(desc(customScreens.createdAt))
    .all();

  return rows.map((row) => ({
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

export async function createCustomScreen(input: {
  name: string;
  description?: string;
  rules: ScreenRule[];
  universe: ScreenUniverse;
}): Promise<string> {
  const id = `custom-${randomUUID().slice(0, 8)}`;
  await db.insert(customScreens)
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

export async function deleteCustomScreen(id: string) {
  await db.delete(customScreens).where(eq(customScreens.id, id)).run();
  await db.delete(screenHits).where(eq(screenHits.screenId, id)).run();
}

export async function getAllScreens(): Promise<ScreenDefinition[]> {
  const custom = await listCustomScreens();
  return [...BUILT_IN_SCREENS, ...custom];
}

export async function getScreen(id: string): Promise<ScreenDefinition | null> {
  const all = await getAllScreens();
  return all.find((s) => s.id === id) ?? null;
}

export interface ScreenResult {
  screen: ScreenDefinition;
  matches: ConstituentView[];
  newSymbols: string[];
  droppedSymbols: string[];
  previousDate: string | null;
}

export async function recordScreenHits(date?: string): Promise<number> {
  const asOf = date ?? (await latestQuoteDate());
  if (!asOf) return 0;

  const rows = await getAllSymbolViews();
  let written = 0;
  const screens = await getAllScreens();

  for (const screen of screens) {
    const matches = evaluateScreen(screen, rows);
    for (const match of matches) {
      await db.insert(screenHits)
        .values({ screenId: screen.id, date: asOf, symbol: match.symbol })
        .onConflictDoNothing()
        .run();
      written++;
    }
  }

  return written;
}

async function previousHitDate(screenId: string, before: string): Promise<string | null> {
  const rows = await db
    .selectDistinct({ date: screenHits.date })
    .from(screenHits)
    .where(eq(screenHits.screenId, screenId))
    .orderBy(desc(screenHits.date))
    .all();

  const dates = rows
    .map((r) => r.date)
    .filter((d) => d < before);

  return dates[0] ?? null;
}

async function hitsOn(screenId: string, date: string): Promise<string[]> {
  const rows = await db
    .select({ symbol: screenHits.symbol })
    .from(screenHits)
    .where(and(eq(screenHits.screenId, screenId), eq(screenHits.date, date)))
    .all();
  return rows.map((r) => r.symbol);
}

export async function runAllScreens(): Promise<ScreenResult[]> {
  const asOf = await latestQuoteDate();
  const rows = await getAllSymbolViews();
  const screens = await getAllScreens();

  return Promise.all(
    screens.map(async (screen) => {
      const matches = evaluateScreen(screen, rows);
      const current = new Set(matches.map((m) => m.symbol));

      const previousDate = asOf ? await previousHitDate(screen.id, asOf) : null;
      const previous = previousDate
        ? new Set(await hitsOn(screen.id, previousDate))
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
    }),
  );
}

export async function runScreen(id: string): Promise<ScreenResult | null> {
  const screen = await getScreen(id);
  if (!screen) return null;

  const asOf = await latestQuoteDate();
  const rows = await getAllSymbolViews();
  const matches = evaluateScreen(screen, rows);
  const current = new Set(matches.map((m) => m.symbol));
  const previousDate = asOf ? await previousHitDate(screen.id, asOf) : null;
  const previous = previousDate
    ? new Set(await hitsOn(screen.id, previousDate))
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

export async function toPreviewRows(
  rowsInput?: ConstituentView[],
): Promise<PreviewRow[]> {
  const rows = rowsInput ?? (await getAllSymbolViews());
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

export async function updateCustomScreen(
  id: string,
  input: {
    name: string;
    description?: string;
    rules: ScreenRule[];
    universe: ScreenUniverse;
  },
) {
  await db.update(customScreens)
    .set({
      name: input.name,
      description: input.description ?? null,
      rules: JSON.stringify(input.rules),
      universe: input.universe,
    })
    .where(eq(customScreens.id, id))
    .run();

  await db.delete(screenHits).where(eq(screenHits.screenId, id)).run();
}
