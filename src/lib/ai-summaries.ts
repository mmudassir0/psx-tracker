/**
 * Plain-English summaries of companies and results filings, written by an
 * LLM (Groq by default, src/lib/llm.ts) in the ingest workflow (src/scripts/summarise.ts) and read by the symbol
 * page. Inputs are only data this app already holds or PSX publishes; the
 * prompts forbid advice and anything not in the input.
 */
import { createHash } from "node:crypto";
import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiSummaries, announcements } from "@/db/schema";
import type { CompanyFinancials } from "@/lib/financials";
import type { ConstituentView } from "@/lib/market";

export type SummaryKind = "company" | "announcement";

export interface StoredSummary {
  id: string;
  kind: SummaryKind;
  symbol: string;
  text: string;
  model: string;
  createdAt: Date;
}

export const COMPANY_SYSTEM_PROMPT = `You write short, neutral, plain-English summaries of companies listed on the Pakistan Stock Exchange for a personal research tool.
Rules:
- Use only the data provided. Do not add outside knowledge, news or guesses.
- No buy/sell/hold advice, price targets, ratings or predictions.
- 4 to 6 sentences, at most 110 words, no headings or bullet points.
- Cover: what the recent years' revenue and profit trend shows, margins or other notable ratios, valuation (P/E, dividend yield) in context, and what recent announcements are about.
- Money values in the data are PKR thousands unless marked otherwise; write them as PKR millions or billions.
- If the data is thin or inconsistent, say so briefly instead of filling gaps.
- English only.`;

export const FILING_SYSTEM_PROMPT = `You summarise filings from companies listed on the Pakistan Stock Exchange for a personal research tool.
Rules:
- Use only facts stated in the document text provided.
- For financial results: the period, revenue, profit or loss after tax and its change versus the same period last year, EPS, and any dividend, bonus or right shares announced with book closure dates.
- For any other filing: its main point in one or two sentences.
- 3 to 5 short bullet points starting with "- ", at most 90 words in total.
- No advice, opinions or predictions. Write PKR amounts as they appear (note the unit, e.g. PKR '000).
- English only.`;

export function hashInput(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function fmtNumber(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * The text a company summary is written from. `stable` (financials and
 * announcements) decides when to rewrite; `market` (price-driven figures)
 * is included for context but changes daily, so it isn't hashed.
 */
export function companyInput(args: {
  symbol: string;
  name: string | null;
  sector: string | null;
  view: ConstituentView | null;
  financials: CompanyFinancials;
  recentAnnouncements: { date: string; title: string }[];
}): { stable: string; market: string } {
  const { symbol, name, sector, view, financials, recentAnnouncements } = args;
  const years = financials.years.slice(0, 4);
  const series = (list: CompanyFinancials["financials"]) =>
    list
      .map((s) => `${s.lineItem} (${s.unit}): ${years.map((y) => `${y}=${fmtNumber(s.byYear[y])}`).join(", ")}`)
      .join("\n");

  const stable = [
    `Company: ${symbol}${name ? ` (${name})` : ""}${sector ? `, sector: ${sector}` : ""}`,
    years.length ? `Fiscal years, newest first: ${years.join(", ")}` : "No annual financials available.",
    financials.financials.length ? `Financials:\n${series(financials.financials)}` : "",
    financials.ratios.length ? `Ratios:\n${series(financials.ratios)}` : "",
    recentAnnouncements.length
      ? `Recent announcements (newest first):\n${recentAnnouncements.map((a) => `${a.date}: ${a.title}`).join("\n")}`
      : "No recent announcements.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const market = view
    ? [
        `Market data (latest session): P/E ${fmtNumber(view.peTtm)}, market cap PKR ${fmtNumber(view.marketCap != null ? view.marketCap / 1e9 : null, 1)} billion,`,
        `dividend yield (trailing 12m) ${fmtNumber(view.dividendYieldPct, 1)}%, YTD change ${fmtNumber(view.ytdChangePct, 1)}%,`,
        `1-year change ${fmtNumber(view.year1ChangePct, 1)}%, ${fmtNumber(view.drawdownFrom52wPct, 1)}% below its 52-week high.`,
      ].join(" ")
    : "No market data available.";

  return { stable, market };
}

/** PDF text is long and noisy; keep the start, where results tables usually are. */
export function filingInput(title: string, text: string, maxChars = 14_000): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return `Filing title: ${title}\n\nDocument text:\n${clean.slice(0, maxChars)}`;
}

export async function saveSummary(row: {
  id: string;
  kind: SummaryKind;
  symbol: string;
  sourceHash: string;
  text: string;
  model: string;
}) {
  const values = { ...row, createdAt: new Date() };
  await db
    .insert(aiSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: aiSummaries.id,
      set: { sourceHash: row.sourceHash, text: row.text, model: row.model, createdAt: values.createdAt },
    })
    .run();
}

/**
 * A symbol's company summary and its filing summaries keyed by announcement
 * id. One indexed read; not market-cached because summaries are written after
 * the ingest's version stamp. Missing table (before the first workflow run
 * creates it) reads as "no summaries".
 */
export const getSummariesFor = cache(async (symbol: string) => {
  try {
    const rows = await db
      .select()
      .from(aiSummaries)
      .where(eq(aiSummaries.symbol, symbol))
      .all();
    const company = rows.find((r) => r.kind === "company" && r.text) ?? null;
    const filings = new Map(
      rows
        .filter((r) => r.kind === "announcement" && r.text)
        .map((r) => [r.id.slice("announcement:".length), r as StoredSummary]),
    );
    return { company: company as StoredSummary | null, filings };
  } catch {
    return { company: null, filings: new Map<string, StoredSummary>() };
  }
});

/** Recent announcements for a symbol, newest first (input to the company summary). */
export async function recentAnnouncementsOf(symbol: string, limit = 8) {
  return db
    .select({ id: announcements.id, date: announcements.date, title: announcements.title })
    .from(announcements)
    .where(and(eq(announcements.symbol, symbol)))
    .orderBy(desc(announcements.date))
    .limit(limit)
    .all();
}
