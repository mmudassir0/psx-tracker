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

console.log("\n[5] Backup encryption");
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
