# KMI30 Tracker

A personal dashboard for the Pakistan Stock Exchange, built around **KMI30** —
the Shariah-screened index of 30 companies — but covering **all 17 PSX indices**
and every company in them. Local-first: SQLite on disk, no accounts, no cloud,
no third-party data subscription.

It reports market data and your own numbers. It does not give investment advice.

## What it does

| Page | What you get |
|---|---|
| **Dashboard** | KMI30 level, advancers/decliners, day-change bars, sector weights, constituent table |
| **Indices** | All 17 PSX indices with level, change and member count |
| **Index** | Any index's level chart, constituents, weights, sector mix, day-change bars and membership changes |
| **Screens** | 14 saved screens run on every ingest across the whole market, with a daily diff of what newly entered each one |
| **Movers & breadth** | Market-wide gainers, losers, most active by traded value, plus advance/decline breadth |
| **Screener** | Sort/filter on P/E, YTD, 1Y, weight, market cap, volume, distance off 52-week high |
| **Symbol** | 5 years of price history, key stats, dividend yield, declared payouts with book-closure dates, 4 years of financials and ratios, announcement feed, your position |
| **Portfolio** | Holdings with weighted-average cost, unrealised/realised P&L, dividend income, **your weight vs index weight** per stock and per sector |
| **Strategy** | Backtest an index basket against the index itself, and get the exact trades to move your portfolio onto those weights |
| **Risk** | Correlation matrix, beta vs index, and concentration — whether your positions are actually diversified |
| **Liquidity** | Median daily traded value per name, and how many sessions a position would take to exit |
| **Sectors** | Sector rollups and a page per sector |
| **Watchlist** | Follow names you don't own, with drift since you added them |
| **CGT** | Realised gains by Pakistani tax year, FIFO and weighted average side by side, CSV export |
| **Zakat** | Zakat on your holdings, with every scholarly judgement call left as a parameter you set |
| **Recomposition** | Detects when a stock is **dropped from an index** — for KMI30 that means it stopped meeting the Shariah screen |
| **Calendar** | Dividends, bonus, rights, results, board meetings and AGMs — filterable by index, type, or just your holdings |
| **Alerts** | Price / P/E / 52-week-proximity thresholds, plus membership-change rules |
| **Health** | What the database actually holds and where PSX coverage is thin |

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
npm install
```

```bash
npm run setup
```

`setup` creates the SQLite schema and runs the first ingest with `--backfill`,
pulling roughly five years of daily history for every constituent (~37k rows,
about 20 seconds).

```bash
npm run dev
```

Then open http://localhost:3000.

## Daily use

There is a **Refresh data** button on the dashboard and the health page with
three scopes — Quick (~5s), KMI30 (~30s) and Full (~4min). A full run takes
minutes, so it starts in the background and the button polls for progress
rather than blocking the request.

The same guard covers all three entry points: the button, the CLI and the
scheduled run all record into `ingest_runs`, so the UI shows a run started by
launchd and refuses to start a second one on top of it. A run stuck in
`running` for over 30 minutes is treated as dead so a crash can't lock the
button permanently.

Equivalently, from a terminal:

```bash
npm run ingest
```

It refreshes quotes, index levels, fundamentals and announcements, snapshots
index membership, and evaluates your alerts.

### Scheduling (macOS)

Already installed as a **LaunchAgent**, running 16:00 local on weekdays:

```
~/Library/LaunchAgents/com.mudassirabbas.kmi30-ingest.plist
```

launchd rather than cron for two reasons: editing the crontab on modern macOS
needs Full Disk Access and hangs on a permission prompt without it, and launchd
re-fires a missed run when the Mac wakes, so a closed lid at 16:00 doesn't cost
you a day of membership history.

Two things the plist pins deliberately:

- **PATH** — node is managed by fnm, whose `which node` path lives under
  `fnm_multishells/` and is per-shell and ephemeral. The plist uses the stable
  `node-versions/v22.14.0/installation/bin` path instead. If you remove that
  node version via fnm, update the plist.
- **Local time** — launchd schedules in the machine's timezone. This Mac is on
  `Asia/Karachi`, so 16:00 local is 16:00 PKT, safely after the 15:30 close. If
  the Mac moves timezone, change `Hour` to whatever 16:00 PKT becomes.

Useful commands:

```bash
launchctl print gui/$UID/com.mudassirabbas.kmi30-ingest
```

```bash
launchctl kickstart -w gui/$UID/com.mudassirabbas.kmi30-ingest
```

```bash
launchctl bootout gui/$UID/com.mudassirabbas.kmi30-ingest
```

Output goes to `data/ingest.log`.

### Other commands

| Command | Purpose |
|---|---|
| `npm run ingest -- --backfill` | Re-pull full EOD history |
| `npm run ingest -- --no-fundamentals` | Quotes + membership only (~5s) |
| `npm run ingest -- --indices=KMI30` | Fundamentals for one index only |
| `npm run ingest -- --recheck-pages` | Retry symbols marked as having no company page |
| `npm run verify` | Smoke-test the PSX parsers against live pages |
| `npm run test` | Portfolio math, recomposition, backtest, zakat, payouts, links |
| `npm run db:studio` | Browse the database |

### Ingest cost

Index levels, quotes and membership for **all 17 indices** come from two pages,
so they are effectively free. Fundamentals and announcements need one request
per company, which is what makes a run long:

| Scope | Requests | Time |
|---|---|---|
| `--no-fundamentals` | 2 | ~5s |
| `--indices=KMI30` | ~32 | ~15s |
| default (all indexed symbols) | ~400 | ~2min |

## Where the data comes from

There is no official public PSX API, so this reads the public data portal at
`dps.psx.com.pk` — the same pages a browser loads:

| Endpoint | Used for |
|---|---|
| `/indices` | KMI30 level, high/low/change |
| `/market-watch` | All 493 symbols, sector, **index membership**, OHLC, volume |
| `/timeseries/eod/{SYMBOL}` | Daily close/volume/open history (JSON) |
| `/company/{SYMBOL}` | P/E, market cap, shares, free float, 52-week range, announcements, 4-year financials and ratios |
| `POST /company/payouts` | Declared dividend/bonus/rights rates and book-closure dates |

Constituent lists for **every** index are derived from the `market-watch`
membership column, so nothing is hardcoded and they update themselves when PSX
rebalances.

Requests are cached in-process, retried with backoff, and capped at 4
concurrent — please keep it that way. The data is **delayed, not licensed
real-time**. Check the PSX terms of use before doing anything beyond personal
use.

## Things worth knowing

**Session dates.** When the market is closed, `market-watch` still shows the
last completed session. Stamping that with today's date would invent a
duplicate flat day, so outside trading hours the ingest takes the session date
from the EOD timeseries instead. See `resolveSessionDate` in
`src/lib/psx/ingest.ts`.

**No intraday high/low in history.** The EOD feed returns
`[timestamp, close, volume, open]` only. Historical rows therefore have null
high/low; rows captured live from `market-watch` have the full set. The
backfill never overwrites a richer row with a poorer one.

**Index weights are uncapped.** Weights are computed as free-float market cap
(free-float shares × price) as a share of the index total. PSX applies a
per-scrip cap to the live index that this does not model, so the largest names
read slightly high. Weights sum to exactly 100%.

**Payout rates come from a POST endpoint, not the page.** The `#payouts`
section of a company page is empty in the server-rendered HTML — it is filled
in by JavaScript from `POST /company/payouts` (body: `symbol=XXX`). Scraping
only the page HTML makes dividends look absent when PSX plainly publishes
them. That fragment carries the declared rate *and* the book-closure window,
which is the date that actually decides entitlement.

