import { getCurrentUser } from "@/lib/auth";
import { exportUserData, transactionsToCsv } from "@/lib/account-data";
import { todayPkt } from "@/lib/dates";

export const dynamic = "force-dynamic";

/** Download your own data: ?format=json (everything) or ?format=csv (trades). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Log in to download your data.", { status: 401 });

  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const data = await exportUserData(user.id);
  const stamp = todayPkt();

  if (format === "csv") {
    const names = new Map(data.portfolios.map((p) => [p.id, p.name]));
    return new Response(transactionsToCsv(data.transactions, names), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const body = {
    exportedAt: new Date().toISOString(),
    account: { name: user.name, email: user.email, createdAt: user.createdAt },
    ...data,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="psx-tracker-data-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
