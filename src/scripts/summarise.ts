/**
 * Writes plain-English summaries with Grok after each ingest.
 *
 *   npx tsx src/scripts/summarise.ts             write summaries
 *   npx tsx src/scripts/summarise.ts --dry-run   show what would be summarised
 *
 * Covered: KSE100 members plus every stock anyone holds or watches.
 * - Company summary: rewritten when its financials or announcements change,
 *   at most weekly, up to MAX_COMPANY per run (the first fill takes a few runs).
 * - Results filings from the last 2 weeks: the PDF is read and summarised
 *   once, up to MAX_FILINGS per run.
 * Without XAI_API_KEY it does nothing and exits cleanly. A run costs roughly
 * a few US cents at grok-4.3 prices; the totals are printed at the end.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiSummaries, announcements, symbols, transactions, watchlist } from "@/db/schema";
import { addDays, todayPkt } from "@/lib/dates";
import { getAllSymbolViews, latestConstituentDate } from "@/lib/market";
import { membersOn } from "@/lib/psx/ingest";
import { getCompanyFinancials } from "@/lib/financials";
import {
  COMPANY_SYSTEM_PROMPT,
  FILING_SYSTEM_PROMPT,
  companyInput,
  filingInput,
  hashInput,
  recentAnnouncementsOf,
  saveSummary,
} from "@/lib/ai-summaries";
import { GrokError, grokComplete, grokConfigured, grokModel } from "@/lib/grok";

const MAX_COMPANY = 40;
const MAX_FILINGS = 15;
const REWRITE_AFTER_DAYS = 7;
const FILING_WINDOW_DAYS = 14;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
/** Fewer characters than this means a scanned PDF with no text layer. */
const MIN_PDF_TEXT = 300;
/** USD per million tokens for the default model, for the cost estimate only. */
const PRICE_IN = 1.25;
const PRICE_OUT = 2.5;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

let tokensIn = 0;
let tokensOut = 0;

async function universe(): Promise<string[]> {
  const kseDate = await latestConstituentDate("KSE100");
  const kse = kseDate ? await membersOn("KSE100", kseDate) : [];
  const held = await db.selectDistinct({ s: transactions.symbol }).from(transactions).all();
  const watched = await db.selectDistinct({ s: watchlist.symbol }).from(watchlist).all();
  return [...new Set([...kse, ...held.map((r) => r.s), ...watched.map((r) => r.s)])].sort();
}

