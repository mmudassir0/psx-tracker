import { computeDisposals, disposalsToCsv, type CostMethod } from "@/lib/cgt";

export const dynamic = "force-dynamic";

/** CSV export of realised disposals, for handing to an accountant. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const method: CostMethod =
    url.searchParams.get("method") === "fifo" ? "fifo" : "average";

  const csv = disposalsToCsv(computeDisposals(method));
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="disposals-${method}-${stamp}.csv"`,
    },
  });
}
