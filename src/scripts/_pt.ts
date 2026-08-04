import { psxFetch } from "@/lib/psx/client";
import { parsePayouts } from "@/lib/psx/parse";

async function main() {
  for (const sym of ["FFC", "MEBL", "OGDC"]) {
    const html = await psxFetch("/company/payouts", {
      form: { symbol: sym },
      referer: `https://dps.psx.com.pk/company/${sym}`,
      ttlMs: 0,
    });
    const rows = parsePayouts(html);
    console.log(`\n=== ${sym}: ${rows.length} payouts ===`);
    for (const r of rows.slice(0, 4)) {
      console.log(
        `  ${r.date} ${String(r.kind).padEnd(14)} ${String(r.percent ?? "—").padStart(7)}%  ` +
          `PKR ${String(r.perShare?.toFixed(2) ?? "—").padStart(6)}/sh  inst=${r.instalment ?? "—"}  ` +
          `bc ${r.bookClosureFrom ?? "—"}→${r.bookClosureTo ?? "—"}`,
      );
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
