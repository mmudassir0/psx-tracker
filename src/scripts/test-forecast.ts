/** Expected-dividend forecast and P/E-history summary (pure functions). */
import { buildForecast, type DividendEvent } from "@/lib/dividend-forecast";
import { summariseValuation } from "@/lib/valuation";

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

console.log("\n[valuation]");
const series = Array.from({ length: 25 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, pe: 10 + i }));
series.push({ date: "2026-09-26", pe: -3 }); // a loss-making day is ignored
series.push({ date: "2026-09-27", pe: 12 });
const v = summariseValuation(series);
check("current is the latest positive P/E", v.current, 12);
check("median of 10..34 and 12", v.median, 21.5);
check("range", [v.low, v.high], [10, 34]);
check("percentile: 2 lower + 2 ties of 26 days", Math.round(v.percentile ?? -1), 12);
check("flat history reads as typical", summariseValuation(Array.from({ length: 30 }, (_, i) => ({ date: String(i), pe: 10 }))).percentile, 50);
check("too little history gives no percentile", summariseValuation(series.slice(0, 5)).percentile, null);

if (failures) {
  console.log(`\n${failures} forecast check(s) failed.`);
  process.exit(1);
}
console.log("\nAll forecast checks passed.");
