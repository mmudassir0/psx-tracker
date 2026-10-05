/**
 * Data isolation between accounts: one user must never see or change
 * another's ledger, alerts, custom screens or settings, even by guessing ids.
 *
 *   npm run test:accounts
 */
import { db } from "@/db";
import {
  addTransaction,
  deleteTransaction,
  getHoldings,
  listTransactions,
} from "@/lib/portfolio";
import { computeDisposals } from "@/lib/cgt";
import {
  acknowledgeEvent,
  countUnacknowledgedEvents,
  createAlert,
  deleteAlert,
  listAlertEvents,
  listAlerts,
  setAlertActive,
} from "@/lib/alerts";
import {
  createCustomScreen,
  deleteCustomScreen,
  listCustomScreens,
  updateCustomScreen,
} from "@/lib/screens";
import { getUserSetting, setUserSetting } from "@/lib/settings";
import { alertEvents } from "@/db/schema";
import { assertScratchDatabase } from "./test-guard";

console.log(`Using scratch database: ${assertScratchDatabase()}`);

db.$client.exec(`
  DROP TABLE IF EXISTS transactions;
  CREATE TABLE transactions (
    id text PRIMARY KEY, user_id text, symbol text NOT NULL, date text NOT NULL,
    type text NOT NULL, quantity real NOT NULL DEFAULT 0, price real NOT NULL DEFAULT 0,
    fees real NOT NULL DEFAULT 0, note text, created_at integer NOT NULL);
  DROP TABLE IF EXISTS alerts;
  CREATE TABLE alerts (
    id text PRIMARY KEY, user_id text, symbol text, kind text NOT NULL, threshold real,
    active integer NOT NULL DEFAULT 1, note text, created_at integer NOT NULL);
  DROP TABLE IF EXISTS alert_events;
  CREATE TABLE alert_events (
    id text PRIMARY KEY, user_id text, alert_id text NOT NULL, symbol text,
    date text NOT NULL, message text NOT NULL, value real,
    acknowledged integer NOT NULL DEFAULT 0, created_at integer NOT NULL);
  DROP TABLE IF EXISTS custom_screens;
  CREATE TABLE custom_screens (
    id text PRIMARY KEY, user_id text, name text NOT NULL, description text,
    rules text NOT NULL, universe text NOT NULL DEFAULT 'all', created_at integer NOT NULL);
  DROP TABLE IF EXISTS screen_hits;
  CREATE TABLE screen_hits (
    screen_id text NOT NULL, date text NOT NULL, symbol text NOT NULL,
    PRIMARY KEY (screen_id, date, symbol));
  DROP TABLE IF EXISTS user_settings;
  CREATE TABLE user_settings (
    user_id text NOT NULL, key text NOT NULL, value text NOT NULL,
    updated_at integer NOT NULL, PRIMARY KEY (user_id, key));
`);

