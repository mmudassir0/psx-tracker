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
| **Portfolio** | Several named portfolios per account (or all combined), holdings with weighted-average cost, unrealised/realised P&L, dividend income, **your weight vs index weight**, value over time against the same money in KMI30, a dividend recorder, and CSV import from your broker |
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
| **Account** | Change password, connect Google, Telegram / email alerts, download all your data, delete your account |
| **Admin** | Every account: reset a forgotten password, disable an account |
| **Privacy** | What is stored, who can see it, and how to remove it |

Every page shows a banner when the newest prices are two or more trading
sessions old, and price charts shade any stretch with no data. New accounts
get a short "Get started" checklist on the dashboard.

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

## Accounts

Anyone can sign up (`/signup`) with an email and password, or with Google if
it is configured. Each account has its own portfolio, transactions, watchlist,
alerts, custom screens and zakat settings; nobody can see anyone else's.
Market data is shared and public. Visitors who aren't logged in see the
market pages with no holdings.

Built on [Better Auth](https://better-auth.com) (`src/lib/auth.ts`):

- Passwords are hashed (scrypt), never stored readable. Minimum 10 characters.
- Sessions last 30 days, in an HTTP-only cookie backed by the `session` table.
- Login, sign-up and password changes are rate limited per IP (5 a minute for
  login; 5 an hour for sign-up), counted in the database so the limit holds
  across serverless instances.
- Emails are **not verified** at sign-up. Treat them as usernames. For the
  same reason a Google login is never merged into an existing email account
  automatically; a logged-in user can connect Google from their Account page.
  An address is only verified (by emailed link) when someone turns on email
  alerts, so the site never mails an address its owner didn't confirm.
- Sign-up can require a Cloudflare Turnstile check (bot protection) once its
  keys are set.
- Anyone can download all their data (CSV of trades, or everything as JSON)
  and delete their account from `/account`. Deletion removes every personal
  row; admins can't delete themselves, so the site always keeps one.
- Every personal query takes the owner's id and filters by it; pages and
  actions get that id from the session. `npm run test:accounts` checks that
  one user can't read or change another's data, even by guessing ids.

### Environment variables

| Variable | Needed | Value |
|---|---|---|
| `AUTH_SECRET` | Yes | Long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Changing it logs everyone out. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google login | From a Google Cloud OAuth client (below). Without them the Google button is hidden. |
| `BETTER_AUTH_URL` | No | Public URL of the site. On Vercel the production domain is used automatically. |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | For bot protection | Cloudflare Turnstile keys. Without them sign-up has no bot check. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | For Telegram alerts | Bot from @BotFather; the webhook secret is any long random string. See below. |
| `RESEND_API_KEY`, `EMAIL_FROM` | For email alerts | Resend key and a sender on a domain verified in Resend. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | For browser notifications | Web Push key pair (see Alert notifications); subject is your site URL. |
| `SITE_URL` | No | Public URL; adds a link to alert messages and is the default for `telegram:setup`. |
| `BACKUP_PASSPHRASE` | For backups | 16+ characters. Encrypts backups; keep a copy outside the repo or backups can't be opened. |

Variables used by the daily jobs (ingest alerts, backups) must also be set as
GitHub Actions secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`BACKUP_PASSPHRASE`, and the VAPID / Telegram / Resend ones if you use them.

### First-time setup on an existing database

```bash
npm run migrate
```

Brings an older database up to the current schema: account tables, an owner
on every personal table, portfolios (existing trades go into a "Main"
portfolio), per-user settings and link codes. Safe to run again; it only adds
what is missing. Run it **before** deploying code that needs the new schema.
Then sign up on the site and run:

```bash
npm run make-admin -- you@example.com
```

That account becomes the admin and receives all data from before accounts
existed. It is a command rather than "first sign-up wins" because sign-up is
open: a stranger could otherwise register first and take both.

### Admin

`/admin` (admins only) lists every account. From there you can set a
temporary password for someone who forgot theirs (they are logged out
everywhere and should change it on `/account`), or disable an account.

### Google login

1. Google Cloud Console → APIs & Services → Credentials → Create credentials →
   OAuth client ID → Web application.
2. Authorised redirect URI: `https://<your-domain>/api/auth/callback/google`
   (and `http://localhost:3000/api/auth/callback/google` for local use).
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Under OAuth consent screen → Audience, **Publish app**, or only listed test
   users can log in.

## Portfolios

Each account can have up to 20 named portfolios ("Long-term", "Trading", a
family member's). The Portfolio page switches between them or shows all
combined; trades can be moved between them. A portfolio can only be deleted
when empty, and the last one never, so a misclick can't remove trades.

Tax (CGT) and zakat always combine every portfolio, since both are per person.

**Value over time** replays the ledger over daily closes: market value, cost
basis, and the same money in KMI30 (each purchase buys index units on its
date, each sale withdraws its proceeds), so timing is compared fairly. Price
only; dividends are not added to the value line.

**Dividends**: PSX no longer publishes payouts, so dividends are recorded on
the Portfolio page. Leave shares blank to use what the portfolio held on that
date; tax defaults to 15% (filer), with 30% (non-filer), none or an exact
amount as options.

**CSV import** (`/portfolio/import`): upload or paste a broker export. Columns
are guessed from the header and can be changed; dates in day-first,
month-first, ISO or `05-Oct-2026` form; `B`/`S`/`Purchase`/`Sale` and
similar; thousands separators; a negative quantity means a sale when there is
no buy/sell column. Rows are previewed with the reason any can't be read, and
re-parsed on the server on import. Rows already recorded are skipped, so the
same file can be imported twice safely. Up to 5,000 rows per file.

## Alert notifications

Alerts fire during the daily ingest. Each user chooses on `/account` where
they're delivered; each channel stays hidden until its variables are set.

**Browser notifications** (recommended; work where Telegram is blocked) go
through the browser maker's push service (Google, Apple, Mozilla). Users press
**Turn on notifications** on `/account`, once per device. On iPhone/iPad the
site must first be added to the home screen (Share → Add to Home Screen); the
site ships a web app manifest and icons for this. Needs `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (your site URL); generate a key pair
with `node -e "console.log(require('web-push').generateVAPIDKeys())"`. Changing
the keys silently stops every existing subscription. Devices that uninstall or
expire are removed automatically on the next send.

**Telegram**

1. Create a bot with @BotFather; set `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_BOT_USERNAME` (without @), plus a random `TELEGRAM_WEBHOOK_SECRET`.
2. After deploying, point the bot at the site once: press **Set up Telegram
   webhook** on `/admin` (runs from the server, so it works even where your
   own network blocks `api.telegram.org`), or run:

   ```bash
   npm run telegram:setup -- https://your-site.example
   ```

3. Users press **Connect Telegram**, open the one-time link (valid 15
   minutes) and press Start. The bot's webhook (`/api/telegram`) only accepts
   requests carrying the secret. `/stop` in the chat turns alerts off.

**Email** uses Resend. Alerts only go to addresses confirmed through an
emailed link. Without a domain verified in Resend, Resend only delivers to
your own address.

## Backups

`.github/workflows/backup.yml` runs nightly (03:00 PKT) and on demand. It
saves accounts, everyone's personal data and all market data, including the
price history PSX no longer serves, so it can't be re-fetched. Sessions and
other short-lived tokens are left out.

Backups are gzipped and encrypted (AES-256-GCM, key from `BACKUP_PASSPHRASE`
via scrypt) **before** upload, because artifacts of a public repository can be
downloaded by any GitHub user. They are kept 30 days.

```bash
npm run backup
```

```bash
npm run backup:decrypt -- backups/psx-backup-2026-10-06.enc
```

The first writes `backups/psx-backup-<date>.enc` from the current database;
the second turns a downloaded backup back into JSON (every table as an array
of rows). The JSON contains everyone's data and password hashes: keep it
private and delete it after use. `backups/` is git-ignored.

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
| `npm test` | Portfolio math, recomposition, backtest, zakat, parsers, account isolation, CSV import, history, backup encryption, links |
| `npm run migrate` | Bring an existing database up to the current schema |
| `npm run make-admin -- <email>` | Make an account the admin and give it pre-account data |
| `npm run seed:demo -- <email>` | Add demo transactions to an account (`seed:clear` removes them) |
| `npm run telegram:setup -- <url>` | Point the Telegram bot's webhook at the site |
| `npm run backup` | Write an encrypted backup to `backups/` |
| `npm run backup:decrypt -- <file>` | Open an encrypted backup as JSON |
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

**Notifications never fail the ingest.** Each user's alerts go out by
Telegram or email (see Alert notifications); a delivery failure is logged and
the run carries on. An ingest run by hand on a Mac also shows a native banner
via `osascript`, which is a silent no-op anywhere else.

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
  db/schema.ts          Tables: market data, accounts, ledger, portfolios, alerts
  db/index.ts           Turso when TURSO_DATABASE_URL is set, else local SQLite
  lib/
    psx/client.ts       HTTP with cache, retry, bounded concurrency
    psx/parse.ts        HTML parsers for each PSX page
    psx/ingest.ts       The ingest pass + recomposition diffing
    psx/indices.ts      Index catalogue: names, Shariah flags, ordering
    market.ts           Constituent views, index weights, history
    auth.ts             Accounts (Better Auth): sessions, Google, admin, bot check
    portfolio.ts        Weighted-average cost engine, per user and portfolio
    portfolios.ts       Named portfolios: create, rename, delete-when-empty
    portfolio-history.ts  Daily value replay and the KMI30 comparison
    csv-import.ts       Broker CSV parsing and column guessing
    account-data.ts     Export and deletion of one user's data
    user-notify.ts      Telegram and email alert delivery
    backup-crypto.ts    Backup encryption
    backtest.ts         Simulation + rebalance planner
    dividends.ts        Yield, payout history, book closures
    financials.ts       Annual financials and ratios
    liquidity.ts        Traded value tiers and exit estimates
    zakat.ts            Zakat arithmetic (parameters, never opinions)
    alerts.ts           Rule evaluation
    recomposition.ts    Membership history
  app/                  Dashboard, indices, index/[code], screener,
                        symbol/[symbol], portfolio (+ import), strategy,
                        zakat, recomposition, calendar, alerts, health,
                        login, signup, account, admin, privacy
  app/api/              auth, cgt.csv, export, telegram webhook
  proxy.ts              Redirects logged-out visitors from personal pages
  scripts/              ingest, migrate, make-admin, backup, telegram setup,
                        parser smoke test, tests and their runner
.github/workflows/      Daily ingest, nightly encrypted backup
```

Charts follow a validated colour method: the gain/loss scale is **blue↔red**,
not green/red, because green/red is the classic red-green colourblindness trap.
Every bar carries its own value label, so colour is never the only encoding.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · SQLite / Turso
via Drizzle · Better Auth · Recharts · Cheerio · Vercel · GitHub Actions.
