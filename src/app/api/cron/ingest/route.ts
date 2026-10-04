import { revalidatePath } from "next/cache";
import { runIngest } from "@/lib/psx/ingest";
import { evaluateAlerts } from "@/lib/alerts";
import { notifyAlerts } from "@/lib/notify";
import { recordScreenHits } from "@/lib/screens";

export const dynamic = "force-dynamic";
// Quotes-only runs finish in well under a minute; the headroom covers a slow
// PSX response plus Turso round-trips.
export const maxDuration = 300;

/**
 * Daily post-close ingest, called by Vercel Cron (see vercel.json). Vercel
 * sends `Authorization: Bearer $CRON_SECRET`; anything else is rejected so
 * the endpoint cannot be used to hammer PSX.
 *
 * Fundamentals (one request per company) are left to a manual
 * `npm run ingest`; they take far longer than a function may run.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runIngest({
    includeFundamentals: false,
    trigger: "schedule",
  });

  try {
    await recordScreenHits();
    notifyAlerts(await evaluateAlerts());
  } catch (err) {
    console.error("Post-ingest alerts failed:", err);
  }

  revalidatePath("/", "layout");

  return Response.json(result);
}
