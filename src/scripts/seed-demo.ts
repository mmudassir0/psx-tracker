/**
 * Demo holdings, so the portfolio-dependent pages have something to show
 * before real transactions exist.
 *
 *   npm run seed:demo    add them
 *   npm run seed:clear   remove them
 *
 * Every row is tagged with DEMO_NOTE. Nothing else touches transactions
 * carrying that note, so clearing is exact and can never eat real entries.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { addTransaction, listTransactions } from "@/lib/portfolio";

export const DEMO_NOTE = "DEMO";

/**
 * Deliberately varied so the analytics pages are actually exercised:
 * concentrated banking + energy (correlation should notice), one thin name
 * (liquidity should flag it), a closed position and a partial sell (CGT),
 * plus bonus, rights and dividends (cost-basis edge cases).
 */
const DEMO_TRANSACTIONS: {
  symbol: string;
  date: string;
  type: "buy" | "sell" | "dividend" | "bonus" | "rights";
  quantity: number;
  price: number;
  fees?: number;
}[] = [
  // Core positions, bought across 2025 so there is holding-period history.
  { symbol: "MEBL", date: "2025-09-15", type: "buy", quantity: 400, price: 385, fees: 480 },
  { symbol: "OGDC", date: "2025-10-02", type: "buy", quantity: 600, price: 242, fees: 450 },
  { symbol: "LUCK", date: "2025-11-20", type: "buy", quantity: 200, price: 362, fees: 380 },
  { symbol: "FFC", date: "2026-01-12", type: "buy", quantity: 300, price: 445, fees: 420 },
  { symbol: "HUBC", date: "2026-02-05", type: "buy", quantity: 500, price: 168, fees: 350 },
  { symbol: "SYS", date: "2026-03-18", type: "buy", quantity: 150, price: 268, fees: 210 },

  // Adding to a winner — exercises weighted-average cost.
  { symbol: "MEBL", date: "2026-04-10", type: "buy", quantity: 150, price: 512, fees: 260 },

  // Corporate actions.
  { symbol: "FFC", date: "2026-02-20", type: "dividend", quantity: 300, price: 8.5, fees: 383 },
  { symbol: "MEBL", date: "2026-03-27", type: "dividend", quantity: 400, price: 7.0, fees: 420 },
  { symbol: "OGDC", date: "2026-03-10", type: "dividend", quantity: 600, price: 4.25, fees: 383 },
  { symbol: "SYS", date: "2026-05-06", type: "bonus", quantity: 15, price: 0 },
  { symbol: "HUBC", date: "2026-04-15", type: "rights", quantity: 100, price: 120, fees: 90 },

  // Realised P&L for the CGT report: one trim, one full exit.
  { symbol: "OGDC", date: "2026-06-18", type: "sell", quantity: 200, price: 305, fees: 460 },
  { symbol: "PSO", date: "2025-12-01", type: "buy", quantity: 250, price: 195, fees: 240 },
  { symbol: "PSO", date: "2026-05-22", type: "sell", quantity: 250, price: 268, fees: 335 },
];

export function seedDemo(): number {
  clearDemo();
  for (const tx of DEMO_TRANSACTIONS) {
    addTransaction({ ...tx, fees: tx.fees ?? 0, note: DEMO_NOTE });
  }
  return DEMO_TRANSACTIONS.length;
}

export function clearDemo(): number {
  return db.delete(transactions).where(eq(transactions.note, DEMO_NOTE)).run()
    .changes;
}

export async function hasDemoData(): Promise<boolean> {
  const txs = await listTransactions();
  return txs.some((t) => t.note === DEMO_NOTE);
}

async function main() {
  const mode = process.argv.includes("--clear") ? "clear" : "seed";

  if (mode === "clear") {
    const removed = clearDemo();
    console.log(`Removed ${removed} demo transaction(s).`);
    return;
  }

  const txs = await listTransactions();
  const real = txs.filter((t) => t.note !== DEMO_NOTE).length;
  if (real > 0) {
    console.log(
      `Note: ${real} non-demo transaction(s) already exist. They are left untouched.`,
    );
  }

  const added = seedDemo();
  console.log(`Added ${added} demo transactions, all tagged "${DEMO_NOTE}".`);
  console.log("Remove them any time with:  npm run seed:clear");
}

// Only run the CLI when invoked directly, not when imported by a page.
if (process.argv[1]?.includes("seed-demo")) main();
