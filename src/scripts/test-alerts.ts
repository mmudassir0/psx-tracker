/**
 * Alert rules that the other tests don't cover: new announcements for a
 * holding (each one reported once, never older than the rule) and the
 * 52-week-low proximity rule.
 */
import { db } from "@/db";
import { alerts, announcements, companyStats, ingestRuns, quotesDaily, symbols } from "@/db/schema";
import { addTransaction } from "@/lib/portfolio";
import { ensureDefaultPortfolio } from "@/lib/portfolios";
import { evaluateAlerts, pctAboveLow } from "@/lib/alerts";
import { assertScratchDatabase } from "./test-guard";
import { resetToAppSchema } from "./test-schema";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${a}, want ${e}`);
}

const USER = "user-1";
const TODAY = "2026-10-20";

async function main() {
  console.log(`Using scratch database: ${assertScratchDatabase()}`);
  await resetToAppSchema();

  for (const s of ["MEBL", "OGDC", "LUCK"]) {
    await db.insert(symbols).values({ symbol: s, name: s, indexes: "KSE100" }).run();
    await db.insert(quotesDaily).values({ symbol: s, date: TODAY, close: 104, ldcp: 100, source: "market-watch" }).run();
    await db
      .insert(companyStats)
      .values({ symbol: s, date: TODAY, week52High: 200, week52Low: 100 })
      .run();
  }
  await db.insert(ingestRuns).values({ id: "r", startedAt: new Date(), finishedAt: new Date(), status: "ok" }).run();

  const portfolioId = await ensureDefaultPortfolio(USER);
  await addTransaction(USER, { portfolioId, symbol: "MEBL", date: "2026-01-02", type: "buy", quantity: 10, price: 100 });

  const ruleCreated = new Date("2026-10-15T00:00:00Z");
  await db.insert(alerts).values([
    { id: "ann", userId: USER, symbol: null, kind: "new_announcement", active: true, createdAt: ruleCreated },
    { id: "low", userId: USER, symbol: "OGDC", kind: "near_52w_low", threshold: 5, active: true, createdAt: ruleCreated },
  ]).run();

  await db.insert(announcements).values([
    { id: "a1", symbol: "MEBL", date: "2026-10-19", title: "Financial results for the quarter", category: "result" },
    { id: "a2", symbol: "MEBL", date: "2026-10-10", title: "Older than the rule", category: "other" },
    { id: "a3", symbol: "OGDC", date: "2026-10-19", title: "Not held", category: "other" },
  ]).run();

  console.log("\n[1] First evaluation");
  const first = await evaluateAlerts();
  check(
    "announcement for the holding only, not older than the rule",
    first.filter((f) => f.alertId === "ann").map((f) => f.message),
    ["MEBL: Financial results for the quarter"],
  );
  check(
    "52-week-low rule fires (104 is 4% above 100)",
    first.filter((f) => f.alertId === "low").map((f) => f.value),
    [4],
  );

  console.log("\n[2] Re-run the same day");
  const again = await evaluateAlerts();
  check("same announcement is not reported twice", again.filter((f) => f.alertId === "ann").length, 0);

  console.log("\n[3] A new announcement arrives later the same day");
  await db
    .insert(announcements)
    .values({ id: "a4", symbol: "MEBL", date: TODAY, title: "Board meeting", category: "board_meeting" })
    .run();
  const later = await evaluateAlerts();
  check("only the new one is reported", later.map((f) => f.message), ["MEBL: Board meeting"]);

  console.log("\n[4] pctAboveLow");
  check("at the low", pctAboveLow(100, 100), 0);
  check("no low", pctAboveLow(100, null), null);

  if (failures) {
    console.log(`\n${failures} alert check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll alert checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
