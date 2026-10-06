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
  importTransactions,
  listTransactions,
  moveTransaction,
} from "@/lib/portfolio";
import {
  createPortfolio,
  deletePortfolio,
  ensureDefaultPortfolio,
  listPortfolios,
  renamePortfolio,
} from "@/lib/portfolios";
import { deleteUserData, exportUserData } from "@/lib/account-data";
import { isValidSubscription, listDevices, removeSubscription, saveSubscription } from "@/lib/push";
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
    id text PRIMARY KEY, user_id text, portfolio_id text, symbol text NOT NULL, date text NOT NULL,
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
  DROP TABLE IF EXISTS portfolios;
  CREATE TABLE portfolios (
    id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL, created_at integer NOT NULL);
  DROP TABLE IF EXISTS watchlist;
  CREATE TABLE watchlist (
    user_id text NOT NULL, symbol text NOT NULL, note text, added_price real,
    added_at integer NOT NULL, PRIMARY KEY (user_id, symbol));
  DROP TABLE IF EXISTS link_codes;
  CREATE TABLE link_codes (
    code text PRIMARY KEY, user_id text NOT NULL, purpose text NOT NULL, expires_at integer NOT NULL);
  DROP TABLE IF EXISTS push_subscriptions;
  CREATE TABLE push_subscriptions (
    endpoint text PRIMARY KEY, user_id text NOT NULL, p256dh text NOT NULL, auth text NOT NULL,
    device text, created_at integer NOT NULL);
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

  console.log("\n[5] Portfolios");
  const aliceMain = await ensureDefaultPortfolio(ALICE);
  check("default portfolio is reused", await ensureDefaultPortfolio(ALICE), aliceMain);
  const trading = await createPortfolio(ALICE, "Trading");
  check("alice creates a second portfolio", trading.ok, true);
  const tradingId = trading.ok ? trading.id : "";
  check("duplicate names refused", (await createPortfolio(ALICE, "trading")).ok, false);
  check("bob sees only his own portfolio", (await listPortfolios(BOB)).length, 1);

  // Bob can't file a trade into alice's portfolio: it lands in his own default.
  await addTransaction(BOB, { symbol: "OGDC", date: "2026-02-01", type: "buy", quantity: 5, price: 280, portfolioId: tradingId });
  const bobDefault = await ensureDefaultPortfolio(BOB);
  check("bob's trade went to his own portfolio",
    (await listTransactions(BOB)).find((t) => t.symbol === "OGDC")?.portfolioId, bobDefault);
  check("alice's Trading portfolio stays empty", (await listTransactions(ALICE, { portfolioId: tradingId })).length, 0);

  const ogdc = await addTransaction(ALICE, { symbol: "OGDC", date: "2026-02-02", type: "buy", quantity: 20, price: 280, portfolioId: tradingId });
  check("per-portfolio holdings", (await getHoldings(ALICE, { portfolioId: tradingId })).map((h) => h.symbol), ["OGDC"]);
  check("combined holdings span portfolios", (await getHoldings(ALICE)).map((h) => h.symbol).sort(), ["MEBL", "OGDC"]);
  check("holdings as of a date", (await getHoldings(ALICE, { asOf: "2026-01-31" })).map((h) => h.symbol), []);

  await moveTransaction(BOB, ogdc, bobDefault);
  check("bob can't move alice's trade", (await listTransactions(ALICE, { portfolioId: tradingId })).length, 1);
  check("bob can't rename alice's portfolio", (await renamePortfolio(BOB, tradingId, "Mine")).ok, false);
  check("a non-empty portfolio can't be deleted", (await deletePortfolio(ALICE, tradingId)).ok, false);
  await moveTransaction(ALICE, ogdc, aliceMain);
  check("alice moves her trade", (await listTransactions(ALICE, { portfolioId: aliceMain })).some((t) => t.id === ogdc), true);
  check("an empty portfolio can be deleted", (await deletePortfolio(ALICE, tradingId)).ok, true);
  check("the last portfolio can't be deleted", (await deletePortfolio(ALICE, aliceMain)).ok, false);

  console.log("\n[6] Import");
  const rows = [
    { date: "2026-03-01", symbol: "LUCK", type: "buy" as const, quantity: 10, price: 400, fees: 5, note: null },
    { date: "2026-03-01", symbol: "LUCK", type: "buy" as const, quantity: 10, price: 400, fees: 5, note: null },
    { date: "2026-03-05", symbol: "LUCK", type: "sell" as const, quantity: 4, price: 420, fees: 3, note: "trim" },
  ];
  check("duplicates inside the file are skipped", await importTransactions(ALICE, aliceMain, rows), { imported: 2, skipped: 1 });
  check("re-importing the same file adds nothing", await importTransactions(ALICE, aliceMain, rows), { imported: 0, skipped: 3 });
  await importTransactions(BOB, aliceMain, rows.slice(2));
  check("import into someone else's portfolio lands in your own",
    (await listTransactions(BOB)).filter((t) => t.symbol === "LUCK").map((t) => t.portfolioId), [bobDefault]);

  console.log("\n[7] Settings");
  await setUserSetting(ALICE, "zakat", { otherAssets: 5000 });
  check("alice reads her setting", (await getUserSetting(ALICE, "zakat", { otherAssets: 0 })).otherAssets, 5000);
  check("bob gets the default", (await getUserSetting(BOB, "zakat", { otherAssets: 0 })).otherAssets, 0);
  check("logged out gets the default", (await getUserSetting(null, "zakat", { otherAssets: 0 })).otherAssets, 0);

  console.log("\n[8] Push notification devices");
  const sub = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } });
  check("valid subscription accepted", isValidSubscription(sub("x")), true);
  check("http endpoint refused", isValidSubscription({ ...sub("x"), endpoint: "http://evil.example/x" }), false);
  check("non-URL endpoint refused", isValidSubscription({ ...sub("x"), endpoint: "javascript:alert(1)" }), false);
  check("missing keys refused", isValidSubscription({ endpoint: sub("x").endpoint }), false);

  await saveSubscription(ALICE, sub("alice-phone"), "Chrome on Android");
  await saveSubscription(BOB, sub("bob-laptop"), "Edge on Windows");
  check("alice sees only her device", (await listDevices(ALICE)).map((d) => d.device), ["Chrome on Android"]);
  await removeSubscription(BOB, sub("alice-phone").endpoint);
  check("bob can't remove alice's device", (await listDevices(ALICE)).length, 1);
  // Same browser, now logged in as bob: the endpoint moves to bob.
  await saveSubscription(BOB, sub("alice-phone"), "Chrome on Android");
  check("a browser belongs to whoever subscribed last", [(await listDevices(ALICE)).length, (await listDevices(BOB)).length], [0, 2]);
  await saveSubscription(ALICE, sub("alice-tablet"), "Safari on iPhone/iPad");

  console.log("\n[9] Export and delete");
  const aliceExport = await exportUserData(ALICE);
  check("export has only alice's trades", aliceExport.transactions.every((t) => t.userId === ALICE), true);
  check("export includes her portfolio", aliceExport.portfolios.length, 1);
  check("export includes her alert", aliceExport.alerts.length, 1);
  const bobBefore = (await listTransactions(BOB)).length;
  await deleteUserData(ALICE);
  const gone = await exportUserData(ALICE);
  check("alice's data is gone",
    [gone.transactions.length, gone.portfolios.length, gone.alerts.length, gone.alertEvents.length, gone.customScreens.length, Object.keys(gone.settings).length],
    [0, 0, 0, 0, 0, 0]);
  check("bob's data is untouched", (await listTransactions(BOB)).length, bobBefore);
  check("alice's devices are gone", (await listDevices(ALICE)).length, 0);
  check("bob's devices are untouched", (await listDevices(BOB)).length, 2);
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
