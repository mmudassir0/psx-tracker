import { db } from "@/db";
import { constituents } from "@/db/schema";
import { getRecompositionHistory, getSnapshotCoverage } from "@/lib/recomposition";
import { detectRecomposition } from "@/lib/psx/ingest";
import { assertScratchDatabase } from "./test-guard";

console.log(`Using scratch database: ${assertScratchDatabase()}`);

db.$client.exec(`
  DROP TABLE IF EXISTS constituents;
  CREATE TABLE constituents (
    date text NOT NULL,
    index_code text NOT NULL,
    symbol text NOT NULL,
    PRIMARY KEY (date, index_code, symbol)
  );
`);

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${a}, expected ${e}`);
}

function snapshot(date: string, symbols: string[]) {
  for (const symbol of symbols) {
    db.insert(constituents)
      .values({ date, indexCode: "KMI30", symbol })
      .onConflictDoNothing()
      .run();
  }
}

async function runTests() {
  snapshot("2026-08-01", ["MEBL", "OGDC", "LUCK", "FFC"]);
  snapshot("2026-08-02", ["OGDC", "LUCK", "FFC", "SYS"]);
  snapshot("2026-08-03", ["OGDC", "LUCK", "SYS", "PPL"]);

  console.log("\n[1] Coverage");
  const coverage = await getSnapshotCoverage();
  check("snapshot count", coverage.count, 3);
  check("first", coverage.first, "2026-08-01");
  check("last", coverage.last, "2026-08-03");

  console.log("\n[2] Latest change (drives the dashboard banner)");
  const latest = await detectRecomposition();
  check("currentDate", latest.currentDate, "2026-08-03");
  check("previousDate", latest.previousDate, "2026-08-02");
  check("dropped", latest.dropped, ["FFC"]);
  check("added", latest.added, ["PPL"]);

  console.log("\n[3] Full history, newest first");
  const history = await getRecompositionHistory();
  check("event count", history.length, 2);
  check("event[0] date", history[0].date, "2026-08-03");
  check("event[0] dropped", history[0].dropped, ["FFC"]);
  check("event[0] added", history[0].added, ["PPL"]);
  check("event[1] date", history[1].date, "2026-08-02");
  check("event[1] dropped", history[1].dropped, ["MEBL"]);
  check("event[1] added", history[1].added, ["SYS"]);

  console.log("\n[4] Unchanged membership produces no event");
  snapshot("2026-08-04", ["OGDC", "LUCK", "SYS", "PPL"]);
  const afterNoChange = await getRecompositionHistory();
  check("still 2 events", afterNoChange.length, 2);
  const latestDiff = await detectRecomposition();
  check("latest diff is empty", latestDiff.dropped, []);

  console.log(
    failures === 0
      ? "\nAll recomposition checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

runTests();
