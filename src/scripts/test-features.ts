/**
 * Offline checks: broker CSV parsing, portfolio history replay, and backup
 * encryption. No network, no database.
 *
 *   npm run test:features
 */
import {
  guessDateOrder,
  guessMapping,
  normaliseRow,
  parseCsv,
  parseDate,
  parseNumber,
  parseType,
} from "@/lib/csv-import";
import { replayLedger } from "@/lib/portfolio-history";
import { decryptBackup, encryptBackup } from "@/lib/backup-crypto";
import { computeIndexMovers } from "@/lib/index-movers";
import { checkStaleness, periodReturns, streakOf } from "@/lib/dashboard-data";
import { DASHBOARD_CARDS, cardOrder, hiddenCards } from "@/lib/dashboard-layout";
import { afterCloseOf, missingSession } from "@/lib/ingest-guard";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

console.log("\n[1] CSV parsing");
check("quoted fields and doubled quotes", parseCsv('a,"b,c","say ""hi"""\n1,2,3'), [["a", "b,c", 'say "hi"'], ["1", "2", "3"]]);
check("semicolon delimiter", parseCsv("Date;Qty\n05/10/2026;100"), [["Date", "Qty"], ["05/10/2026", "100"]]);
check("tabs, CRLF, blank lines, BOM", parseCsv("﻿x\ty\r\n\r\n1\t2\r\n"), [["x", "y"], ["1", "2"]]);

console.log("\n[2] Values");
check("thousands separators", parseNumber("1,234.50"), 1234.5);
check("accounting negative", parseNumber("(12.5)"), -12.5);
check("currency prefix", parseNumber("PKR 300"), 300);
check("empty", parseNumber(""), null);
check("ISO date", parseDate("2026-10-05", "dmy"), "2026-10-05");
check("day first", parseDate("05/10/2026", "dmy"), "2026-10-05");
check("month first", parseDate("05/10/2026", "mdy"), "2026-05-10");
check("month name", parseDate("05-Oct-2026", "dmy"), "2026-10-05");
check("two-digit year", parseDate("5-Oct-26", "dmy"), "2026-10-05");
check("impossible date", parseDate("31/02/2026", "dmy"), null);
check("day-first detected", guessDateOrder(["03/04/2026", "25/04/2026"]), "dmy");
check("month-first detected", guessDateOrder(["04/25/2026"]), "mdy");
check("type words", ["B", "Purchase", "SOLD", "Dividend", "Right Shares", "xyz"].map(parseType),
  ["buy", "buy", "sell", "dividend", "rights", null]);

console.log("\n[3] Column guessing and rows");
const headers = ["Trade Date", "Scrip", "B/S", "Volume", "Rate", "Commission", "Remarks"];
const mapping = guessMapping(headers);
check("columns guessed", mapping, { date: 0, symbol: 1, type: 2, quantity: 3, price: 4, fees: 5, note: 6 });
check("row parsed", normaliseRow(["05/10/2026", "mebl", "B", "1,000", "548.79", "250", "first lot"], mapping, "dmy"),
  { ok: true, tx: { date: "2026-10-05", symbol: "MEBL", type: "buy", quantity: 1000, price: 548.79, fees: 250, note: "first lot" } });
check("bad price reported", normaliseRow(["05/10/2026", "MEBL", "B", "10", "n/a", "", ""], mapping, "dmy").ok, false);
const noType = { ...mapping, type: -1 };
check("negative quantity without a type column is a sell",
  normaliseRow(["05/10/2026", "MEBL", "", "-40", "560", "", ""], noType, "dmy"),
  { ok: true, tx: { date: "2026-10-05", symbol: "MEBL", type: "sell", quantity: 40, price: 560, fees: 0, note: null } });

console.log("\n[4] Portfolio history");
const closes = new Map([["AAA", new Map([["d1", 100], ["d2", 110], ["d4", 120]])]]);
const index = new Map([["d1", 1000], ["d2", 1100], ["d3", 1100], ["d4", 1200]]);
const points = replayLedger(
  [
    { symbol: "AAA", date: "d1", type: "buy", quantity: 10, price: 100, fees: 0 },
    { symbol: "AAA", date: "d3", type: "sell", quantity: 5, price: 110, fees: 0 },
    { symbol: "AAA", date: "d4", type: "dividend", quantity: 5, price: 3, fees: 0 },
  ],
  ["d1", "d2", "d3", "d4"],
  closes,
  index,
);
check("value follows closes", points.map((p) => p.value), [1000, 1100, 550, 600]);
check("missing close carries forward (d3)", points[2].value, 5 * 110);
check("invested is average cost of what's held", points.map((p) => p.invested), [1000, 1000, 500, 500]);
// 1000 PKR buys 1 index unit at 1000; selling 550 at 1100 withdraws 0.5.
check("benchmark buys and sells the index with the trades", points.map((p) => p.benchmark), [1000, 1100, 550, 600]);
check("dividends don't change the position", points[3].value, 600);

// Index known only from d3: the d1 purchase buys index units at d3's level.
const late = replayLedger(
  [{ symbol: "AAA", date: "d1", type: "buy", quantity: 10, price: 100, fees: 0 }],
  ["d1", "d2", "d3"],
  closes,
  new Map([["d3", 500]]),
);
check("benchmark waits for the first index level", late.map((p) => p.benchmark), [null, null, 1000]);

