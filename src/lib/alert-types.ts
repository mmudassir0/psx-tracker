/**
 * Client-safe alert vocabulary.
 *
 * Kept separate from `@/lib/alerts` because that module imports the SQLite
 * client, which cannot be bundled into a client component.
 */

export type AlertKind =
  | "price_above"
  | "price_below"
  | "pe_above"
  | "pe_below"
  | "near_52w_high"
  | "near_52w_low"
  | "dropped_from_kmi30"
  | "added_to_kmi30";

export const ALERT_LABELS: Record<AlertKind, string> = {
  price_above: "Price rises above",
  price_below: "Price falls below",
  pe_above: "P/E rises above",
  pe_below: "P/E falls below",
  near_52w_high: "Within % of 52-week high",
  near_52w_low: "Within % of 52-week low",
  dropped_from_kmi30: "Dropped from KMI30 (Shariah non-compliance)",
  added_to_kmi30: "Added to KMI30",
};

/** Membership alerts have no numeric threshold. */
export function needsThreshold(kind: AlertKind): boolean {
  return kind !== "dropped_from_kmi30" && kind !== "added_to_kmi30";
}
