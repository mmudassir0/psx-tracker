/**
 * Backtest metrics and zakat arithmetic, against hand-computed expectations.
 *
 *   npm run test:strategy
 */
import { db } from "@/db";
import { transactions, quotesDaily, symbols, constituents, companyStats } from "@/db/schema";
import { computeMetrics } from "@/lib/backtest";
import { computeZakat, DEFAULT_ZAKAT_SETTINGS } from "@/lib/zakat";
import { addTransaction } from "@/lib/portfolio";
import { assertScratchDatabase } from "./test-guard";

console.log(`Using scratch database: ${assertScratchDatabase()}`);

let failures = 0;

function check(label: string, actual: number, expected: number, tol = 0.01) {
  const pass = Math.abs(actual - expected) <= tol;
  if (!pass) failures++;
  console.log(
    `${pass ? "  PASS" : "  FAIL"}  ${label}: got ${actual.toFixed(4)}, expected ${expected.toFixed(4)}`,
  );
}

// --- Backtest metrics (pure arithmetic, no database) ---------------------
console.log("\n[1] Metrics on a doubling series over exactly one year");
{
  const m = computeMetrics([100, 150, 200], 1);
  check("total return %", m.totalReturnPct, 100);
  check("CAGR %", m.cagrPct, 100);
  check("max drawdown %", m.maxDrawdownPct, 0);
  check("final value", m.finalValue, 200);
}

console.log("\n[2] Drawdown is measured peak-to-trough, not start-to-end");
{
  // Peak 200, trough 120 => (200-120)/200 = 40%
  const m = computeMetrics([100, 200, 120, 160], 1);
  check("max drawdown %", m.maxDrawdownPct, 40);
  check("total return %", m.totalReturnPct, 60);
}

console.log("\n[3] CAGR compounds over multiple years");
{
  // 4x over 2 years => sqrt(4) - 1 = 100% a year
  const m = computeMetrics([100, 200, 400], 2);
  check("CAGR %", m.cagrPct, 100);
  check("total return %", m.totalReturnPct, 300);
}

console.log("\n[4] A flat series has no return, drawdown or volatility");
{
  const m = computeMetrics([100, 100, 100, 100], 1);
  check("total return %", m.totalReturnPct, 0);
  check("max drawdown %", m.maxDrawdownPct, 0);
  check("volatility %", m.volatilityPct, 0);
}

// --- Zakat (needs a portfolio, so build a scratch one) -------------------
db.$client.exec(`
  DROP TABLE IF EXISTS transactions;
  CREATE TABLE transactions (
    id text PRIMARY KEY, symbol text NOT NULL, date text NOT NULL, type text NOT NULL,
    quantity real NOT NULL DEFAULT 0, price real NOT NULL DEFAULT 0,
    fees real NOT NULL DEFAULT 0, note text, created_at integer NOT NULL);
  DROP TABLE IF EXISTS quotes_daily;
  CREATE TABLE quotes_daily (
    symbol text NOT NULL, date text NOT NULL, open real, high real, low real,
    close real NOT NULL, ldcp real, volume integer, source text NOT NULL,
    PRIMARY KEY (symbol, date));
  DROP TABLE IF EXISTS symbols;
  CREATE TABLE symbols (
    symbol text PRIMARY KEY, name text, sector_code text, sector_name text,
    indexes text, is_kmi30 integer NOT NULL DEFAULT 0,
    no_company_page integer NOT NULL DEFAULT 0, updated_at integer);
  DROP TABLE IF EXISTS constituents;
  CREATE TABLE constituents (
    date text NOT NULL, index_code text NOT NULL, symbol text NOT NULL,
    PRIMARY KEY (date, index_code, symbol));
  DROP TABLE IF EXISTS company_stats;
  CREATE TABLE company_stats (
    symbol text NOT NULL, date text NOT NULL, pe_ttm real, market_cap real,
    shares integer, free_float_shares integer, free_float_pct real,
    week_52_high real, week_52_low real, ytd_change_pct real,
    year_1_change_pct real, PRIMARY KEY (symbol, date));
  -- getConstituents joins dividends and fundamentals, so both must exist
  -- even when a test does not exercise them.
  DROP TABLE IF EXISTS payouts;
  CREATE TABLE payouts (
    id text PRIMARY KEY, symbol text NOT NULL, date text NOT NULL,
    type text NOT NULL, percent real, per_share real, period text,
    instalment text, book_closure_from text, book_closure_to text,
    raw text, note text);
  DROP TABLE IF EXISTS financials;
  CREATE TABLE financials (
    symbol text NOT NULL, fiscal_year text NOT NULL, section text NOT NULL,
    line_item text NOT NULL, value real, unit text NOT NULL,
    PRIMARY KEY (symbol, fiscal_year, section, line_item));
`);

