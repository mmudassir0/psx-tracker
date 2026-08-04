/**
 * Payout parsing, against the messy shapes PSX actually emits.
 *
 * Regression guard: payouts come from a POST fragment that is empty in the
 * server-rendered company page. Missing it is why declared rates showed as
 * blank when PSX clearly published them.
 *
 *   npm run test:payouts
 */
import { psxFetch, PSX_BASE } from "@/lib/psx/client";
import { parsePayouts, inferFinancialUnit } from "@/lib/psx/parse";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${a}, want ${e}`);
}

function table(rows: string[][]): string {
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr><th>Date</th><th>Financial Results</th><th>Details</th><th>Book Closure</th></tr></thead><tbody>${body}</tbody></table>`;
}

console.log("\n[1] Standard interim dividend");
{
  const [p] = parsePayouts(
    table([["July 29, 2026 3:23 PM", "30/06/2026(HYR)", "145%(ii) (D)", "11/08/2026 - 13/08/2026"]]),
  );
  check("date", p.date, "2026-07-29");
  check("kind", p.kind, "cash_dividend");
  check("percent", p.percent, 145);
  check("perShare (PKR 10 face)", p.perShare, 14.5);
  check("instalment", p.instalment, "ii");
  check("book closure from", p.bookClosureFrom, "2026-08-11");
  check("book closure to", p.bookClosureTo, "2026-08-13");
}

console.log("\n[2] Final dividend with a decimal rate");
{
  const [p] = parsePayouts(
    table([["April 29, 2026 3:56 PM", "31/03/2026(IIIQ)", "32.50%(F) (D)", "12/05/2026 - 13/05/2026"]]),
  );
  check("percent", p.percent, 32.5);
  check("perShare", p.perShare, 3.25);
  check("instalment", p.instalment, "F");
}

console.log("\n[3] Malformed parentheses still parse");
{
  const rows = parsePayouts(
    table([
      ["January 5, 2026", "31/12/2025(YR)", "50%F) (D)", "01/02/2026 - 03/02/2026"],
      ["January 6, 2026", "31/12/2025(YR)", "40%(ii (D)", "01/02/2026 - 03/02/2026"],
      ["January 7, 2026", "31/12/2025(YR)", "DIVIDEND =350% (F)", "01/02/2026 - 03/02/2026"],
    ]),
  );
  check("all three parsed", rows.length, 3);
  const byPct = Object.fromEntries(rows.map((r) => [r.percent, r.kind]));
  check("50% is a dividend", byPct[50], "cash_dividend");
  check("40% is a dividend", byPct[40], "cash_dividend");
  check("350% spelled-out is a dividend", byPct[350], "cash_dividend");
}

console.log("\n[4] Two payouts in one cell are summed, not halved");
{
  const [p] = parsePayouts(
    table([["March 1, 2026", "31/12/2025(YR)", "10%(i) (D) - 5%(i) (D)", "01/04/2026 - 03/04/2026"]]),
  );
  check("percent", p.percent, 15);
  check("perShare", p.perShare, 1.5);
}

console.log("\n[5] Bonus and rights are distinguished from cash");
{
  const rows = parsePayouts(
    table([
      ["May 1, 2026", "31/12/2025(YR)", "20%(F) (B)", "01/06/2026 - 03/06/2026"],
      ["May 2, 2026", "31/12/2025(YR)", "30%(F) (R)", "01/06/2026 - 03/06/2026"],
    ]),
  );
  const kinds = rows.map((r) => r.kind).sort();
  check("kinds", kinds, ["bonus", "rights"]);
}

console.log("\n[6] Header rows and junk are ignored");
{
  const rows = parsePayouts(
    table([["Date", "Financial Results", "Details", "Book Closure"], ["not a date", "x", "y", "z"]]),
  );
  check("nothing parsed", rows.length, 0);
}

console.log("\n[7] Financial unit inference");
{
  check("Sales", inferFinancialUnit("Sales"), "pkr_thousands");
  check("Mark-up Earned", inferFinancialUnit("Mark-up Earned"), "pkr_thousands");
  check("EPS", inferFinancialUnit("EPS"), "pkr_per_share");
  check("Net Profit Margin (%)", inferFinancialUnit("Net Profit Margin (%)"), "percent");
  check("EPS Growth (%)", inferFinancialUnit("EPS Growth (%)"), "percent");
  check("PEG", inferFinancialUnit("PEG"), "ratio");
}

async function live() {
  console.log("\n[8] Live check against PSX");
  const html = await psxFetch("/company/payouts", {
    form: { symbol: "FFC" },
    referer: `${PSX_BASE}/company/FFC`,
    ttlMs: 0,
  });
  const rows = parsePayouts(html);
  const withRate = rows.filter((r) => r.percent != null);
  console.log(
    `${rows.length > 0 ? "  PASS" : "  FAIL"}  FFC returned ${rows.length} payouts, ${withRate.length} with a rate`,
  );
  if (rows.length === 0) failures++;
  // Every row should carry a rate; a blank one means the shape changed.
  if (rows.length !== withRate.length) {
    failures++;
    console.log("  FAIL  some rows had no parsable rate:",
      rows.filter((r) => r.percent == null).map((r) => r.raw));
  }
  for (const r of rows.slice(0, 3)) {
    console.log(`        ${r.date}  ${r.percent}%  PKR ${r.perShare?.toFixed(2)}/sh`);
  }
}

live()
  .then(() => {
    console.log(
      failures === 0
        ? "\nAll payout checks passed."
        : `\n${failures} check(s) FAILED.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
