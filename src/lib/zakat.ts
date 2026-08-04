import { getPortfolio, type HoldingView } from "@/lib/portfolio";
import { getSetting } from "@/lib/settings";

/**
 * Zakat calculator for a shareholding portfolio.
 *
 * This is a CALCULATOR, not a religious ruling. Scholars differ on how zakat
 * applies to shares, so every judgement call is a user-supplied parameter
 * rather than something assumed here:
 *
 *  - which nisab standard applies (gold or silver)
 *  - the current metal price used to value that nisab
 *  - whether the whole market value is zakatable (shares held for resale) or
 *    only a portion of it (shares held long-term for income, where several
 *    methods assess only the company's own zakatable assets)
 *  - the lunar vs solar rate
 *
 * Nothing here is defaulted to a figure that expresses a scholarly opinion —
 * the per-holding zakatable share defaults to 100%, which is simply "no
 * adjustment applied", and the user lowers it if their own method says so.
 */

import {
  RATE_LUNAR,
  RATE_SOLAR,
  nisabGramsFor,
  type NisabBasis,
  type ZakatYear,
} from "@/lib/zakat-constants";

export * from "@/lib/zakat-constants";

export interface ZakatSettings {
  nisabBasis: NisabBasis;
  /** PKR per gram of the chosen metal, entered by the user. */
  metalPricePerGram: number;
  year: ZakatYear;
  /** Cash, bank balances and other zakatable assets outside this portfolio. */
  otherAssets: number;
  /** Debts deductible under the user's chosen method. */
  liabilities: number;
  /** Per-symbol zakatable share of market value, 0-100. Absent means 100. */
  zakatablePct: Record<string, number>;
  /** Applied to holdings without a per-symbol entry. */
  defaultZakatablePct: number;
}

export const ZAKAT_SETTINGS_KEY = "zakat";

export const DEFAULT_ZAKAT_SETTINGS: ZakatSettings = {
  nisabBasis: "silver",
  metalPricePerGram: 0,
  year: "lunar",
  otherAssets: 0,
  liabilities: 0,
  zakatablePct: {},
  defaultZakatablePct: 100,
};

export function getZakatSettings(): ZakatSettings {
  return getSetting<ZakatSettings>(ZAKAT_SETTINGS_KEY, DEFAULT_ZAKAT_SETTINGS);
}

export interface ZakatLine {
  symbol: string;
  name: string | null;
  quantity: number;
  price: number | null;
  marketValue: number;
  zakatablePct: number;
  zakatableValue: number;
}

export interface ZakatResult {
  lines: ZakatLine[];
  /** Full market value of open positions. */
  portfolioValue: number;
  /** Portfolio value after each holding's zakatable share is applied. */
  zakatableFromShares: number;
  otherAssets: number;
  liabilities: number;
  /** zakatableFromShares + otherAssets - liabilities, floored at zero. */
  netZakatableWealth: number;
  nisabGrams: number;
  nisabValue: number;
  /** Null when no metal price has been entered yet. */
  aboveNisab: boolean | null;
  rate: number;
  zakatDue: number;
  /** Dividends booked in the ledger, shown for context only. */
  dividendIncome: number;
}

export function computeZakat(settings: ZakatSettings): ZakatResult {
  const portfolio = getPortfolio();
  const open = portfolio.holdings.filter((h) => h.quantity > 0);

  const lines: ZakatLine[] = open.map((h: HoldingView) => {
    const marketValue = h.marketValue ?? 0;
    const pct = clampPct(
      settings.zakatablePct[h.symbol] ?? settings.defaultZakatablePct,
    );
    return {
      symbol: h.symbol,
      name: h.name,
      quantity: h.quantity,
      price: h.close,
      marketValue,
      zakatablePct: pct,
      zakatableValue: marketValue * (pct / 100),
    };
  });

  const portfolioValue = lines.reduce((sum, l) => sum + l.marketValue, 0);
  const zakatableFromShares = lines.reduce(
    (sum, l) => sum + l.zakatableValue,
    0,
  );

  const otherAssets = Math.max(0, settings.otherAssets || 0);
  const liabilities = Math.max(0, settings.liabilities || 0);
  const netZakatableWealth = Math.max(
    0,
    zakatableFromShares + otherAssets - liabilities,
  );

  const nisabGrams = nisabGramsFor(settings.nisabBasis);
  const metalPrice = settings.metalPricePerGram || 0;
  const nisabValue = nisabGrams * metalPrice;

  // Without a metal price there is no threshold to test against, so the
  // answer is "unknown" rather than a misleading yes or no.
  const aboveNisab = metalPrice > 0 ? netZakatableWealth >= nisabValue : null;

  const rate = settings.year === "solar" ? RATE_SOLAR : RATE_LUNAR;
  const zakatDue = aboveNisab ? netZakatableWealth * rate : 0;

  return {
    lines: lines.sort((a, b) => b.marketValue - a.marketValue),
    portfolioValue,
    zakatableFromShares,
    otherAssets,
    liabilities,
    netZakatableWealth,
    nisabGrams,
    nisabValue,
    aboveNisab,
    rate,
    zakatDue,
    dividendIncome: portfolio.dividendIncome,
  };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(0, value));
}

