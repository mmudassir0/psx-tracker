/**
 * Smoke-test the PSX parsers against live pages.
 * Run: npx tsx src/scripts/verify-parsers.ts
 */
import { psxFetch, psxFetchJson } from "@/lib/psx/client";
import {
  parseMarketWatch,
  parseIndices,
  parseEodSeries,
  parseCompanyPage,
  categorise,
} from "@/lib/psx/parse";

async function main() {
  console.log("== /indices ==");
  const indices = parseIndices(await psxFetch("/indices"));
  const kmi30 = indices.find((i) => i.indexCode === "KMI30");
  console.log(`parsed ${indices.length} indices`);
  console.log("KMI30:", kmi30);

  console.log("\n== /market-watch ==");
  const rows = parseMarketWatch(await psxFetch("/market-watch"));
  const members = rows.filter((r) => r.isKmi30);
  console.log(`parsed ${rows.length} symbols, ${members.length} in KMI30`);
  console.log(
    "constituents:",
    members.map((m) => m.symbol).join(", "),
  );
  const sample = members.find((m) => m.symbol === "MEBL") ?? members[0];
  console.log("sample row:", sample);

  console.log("\n== /timeseries/eod/MEBL ==");
  const bars = parseEodSeries(await psxFetchJson("/timeseries/eod/MEBL"));
  console.log(`parsed ${bars.length} bars`);
  console.log("oldest:", bars[0]);
  console.log("newest:", bars[bars.length - 1]);

  console.log("\n== /company/MEBL ==");
  const company = parseCompanyPage(await psxFetch("/company/MEBL"));
  const { announcements, ...stats } = company;
  console.log("stats:", stats);
  console.log(`announcements: ${announcements.length}`);
  for (const a of announcements.slice(0, 5)) {
    console.log(`  [${a.date}] (${categorise(a.title)}) ${a.title.slice(0, 70)}`);
  }

  // Cross-check: free-float % should agree with shares ratio.
  if (company.shares && company.freeFloatShares && company.freeFloatPct) {
    const derived = (company.freeFloatShares / company.shares) * 100;
    console.log(
      `\nfree-float check: reported ${company.freeFloatPct}% vs derived ${derived.toFixed(2)}%`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
