/** Expected-dividend forecast: source priority, totals, yields and timing. */
import { buildForecast, type DividendEvent } from "@/lib/dividend-forecast";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${a}, want ${e}`);
}

const asOf = "2026-10-28";
const holdings = [
  { symbol: "MEBL", quantity: 100, avgCost: 200, close: 400 },
  { symbol: "OGDC", quantity: 50, avgCost: 100, close: 250 },
  { symbol: "SYS", quantity: 10, avgCost: 500, close: 600 },
  { symbol: "SOLD", quantity: 0, avgCost: 0, close: 10 },
];
const recorded = new Map<string, DividendEvent[]>([["MEBL", [{ date: "2026-03-10", perShare: 7 }]]]);
const psx = new Map<string, DividendEvent[]>([
  // Ignored: MEBL has the user's own records.
  ["MEBL", [{ date: "2026-03-01", perShare: 99 }]],
  ["OGDC", [{ date: "2025-11-15", perShare: 2 }, { date: "2026-05-20", perShare: 3 }]],
]);

const f = buildForecast(holdings, recorded, psx, asOf);
check("your records beat PSX history", f.rows.find((r) => r.symbol === "MEBL")?.source, "recorded");
check("MEBL income = 100 × 7", f.rows.find((r) => r.symbol === "MEBL")?.expectedIncome, 700);
check("OGDC income = 50 × (2 + 3)", f.rows.find((r) => r.symbol === "OGDC")?.expectedIncome, 250);
check("total", f.total, 950);
check("OGDC yield on value", f.rows.find((r) => r.symbol === "OGDC")?.yieldOnValuePct, 2);
check("OGDC yield on cost", f.rows.find((r) => r.symbol === "OGDC")?.yieldOnCostPct, 5);
check("closed positions ignored; no-history listed", f.noHistory, ["SYS"]);
check("months start with the current one", f.byMonth.map((m) => m.month).slice(0, 3), ["10", "11", "12"]);
check("OGDC November payment lands in November", f.byMonth.find((m) => m.month === "11")?.amount, 100);
check("MEBL March payment lands in March", f.byMonth.find((m) => m.month === "03")?.amount, 700);
check("by-month sums to the total", f.byMonth.reduce((s, m) => s + m.amount, 0), 950);

if (failures) {
  console.log(`\n${failures} forecast check(s) failed.`);
  process.exit(1);
}
console.log("\nAll forecast checks passed.");