Rates are a percent of face value; PKR 10 is the PSX standard, so 145% is
PKR 14.50 per share. The raw percent is always stored alongside the converted
figure, because a company on a different face value would be misconverted.

The Details cell is messy in the wild — `145%(ii) (D)`, `50%F) (D)`,
`40%(ii (D)`, `DIVIDEND =350% (F)`, and rows holding two payouts at once — so
the parser extracts and sums every percentage rather than matching one rigid
shape. `npm run test:payouts` covers each of those shapes.

**Recomposition history starts when you do.** Membership changes are found by
diffing daily snapshots. PSX does not publish a membership archive on this
portal, so changes from before your first ingest cannot be reconstructed. Run
the ingest daily and the history builds itself.

**Membership snapshots are guarded.** In the first minutes of a session,
`market-watch` only lists symbols that have already traded — a run at 09:33 can
see 2 of 30 KMI30 constituents, or 380 of 437 in ALLSHR. Recording that would
make the tracker report a wave of drops. Two things prevent it: inserts only
ever *add*, so a later run the same day tops a partial snapshot back up; and a
completeness guard compares each index against its own previous snapshot, so a
partial listing can never shrink an established index. A first-ever snapshot is
allowed to bootstrap. Either way the daily run belongs **after** the 15:30 PKT
close.

