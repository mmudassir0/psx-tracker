import * as cheerio from "cheerio";

/**
 * A wrapped cheerio selection. Derived from the API's own return type because
 * cheerio 1.x exports no element type of its own — the underlying node types
 * live in domhandler, which is only a transitive dependency here.
 */
type Selection = ReturnType<cheerio.CheerioAPI>;

/** Strip commas, %, currency and whitespace, then parse. Returns null if not numeric. */
export function num(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let text = raw.replace(/[,%\s ]/g, "").trim();
  if (!text || text === "-" || text === "—" || text === "N/A") return null;
  // PSX renders negatives in accounting style: (12.50)
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// /screener (replaced /market-watch, which PSX retired in Sep 2026)
// ---------------------------------------------------------------------------

export interface MarketWatchRow {
  symbol: string;
  sectorCode: string;
  /** Index memberships, e.g. ["ALLSHR", "KMI30", "KSE100"]. */
  indexes: string[];
  isKmi30: boolean;
  ldcp: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  current: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  /** 30-session average share volume; PSX no longer publishes daily volume. */
  avgVolume30d: number | null;
}

/**
 * PSX appends corporate action flags to ticker symbols on the live market-watch page:
 * - XD = Ex-Dividend (e.g. FFCXD -> FFC)
 * - XB = Ex-Bonus (e.g. IPAKXB -> IPAK)
 * - XR = Ex-Right (e.g. EPCLXR -> EPCL)
 * - XA = Ex-All (Dividend + Bonus + Right)
 *
 * Normalise these to the base equity ticker so history, company pages, and holdings stay unified.
 */
export function normalizeSymbol(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  const match = trimmed.match(/^(.*)(XD|XB|XR|XA)$/);
  if (match && match[1].length >= 2) {
    return match[1];
  }
  return trimmed;
}

/**
 * Parses the /screener table. Columns: SYMBOL | SECTOR | LISTED IN |
 * MARKET CAP | PRICE | CHANGE (%) | 1-YEAR CH. | PE | DIV YIELD | FREE FLOAT |
 * 30D VOLUME AVG.
 *
 * It carries no OHLC or daily volume, so those stay null and LDCP is
 * back-derived from the price and the change percentage.
 */
export function parseMarketWatch(html: string): MarketWatchRow[] {
  const $ = cheerio.load(html);
  const rows: MarketWatchRow[] = [];

  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 6) return;
    const cells = tds.map((__, td) => clean($(td).text())).get();

    const rawSymbol = cells[0];
    if (!rawSymbol || !/^[A-Z0-9._-]{2,20}$/.test(rawSymbol)) return;
    const symbol = normalizeSymbol(rawSymbol);

    const indexes = cells[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const current = num(cells[4]);
    const changePct = num($(tds[5]).attr("data-order") ?? cells[5]);
    let ldcp: number | null = null;
    let change: number | null = null;
    if (current != null && changePct != null && changePct > -100) {
      ldcp = Math.round((current / (1 + changePct / 100)) * 100) / 100;
      change = Math.round((current - ldcp) * 100) / 100;
    }

    rows.push({
      symbol,
      sectorCode: cells[1],
      indexes,
      isKmi30: indexes.includes("KMI30"),
      ldcp,
      open: null,
      high: null,
      low: null,
      current,
      change,
      changePct,
      volume: null,
      avgVolume30d: num(cells[10]),
    });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// /indices
// ---------------------------------------------------------------------------

export interface IndexRow {
  indexCode: string;
  current: number | null;
  high: number | null;
  low: number | null;
  change: number | null;
  changePct: number | null;
}

/** Columns: INDEX | HIGH | LOW | CURRENT | CHANGE | % CHANGE */
export function parseIndices(html: string): IndexRow[] {
  const $ = cheerio.load(html);
  const rows: IndexRow[] = [];

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => clean($(td).text()))
      .get();
    if (cells.length < 6) return;

    const indexCode = cells[0];
    if (!indexCode || !/^[A-Z0-9]{2,20}$/.test(indexCode)) return;

    rows.push({
      indexCode,
      high: num(cells[1]),
      low: num(cells[2]),
      current: num(cells[3]),
      change: num(cells[4]),
      changePct: num(cells[5]),
    });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// /company/{SYMBOL}
// ---------------------------------------------------------------------------

export interface CompanyAnnouncement {
  date: string;
  title: string;
  url: string | null;
}

export interface CompanyPage {
  name: string | null;
  sectorName: string | null;
  peTtm: number | null;
  /** PKR, converted from the page's "Market Cap (000's)". */
  marketCap: number | null;
  shares: number | null;
  freeFloatShares: number | null;
  freeFloatPct: number | null;
  week52High: number | null;
  week52Low: number | null;
  ytdChangePct: number | null;
  year1ChangePct: number | null;
  announcements: CompanyAnnouncement[];
}

/**
 * The company page repeats its stat blocks (current session, then previous
 * session). We take the FIRST occurrence of each label, which is the current
 * one, via `firstStat`.
 */
export function parseCompanyPage(html: string): CompanyPage {
  const $ = cheerio.load(html);

  // Labels repeat (current session then previous session, and "Free Float"
  // appears twice with different units), so keep every value per label.
  const stats = new Map<string, string[]>();
  $(".stats_label").each((_, el) => {
    const label = normaliseLabel($(el).text());
    const value = clean($(el).next(".stats_value").text());
    if (!label || !value) return;
    const existing = stats.get(label);
    if (existing) existing.push(value);
    else stats.set(label, [value]);
  });

  const firstStat = (label: string) =>
    stats.get(normaliseLabel(label))?.[0] ?? null;

  const [week52Low, week52High] = parseRange(firstStat("52-WEEK RANGE"));

  // "Market Cap (000's)" is in thousands of PKR.
  const marketCapThousands = num(firstStat("Market Cap"));

  return {
    // <h1> elements are section headings ("Company Profile"); the company's
    // own name lives in .quote__name.
    name: clean($(".quote__name").first().text()).replace(/(XD|XB|XR|XA)$/i, "").trim() || null,
    sectorName: extractSector($),
    peTtm: num(firstStat("P/E Ratio (TTM)")),
    marketCap: marketCapThousands == null ? null : marketCapThousands * 1000,
    shares: num(firstStat("Shares")),
    freeFloatShares: parseFreeFloatShares(stats),
    freeFloatPct: parseFreeFloatPct(stats),
    week52High,
    week52Low,
    ytdChangePct: num(firstStat("YTD Change")),
    year1ChangePct: num(firstStat("1-Year Change")),
    announcements: parseAnnouncements($),
  };
}

/**
 * PSX decorates labels with footnote markers ("52-WEEK RANGE ^",
 * "P/E Ratio (TTM) **") and inconsistent casing. Normalise so lookups are
 * stable when those markers change.
 */
function normaliseLabel(raw: string): string {
  return clean(raw)
    // Footnote markers can be separated by spaces: "1-Year Change * ^".
    .replace(/[\s*^]+$/g, "")
    .replace(/\s*\(000'?s?\)\s*/i, "")
    .trim()
    .toLowerCase();
}

/** "361.06 — 582.00" -> [361.06, 582.00] */
function parseRange(raw: string | null): [number | null, number | null] {
  if (!raw) return [null, null];
  const parts = raw.split(/[—–-]/).map((p) => num(p));
  if (parts.length < 2) return [null, null];
  return [parts[0], parts[1]];
}

/**
 * The page emits two "Free Float" labels in a row: absolute share count, then
 * a percentage. Pick whichever value carries the % sign.
 */
function parseFreeFloatPct(stats: Map<string, string[]>): number | null {
  const values = stats.get("free float") ?? [];
  const pct = values.find((v) => v.includes("%"));
  return pct ? num(pct) : null;
}

/** The absolute share count is the "Free Float" value without a % sign. */
function parseFreeFloatShares(stats: Map<string, string[]>): number | null {
  const values = stats.get("free float") ?? [];
  const count = values.find((v) => !v.includes("%"));
  return count ? num(count) : null;
}

function extractSector($: cheerio.CheerioAPI): string | null {
  const text = clean($('[class*="sector"]').first().text());
  return text || null;
}

function parseAnnouncements($: cheerio.CheerioAPI): CompanyAnnouncement[] {
  const out: CompanyAnnouncement[] = [];
  const seen = new Set<string>();

  $("tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 2) return;

    const dateText = clean(cells.eq(0).text());
    const date = parseLooseDate(dateText);
    if (!date) return;

    const title = clean(cells.eq(1).text());
    if (!title || title.length < 8) return;

    const url = resolveDocumentUrl($, $(tr));

    const key = `${date}|${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ date, title, url });
  });

  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Find the real document link in an announcement row.
 *
 * Each row carries two anchors: a dummy `href="javascript:"` that opens an
 * in-page image viewer, and the actual PDF at /download/document/{id}.pdf.
 * Taking the first anchor grabs the dummy — and naively prefixing the base
 * URL onto it produced "https://dps.psx.com.pkjavascript:".
 */
function resolveDocumentUrl(
  $: cheerio.CheerioAPI,
  row: Selection,
): string | null {
  const hrefs = row
    .find("a[href]")
    .map((_, a) => $(a).attr("href") ?? "")
    .get()
    .map((h) => h.trim())
    .filter(isNavigableHref);

  if (hrefs.length === 0) return null;

  // The PDF is what a reader actually wants; fall back to any real link.
  const preferred = hrefs.find((h) => h.toLowerCase().includes(".pdf"));
  return toAbsoluteUrl(preferred ?? hrefs[0]);
}

/** Reject pseudo-URLs that go nowhere when opened in a new tab. */
function isNavigableHref(href: string): boolean {
  if (!href) return false;
  const lower = href.toLowerCase();
  return (
    !lower.startsWith("javascript:") &&
    !lower.startsWith("mailto:") &&
    !lower.startsWith("tel:") &&
    !lower.startsWith("data:") &&
    href !== "#" &&
    !href.startsWith("#")
  );
}

/** Resolve a PSX-relative href, tolerating a missing leading slash. */
export function toAbsoluteUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!isNavigableHref(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `${PSX_BASE_URL}/${trimmed.replace(/^\/+/, "")}`;
}

const PSX_BASE_URL = "https://dps.psx.com.pk";

/** "May 20, 2026" -> "2026-05-20". Returns null when the cell isn't a date. */
export function parseLooseDate(raw: string): string | null {
  const text = clean(raw);
  if (!text) return null;

  const match = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!match) return null;

  const monthIndex = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
  if (monthIndex < 0) return null;

  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !year) return null;

  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

// ---------------------------------------------------------------------------
// Announcement classification
// ---------------------------------------------------------------------------

export type AnnouncementCategory =
  | "dividend"
  | "bonus"
  | "rights"
  | "result"
  | "board_meeting"
  | "meeting"
  | "other";

/**
 * Bucket an announcement by its title so the calendar can filter it.
 *
 * Order matters: entitlement wording ("bonus", "right", "dividend") is checked
 * before meeting wording, because a single notice often mentions both — e.g.
 * "BOOK CLOSURE FOR FINAL CASH DIVIDEND AND AGM" is a dividend event first.
 */
export function categorise(title: string): AnnouncementCategory {
  const t = title.toLowerCase();

  if (t.includes("bonus")) return "bonus";
  // "right" also matches "rights issue" and "right shares".
  if (t.includes("right")) return "rights";
  if (t.includes("dividend") || t.includes("payout")) return "dividend";

  if (
    t.includes("financial result") ||
    t.includes("quarterly report") ||
    t.includes("annual report") ||
    t.includes("half yearly") ||
    t.includes("financial statement")
  )
    return "result";

  if (t.includes("board meeting") || t.includes("closed period"))
    return "board_meeting";

  // Shareholder-facing events that carry a date worth watching.
  if (
    t.includes("annual general meeting") ||
    t.includes("extraordinary general meeting") ||
    t.includes("general meeting") ||
    t.includes(" agm") ||
    t.includes(" egm") ||
    t.includes("corporate briefing") ||
    t.includes("book closure")
  )
    return "meeting";

  return "other";
}

/**
 * Pull a payout percentage out of announcement text, e.g.
 * "INTERIM CASH DIVIDEND @ 50%" -> 50.
 */
export function extractPercent(title: string): number | null {
  const match = title.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Financials & ratios tables on the company page
// ---------------------------------------------------------------------------

export type FinancialUnit =
  | "pkr_thousands"
  | "pkr_per_share"
  | "percent"
  | "ratio";

export interface FinancialCell {
  section: "financials" | "ratios";
  fiscalYear: string;
  lineItem: string;
  value: number | null;
  unit: FinancialUnit;
}

/**
 * PSX mixes units inside one table, so the unit is inferred from the line
 * item name rather than assumed uniform:
 *   "Sales", "Profit after Taxation"   -> PKR thousands
 *   "EPS"                              -> PKR per share
 *   "Net Profit Margin (%)"            -> percent
 *   "PEG"                              -> a bare ratio
 */
export function inferFinancialUnit(lineItem: string): FinancialUnit {
  const label = lineItem.toLowerCase();
  if (label.includes("(%)") || label.includes("margin") || label.includes("growth"))
    return "percent";
  if (label === "eps" || label.startsWith("eps ")) return "pkr_per_share";
  if (label.includes("peg") || label.includes("ratio")) return "ratio";
  return "pkr_thousands";
}

/**
 * Parse the Financials and Ratios tables.
 *
 * Both are laid out with fiscal years across the header and line items down
 * the first column, and both are server-rendered (unlike payouts).
 */
export function parseFinancials(html: string): FinancialCell[] {
  const $ = cheerio.load(html);
  const out: FinancialCell[] = [];

  for (const section of ["financials", "ratios"] as const) {
    const table = $(`#${section}`).find("table").first();
    if (table.length === 0) continue;

    // Header row carries the fiscal years; the first cell is the label column.
    const years = table
      .find("tr")
      .first()
      .find("th, td")
      .map((_, el) => clean($(el).text()))
      .get()
      .slice(1)
      .filter(Boolean);

    if (years.length === 0) continue;

    table.find("tr").each((_, tr) => {
      const cells = $(tr)
        .find("td, th")
        .map((__, el) => clean($(el).text()))
        .get();
      if (cells.length < 2) return;

      const lineItem = cells[0];
      // Skip the header row itself and any blank label.
      if (!lineItem || years.includes(lineItem)) return;

      const unit = inferFinancialUnit(lineItem);
      years.forEach((year, i) => {
        const raw = cells[i + 1];
        if (raw == null) return;
        out.push({
          section,
          fiscalYear: year,
          lineItem,
          value: num(raw),
          unit,
        });
      });
    });
  }

  return out;
}
