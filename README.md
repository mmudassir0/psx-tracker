# KMI30 Tracker

A personal dashboard for the Pakistan Stock Exchange, built around **KMI30** —
the Shariah-screened index of 30 companies — but covering **all 17 PSX indices**
and every company in them. No third-party data subscription: everything comes
from the public PSX data portal.

It runs on Vercel with a Turso (hosted SQLite) database, updated every weekday
by a GitHub Actions job. It also runs locally against a plain SQLite file.

It reports market data and your own numbers. It does not give investment advice.

## What it does

| Page | What you get |
|---|---|
| **Dashboard** | KMI30 level, advancers/decliners, day-change bars, sector weights, constituent table |
| **Indices** | All 17 PSX indices with level, change and member count |
| **Index** | Any index's level chart, constituents, weights, sector mix, day-change bars and membership changes |
| **Screens** | 14 saved screens run on every ingest across the whole market, with a daily diff of what newly entered each one |
| **Movers & breadth** | Market-wide gainers, losers, most traded (30-day average value), plus advance/decline breadth |
| **Screener** | Sort/filter on P/E, YTD, 1Y, weight, market cap, 30-day average volume, distance off 52-week high |
| **Symbol** | Price history since 2021, key stats, dividend yield, past payouts with book-closure dates, 4 years of financials and ratios, announcement feed, your position |
| **Portfolio** | Holdings with weighted-average cost, unrealised/realised P&L, dividend income, **your weight vs index weight** per stock and per sector |
| **Strategy** | Backtest an index basket against the index itself, and get the exact trades to move your portfolio onto those weights |
| **Risk** | Correlation matrix, beta vs index, and concentration — whether your positions are actually diversified |
| **Liquidity** | 30-day average traded value per name, and how many sessions a position would take to exit |
| **Sectors** | Sector rollups and a page per sector |
| **Watchlist** | Follow names you don't own, with drift since you added them |
| **CGT** | Realised gains by Pakistani tax year, FIFO and weighted average side by side, CSV export |
| **Zakat** | Zakat on your holdings, with every scholarly judgement call left as a parameter you set |
| **Recomposition** | Detects when a stock is **dropped from an index** — for KMI30 that means it stopped meeting the Shariah screen |
| **Calendar** | Dividends, bonus, rights, results, board meetings and AGMs — filterable by index, type, or just your holdings |
| **Alerts** | Price / P/E / 52-week-proximity thresholds, plus membership-change rules |
| **Health** | What the database holds, where PSX coverage is thin, and whether the daily job is succeeding |

Every page shows a banner when the newest prices are two or more trading
sessions old, and price charts shade any stretch with no data.

### Indices covered

`KMI30` · `KMIALLSHR` · `KSE100` · `KSE30` · `ALLSHR` · `PSXDIV20` · `BKTI` ·
`OGTI` · `KSE100PR` · `ACI` · `JSGBKTI` · `JSMFI` · `MII30` · `MZNPI` ·
`NBPPGI` · `NITPGI` · `UPP9`

PSX publishes only the index *code*, never a display name. Names are filled in
where they are unambiguous; sponsor-branded indices show their code rather than
a guessed name. The Shariah badge marks indices that are Shariah-screened by
construction (KMI30, KMIALLSHR) — its absence is not a claim either way.

## Setup

```bash
npm install --ignore-scripts
```

`--ignore-scripts` skips compiling `better-sqlite3` from source, which needs
Python and a C++ toolchain. Its package already ships prebuilt binaries for
Windows, macOS and Linux.

### Against Turso (production data)

Create `.env` in the project root:

```
TURSO_DATABASE_URL=libsql://<your-db>.turso.io
TURSO_AUTH_TOKEN=<token>
```

`.env*` is git-ignored — keep it that way. With these set, every script and
`npm run dev` read and write the Turso database.

### Local only

Without a `.env`, the app uses `data/kmi30.db`:

```bash
npm run setup
```

`setup` creates the schema and runs one ingest: today's quotes, membership,
fundamentals and announcements. There is no history backfill any more (see
below), so charts start from the first ingest.

```bash
npm run dev
```

Then open http://localhost:3000.

## Daily updates

`.github/workflows/ingest.yml` runs `npm run ingest` at 11:00 UTC (16:00 PKT),
Monday to Friday, against Turso. GitHub often starts scheduled jobs late, so
expect the data between about 4 and 6 PM. It needs two repository secrets:
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Run it on demand from the
**Actions** tab with **Run workflow**.

It runs on GitHub rather than as a Vercel Cron because PSX refuses requests
from Vercel's servers (HTTP 462). For the same reason the **Refresh data**
button only works when the app runs locally; on Vercel it explains that
updates are automatic.

