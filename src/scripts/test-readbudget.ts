/**
 * Read-budget check: no page loader may scan a large table.
 *
 * Turso bills (and on the free plan, blocks) by rows read. A query that walks
 * a whole table looks fine on a small database and then eats the monthly
 * quota in days, which is how production went down in October 2026. This
 * builds the real schema in a scratch database, runs the data loaders behind
 * the main pages, and fails if any statement's plan is a full SCAN of a table
 * that grows every session (SEARCH via an index is fine).
 *
 * Loaders that knowingly scan (the /health coverage counts) are not run here;
 * they are cached per ingest instead (see src/lib/market-cache.ts).
 */
import Database from "better-sqlite3";
import { db } from "@/db";
import { assertScratchDatabase } from "./test-guard";
import { resetToAppSchema } from "./test-schema";

/** Tables that gain rows every session; a full scan of these is a bug. */
const GROWING_TABLES = [
  "quotes_daily",
  "company_stats",
  "constituents",
  "index_levels",
  "financials",
  "screen_hits",
  "alert_events",
];

type Logged = { sql: string; params: unknown[]; label: string };
const logged: Logged[] = [];
let label = "";

// Record every statement the loaders prepare and run.
const proto = Database.prototype as unknown as {
  prepare: (this: Database.Database, src: string) => Database.Statement;
};
const prepare = proto.prepare;
proto.prepare = function (src: string) {
  const stmt = prepare.call(this, src) as unknown as Record<string, unknown>;
  for (const m of ["all", "get", "run", "values"]) {
    const fn = stmt[m];
    if (typeof fn !== "function") continue;
    stmt[m] = function (this: unknown, ...args: unknown[]) {
      if (label) logged.push({ sql: src, params: args.flat(), label });
      return (fn as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
  return stmt as unknown as Database.Statement;
};

function seed() {
  const c = db.$client;
  const days: string[] = [];
  for (let d = new Date("2026-01-01T00:00:00Z"); days.length < 120; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() % 6 !== 0) days.push(d.toISOString().slice(0, 10));
  }
  const syms = Array.from({ length: 60 }, (_, i) => `S${String(i).padStart(3, "0")}`);
  const indexes = ["KSE100", "KMI30", "ALLSHR"];
  c.transaction(() => {
    const sym = c.prepare(
      "insert into symbols(symbol,name,sector_code,sector_name,indexes,is_kmi30,no_company_page) values(?,?,?,?,?,?,0)",
    );
    syms.forEach((s, i) => sym.run(s, s, String(i % 5), `Sector ${i % 5}`, indexes.join(","), i % 2));
    const q = c.prepare("insert into quotes_daily(symbol,date,close,ldcp,source) values(?,?,?,?,'eod')");
    const cs = c.prepare(
      "insert into company_stats(symbol,date,pe_ttm,market_cap,free_float_shares,week_52_high,week_52_low) values(?,?,10,1e9,1e6,150,50)",
    );
    const con = c.prepare("insert into constituents(date,index_code,symbol) values(?,?,?)");
    const lvl = c.prepare("insert into index_levels(index_code,date,current,change_pct) values(?,?,1000,0.1)");
    for (const d of days) {
      syms.forEach((s, i) => {
        q.run(s, d, 100 + i, 99 + i);
        cs.run(s, d);
        for (const ix of indexes) con.run(d, ix, s);
      });
      for (const ix of indexes) lvl.run(ix, d);
    }
    const fin = c.prepare(
      "insert into financials(symbol,fiscal_year,section,line_item,value,unit) values(?,?,'ratios',?,1,'percent')",
    );
    for (const s of syms)
      for (const y of ["2023", "2024", "2025"])
        for (const item of ["EPS Growth (%)", "Net Profit Margin (%)", "Sales", "Other"]) fin.run(s, y, item);
    c.prepare(
      "insert into ingest_runs(id,started_at,finished_at,status,trigger) values('r1',1,2,'ok','schedule')",
    ).run();
  })();
  return { quoteDate: days[days.length - 1] };
}

function fullScans(entry: Logged): string[] {
  if (!/^\s*(select|with)/i.test(entry.sql)) return [];
  const params = entry.params.map((p) => (typeof p === "boolean" ? Number(p) : p));
  const plan = db.$client.prepare(`explain query plan ${entry.sql}`).all(...params) as {
    detail: string;
  }[];
  // An index walk that stops at a LIMIT (e.g. "newest date": order by date
  // desc limit 1) reads only that many rows, so it is not a scan.
  const stopsEarly = /\blimit\b/i.test(entry.sql) && !/\bgroup by\b/i.test(entry.sql);
  return plan
    .map((r) => r.detail)
    .filter((d) => GROWING_TABLES.some((t) => new RegExp(`^SCAN ${t}\\b`).test(d)))
    .filter((d) => !(stopsEarly && / USING (COVERING )?INDEX /.test(d)));
}

async function main() {
  console.log(`Using scratch database: ${assertScratchDatabase()}`);
  await resetToAppSchema();
  const { quoteDate } = seed();

  const market = await import("@/lib/market");
  const dash = await import("@/lib/dashboard-data");
  const recomposition = await import("@/lib/recomposition");
  const backtest = await import("@/lib/backtest");
  const financials = await import("@/lib/financials");
  const dividends = await import("@/lib/dividends");

  const loaders: [string, () => Promise<unknown>][] = [
    ["database status", () => market.getDatabaseStatus()],
    ["tracked index codes", () => market.getTrackedIndexCodes()],
    ["constituents", () => market.getConstituents("KSE100")],
    ["all symbol views", () => market.getAllSymbolViews()],
    ["index summaries", () => market.getIndexSummaries()],
    ["index history", () => market.getIndexHistory("KSE100")],
    ["latest index level", () => market.getLatestIndexLevel("KSE100")],
    ["price history", () => market.getPriceHistory("S001")],
    ["symbol view", () => market.getConstituent("S001", "ALLSHR")],
    ["recent closes", () => dash.getRecentCloses(quoteDate)],
    ["breadth history", () => dash.getBreadthHistory(quoteDate)],
    ["recomposition", () => recomposition.getRecompositionHistory("KSE100")],
    ["company financials", () => financials.getCompanyFinancials("S001")],
    ["payouts", () => dividends.getPayouts("S001")],
    ["backtest", () => backtest.runBacktest({ indexCode: "KMI30", startDate: "2026-01-01" })],
  ];

  let failures = 0;
  for (const [name, run] of loaders) {
    label = name;
    const before = logged.length;
    await run();
    label = "";
    const scans = logged.slice(before).flatMap((e) => fullScans(e).map((s) => `${s}\n        in: ${e.sql.replace(/\s+/g, " ").slice(0, 140)}`));
    if (scans.length) failures++;
    console.log(`${scans.length ? "  FAIL" : "  PASS"}  ${name}${scans.length ? `\n      ${scans.join("\n      ")}` : ""}`);
  }

  if (failures) {
    console.log(`\n${failures} loader(s) scan a growing table. Add an index or rewrite the query.`);
    process.exit(1);
  }
  console.log("\nNo full scans of growing tables.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
