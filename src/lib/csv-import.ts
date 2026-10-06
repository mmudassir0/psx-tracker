/**
 * Broker CSV import: parse, guess which column is which, and turn rows into
 * transactions. Pure functions shared by the browser (preview) and the server
 * (validation), so what you preview is exactly what gets imported.
 */

export type ImportField = "date" | "symbol" | "type" | "quantity" | "price" | "fees" | "note";
export type ImportType = "buy" | "sell" | "dividend" | "bonus" | "rights";
export type DateOrder = "dmy" | "mdy";

export const IMPORT_FIELDS: { key: ImportField; label: string; required: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "symbol", label: "Symbol", required: true },
  { key: "type", label: "Buy / sell", required: false },
  { key: "quantity", label: "Quantity", required: true },
  { key: "price", label: "Price", required: true },
  { key: "fees", label: "Fees / commission", required: false },
  { key: "note", label: "Note", required: false },
];

export const MAX_IMPORT_ROWS = 5000;

/** Column index per field; -1 = not present. */
export type ColumnMapping = Record<ImportField, number>;

export interface ImportedTx {
  date: string;
  symbol: string;
  type: ImportType;
  quantity: number;
  price: number;
  fees: number;
  note: string | null;
}

export type RowResult = { ok: true; tx: ImportedTx } | { ok: false; error: string };

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF; delimiter auto-detected. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

const HEADER_HINTS: Record<ImportField, RegExp> = {
  date: /date|trade\s*dt|settle/i,
  symbol: /symbol|scrip|ticker|security|stock|instrument|share\s*name|company/i,
  type: /type|side|buy.?\/?.?sell|b\/s|transaction|action|nature/i,
  quantity: /qty|quantity|volume|shares|units|no\.?\s*of/i,
  price: /price|rate|avg/i,
  fees: /fee|commission|charges|brokerage|cvt|tax|cdc|levies/i,
  note: /note|remark|comment|memo|description/i,
};

/** Best guess at which column holds what, from the header row. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, -1])) as ColumnMapping;
  const taken = new Set<number>();
  // Most specific fields first, so "Trade Date" isn't taken as a type, etc.
  for (const field of ["date", "symbol", "quantity", "price", "fees", "type", "note"] as ImportField[]) {
    const index = headers.findIndex((h, i) => !taken.has(i) && HEADER_HINTS[field].test(h));
    if (index >= 0) {
      mapping[field] = index;
      taken.add(index);
    }
  }
  return mapping;
}

/** "1,234.50", "(12.5)", "PKR 300" -> number. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/[^\d.,()\-]/g, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()\-]/g, "").replace(/,/g, "");
  if (!s || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Accepts 2026-10-05, 05/10/2026, 05-10-26, 05-Oct-2026, Oct 5 2026. */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,})[-/. ,]*(\d{2,4})/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return month ? isoDate(year, month, +m[1]) : null;
  }
  m = s.match(/^([A-Za-z]{3,})[ -](\d{1,2}),? (\d{4})/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return month ? isoDate(+m[3], month, +m[2]) : null;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [a, b] = [+m[1], +m[2]];
    return order === "dmy" ? isoDate(year, b, a) : isoDate(year, a, b);
  }
  return null;
}

/** Guess day-first vs month-first from the values themselves. */
export function guessDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) return "dmy";
    if (+m[2] > 12) return "mdy";
  }
  return "dmy"; // Pakistan's convention
}

export function parseType(raw: string | undefined): ImportType | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(b|buy|bought|purchase|purchased|p)$/.test(s) || s.startsWith("buy")) return "buy";
  if (/^(s|sell|sold|sale)$/.test(s) || s.startsWith("sell") || s.startsWith("sale")) return "sell";
  if (s.startsWith("div")) return "dividend";
  if (s.startsWith("bonus")) return "bonus";
  if (s.startsWith("right")) return "rights";
  return null;
}

/** Turn one CSV row into a transaction, or say exactly what is wrong with it. */
export function normaliseRow(row: string[], mapping: ColumnMapping, order: DateOrder): RowResult {
  const cell = (field: ImportField) => (mapping[field] >= 0 ? row[mapping[field]] ?? "" : "");

  const date = parseDate(cell("date"), order);
  if (!date) return { ok: false, error: `Unreadable date "${cell("date")}"` };

  const symbol = cell("symbol").toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!symbol || symbol.length > 20) return { ok: false, error: `Unreadable symbol "${cell("symbol")}"` };

  const rawQty = parseNumber(cell("quantity"));
  if (rawQty == null || rawQty === 0) return { ok: false, error: `Unreadable quantity "${cell("quantity")}"` };

  let type: ImportType | null;
  if (mapping.type >= 0) {
    type = parseType(cell("type"));
    if (!type) return { ok: false, error: `Unknown type "${cell("type")}" (expected buy/sell/dividend/bonus/rights)` };
  } else {
    // No type column: a negative quantity is a sale.
    type = rawQty < 0 ? "sell" : "buy";
  }

  const price = parseNumber(cell("price"));
  if (price == null || price < 0) return { ok: false, error: `Unreadable price "${cell("price")}"` };
  if (price === 0 && type !== "bonus") return { ok: false, error: "Price is zero" };

  const fees = mapping.fees >= 0 ? Math.abs(parseNumber(cell("fees")) ?? 0) : 0;
  const note = cell("note").slice(0, 200) || null;

  return { ok: true, tx: { date, symbol, type, quantity: Math.abs(rawQty), price, fees, note } };
}

/** Identity used to skip rows that were already imported. */
export function txKey(tx: Pick<ImportedTx, "date" | "symbol" | "type" | "quantity" | "price">): string {
  return [tx.date, tx.symbol, tx.type, Number(tx.quantity).toFixed(4), Number(tx.price).toFixed(4)].join("|");
}