Every run is recorded in `ingest_runs` with its trigger (`schedule`, `cli` or
`ui`), and the Health page lists them in PKT. A run still marked `running`
after an hour is shown as interrupted.

### Commands

| Command | Purpose |
|---|---|
| `npm run ingest` | Quotes, membership, fundamentals and announcements |
| `npm run ingest -- --no-fundamentals` | Quotes + membership only (~1 min on Turso) |
| `npm run ingest -- --indices=KMI30` | Fundamentals for one index only |
| `npm run ingest -- --recheck-pages` | Retry symbols marked as having no company page |
| `npm run verify` | Smoke-test the PSX parsers against live pages |
| `npm test` | Portfolio math, recomposition, backtest, zakat, parsers, links |
| `npm run db:studio` | Browse the database |

`npm test` always runs against scratch SQLite files under `.scratch/`, even
when `.env` points at Turso: `src/scripts/run-test.ts` blanks the Turso
variables before the database client loads, and `test-guard.ts` refuses to run
a destructive test if Turso is still configured.

### Ingest cost

Index levels, quotes and membership for **all 17 indices** come from two pages.
Fundamentals and announcements need one request per company, which is what
makes a run long:

| Scope | Requests | Time (Turso) |
|---|---|---|
| `--no-fundamentals` | 3 | ~1 min |
| `--indices=KMI30` | ~33 | ~1–2 min |
| default (all indexed symbols) | ~460 | ~6–8 min |

Database writes are batched 100 rows at a time; one round-trip per row took
over ten minutes for the quotes alone against Turso.

## Where the data comes from

There is no official public PSX API, so this reads the public data portal at
`dps.psx.com.pk` — the same pages a browser loads:

| Endpoint | Used for |
|---|---|
| `/indices` | Index levels, high/low/change |
| `/screener` | All ~750 symbols: sector, **index membership**, price, change %, 30-day average volume |
| `/` | The "As of" stamp that dates the session outside market hours |
| `/company/{SYMBOL}` | P/E, market cap, shares, free float, 52-week range, announcements, 4-year financials and ratios |

Constituent lists for **every** index are derived from the screener's
membership column, so nothing is hardcoded and they update themselves when PSX
rebalances.

Requests are cached in-process, retried with backoff (much longer after an
HTTP 429), and capped at 4 concurrent — please keep it that way. The data is
**delayed, not licensed real-time**. Check the PSX terms of use before doing
anything beyond personal use.

### What PSX withdrew in September 2026

PSX rebuilt the portal around 23 Sep 2026. These are gone or blocked, and the
code that used them has been removed:

- **`/market-watch`** — replaced by `/screener`, which has no open/high/low and
  no daily volume. Daily volume, OHLC and LDCP are therefore not stored for new
  sessions; LDCP is back-derived from price and change %.
- **`/timeseries/eod/{SYMBOL}`** — the daily history feed. Price history
  before 23 Sep 2026 came from it and is still in the database; nothing new can
  be backfilled. Sessions 23 Sep – 1 Oct 2026 are missing and shaded on charts.
- **`POST /company/payouts`** — declared dividend rates and book-closure dates.
  It now returns HTTP 403 (it needs a per-session token). Payouts recorded
  before then remain; new ones are not captured.

Getting around the new tokens would mean defeating PSX's bot protection, so
the app doesn't try.

## Things worth knowing

**Session dates.** When the market is closed, PSX still shows the last
completed session. Stamping that with today's date would invent a duplicate
flat day, so outside trading hours the ingest reads the session date from the
"As of" stamp on the home page, and falls back to the last weekday. See
`resolveSessionDate` in `src/lib/psx/ingest.ts`.

**Volume is a 30-day average.** With no daily volume, everything
volume-related — liquidity tiers, exit estimates, most traded, the screener
column, the "traded value" screen metric — uses PSX's 30-session average. A
mean is pulled up by block trades, so liquidity reads slightly optimistic.

**Stale-data banner.** It appears once **two or more** weekday sessions are
missing, so a single PSX holiday doesn't trigger it.

**Index weights are uncapped.** Weights are computed as free-float market cap
(free-float shares × price) as a share of the index total. PSX applies a
per-scrip cap to the live index that this does not model, so the largest names
read slightly high. Weights sum to exactly 100%.

**Recomposition history starts when you do.** Membership changes are found by
diffing daily snapshots. PSX does not publish a membership archive on this
portal, so changes from before your first ingest cannot be reconstructed. Run
the ingest daily and the history builds itself.

