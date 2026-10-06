import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * All money values are PKR. All `date` columns are ISO "YYYY-MM-DD" strings in
 * Pakistan Standard Time (PKT, UTC+5) — the PSX trading calendar — so that a
 * trading session always maps to exactly one row regardless of server timezone.
 */

/** One row per listed company we track. */
export const symbols = sqliteTable("symbols", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  sectorCode: text("sector_code"),
  sectorName: text("sector_name"),
  /** Comma-separated index memberships from market-watch, e.g. "KMI30,KSE100". */
  indexes: text("indexes"),
  isKmi30: integer("is_kmi30", { mode: "boolean" }).notNull().default(false),
  /**
   * 30-session average share volume from /screener. PSX stopped publishing
   * daily volume, so this is the only liquidity figure still available.
   */
  avgVolume30d: real("avg_volume_30d"),
  /**
   * PSX serves HTTP 500 for /company/{SYMBOL} on some counters (ex-dividend,
   * non-compliant and similar segment listings). Remembering that avoids
   * re-requesting ~40 dead pages, with retries, on every single run.
   */
  noCompanyPage: integer("no_company_page", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

/**
 * Daily OHLCV. Rows up to Sep 2026 came from PSX's EOD timeseries (close,
 * volume, open). PSX has since withdrawn both that and daily volume, so newer
 * rows from /screener carry only close and LDCP. `source` keeps the legacy
 * "market-watch" label for them.
 */
export const quotesDaily = sqliteTable(
  "quotes_daily",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close").notNull(),
    ldcp: real("ldcp"),
    volume: integer("volume"),
    source: text("source", { enum: ["eod", "market-watch"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.date] }),
    index("quotes_date_idx").on(t.date),
  ],
);

/** Daily close for each PSX index (KMI30, KSE100, KMIALLSHR, ...). */
export const indexLevels = sqliteTable(
  "index_levels",
  {
    indexCode: text("index_code").notNull(),
    date: text("date").notNull(),
    current: real("current").notNull(),
    high: real("high"),
    low: real("low"),
    open: real("open"),
    /** Total traded volume across the index, from the EOD timeseries. */
    volume: integer("volume"),
    change: real("change"),
    changePct: real("change_pct"),
  },
  (t) => [primaryKey({ columns: [t.indexCode, t.date] })],
);

/**
 * Daily snapshot of index membership. Diffing consecutive snapshot dates is
 * what powers the Shariah recomposition tracker — a symbol leaving KMI30
 * means it failed screening (or was replaced on periodic review).
 */
export const constituents = sqliteTable(
  "constituents",
  {
    date: text("date").notNull(),
    indexCode: text("index_code").notNull(),
    symbol: text("symbol").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.indexCode, t.symbol] }),
    index("constituents_index_date_idx").on(t.indexCode, t.date),
  ],
);

/**
 * Point-in-time fundamentals scraped from the company page. Stored per-date so
 * P/E and free-float history is preserved rather than overwritten.
 */
export const companyStats = sqliteTable(
  "company_stats",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    peTtm: real("pe_ttm"),
    /** PKR (already converted from the page's "000's" units). */
    marketCap: real("market_cap"),
    shares: integer("shares"),
    freeFloatShares: integer("free_float_shares"),
    freeFloatPct: real("free_float_pct"),
    week52High: real("week_52_high"),
    week52Low: real("week_52_low"),
    ytdChangePct: real("ytd_change_pct"),
    year1ChangePct: real("year_1_change_pct"),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/** Corporate announcements (results, board meetings, payouts) with PDF links. */
export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    /** Derived bucket: dividend | bonus | rights | result | board_meeting | other */
    category: text("category").notNull().default("other"),
  },
  (t) => [index("announcements_symbol_date_idx").on(t.symbol, t.date)],
);

/**
 * Cash dividends / bonus / rights.
 *
 * Historical rows from PSX's `POST /company/payouts` fragment, which carried
 * the declared rate and book-closure dates. PSX now refuses that endpoint
 * (HTTP 403), so this table is no longer refreshed.
 */
export const payouts = sqliteTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    type: text("type", {
      enum: ["cash_dividend", "bonus", "rights", "other"],
    }).notNull(),
    /** Percent of face value as announced (e.g. 145 => 145%). */
    percent: real("percent"),
    /** PKR per share, percent x PKR 10 face value. */
    perShare: real("per_share"),
    /** Period the payout relates to, e.g. "30/06/2026(HYR)". */
    period: text("period"),
    /** "F" final, or "i"/"ii"/"iii" interim instalment. */
    instalment: text("instalment"),
    bookClosureFrom: text("book_closure_from"),
    bookClosureTo: text("book_closure_to"),
    /** Raw Details cell, so anything unparsed stays inspectable. */
    raw: text("raw"),
    note: text("note"),
  },
  (t) => [
    index("payouts_symbol_date_idx").on(t.symbol, t.date),
    index("payouts_book_closure_idx").on(t.bookClosureFrom),
  ],
);

