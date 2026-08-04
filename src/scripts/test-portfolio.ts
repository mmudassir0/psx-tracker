/**
 * Exercises the weighted-average cost engine against hand-computed expectations.
 * Runs against a scratch database so it never touches real holdings.
 *
 *   npx tsx src/scripts/test-portfolio.ts
 */
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { getHoldings, addTransaction } from "@/lib/portfolio";
import { assertScratchDatabase } from "./test-guard";

// DB_PATH is set by the npm script; this throws if it points at real data.
console.log(`Using scratch database: ${assertScratchDatabase()}`);

// Minimal schema — this test only needs the ledger table.
db.$client.exec(`
  DROP TABLE IF EXISTS transactions;
  CREATE TABLE transactions (
    id text PRIMARY KEY,
    symbol text NOT NULL,
    date text NOT NULL,
    type text NOT NULL,
    quantity real NOT NULL DEFAULT 0,
    price real NOT NULL DEFAULT 0,
    fees real NOT NULL DEFAULT 0,
    note text,
    created_at integer NOT NULL
  );
`);

let failures = 0;

function check(label: string, actual: number, expected: number, tol = 0.01) {
  const pass = Math.abs(actual - expected) <= tol;
  if (!pass) failures++;
  console.log(
    `${pass ? "  PASS" : "  FAIL"}  ${label}: got ${actual.toFixed(4)}, expected ${expected.toFixed(4)}`,
  );
}

function reset() {
  db.delete(transactions).run();
}

// --- 1. Weighted average across two buys, fees included in basis ---------
console.log("\n[1] Two buys with fees -> weighted average cost");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 100, price: 100, fees: 50 });
addTransaction({ symbol: "T", date: "2026-02-01", type: "buy", quantity: 100, price: 200, fees: 50 });
{
  // (100*100 + 50 + 100*200 + 50) / 200 = 30100/200 = 150.5
  const h = getHoldings()[0];
  check("quantity", h.quantity, 200);
  check("avgCost", h.avgCost, 150.5);
  check("investedValue", h.investedValue, 30100);
}

// --- 2. Sell realises P&L against the average, basis unchanged ----------
console.log("\n[2] Partial sell -> realised P&L, avg cost unchanged");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 100, price: 100, fees: 0 });
addTransaction({ symbol: "T", date: "2026-03-01", type: "sell", quantity: 40, price: 150, fees: 100 });
{
  // proceeds 40*150 - 100 = 5900; cost 40*100 = 4000; realised = 1900
  const h = getHoldings()[0];
  check("remaining quantity", h.quantity, 60);
  check("avgCost unchanged", h.avgCost, 100);
  check("realisedPnl", h.realizedPnl, 1900);
}

// --- 3. Bonus shares dilute the average, total cost constant -------------
console.log("\n[3] Bonus issue -> average diluted, total cost constant");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 100, price: 300, fees: 0 });
addTransaction({ symbol: "T", date: "2026-04-01", type: "bonus", quantity: 50, price: 0, fees: 0 });
{
  // 30000 total cost over 150 shares = 200
  const h = getHoldings()[0];
  check("quantity", h.quantity, 150);
  check("avgCost", h.avgCost, 200);
  check("total cost preserved", h.investedValue, 30000);
}

// --- 4. Dividend is income only, never touches basis ---------------------
console.log("\n[4] Dividend -> income only, basis untouched");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 100, price: 100, fees: 0 });
addTransaction({ symbol: "T", date: "2026-05-01", type: "dividend", quantity: 100, price: 5, fees: 75 });
{
  // 100*5 - 75 = 425
  const h = getHoldings()[0];
  check("dividendIncome", h.dividendIncome, 425);
  check("avgCost untouched", h.avgCost, 100);
  check("quantity untouched", h.quantity, 100);
}

// --- 5. Rights issue adds shares at subscription price -------------------
console.log("\n[5] Rights issue -> shares added at subscription price");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 100, price: 200, fees: 0 });
addTransaction({ symbol: "T", date: "2026-06-01", type: "rights", quantity: 50, price: 50, fees: 0 });
{
  // (20000 + 2500) / 150 = 150
  const h = getHoldings()[0];
  check("quantity", h.quantity, 150);
  check("avgCost", h.avgCost, 150);
}

// --- 6. Full exit zeroes the position but keeps realised P&L ------------
console.log("\n[6] Full exit -> flat position, realised P&L retained");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 100, price: 100, fees: 0 });
addTransaction({ symbol: "T", date: "2026-07-01", type: "sell", quantity: 100, price: 120, fees: 0 });
{
  const h = getHoldings()[0];
  check("quantity", h.quantity, 0);
  check("avgCost reset", h.avgCost, 0);
  check("realisedPnl", h.realizedPnl, 2000);
}

// --- 7. Overselling is clamped to the held quantity ---------------------
console.log("\n[7] Sell more than held -> clamped, no negative position");
reset();
addTransaction({ symbol: "T", date: "2026-01-01", type: "buy", quantity: 50, price: 100, fees: 0 });
addTransaction({ symbol: "T", date: "2026-07-01", type: "sell", quantity: 500, price: 110, fees: 0 });
{
  const h = getHoldings()[0];
  check("quantity floored at zero", h.quantity, 0);
  check("realised on 50 only", h.realizedPnl, 500);
}

console.log(
  failures === 0
    ? "\nAll portfolio math checks passed."
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
