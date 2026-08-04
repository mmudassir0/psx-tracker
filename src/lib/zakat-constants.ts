/**
 * Pure zakat constants, safe to import from client components.
 *
 * Kept separate from `@/lib/zakat`, which pulls in the portfolio engine and
 * therefore the SQLite client — that cannot be bundled for the browser.
 */

/** Nisab thresholds in grams — 20 mithqal of gold, 200 dirhams of silver. */
export const NISAB_GOLD_GRAMS = 87.48;
export const NISAB_SILVER_GRAMS = 612.36;

/** 1 tola = 11.6638 g, the unit Pakistani bullion is usually quoted in. */
export const GRAMS_PER_TOLA = 11.6638;

/** 2.5% over a lunar year; the solar-year equivalent is slightly higher. */
export const RATE_LUNAR = 0.025;
export const RATE_SOLAR = 0.02577;

export type NisabBasis = "gold" | "silver";
export type ZakatYear = "lunar" | "solar";

export function nisabGramsFor(basis: NisabBasis): number {
  return basis === "gold" ? NISAB_GOLD_GRAMS : NISAB_SILVER_GRAMS;
}
