/** Mutual funds: average-cost maths, NAV choice, ownership and validation. */
import { db } from "@/db";
import { fundTransactions } from "@/db/schema";
import { exportUserData, deleteUserData } from "@/lib/account-data";
import {
  addFundTransaction,
  computeFundPortfolio,
  createFund,
  deleteFund,
  getFundPortfolio,
  recordFundNav,
  type FundTx,
} from "@/lib/funds";
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
const round = (v: number | null | undefined) => (v == null ? v : Math.round(v * 100) / 100);

async function main() {
  console.log("[1] Average cost (pure)");
  const fund = { id: "f", name: "Cash Fund", amc: null, category: null, shariah: true };
  const tx = (date: string, type: FundTx["type"], units: number, nav: number, amount: number): FundTx =>
    ({ id: date + type, fundId: "f", date, type, units, nav, amount, note: null });
  const p = computeFundPortfolio(
    [fund],
    [
      tx("2026-01-01", "buy", 100, 10, 1000),
      tx("2026-02-01", "buy", 100, 12, 1250), // 50 front-end load
      tx("2026-03-01", "redeem", 50, 13, 650),
      tx("2026-04-01", "dividend", 0, 0, 30),
    ],
    [{ fundId: "f", date: "2026-05-01", nav: 14 }],
  );
  const h = p.holdings[0];
  check("units", h.units, 150);
  check("cost basis after redeeming at average cost (2250 × 150/200)", round(h.costBasis), 1687.5);
  check("realised = 650 − 50 × 11.25", round(h.realizedPnl), 87.5);
  check("latest NAV is the newest noted one", h.latestNav, { date: "2026-05-01", nav: 14 });
  check("value", h.value, 2100);
  check("unrealised", round(h.unrealizedPnl), 412.5);
  check("total return incl. dividend", round(h.totalReturn), 530);

  const noNav = computeFundPortfolio([fund], [tx("2026-01-01", "buy", 10, 0.000001, 5)], []);
  check("a transaction's NAV counts when nothing newer is noted", noNav.holdings[0].latestNav?.date, "2026-01-01");
  const closed = computeFundPortfolio([fund], [tx("2026-01-01", "buy", 10, 10, 100), tx("2026-01-05", "redeem", 10, 11, 110)], []);
  check("fully redeemed: no units, no cost left", [closed.holdings[0].units, closed.holdings[0].costBasis], [0, 0]);

  console.log("\n[2] Database: ownership and validation");
  console.log(`Using scratch database: ${assertScratchDatabase()}`);
  await resetToAppSchema();
  const mine = await createFund("alice", { name: "Meezan Cash Fund", category: "Shariah Compliant Money Market", shariah: true });
  check("buy", await addFundTransaction("alice", { fundId: mine, date: "2026-01-01", type: "buy", units: 100, nav: 50 }), { ok: true });
  check(
    "redeeming more than held is refused",
    await addFundTransaction("alice", { fundId: mine, date: "2026-02-01", type: "redeem", units: 101, nav: 51 }),
    { ok: false, message: "You held 100 units on that date" },
  );
  check(
    "someone else's fund is refused",
    await addFundTransaction("bob", { fundId: mine, date: "2026-02-01", type: "buy", units: 1, nav: 1 }),
    { ok: false, message: "Unknown fund" },
  );
  check("bob can't record a NAV on alice's fund", await recordFundNav("bob", { fundId: mine, date: "2026-03-01", nav: 60 }), false);
  check("alice can", await recordFundNav("alice", { fundId: mine, date: "2026-03-01", nav: 55 }), true);
  const alice = await getFundPortfolio("alice");
  check("alice's value at the noted NAV", alice.value, 5500);
  check("bob sees nothing", (await getFundPortfolio("bob")).holdings.length, 0);
  check("bob can't delete it", await deleteFund("bob", mine), false);

  console.log("\n[3] Export and account deletion cover funds");
  const exported = await exportUserData("alice");
  check("export includes funds, transactions, NAVs", [exported.funds.length, exported.fundTransactions.length, exported.fundNavs.length], [1, 1, 1]);
  await deleteUserData("alice");
  check("deleted with the account", [(await getFundPortfolio("alice")).holdings.length, db.select().from(fundTransactions).all().length], [0, 0]);

  if (failures) {
    console.log(`\n${failures} fund check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll fund checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
