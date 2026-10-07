/**
 * EOD ingest. Run after market close (15:30 PKT).
 *
 * With --trigger=schedule (GitHub Actions, several times a day) it never saves
 * during trading hours, stops early once the session is captured, and tells
 * the admins when a weekday's prices are still missing in the evening.
 *
 *   npm run ingest                        # all indices, all fundamentals
 *   npm run ingest -- --indices=KMI30     # fundamentals for one index only
 *   npm run ingest -- --no-fundamentals   # quotes + membership only, fastest
 */
import { runIngest, detectRecomposition, resolveSessionDate } from "@/lib/psx/ingest";
import { reportCrash, reportMissingSession, sessionCaptured } from "@/lib/ingest-guard";
import { latestQuoteDate } from "@/lib/market";
import { isMarketOpen } from "@/lib/dates";
import { evaluateAlerts } from "@/lib/alerts";
import { notifyAlerts, notifyIngestComplete } from "@/lib/notify";
import { recordScreenHits } from "@/lib/screens";
import { deliverAlerts } from "@/lib/user-notify";
import { indexLabel, sortIndexCodes } from "@/lib/psx/indices";

function flagValue(name: string): string | null {
  const match = process.argv.find((a) => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
}

async function main() {
  const skipFundamentals = process.argv.includes("--no-fundamentals");
  const indicesArg = flagValue("indices");
  const fundamentalIndices = indicesArg
    ? indicesArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined;

  const started = Date.now();
  console.log(`PSX ingest — ${new Date().toISOString()}`);
  if (fundamentalIndices)
    console.log(`Fundamentals limited to: ${fundamentalIndices.join(", ")}`);

  const triggerArg = flagValue("trigger");
  const trigger =
    triggerArg === "schedule" || triggerArg === "ui" ? triggerArg : "cli";
  scheduled = trigger === "schedule";

  if (scheduled) {
    if (isMarketOpen()) {
      console.log("Market is open: nothing saved, half-day prices would be stored as the close.");
      await reportMissingSession(await latestQuoteDate());
      return;
    }
    const session = await resolveSessionDate();
    if (!process.argv.includes("--force") && (await sessionCaptured(session))) {
      console.log(`Session ${session} is already saved after the close. Nothing to do.`);
      await reportMissingSession(await latestQuoteDate());
      return;
    }
  }

  const result = await runIngest({
    trigger,
    includeFundamentals: !skipFundamentals,
    fundamentalScope: fundamentalIndices ? "indices" : "all",
    fundamentalIndices,
    recheckCompanyPages: process.argv.includes("--recheck-pages"),
    onProgress: (m) => console.log(m),
  });

  console.log("\n--- summary ---");
  console.log(`date:            ${result.date}`);
  console.log(`symbols seen:    ${result.symbolsSeen}`);
  console.log(`quotes written:  ${result.quotesWritten}`);
  console.log(
    `companies:       ${result.fundamentalsFetched}` +
      (result.pagesSkipped ? ` (${result.pagesSkipped} skipped, no PSX page)` : ""),
  );
  if (result.pagesMarkedMissing > 0) {
    console.log(
      `                 ${result.pagesMarkedMissing} newly marked as having no company page`,
    );
  }
  console.log(`announcements:   ${result.announcementsWritten}`);

  const snapshotted = sortIndexCodes(Object.keys(result.indexMemberCounts));
  if (snapshotted.length > 0) {
    console.log(`\nindex membership snapshotted (${snapshotted.length}):`);
    for (const code of snapshotted) {
      const label = indexLabel(code);
      const suffix = label === code ? "" : `  ${label}`;
      console.log(
        `  ${code.padEnd(12)} ${String(result.indexMemberCounts[code]).padStart(4)} members${suffix}`,
      );
    }
  }

  if (result.skippedIndices.length > 0) {
    console.log(
      `\nmembership snapshot skipped for ${result.skippedIndices.length} index/indices:`,
    );
    console.log(`  ${sortIndexCodes(result.skippedIndices).join(", ")}`);
    console.log(
      "  Mid-session listings are partial, so a new baseline would be wrong.\n" +
        "  Prices were still saved. Re-run after 15:30 PKT to capture membership.",
    );
  }

  const recomp = await detectRecomposition();
  if (recomp.added.length || recomp.dropped.length) {
    console.log("\n*** KMI30 RECOMPOSITION DETECTED ***");
    console.log(`  ${recomp.previousDate} -> ${recomp.currentDate}`);
    if (recomp.added.length) console.log(`  added:   ${recomp.added.join(", ")}`);
    if (recomp.dropped.length)
      console.log(`  dropped: ${recomp.dropped.join(", ")}`);
  }

  // Snapshot screen matches so tomorrow can diff against today.
  const screenHitCount = await recordScreenHits();
  if (screenHitCount > 0) console.log(`\nscreen matches recorded: ${screenHitCount}`);

  const fired = await evaluateAlerts();
  notifyAlerts(fired);
  notifyIngestComplete(
    `${result.constituentCount} constituents, ${result.quotesWritten} quotes`,
    result.errors.length > 0,
  );
  if (fired.length) {
    console.log(`\n${fired.length} alert(s) fired:`);
    for (const f of fired) console.log(`  - ${f.message}`);
    // Telegram / email, per user. SITE_URL only adds a link to the message.
    const { sent } = await deliverAlerts(fired, process.env.SITE_URL);
    if (sent) console.log(`  delivered ${sent} message(s)`);
  }

  if (result.errors.length) {
    console.log(`\n${result.errors.length} error(s):`);
    for (const e of result.errors.slice(0, 20)) console.log(`  ! ${e}`);
  }

  if (scheduled) await reportMissingSession(await latestQuoteDate());

  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

let scheduled = false;

main().catch(async (err) => {
  console.error("ingest failed:", err);
  if (scheduled) await reportCrash(err).catch((e) => console.error("couldn't notify admins:", e));
  process.exit(1);
});
