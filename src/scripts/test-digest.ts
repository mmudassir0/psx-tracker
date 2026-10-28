/** Weekly digest: the week's numbers for one user, and the message text. */
import { db } from "@/db";
import { announcements, indexLevels, ingestRuns, quotesDaily, symbols, user } from "@/db/schema";
import { addTransaction } from "@/lib/portfolio";
import { ensureDefaultPortfolio } from "@/lib/portfolios";
import { buildDigest, formatDigest } from "@/lib/digest";
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

const U = "u1";
const WEEK_AGO = "2026-10-16";
const NOW = "2026-10-23";

async function main() {
  console.log(`Using scratch database: ${assertScratchDatabase()}`);
  await resetToAppSchema();

  await db.insert(user).values({ id: U, name: "T", email: "t@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() }).run();
  const prices: Record<string, [number, number]> = { MEBL: [100, 110], OGDC: [200, 190], LUCK: [50, 50] };
  for (const [s, [then, now]] of Object.entries(prices)) {
    await db.insert(symbols).values({ symbol: s, name: s, indexes: "KSE100" }).run();
    await db.insert(quotesDaily).values([
      { symbol: s, date: WEEK_AGO, close: then, source: "market-watch" },
      { symbol: s, date: NOW, close: now, ldcp: then, source: "market-watch" },
    ]).run();
  }
  await db.insert(indexLevels).values([
    { indexCode: "KSE100", date: WEEK_AGO, current: 100000 },
    { indexCode: "KSE100", date: NOW, current: 102000 },
  ]).run();
  await db.insert(ingestRuns).values({ id: "r", startedAt: new Date(), finishedAt: new Date(), status: "ok" }).run();
  await db.insert(announcements).values([
    { id: "a1", symbol: "MEBL", date: "2026-10-20", title: "Board meeting", category: "board_meeting" },
    { id: "a2", symbol: "MEBL", date: "2026-10-01", title: "Too old", category: "other" },
    { id: "a3", symbol: "SYS", date: "2026-10-21", title: "Not held", category: "other" },
  ]).run();

  const pid = await ensureDefaultPortfolio(U);
  await addTransaction(U, { portfolioId: pid, symbol: "MEBL", date: "2026-01-02", type: "buy", quantity: 10, price: 90 });
  await addTransaction(U, { portfolioId: pid, symbol: "OGDC", date: "2026-01-02", type: "buy", quantity: 10, price: 150 });
  await addTransaction(U, { portfolioId: pid, symbol: "MEBL", date: "2025-11-05", type: "dividend", quantity: 10, price: 4 });

  const d = await buildDigest(U, NOW);
  check("index weekly change", d.index && Math.round((d.index.changePct ?? 0) * 10) / 10, 2);
  check("portfolio value", d.portfolio?.value, 10 * 110 + 10 * 190);
  check("portfolio weekly change (+100 −100)", d.portfolio?.change, 0);
  check("best holding", d.best, [{ symbol: "MEBL", changePct: 10 }]);
  check("worst holding", d.worst, [{ symbol: "OGDC", changePct: -5 }]);
  check("announcements: held and this week only", d.announcements, [{ symbol: "MEBL", title: "Board meeting" }]);
  check("dividend expected within 30 days (last Nov 5)", d.dividendsSoon, { amount: 40, symbols: ["MEBL"] });

  const msg = formatDigest(d, "https://example.com");
  check("subject leads with the portfolio", msg.subject, "Your portfolio 0.0% this week · PSX weekly");
  check("text names the best holding", msg.text.includes("Best: MEBL +10.0%"), true);
  check("text links to the portfolio", msg.text.includes("https://example.com/portfolio"), true);

  if (failures) {
    console.log(`\n${failures} digest check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll digest checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
