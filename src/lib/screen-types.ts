/**
 * Client-safe screen vocabulary and the pure rule logic.
 *
 * Kept separate from `@/lib/screens`, which imports the SQLite client and so
 * cannot be bundled into a client component. The rule evaluation lives here
 * because the builder runs it in the browser for its live preview — the server
 * re-evaluates on save, so this is a convenience, never the source of truth.
 */

export type ScreenMetric =
  | "dividendYieldPct"
  | "peTtm"
  | "epsGrowthPct"
  | "revenueGrowthPct"
  | "netMarginPct"
  | "ytdChangePct"
  | "year1ChangePct"
  | "drawdownFrom52wPct"
  | "changePct"
  | "marketCap"
  | "tradedValue";

export type ScreenOp = "gte" | "lte" | "gt" | "lt";

export interface ScreenRule {
  metric: ScreenMetric;
  op: ScreenOp;
  value: number;
}

export type ScreenUniverse = "all" | "shariah" | string;

export interface ScreenDefinition {
  id: string;
  name: string;
  description: string;
  rules: ScreenRule[];
  universe: ScreenUniverse;
  builtIn: boolean;
}

export const METRIC_LABELS: Record<ScreenMetric, string> = {
  dividendYieldPct: "Dividend yield %",
  peTtm: "P/E (TTM)",
  epsGrowthPct: "EPS growth %",
  revenueGrowthPct: "Revenue growth %",
  netMarginPct: "Net margin %",
  ytdChangePct: "YTD change %",
  year1ChangePct: "1-year change %",
  drawdownFrom52wPct: "% below 52-week high",
  changePct: "Day change %",
  marketCap: "Market cap (PKR)",
  tradedValue: "Traded value today (PKR)",
};

export const OP_LABELS: Record<ScreenOp, string> = {
  gte: "at least",
  lte: "at most",
  gt: "above",
  lt: "below",
};

/** Metrics offered in the builder, with sensible input steps. */
export const BUILDER_METRICS: {
  metric: ScreenMetric;
  label: string;
  unit: string;
  step: number;
}[] = [
  { metric: "dividendYieldPct", label: "Dividend yield", unit: "%", step: 0.5 },
  { metric: "peTtm", label: "P/E (TTM)", unit: "x", step: 0.5 },
  { metric: "epsGrowthPct", label: "EPS growth", unit: "%", step: 5 },
  { metric: "revenueGrowthPct", label: "Revenue growth", unit: "%", step: 5 },
  { metric: "netMarginPct", label: "Net margin", unit: "%", step: 1 },
  { metric: "ytdChangePct", label: "YTD change", unit: "%", step: 5 },
  { metric: "year1ChangePct", label: "1-year change", unit: "%", step: 5 },
  {
    metric: "drawdownFrom52wPct",
    label: "% below 52-week high",
    unit: "%",
    step: 1,
  },
  { metric: "changePct", label: "Day change", unit: "%", step: 0.5 },
  { metric: "marketCap", label: "Market cap", unit: "PKR", step: 1_000_000_000 },
  {
    metric: "tradedValue",
    label: "Traded value today",
    unit: "PKR",
    step: 10_000_000,
  },
];

/** Slim market projection carrying only what a rule can test. */
export interface PreviewRow {
  symbol: string;
  name: string | null;
  shariah: boolean;
  metrics: Partial<Record<ScreenMetric, number | null>>;
}

/** A missing metric never satisfies a rule — absence is not a match. */
export function ruleHolds(
  value: number | null | undefined,
  rule: ScreenRule,
): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  switch (rule.op) {
    case "gte":
      return value >= rule.value;
    case "lte":
      return value <= rule.value;
    case "gt":
      return value > rule.value;
    case "lt":
      return value < rule.value;
  }
}

export function previewMatches(
  rows: PreviewRow[],
  rules: ScreenRule[],
  universe: ScreenUniverse,
): PreviewRow[] {
  return rows.filter((row) => {
    if (universe === "shariah" && !row.shariah) return false;
    return rules.every((rule) => ruleHolds(row.metrics[rule.metric], rule));
  });
}

export function describeRule(rule: ScreenRule): string {
  const label = METRIC_LABELS[rule.metric];
  const op = OP_LABELS[rule.op];
  const value =
    rule.metric === "marketCap" || rule.metric === "tradedValue"
      ? formatBigNumber(rule.value)
      : String(rule.value);
  return `${label} ${op} ${value}`;
}

function formatBigNumber(value: number): string {
  if (Math.abs(value) >= 1e9) return `${value / 1e9}bn`;
  if (Math.abs(value) >= 1e6) return `${value / 1e6}mn`;
  return String(value);
}
