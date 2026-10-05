import { getCurrentUserId } from "@/lib/auth";
import { computeDisposals, disposalsToCsv, type CostMethod } from "@/lib/cgt";

export const dynamic = "force-dynamic";

/** CSV export of realised disposals, for handing to an accountant. */
export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return new Response("Log in to download this file.", { status: 401 });
  }
  const url = new URL(request.url);
  const method: CostMethod =
    url.searchParams.get("method") === "fifo" ? "fifo" : "average";

  const csv = disposalsToCsv(await computeDisposals(userId, method));
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="disposals-${method}-${stamp}.csv"`,
    },
  });
}