**Membership snapshots are guarded.** Early in a session PSX may list only
symbols that have already traded. Recording that would make the tracker report
a wave of drops. Two things prevent it: inserts only ever *add*, so a later run
the same day tops a partial snapshot back up; and a completeness guard compares
each index against its own previous snapshot, so a partial listing can never
shrink an established index. A first-ever snapshot is allowed to bootstrap.
Either way the daily run belongs **after** the 15:30 PKT close.

**Financial line items differ by sector.** Banks report "Mark-up Earned" and
"Total Income"; manufacturers report "Sales" and "Gross Profit Margin (%)".
Financials are therefore stored long (symbol, year, section, line item, value)
rather than in fixed columns. Units are mixed within one table — monetary rows
are PKR thousands, EPS is PKR per share, ratio rows are percents or bare
multiples — so the unit is inferred per line item and stored with the value.

**Some symbols have no PSX company page.** About 60 counters (ex-dividend `XD`,
ex-bonus `XB`, non-compliant `NC` and similar segment listings) return HTTP 500
for `/company/{SYMBOL}`. Those are recorded once and skipped on later runs
rather than being re-requested with retries every day. They still get quotes and
index membership — just no P/E, free float or announcements, so they carry no
index weight. `--recheck-pages` clears the marks if PSX starts serving them.

**Cost basis is weighted-average**, the usual retail convention: buys and rights
add to the average, bonus shares dilute it at zero cost, sells realise P&L
against it without changing it, and dividends are income only. All of this is
covered by `npm test`.

**The backtest has survivorship bias, by construction.** Its universe is an
index's constituents *today*. Membership snapshots only start at your first
ingest, so companies dropped along the way are missing and today's weights get
applied retroactively. The index line it is compared against has no such bias,
so the two are not strictly comparable. Both lines are also **price return
only** — dividends are excluded. CAGR uses the calendar span of the test, so
gaps in the history don't inflate it. The page states the caveats above the
chart rather than burying them.

**CGT is a working, not a return.** Pakistani CGT depends on holding period,
acquisition date and filer status, none of which this models — it computes
disposals and cost basis, not tax owed. Because tax rules may require FIFO
while the portfolio pages use weighted average, both are shown side by side
and neither is presented as the right one. The weighted-average total
reconciles exactly with the portfolio page's realised P&L.

**Liquidity is a volume proxy.** PSX publishes no order-book depth here, so the
exit estimate is built from average traded value and assumes you are 20% of a
session. It does not model spread or your own market impact — treat it as an
order of magnitude.

**Correlations use shared sessions only.** A pair is measured on days when both
names traded; anything under 30 overlapping sessions is marked with an asterisk
because the number looks more precise than it is.

**Notifications are macOS-only.** Alerts fire a native banner via `osascript`
during an ingest. On any other platform it is a silent no-op, and a
notification failure can never fail the ingest.

**The zakat calculator takes no scholarly position.** Scholars differ on how
zakat applies to shares, particularly whether full market value is assessed or
only the company's own zakatable assets. So the nisab standard, the metal price,
the lunar/solar rate and the zakatable share of each holding are all inputs you
set — the zakatable share simply defaults to 100%, meaning "no adjustment
applied". The current gold and silver prices are never assumed or fetched,
because a stale bullion rate would silently produce a wrong answer. The page
shows the full arithmetic so you can check it by hand, and it is not a fatwa.

## Layout

```
src/
  db/schema.ts          Tables: quotes, constituents, stats, ledger, alerts
  db/index.ts           Turso when TURSO_DATABASE_URL is set, else local SQLite
  lib/
    psx/client.ts       HTTP with cache, retry, bounded concurrency
    psx/parse.ts        HTML parsers for each PSX page
    psx/ingest.ts       The ingest pass + recomposition diffing
    psx/indices.ts      Index catalogue: names, Shariah flags, ordering
    market.ts           Constituent views, index weights, history
    portfolio.ts        Weighted-average cost engine
    backtest.ts         Simulation + rebalance planner
    dividends.ts        Yield, payout history, book closures
    financials.ts       Annual financials and ratios
    liquidity.ts        Traded value tiers and exit estimates
    zakat.ts            Zakat arithmetic (parameters, never opinions)
    alerts.ts           Rule evaluation
    recomposition.ts    Membership history
  app/                  Dashboard, indices, index/[code], screener,
                        symbol/[symbol], portfolio, strategy, zakat,
                        recomposition, calendar, alerts, health
  scripts/              ingest, parser smoke test, tests and their runner
.github/workflows/      Daily ingest
```

Charts follow a validated colour method: the gain/loss scale is **blue↔red**,
not green/red, because green/red is the classic red-green colourblindness trap.
Every bar carries its own value label, so colour is never the only encoding.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · SQLite / Turso
via Drizzle · Recharts · Cheerio · Vercel · GitHub Actions.
