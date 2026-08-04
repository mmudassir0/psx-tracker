/**
 * Catalogue of PSX indices.
 *
 * PSX publishes only the index CODE on both /indices and the market-watch
 * membership column — no display names, no descriptions. The names below are
 * therefore a curated map covering the indices whose naming is unambiguous.
 * Sponsor-branded indices (NIT, NBP, JS, Meezan co-branded products) are
 * deliberately left out rather than guessed; they fall back to their code.
 *
 * The same restraint applies to `shariah`: it is set only for the two indices
 * that are definitively Shariah-screened by construction. Absence of the flag
 * means "not asserted", not "not compliant".
 */

export interface IndexMeta {
  code: string;
  /** Display name, or null when PSX's code is all we can state. */
  name: string | null;
  /** True only where Shariah screening is part of the index definition. */
  shariah: boolean;
  /** Short note shown under the name. */
  note?: string;
}

const CATALOGUE: Record<string, Omit<IndexMeta, "code">> = {
  KSE100: {
    name: "KSE 100",
    shariah: false,
    note: "The benchmark: top companies by free-float market cap",
  },
  KSE100PR: {
    name: "KSE 100 (Price Return)",
    shariah: false,
    note: "KSE 100 excluding dividend reinvestment",
  },
  KSE30: {
    name: "KSE 30",
    shariah: false,
    note: "Free-float weighted, 30 largest",
  },
  ALLSHR: {
    name: "PSX All Shares",
    shariah: false,
    note: "Every eligible listed company",
  },
  KMI30: {
    name: "KMI 30",
    shariah: true,
    note: "Shariah-screened, 30 constituents",
  },
  KMIALLSHR: {
    name: "KMI All Shares",
    shariah: true,
    note: "Every Shariah-compliant listed company",
  },
  BKTI: { name: "Banking Tradable", shariah: false, note: "Banking sector" },
  OGTI: {
    name: "Oil & Gas Tradable",
    shariah: false,
    note: "Oil and gas sector",
  },
  PSXDIV20: {
    name: "PSX Dividend 20",
    shariah: false,
    note: "Selected on dividend yield",
  },
};

/** Indices whose level PSX quotes, in a sensible reading order. */
export const PREFERRED_ORDER = [
  "KMI30",
  "KMIALLSHR",
  "KSE100",
  "KSE30",
  "ALLSHR",
  "PSXDIV20",
  "BKTI",
  "OGTI",
  "KSE100PR",
];

export const DEFAULT_INDEX = "KMI30";

export function getIndexMeta(code: string): IndexMeta {
  const entry = CATALOGUE[code];
  return {
    code,
    name: entry?.name ?? null,
    shariah: entry?.shariah ?? false,
    note: entry?.note,
  };
}

/** Name for display, falling back to the raw PSX code. */
export function indexLabel(code: string): string {
  return CATALOGUE[code]?.name ?? code;
}

/** Sort indices by the curated order, then alphabetically for the rest. */
export function sortIndexCodes(codes: string[]): string[] {
  return [...codes].sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a);
    const ib = PREFERRED_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}
