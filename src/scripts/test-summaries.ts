/**
 * LLM summaries against a local stub of an OpenAI-compatible API (Groq): request shape, what
 * gets summarised, PDF reading, idempotence and the stored rows.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/db";
import { aiSummaries, announcements, constituents, financials, ingestRuns, symbols } from "@/db/schema";
import { getSummariesFor } from "@/lib/ai-summaries";
import { todayPkt } from "@/lib/dates";
import { assertScratchDatabase } from "./test-guard";
import { resetToAppSchema } from "./test-schema";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}: got ${a}, want ${e}`);
}

/** A one-page PDF with a real text layer. */
function makePdf(lines: string[]): Buffer {
  const content = `BT /F1 10 Tf 40 800 Td 12 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, "")}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const requests: { auth: string | undefined; body: { model: string; reasoning_effort?: string; max_completion_tokens?: number; messages: { role: string; content: string }[] } }[] = [];

async function main() {
  console.log(`Using scratch database: ${assertScratchDatabase()}`);
  await resetToAppSchema();

  const resultsPdf = makePdf(
    Array.from({ length: 30 }, (_, i) =>
      i === 0 ? "Condensed interim financial statements for the quarter ended September 30 2026" : `Line ${i}: Revenue 1,234,567 Profit after tax 345,678 Earnings per share 4.56 PKR`,
    ),
  );

  const server = http.createServer((req, res) => {
    if (req.url === "/results.pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" }).end(resultsPdf);
      return;
    }
    if (req.url === "/scanned.pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" }).end(makePdf(["x"]));
      return;
    }
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        requests.push({ auth: req.headers.authorization, body });
        const isFiling = body.messages[0].content.includes("summarise filings");
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            choices: [{ message: { content: isFiling ? "- Profit after tax PKR 345,678 thousand." : "Revenue grew steadily." } }],
            usage: { prompt_tokens: 1000, completion_tokens: 80 },
          }),
        );
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.GROQ_API_KEY = "test-key";
  process.env.LLM_BASE_URL = `${base}/v1`;
  process.env.LLM_TOKENS_PER_MINUTE = "100000000"; // no pacing in tests

  const today = todayPkt();
  await db.insert(symbols).values([
    { symbol: "MEBL", name: "Meezan Bank", sectorName: "Commercial Banks", indexes: "KSE100" },
    { symbol: "EMPTY", name: "No data", indexes: "KSE100" },
  ]).run();
  await db.insert(constituents).values([
    { date: today, indexCode: "KSE100", symbol: "MEBL" },
    { date: today, indexCode: "KSE100", symbol: "EMPTY" },
  ]).run();
  await db.insert(ingestRuns).values({ id: "r", startedAt: new Date(), finishedAt: new Date(), status: "ok" }).run();
  await db.insert(financials).values([
    { symbol: "MEBL", fiscalYear: "2025", section: "financials", lineItem: "Total Income", value: 500, unit: "pkr_thousands" },
    { symbol: "MEBL", fiscalYear: "2024", section: "financials", lineItem: "Total Income", value: 400, unit: "pkr_thousands" },
  ]).run();
  await db.insert(announcements).values([
    { id: "res", symbol: "MEBL", date: today, title: "Financial results for the quarter", url: `${base}/results.pdf`, category: "result" },
    { id: "scan", symbol: "MEBL", date: today, title: "Financial results (scanned)", url: `${base}/scanned.pdf`, category: "result" },
    { id: "other", symbol: "MEBL", date: today, title: "Board meeting", url: `${base}/other.pdf`, category: "board_meeting" },
  ]).run();

  const { runSummarise } = await import("./summarise");

  console.log("\n[1] First run");
  const first = await runSummarise();
  check("written: 1 company + 1 readable filing", first?.written, 2);
  check("API key sent as Bearer", requests[0]?.auth, "Bearer test-key");
  check("Groq model", requests[0]?.body.model, "openai/gpt-oss-120b");
  const companyReq = requests.find((r) => r.body.messages[0].content.includes("summaries of companies"));
  check("short reasoning, room for the answer", [companyReq?.body.reasoning_effort, companyReq?.body.max_completion_tokens], ["low", 1350]);
  check("filings are summarised before companies", requests[0]?.body.messages[0].content.includes("summarise filings"), true);
  check("company prompt carries the financials", companyReq?.body.messages[1].content.includes("Total Income (pkr_thousands): 2025=500, 2024=400"), true);
  check("filing prompt carries the PDF text", requests.some((r) => r.body.messages[1].content.includes("Profit after tax 345,678")), true);
  check("only 'result' filings are read", requests.length, 2);

  const rows = await db.select({ id: aiSummaries.id, text: aiSummaries.text }).from(aiSummaries).orderBy(aiSummaries.id).all();
  check("stored rows (scanned PDF recorded empty so it isn't retried)", rows, [
    { id: "announcement:res", text: "- Profit after tax PKR 345,678 thousand." },
    { id: "announcement:scan", text: "" },
    { id: "company:MEBL", text: "Revenue grew steadily." },
  ]);

  console.log("\n[2] Second run: nothing changed");
  const second = await runSummarise();
  check("nothing rewritten", second?.written, 0);
  check("no new API calls", requests.length, 2);

  console.log("\n[3] Reading for the symbol page");
  const s = await getSummariesFor("MEBL");
  check("company summary", s.company?.text, "Revenue grew steadily.");
  check("filing summaries keyed by announcement id, empty ones hidden", [...s.filings.keys()], ["res"]);

  console.log("\n[4] Token budget stops a run cleanly");
  await db.delete(aiSummaries).run();
  process.env.LLM_TOKEN_BUDGET = "2500";
  const capped = await runSummarise();
  check("one call fits a 2,500-token budget, then it stops", capped?.written, 1);
  delete process.env.LLM_TOKEN_BUDGET;

  console.log("\n[5] Without a key");
  delete process.env.GROQ_API_KEY;
  const none = await runSummarise();
  check("skips cleanly", none, undefined);

  server.close();
  if (failures) {
    console.log(`\n${failures} summary check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll summary checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