const DATE = "2026-08-04";
db.insert(symbols).values({ symbol: "AAA", name: "Alpha", isKmi30: true }).run();
db.insert(constituents).values({ date: DATE, indexCode: "KMI30", symbol: "AAA" }).run();
db.insert(quotesDaily)
  .values({ symbol: "AAA", date: DATE, close: 500, ldcp: 500, source: "market-watch" })
  .run();
db.insert(companyStats)
  .values({ symbol: "AAA", date: DATE, freeFloatShares: 1000 })
  .run();

addTransaction({ symbol: "AAA", date: "2026-01-01", type: "buy", quantity: 1000, price: 400 });

console.log("\n[5] Zakat at 100% zakatable, above nisab");
{
  // 1000 shares x 500 = 500,000 market value.
  // Silver nisab 612.36 g x 100 PKR/g = 61,236 -> above.
  const r = computeZakat({
    ...DEFAULT_ZAKAT_SETTINGS,
    metalPricePerGram: 100,
    nisabBasis: "silver",
  });
  check("portfolio value", r.portfolioValue, 500_000);
  check("zakatable from shares", r.zakatableFromShares, 500_000);
  check("nisab value", r.nisabValue, 61_236);
  check("zakat due (2.5%)", r.zakatDue, 12_500);
}

console.log("\n[6] Partial zakatable share and liabilities both apply");
{
  // 40% of 500,000 = 200,000; +50,000 other -20,000 debts = 230,000
  const r = computeZakat({
    ...DEFAULT_ZAKAT_SETTINGS,
    metalPricePerGram: 100,
    defaultZakatablePct: 40,
    otherAssets: 50_000,
    liabilities: 20_000,
  });
  check("zakatable from shares", r.zakatableFromShares, 200_000);
  check("net zakatable wealth", r.netZakatableWealth, 230_000);
  check("zakat due", r.zakatDue, 5_750);
}

console.log("\n[7] Below nisab means nothing is due");
{
  // Gold nisab 87.48 g x 10,000 = 874,800 > 500,000
  const r = computeZakat({
    ...DEFAULT_ZAKAT_SETTINGS,
    metalPricePerGram: 10_000,
    nisabBasis: "gold",
  });
  check("nisab value", r.nisabValue, 874_800);
  check("zakat due", r.zakatDue, 0);
  console.log(
    `${r.aboveNisab === false ? "  PASS" : "  FAIL"}  aboveNisab is false`,
  );
  if (r.aboveNisab !== false) failures++;
}

console.log("\n[8] No metal price means the nisab test is unknown, not 'no'");
{
  const r = computeZakat({ ...DEFAULT_ZAKAT_SETTINGS, metalPricePerGram: 0 });
  console.log(
    `${r.aboveNisab === null ? "  PASS" : "  FAIL"}  aboveNisab is null`,
  );
  if (r.aboveNisab !== null) failures++;
  check("zakat due stays zero", r.zakatDue, 0);
}

console.log("\n[9] Solar year uses the higher rate");
{
  const r = computeZakat({
    ...DEFAULT_ZAKAT_SETTINGS,
    metalPricePerGram: 100,
    year: "solar",
  });
  check("zakat due (2.577%)", r.zakatDue, 500_000 * 0.02577);
}

console.log(
  failures === 0
    ? "\nAll strategy and zakat checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