console.log("\n[5] What moved the index");
{
  const movers = computeIndexMovers(
    [
      { symbol: "A", name: null, close: 11, ldcp: 10, freeFloatShares: 100 },
      { symbol: "B", name: null, close: 9.9, ldcp: 10, freeFloatShares: 900 },
      { symbol: "C", name: null, close: null, ldcp: 10, freeFloatShares: 50 },
    ],
    { current: 1001, change: 1 },
  );
  check("points per stock, biggest first", movers.rows.map((r) => [r.symbol, Math.round(r.points * 100) / 100]), [["A", 10], ["B", -9]]);
  check("weights at the previous close", movers.rows.map((r) => Math.round(r.weightPct)), [10, 90]);
  check("contributions add up to the move", Math.round(movers.explainedPoints * 100) / 100, 1);
  check("published move", movers.actualPoints, 1);
  check("previous level from changePct", Math.round(computeIndexMovers([], { current: 1010, changePct: 1 }).previousLevel ?? 0), 1000);
  check("no level, no rows", computeIndexMovers([{ symbol: "A", name: null, close: 11, ldcp: 10, freeFloatShares: 1 }], null).rows.length, 0);
}

console.log("\n[6] Dashboard helpers");
{
  check("up streak", streakOf([10, 11, 12, 13]), 3);
  check("down streak stops at an up day", streakOf([10, 12, 11, 10]), -2);
  check("flat close ends a streak", streakOf([10, 11, 11]), 0);
  check("one close, no streak", streakOf([10]), 0);

  const hist = [
    { date: "2025-10-06", current: 100 },
    { date: "2025-12-31", current: 110 },
    { date: "2026-09-04", current: 120 },
    { date: "2026-09-29", current: 125 },
    { date: "2026-10-06", current: 132 },
  ];
  check("period returns", periodReturns(hist).map((r) => [r.label, r.pct == null ? null : Math.round(r.pct * 10) / 10]), [
    ["1W", 5.6], ["1M", 10], ["3M", 20], ["YTD", 20], ["1Y", 32],
  ]);
  check("too short a history gives no 1Y", periodReturns(hist.slice(2))[4].pct, null);

  // Tuesday 2026-10-06 19:00 PKT: Tuesday's session is expected.
  const now = new Date("2026-10-06T14:00:00Z");
  check("current data is fine", checkStaleness("2026-10-06", { status: "ok" }, now), null);
  check("one missed day is tolerated", checkStaleness("2026-10-05", { status: "ok" }, now), null);
  check("one missed day after a failed run is reported", checkStaleness("2026-10-05", { status: "error" }, now)?.missedSessions, 1);
  check("two missed days are reported", checkStaleness("2026-10-02", { status: "ok" }, now)?.missedSessions, 2);

  // Daily update guards. PKT = UTC+5. 2026-10-05 is a Monday.
  check("after close is 15:45 PKT", afterCloseOf("2026-10-05").toISOString(), "2026-10-05T10:45:00.000Z");
  check("Monday 7 PM PKT: waits until 8 PM before reporting",
    missingSession("2026-10-02", new Date("2026-10-05T14:00:00Z")), null);
  check("Monday 9 PM PKT with Friday's prices: Monday missing",
    missingSession("2026-10-02", new Date("2026-10-05T16:00:00Z")), "2026-10-05");
  check("Tuesday 7 AM PKT with Friday's prices: Monday missing",
    missingSession("2026-10-02", new Date("2026-10-06T02:00:00Z")), "2026-10-05");
  check("Monday's prices saved: nothing missing",
    missingSession("2026-10-05", new Date("2026-10-05T16:00:00Z")), null);
  check("Saturday with Friday's prices: nothing missing",
    missingSession("2026-10-09", new Date("2026-10-10T08:00:00Z")), null);

  const defaults = DASHBOARD_CARDS.map((c) => c.id);
  check("no saved order gives the default", cardOrder({}), defaults);
  const order = cardOrder({ order: ["constituents", "bogus", "heatmap", "heatmap"] });
  check("saved cards first, unknown and repeated dropped", order.slice(0, 2), ["constituents", "heatmap"]);
  check("new cards still appear", order.length, defaults.length);
  check("unknown hidden ids ignored", [...hiddenCards({ hidden: ["breadth", "nope"] })], ["breadth"]);
}

console.log("\n[7] Backup encryption");
const secret = "correct horse battery staple";
const sample = JSON.stringify({ tables: { user: [{ email: "a@b.c" }] } });
const sealed = encryptBackup(sample, secret);
check("not readable as plain text", sealed.includes(Buffer.from("a@b.c")), false);
check("round trip", decryptBackup(sealed, secret), sample);
let wrong = "";
try { decryptBackup(sealed, "a different passphrase"); } catch (e) { wrong = (e as Error).message; }
check("wrong passphrase refused", wrong, "Wrong passphrase, or the file is damaged.");
const tampered = Buffer.from(sealed);
tampered[tampered.length - 1] ^= 1;
let damaged = "";
try { decryptBackup(tampered, secret); } catch (e) { damaged = (e as Error).message; }
check("tampering detected", damaged, "Wrong passphrase, or the file is damaged.");
let short = "";
try { encryptBackup(sample, "short"); } catch (e) { short = (e as Error).message; }
check("short passphrase refused", short.startsWith("BACKUP_PASSPHRASE must be"), true);

console.log(failures === 0 ? "\nAll feature checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