/** A user's ledger. Holdings are derived from this, never stored directly. */
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    /** Owner. Null only for rows from before accounts, until claimed. */
    userId: text("user_id"),
    /** Which of the owner's portfolios this belongs to (see `portfolios`). */
    portfolioId: text("portfolio_id"),
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    type: text("type", {
      enum: ["buy", "sell", "dividend", "bonus", "rights"],
    }).notNull(),
    quantity: real("quantity").notNull().default(0),
    /** Price per share for buy/sell; PKR per share received for dividend. */
    price: real("price").notNull().default(0),
    /** Brokerage + CDC + taxes, in PKR. */
    fees: real("fees").notNull().default(0),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("transactions_symbol_idx").on(t.symbol),
    index("transactions_user_idx").on(t.userId),
    index("transactions_portfolio_idx").on(t.portfolioId),
  ],
);

/**
 * A user's named portfolios ("Long-term", "Trading", a family member's).
 * Tax and zakat pages combine them, since both are per person.
 */
export const portfolios = sqliteTable(
  "portfolios",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("portfolios_user_idx").on(t.userId)],
);

/**
 * Short-lived one-time codes, e.g. linking a Telegram chat: the user opens
 * t.me/<bot>?start=<code> and the bot's webhook redeems it.
 */
export const linkCodes = sqliteTable("link_codes", {
  code: text("code").primaryKey(),
  userId: text("user_id").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

/** User-defined alert rules, evaluated after each ingest. */
export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  /** Null symbol = portfolio-wide rule (used by dropped_from_kmi30). */
  symbol: text("symbol"),
  kind: text("kind", {
    enum: [
      "price_above",
      "price_below",
      "pe_above",
      "pe_below",
      "near_52w_high",
      "near_52w_low",
      "dropped_from_kmi30",
      "added_to_kmi30",
    ],
  }).notNull(),
  /** Threshold value; unused for membership alerts. */
  threshold: real("threshold"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Fired alerts, kept as a log so the UI can show what happened and when. */
export const alertEvents = sqliteTable(
  "alert_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    alertId: text("alert_id").notNull(),
    symbol: text("symbol"),
    date: text("date").notNull(),
    message: text("message").notNull(),
    value: real("value"),
    acknowledged: integer("acknowledged", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("alert_events_date_idx").on(t.date),
    index("alert_events_user_idx").on(t.userId),
  ],
);

/**
 * Annual financials and ratios from the company page, ~4 years per company.
 *
 * Stored long rather than wide because the line items genuinely differ by
 * sector: a bank reports "Mark-up Earned" and "Total Income", a manufacturer
 * reports "Sales" and "Gross Profit Margin (%)". Fixed columns would either
 * lose data or be mostly null.
 */
export const financials = sqliteTable(
  "financials",
  {
    symbol: text("symbol").notNull(),
    /** Fiscal year label as PSX prints it, e.g. "2025". */
    fiscalYear: text("fiscal_year").notNull(),
    section: text("section", { enum: ["financials", "ratios"] }).notNull(),
    lineItem: text("line_item").notNull(),
    value: real("value"),
    /**
     * Unit inferred from the line item name, since PSX mixes units in one
     * table: monetary rows are PKR thousands, EPS is PKR per share, and
     * anything marked (%) is a percentage.
     */
    unit: text("unit", {
      enum: ["pkr_thousands", "pkr_per_share", "percent", "ratio"],
    }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.symbol, t.fiscalYear, t.section, t.lineItem],
    }),
    index("financials_symbol_idx").on(t.symbol),
  ],
);

/**
 * Daily record of which symbols matched which screen.
 *
 * Stored rather than recomputed so "what newly triggered today" is a diff of
 * consecutive dates — the same approach the recomposition tracker uses.
 */
export const screenHits = sqliteTable(
  "screen_hits",
  {
    screenId: text("screen_id").notNull(),
    date: text("date").notNull(),
    symbol: text("symbol").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.screenId, t.date, t.symbol] }),
    index("screen_hits_screen_date_idx").on(t.screenId, t.date),
  ],
);

/** User-defined screens. Built-in ones live in code, not here. */
export const customScreens = sqliteTable("custom_screens", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  /** JSON-encoded ScreenRule[]. */
  rules: text("rules").notNull(),
  /** "all" | "shariah" | an index code. */
  universe: text("universe").notNull().default("all"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

/** Symbols a user follows without owning them — no effect on the ledger. */
export const watchlist = sqliteTable(
  "watchlist",
  {
    userId: text("user_id").notNull(),
    symbol: text("symbol").notNull(),
    note: text("note"),
    /** Price at the moment it was added, so drift since is measurable. */
    addedPrice: real("added_price"),
    addedAt: integer("added_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.symbol] })],
);

/** Per-user preferences (zakat inputs), JSON-encoded. */
export const userSettings = sqliteTable(
  "user_settings",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** App-wide key/value settings (notification preferences). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/** Bookkeeping for ingest runs, so the UI can show data freshness. */
export const ingestRuns = sqliteTable("ingest_runs", {
  id: text("id").primaryKey(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
  detail: text("detail"),
  /**
   * Latest progress line while a run is in flight, so the UI can poll for
   * something better than a spinner. Also lets a manual run see that the
   * scheduled LaunchAgent is already working, since both write here.
   */
  progress: text("progress"),
  /** How the run was launched, for the history list. */
  trigger: text("trigger", { enum: ["cli", "ui", "schedule"] }),
});

// ---------------------------------------------------------------------------
// Accounts (Better Auth). Property names are the field names Better Auth
// expects; role/banned/banReason/banExpires and impersonatedBy are the admin
// plugin's additions.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  role: text("role").default("user"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    /** Password hash for email accounts; never the password itself. */
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Login/sign-up attempt counters, so limits hold across serverless instances. */
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});
