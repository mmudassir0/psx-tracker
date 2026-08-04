/**
 * Checks announcement document links resolve to real, openable URLs.
 *
 * Regression guard: PSX rows contain a dummy `href="javascript:"` alongside
 * the real PDF. Prefixing the base URL onto that dummy produced the broken
 * "https://dps.psx.com.pkjavascript:" links.
 *
 *   npm run test:links
 */
import { psxFetch } from "@/lib/psx/client";
import { parseCompanyPage, toAbsoluteUrl } from "@/lib/psx/parse";

const RESOLVER_CASES: [string, string | null][] = [
  ["javascript:", null],
  ["javascript:void(0)", null],
  ["JavaScript:doThing()", null],
  ["#", null],
  ["#section", null],
  ["", null],
  ["   ", null],
  ["mailto:x@y.com", null],
  ["tel:+92000", null],
  [
    "/download/document/277539.pdf",
    "https://dps.psx.com.pk/download/document/277539.pdf",
  ],
  [
    "download/document/1.pdf",
    "https://dps.psx.com.pk/download/document/1.pdf",
  ],
  ["//cdn.example.com/a.pdf", "https://cdn.example.com/a.pdf"],
  ["https://elsewhere.com/a.pdf", "https://elsewhere.com/a.pdf"],
];

async function main() {
  let failures = 0;

  console.log("=== URL resolver ===");
  for (const [input, want] of RESOLVER_CASES) {
    const got = toAbsoluteUrl(input);
    const pass = got === want;
    if (!pass) failures++;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${JSON.stringify(input).padEnd(26)} -> ${got}`,
    );
  }

  console.log("\n=== Live announcement links ===");
  for (const symbol of ["MEBL", "OGDC", "LUCK"]) {
    const page = parseCompanyPage(
      await psxFetch(`/company/${symbol}`, { ttlMs: 0 }),
    );
    const withUrl = page.announcements.filter((a) => a.url);
    const malformed = withUrl.filter(
      (a) =>
        !a.url!.startsWith("https://") ||
        a.url!.includes("javascript") ||
        // The classic symptom: base and path fused without a separator.
        /psx\.com\.pk[^/]/.test(a.url!),
    );
    const pdfs = withUrl.filter((a) => a.url!.toLowerCase().includes(".pdf"));

    if (malformed.length > 0) failures += malformed.length;
    console.log(
      `  ${malformed.length === 0 ? "PASS" : "FAIL"}  ${symbol}: ` +
        `${page.announcements.length} announcements, ${withUrl.length} linked, ` +
        `${pdfs.length} PDFs, ${malformed.length} malformed`,
    );
    for (const bad of malformed.slice(0, 3)) console.log(`      BAD: ${bad.url}`);
    if (withUrl[0]) console.log(`      e.g. ${withUrl[0].url}`);
  }

  console.log(
    failures === 0
      ? "\nAll link checks passed."
      : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
