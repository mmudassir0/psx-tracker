/**
 * Parser checks against the shapes PSX actually emits. Offline: no network,
 * no database.
 *
 *   npm run test:financials
 */
import { parseMarketWatch, inferFinancialUnit } from "@/lib/psx/parse";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${a}, want ${e}`);
}

/** One /screener row, cell for cell as PSX renders it. */
function screenerRow(cells: string[], changeOrder: string): string {
  const tds = cells.map((c, i) =>
    i === 5 ? `<td class="right" data-order="${changeOrder}">${c}</td>` : `<td>${c}</td>`,
  );
  return `<tr>${tds.join("")}</tr>`;
}

console.log("\n[1] /screener row");
{
  const html = `<table><thead><tr><th>SYMBOL</th></tr></thead><tbody>${screenerRow(
    [
      '<a class="tbl__symbol" href="/company/ATRL"><strong>ATRL</strong></a>',
      "0825",
      "ALLSHR,KMI30,KSE100",
      "126.8B",
      "1,189.43",
      '<i class="icon-up-dir"></i> 0.16%',
      "68.74%",
      "5.74",
      "2.06",
      "42.6M",
      "839,176",
    ],
    "0.16",
  )}</tbody></table>`;
  const [row] = parseMarketWatch(html);
  check("symbol", row.symbol, "ATRL");
  check("sector", row.sectorCode, "0825");
  check("indexes", row.indexes, ["ALLSHR", "KMI30", "KSE100"]);
  check("KMI30 member", row.isKmi30, true);
  check("price", row.current, 1189.43);
  check("change %", row.changePct, 0.16);
  check("LDCP back-derived", row.ldcp, 1187.53);
  check("30D avg volume", row.avgVolume30d, 839176);
  check("no daily volume", row.volume, null);
}

console.log("\n[2] Ex-dividend suffix is stripped");
{
  const html = `<table><tbody>${screenerRow(
    ["FFCXD", "0807", "KMI30", "1B", "537.90", "-0.10%", "0%", "10", "0", "1M", "100"],
    "-0.1",
  )}</tbody></table>`;
  check("FFCXD -> FFC", parseMarketWatch(html)[0]?.symbol, "FFC");
}

console.log("\n[3] Header and short rows are ignored");
{
  const html = `<table><tr><td>SYMBOL</td></tr><tr><td>a</td><td>b</td></tr></table>`;
  check("nothing parsed", parseMarketWatch(html).length, 0);
}

console.log("\n[4] Financial unit inference");
{
  check("Sales", inferFinancialUnit("Sales"), "pkr_thousands");
  check("Mark-up Earned", inferFinancialUnit("Mark-up Earned"), "pkr_thousands");
  check("EPS", inferFinancialUnit("EPS"), "pkr_per_share");
  check("Net Profit Margin (%)", inferFinancialUnit("Net Profit Margin (%)"), "percent");
  check("EPS Growth (%)", inferFinancialUnit("EPS Growth (%)"), "percent");
  check("PEG", inferFinancialUnit("PEG"), "ratio");
}

console.log(
  failures === 0 ? "\nAll parser checks passed." : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