**Financial line items differ by sector.** Banks report "Mark-up Earned" and
"Total Income"; manufacturers report "Sales" and "Gross Profit Margin (%)".
Financials are therefore stored long (symbol, year, section, line item, value)
rather than in fixed columns. Units are mixed within one table — monetary rows
are PKR thousands, EPS is PKR per share, ratio rows are percents or bare
multiples — so the unit is inferred per line item and stored with the value.

**Some symbols have no PSX company page.** About 40 counters (ex-dividend `XD`,
ex-bonus `XB`, non-compliant `NC` and similar segment listings) return HTTP 500
for `/company/{SYMBOL}`. Those are recorded once and skipped on later runs
rather than being re-requested with retries every day. They still get quotes and
index membership — just no P/E, free float or announcements, so they carry no
index weight. `--recheck-pages` clears the marks if PSX starts serving them.

**Cost basis is weighted-average**, the usual retail convention: buys and rights
add to the average, bonus shares dilute it at zero cost, sells realise P&L
against it without changing it, and dividends are income only. All of this is
covered by `npm run test`.

**The backtest has survivorship bias, by construction.** Its universe is an
index's constituents *today*. Membership snapshots only start at your first
ingest, so companies dropped along the way are missing and today's weights get
applied retroactively. The index line it is compared against has no such bias,
so the two are not strictly comparable. Both lines are also **price return
only** — dividends are excluded, because PSX announcement titles often omit the
rate. The page states both caveats above the chart rather than burying them.

**CGT is a working, not a return.** Pakistani CGT depends on holding period,
acquisition date and filer status, none of which this models — it computes
disposals and cost basis, not tax owed. Because tax rules may require FIFO
while the portfolio pages use weighted average, both are shown side by side
and neither is presented as the right one. The weighted-average total
reconciles exactly with the portfolio page's realised P&L.

**Liquidity is a volume proxy.** PSX publishes no order-book depth here, so the
exit estimate is built from traded value and assumes you are 20% of a session.
It does not model spread or your own market impact — treat it as an order of
magnitude.

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
  lib/
    psx/client.ts       HTTP with cache, retry, bounded concurrency
    psx/parse.ts        HTML/JSON parsers for each PSX page
    psx/ingest.ts       The ingest pass + recomposition diffing
    psx/indices.ts      Index catalogue: names, Shariah flags, ordering
    market.ts           Constituent views, index weights, history
    portfolio.ts        Weighted-average cost engine
    backtest.ts         Simulation + rebalance planner
    dividends.ts        Yield, payout history, book closures
    financials.ts       Annual financials and ratios
    zakat.ts            Zakat arithmetic (parameters, never opinions)
    alerts.ts           Rule evaluation
    recomposition.ts    Membership history
  app/                  Dashboard, indices, index/[code], screener,
                        symbol/[symbol], portfolio, strategy, zakat,
                        recomposition, calendar, alerts, health
  scripts/              ingest, parser smoke test, math tests
```

Charts follow a validated colour method: the gain/loss scale is **blue↔red**,
not green/red, because green/red is the classic red-green colourblindness trap.
Every bar carries its own value label, so colour is never the only encoding.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · SQLite via
Drizzle · Recharts · Cheerio.
