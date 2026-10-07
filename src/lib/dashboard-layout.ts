/**
 * The dashboard's cards, in their default order. Pure data, shared by the
 * page and the "Choose cards" panel. Users can hide cards and reorder them;
 * the choice is stored in the "dashboard" user setting.
 */
export const DASHBOARD_CARDS = [
  { id: "trend", label: "Index over time and Your day" },
  { id: "heatmap", label: "Market heatmap" },
  { id: "movers", label: "What moved the index and sectors" },
  { id: "market-movers", label: "Top gainers and losers (whole market)" },
  { id: "watchlist", label: "Your watchlist", personal: true },
  { id: "vs-index", label: "Your portfolio against the index", personal: true },
  { id: "extremes", label: "52-week extremes and streaks" },
  { id: "breadth", label: "Rising and falling stocks over time" },
  { id: "constituents", label: "Companies table" },
] as const;

export type DashboardCardId = (typeof DASHBOARD_CARDS)[number]["id"];

export interface DashboardPrefs {
  index: string;
  order?: string[];
  hidden?: string[];
  /** How the dashboard heatmap is drawn. */
  heatmapView?: "boxes" | "rings";
}

const KNOWN = new Set<string>(DASHBOARD_CARDS.map((c) => c.id));

/** Saved order with unknown ids dropped and new cards appended in default place. */
export function cardOrder(prefs: Pick<DashboardPrefs, "order">): DashboardCardId[] {
  const saved = (prefs.order ?? []).filter((id) => KNOWN.has(id)) as DashboardCardId[];
  const out = [...new Set(saved)];
  for (const c of DASHBOARD_CARDS) if (!out.includes(c.id)) out.push(c.id);
  return out;
}

export function hiddenCards(prefs: Pick<DashboardPrefs, "hidden">): Set<DashboardCardId> {
  return new Set((prefs.hidden ?? []).filter((id) => KNOWN.has(id)) as DashboardCardId[]);
}

export function isCardId(id: string): id is DashboardCardId {
  return KNOWN.has(id);
}