async function readPdfText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: controller.signal });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_PDF_BYTES) return null;
    if (String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") return null;
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return typeof text === "string" ? text : (text as string[]).join("\n");
  } catch (err) {
    console.warn(`  couldn't read PDF ${url}: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function complete(system: string, user: string, maxTokens: number): Promise<string> {
  const out = await grokComplete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens },
  );
  if (!out) throw new GrokError("XAI_API_KEY is not set");
  tokensIn += out.inputTokens;
  tokensOut += out.outputTokens;
  return out.text;
}

export async function runSummarise({ dryRun = false }: { dryRun?: boolean } = {}) {
  tokensIn = 0;
  tokensOut = 0;
  if (!grokConfigured() && !dryRun) {
    console.log("XAI_API_KEY is not set: skipping AI summaries.");
    return;
  }
  const today = todayPkt();
  const list = await universe();
  console.log(`Summaries for ${list.length} symbols with ${grokModel()}${dryRun ? " (dry run)" : ""}`);

  const existing = new Map(
    (
      await db
        .select({ id: aiSummaries.id, hash: aiSummaries.sourceHash, createdAt: aiSummaries.createdAt })
        .from(aiSummaries)
        .where(inArray(aiSummaries.symbol, list))
        .all()
    ).map((r) => [r.id, r]),
  );

  // --- Company summaries ---------------------------------------------------
  const views = new Map((await getAllSymbolViews()).map((v) => [v.symbol, v]));
  const meta = new Map(
    (await db.select().from(symbols).where(inArray(symbols.symbol, list)).all()).map((m) => [m.symbol, m]),
  );
  const staleBefore = Date.now() - REWRITE_AFTER_DAYS * 86_400_000;

  const due: { symbol: string; stable: string; market: string; hash: string; missing: boolean; age: number }[] = [];
  for (const symbol of list) {
    const financials = await getCompanyFinancials(symbol);
    const recent = await recentAnnouncementsOf(symbol);
    if (financials.years.length === 0 && recent.length === 0) continue;
    const m = meta.get(symbol);
    const input = companyInput({
      symbol,
      name: m?.name ?? null,
      sector: m?.sectorName ?? null,
      view: views.get(symbol) ?? null,
      financials,
      recentAnnouncements: recent,
    });
    const hash = hashInput(input.stable);
    const prev = existing.get(`company:${symbol}`);
    if (prev && (prev.hash === hash || prev.createdAt.getTime() > staleBefore)) continue;
    due.push({ symbol, ...input, hash, missing: !prev, age: prev?.createdAt.getTime() ?? 0 });
  }
  // Never-summarised first, then the oldest.
  due.sort((a, b) => Number(b.missing) - Number(a.missing) || a.age - b.age);
  const companyBatch = due.slice(0, MAX_COMPANY);
  console.log(`company summaries due: ${due.length}, this run: ${companyBatch.length}`);

  let written = 0;
  try {
    for (const c of companyBatch) {
      if (dryRun) {
        console.log(`  would summarise ${c.symbol}`);
        continue;
      }
      const text = await complete(COMPANY_SYSTEM_PROMPT, `${c.stable}\n\n${c.market}`, 350);
      await saveSummary({ id: `company:${c.symbol}`, kind: "company", symbol: c.symbol, sourceHash: c.hash, text, model: grokModel() });
      written++;
    }

    // --- Results filings ---------------------------------------------------
    const filings = await db
      .select({ id: announcements.id, symbol: announcements.symbol, title: announcements.title, url: announcements.url, date: announcements.date })
      .from(announcements)
      .where(
        and(
          inArray(announcements.symbol, list),
          gte(announcements.date, addDays(today, -FILING_WINDOW_DAYS)),
          eq(announcements.category, "result"),
          sql`${announcements.url} like '%.pdf'`,
        ),
      )
      .all();
    const pending = filings
      .filter((f) => f.url && !existing.has(`announcement:${f.id}`))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, MAX_FILINGS);
    console.log(`results filings to read: ${pending.length}`);

    for (const f of pending) {
      if (dryRun) {
        console.log(`  would read ${f.symbol}: ${f.title}`);
        continue;
      }
      const pdfText = await readPdfText(f.url!);
      const readable = pdfText != null && pdfText.trim().length >= MIN_PDF_TEXT;
      // An unreadable (scanned) PDF is recorded with empty text so it isn't retried.
      const text = readable ? await complete(FILING_SYSTEM_PROMPT, filingInput(f.title, pdfText), 300) : "";
      await saveSummary({
        id: `announcement:${f.id}`,
        kind: "announcement",
        symbol: f.symbol,
        sourceHash: readable ? hashInput(pdfText) : "unreadable",
        text,
        model: grokModel(),
      });
      if (readable) written++;
      else console.log(`  no text layer: ${f.symbol} ${f.title}`);
    }
  } catch (err) {
    if (err instanceof GrokError && (err.status === 401 || err.status === 403)) {
      console.error("xAI rejected the API key (check the XAI_API_KEY secret):", err.message);
      process.exit(1);
    }
    if (err instanceof GrokError && err.status === 429) {
      console.error("xAI rate limit or credit exhausted; stopping for this run:", err.message);
    } else {
      throw err;
    }
  }

  const cost = (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
  console.log(
    `\n${written} summaries written; ${tokensIn} input + ${tokensOut} output tokens ≈ US$${cost.toFixed(3)} at ${grokModel()} list prices.`,
  );
  return { written, tokensIn, tokensOut };
}

// Run when executed directly (tests import runSummarise instead).
if (/summarise\.ts$/.test(process.argv[1] ?? "")) {
  runSummarise({ dryRun: process.argv.includes("--dry-run") }).catch((err) => {
    console.error("summarise failed:", err);
    process.exit(1);
  });
}