const ALICE = "user-alice";
const BOB = "user-bob";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(
    `${pass ? "  PASS" : "  FAIL"}  ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
}

async function run() {
  console.log("\n[1] Ledgers are separate");
  const aliceTx = await addTransaction(ALICE, { symbol: "MEBL", date: "2026-01-02", type: "buy", quantity: 100, price: 200 });
  await addTransaction(ALICE, { symbol: "MEBL", date: "2026-03-02", type: "sell", quantity: 40, price: 260 });
  await addTransaction(BOB, { symbol: "FFC", date: "2026-01-05", type: "buy", quantity: 10, price: 300 });

  check("alice sees only her rows", (await listTransactions(ALICE)).length, 2);
  check("bob sees only his row", (await listTransactions(BOB)).map((t) => t.symbol), ["FFC"]);
  check("alice holdings", (await getHoldings(ALICE)).map((h) => [h.symbol, h.quantity]), [["MEBL", 60]]);
  check("bob holdings", (await getHoldings(BOB)).map((h) => [h.symbol, h.quantity]), [["FFC", 10]]);
  check("logged out sees nothing", (await listTransactions(null)).length, 0);
  check("alice's disposals only hers", (await computeDisposals(ALICE, "average")).length, 1);
  check("bob has no disposals", (await computeDisposals(BOB, "average")).length, 0);

  console.log("\n[2] Deleting someone else's row by id does nothing");
  await deleteTransaction(BOB, aliceTx);
  check("alice's row survives bob's delete", (await listTransactions(ALICE)).length, 2);
  await deleteTransaction(ALICE, aliceTx);
  check("alice can delete her own", (await listTransactions(ALICE)).length, 1);

  console.log("\n[3] Alerts and their events");
  const aliceAlert = await createAlert(ALICE, { symbol: "MEBL", kind: "price_above", threshold: 300 });
  await createAlert(BOB, { symbol: "FFC", kind: "price_below", threshold: 100 });
  check("alice lists one alert", (await listAlerts(ALICE)).length, 1);
  check("bob lists one alert", (await listAlerts(BOB)).length, 1);

  await setAlertActive(BOB, aliceAlert, false);
  check("bob can't pause alice's alert", (await listAlerts(ALICE))[0].active, true);

  await db.insert(alertEvents).values({
    id: "evt-1", userId: ALICE, alertId: aliceAlert, symbol: "MEBL", date: "2026-10-02",
    message: "MEBL price 310 >= 300", value: 310, acknowledged: false, createdAt: new Date(),
  }).run();
  check("bob sees none of alice's events", (await listAlertEvents(BOB)).length, 0);
  check("alice's unread count", await countUnacknowledgedEvents(ALICE), 1);
  check("bob's unread count", await countUnacknowledgedEvents(BOB), 0);
  await acknowledgeEvent(BOB, "evt-1");
  check("bob can't acknowledge alice's event", await countUnacknowledgedEvents(ALICE), 1);
  await acknowledgeEvent(ALICE, "evt-1");
  check("alice can acknowledge hers", await countUnacknowledgedEvents(ALICE), 0);

  await deleteAlert(BOB, aliceAlert);
  check("bob can't delete alice's alert", (await listAlerts(ALICE)).length, 1);
  check("...or its events", (await listAlertEvents(ALICE)).length, 1);

  console.log("\n[4] Custom screens");
  const rules = [{ metric: "peTtm" as const, op: "lte" as const, value: 10 }];
  const aliceScreen = await createCustomScreen(ALICE, { name: "Cheap", rules, universe: "all" });
  check("alice has her screen", (await listCustomScreens(ALICE)).map((s) => s.name), ["Cheap"]);
  check("bob doesn't see it", (await listCustomScreens(BOB)).length, 0);
  check("logged out doesn't see it", (await listCustomScreens(null)).length, 0);
  check("the daily job sees every screen", (await listCustomScreens("all")).length, 1);

  await updateCustomScreen(BOB, aliceScreen, { name: "Hijacked", rules, universe: "all" });
  check("bob can't rename it", (await listCustomScreens(ALICE))[0].name, "Cheap");
  await deleteCustomScreen(BOB, aliceScreen);
  check("bob can't delete it", (await listCustomScreens(ALICE)).length, 1);

  console.log("\n[5] Settings");
  await setUserSetting(ALICE, "zakat", { otherAssets: 5000 });
  check("alice reads her setting", (await getUserSetting(ALICE, "zakat", { otherAssets: 0 })).otherAssets, 5000);
  check("bob gets the default", (await getUserSetting(BOB, "zakat", { otherAssets: 0 })).otherAssets, 0);
  check("logged out gets the default", (await getUserSetting(null, "zakat", { otherAssets: 0 })).otherAssets, 0);
}

run()
  .then(() => {
    console.log(failures === 0 ? "\nAll account isolation checks passed." : `\n${failures} check(s) FAILED.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
