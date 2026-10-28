import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { alerts, alertEvents, announcements } from "@/db/schema";
import { getAllSymbolViews, latestQuoteDate } from "@/lib/market";
import { detectRecomposition } from "@/lib/psx/ingest";
import { getHoldings } from "@/lib/portfolio";
import { addDays, todayPkt } from "@/lib/dates";
import type { AlertKind } from "@/lib/alert-types";

export {
  ALERT_LABELS,
  needsThreshold,
  symbolOptional,
  type AlertKind,
} from "@/lib/alert-types";

export interface FiredAlert {
  alertId: string;
  /** Whose alert this is, for per-user delivery. */
  userId: string | null;
  symbol: string | null;
  message: string;
  value: number | null;
}

/**
 * Evaluate every active alert against the latest data and log new events.
 *
 * An alert fires at most once per calendar day, so re-running the ingest
 * doesn't spam the log.
 *
 * With a userId, only that user's rules run (after they create one). Without,
 * every user's rules run: that is the daily ingest.
 */
export async function evaluateAlerts(userId?: string): Promise<FiredAlert[]> {
  const date = (await latestQuoteDate()) ?? todayPkt();
  const rules = await db
    .select()
    .from(alerts)
    .where(
      userId
        ? and(eq(alerts.active, true), eq(alerts.userId, userId))
        : eq(alerts.active, true),
    )
    .all();
  if (rules.length === 0) return [];

  // Every listed stock, so price and P/E alerts work outside any one index.
  const views = await getAllSymbolViews();
  const bySymbol = new Map(views.map((c) => [c.symbol, c]));
  // Membership alerts are about KMI30's Shariah screen specifically.
  const recomposition = await detectRecomposition("KMI30");

  // Portfolio-wide rules watch the rule owner's own holdings.
  const heldByUser = new Map<string, Set<string>>();
  async function heldSymbolsOf(owner: string | null): Promise<Set<string>> {
    if (!owner) return new Set();
    let held = heldByUser.get(owner);
    if (!held) {
      held = new Set((await getHoldings(owner)).map((h) => h.symbol));
      heldByUser.set(owner, held);
    }
    return held;
  }

  const fired: FiredAlert[] = [];

  for (const rule of rules) {
    const kind = rule.kind as AlertKind;

    // One event per new announcement, not one per day: handled separately.
    if (kind === "new_announcement") {
      const symbolsWatched = rule.symbol ? [rule.symbol] : [...(await heldSymbolsOf(rule.userId))];
      for (const a of await newAnnouncementsFor(rule.id, symbolsWatched, date, rule.createdAt)) {
        const message = `${a.symbol}: ${a.title}`;
        await logEvent(rule, a.symbol, message, null, date);
        fired.push({ alertId: rule.id, userId: rule.userId, symbol: a.symbol, message, value: null });
      }
      continue;
    }

    if (await hasFiredOn(rule.id, date)) continue;
    let hit: { message: string; value: number | null } | null = null;

    if (kind === "dropped_from_kmi30" || kind === "added_to_kmi30") {
      const moved =
        kind === "dropped_from_kmi30"
          ? recomposition.dropped
          : recomposition.added;

      const heldSymbols = await heldSymbolsOf(rule.userId);
      const relevant = rule.symbol
        ? moved.filter((s) => s === rule.symbol)
        : moved.filter((s) => heldSymbols.has(s));

      if (relevant.length > 0) {
        hit = {
          message:
            kind === "dropped_from_kmi30"
              ? `${relevant.join(", ")} dropped from KMI30`
              : `${relevant.join(", ")} added to KMI30`,
          value: null,
        };
      }
    } else if (rule.symbol) {
      const current = bySymbol.get(rule.symbol);
      if (current && rule.threshold != null) {
        if (kind === "price_below" && current.close != null && current.close <= rule.threshold) {
          hit = {
            message: `${rule.symbol} price ${fmt(current.close)} <= ${fmt(rule.threshold)}`,
            value: current.close,
          };
        } else if (kind === "price_above" && current.close != null && current.close >= rule.threshold) {
          hit = {
            message: `${rule.symbol} price ${fmt(current.close)} >= ${fmt(rule.threshold)}`,
            value: current.close,
          };
        } else if (kind === "pe_below" && current.peTtm != null && current.peTtm <= rule.threshold) {
          hit = {
            message: `${rule.symbol} P/E ${fmt(current.peTtm)} <= ${fmt(rule.threshold)}`,
            value: current.peTtm,
          };
        } else if (kind === "pe_above" && current.peTtm != null && current.peTtm >= rule.threshold) {
          hit = {
            message: `${rule.symbol} P/E ${fmt(current.peTtm)} >= ${fmt(rule.threshold)}`,
            value: current.peTtm,
          };
        } else if (
          kind === "near_52w_high" &&
          current.drawdownFrom52wPct != null &&
          current.drawdownFrom52wPct <= rule.threshold
        ) {
          hit = {
            message: `${rule.symbol} within ${fmt(rule.threshold)}% of 52w high (currently -${fmt(current.drawdownFrom52wPct)}%)`,
            value: current.drawdownFrom52wPct,
          };
        } else if (kind === "near_52w_low") {
          const aboveLow = pctAboveLow(current.close, current.week52Low);
          if (aboveLow != null && aboveLow <= rule.threshold) {
            hit = {
              message: `${rule.symbol} within ${fmt(rule.threshold)}% of 52w low (currently +${fmt(aboveLow)}%)`,
              value: aboveLow,
            };
          }
        }
      }
    }

    if (hit) {
      await logEvent(rule, rule.symbol, hit.message, hit.value, date);
      fired.push({
        alertId: rule.id,
        userId: rule.userId,
        symbol: rule.symbol,
        message: hit.message,
        value: hit.value,
      });
    }
  }

  return fired;
}

async function logEvent(
  rule: { id: string; userId: string | null },
  symbol: string | null,
  message: string,
  value: number | null,
  date: string,
) {
  await db
    .insert(alertEvents)
    .values({
      id: randomUUID(),
      userId: rule.userId,
      alertId: rule.id,
      date,
      symbol,
      message,
      value,
      acknowledged: false,
      createdAt: new Date(),
    })
    .run();
}

/** How far a close sits above its 52-week low, in %. */
export function pctAboveLow(close: number | null, low: number | null): number | null {
  if (close == null || low == null || low <= 0) return null;
  return ((close - low) / low) * 100;
}

/** Announcements older than this are history, not news. */
const ANNOUNCEMENT_WINDOW_DAYS = 7;
/** A first run on a big portfolio shouldn't send dozens of messages. */
const MAX_ANNOUNCEMENTS_PER_RULE = 10;

/**
 * Announcements for these symbols from the last week that this rule hasn't
 * reported yet (matched against its own event log), and none older than the
 * rule itself.
 */
async function newAnnouncementsFor(
  alertId: string,
  symbolList: string[],
  date: string,
  ruleCreatedAt: Date,
): Promise<{ symbol: string; title: string }[]> {
  if (symbolList.length === 0) return [];
  const created = ruleCreatedAt.toISOString().slice(0, 10);
  const windowStart = addDays(date, -ANNOUNCEMENT_WINDOW_DAYS);
  const since = created > windowStart ? created : windowStart;

  const recent = await db
    .select({ symbol: announcements.symbol, title: announcements.title, date: announcements.date })
    .from(announcements)
    .where(and(inArray(announcements.symbol, symbolList), gte(announcements.date, since)))
    .orderBy(announcements.date)
    .all();
  if (recent.length === 0) return [];

  const reported = new Set(
    (
      await db
        .select({ message: alertEvents.message })
        .from(alertEvents)
        .where(and(eq(alertEvents.alertId, alertId), gte(alertEvents.date, addDays(since, -1))))
        .all()
    ).map((e) => e.message),
  );

  const seen = new Set<string>();
  const fresh: { symbol: string; title: string }[] = [];
  for (const a of recent) {
    const key = `${a.symbol}: ${a.title}`;
    if (reported.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ symbol: a.symbol, title: a.title });
  }
  return fresh.slice(-MAX_ANNOUNCEMENTS_PER_RULE);
}

async function hasFiredOn(alertId: string, date: string): Promise<boolean> {
  const existing = await db
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(and(eq(alertEvents.alertId, alertId), eq(alertEvents.date, date)))
    .get();
  return Boolean(existing);
}

function fmt(value: number): string {
  return value.toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

export async function listAlerts(userId: string | null) {
  if (!userId) return [];
  return await db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(desc(alerts.createdAt))
    .all();
}

/** Unread alert count, for the nav badge. */
export async function countUnacknowledgedEvents(
  userId: string | null,
): Promise<number> {
  if (!userId) return 0;
  try {
    const rows = await db
      .select({ id: alertEvents.id })
      .from(alertEvents)
      .where(
        and(eq(alertEvents.userId, userId), eq(alertEvents.acknowledged, false)),
      )
      .all();
    return rows.length;
  } catch {
    return 0;
  }
}

export async function listAlertEvents(userId: string | null, limit = 100) {
  if (!userId) return [];
  return await db
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.userId, userId))
    .orderBy(desc(alertEvents.createdAt))
    .limit(limit)
    .all();
}

export async function createAlert(userId: string, input: {
  symbol: string | null;
  kind: AlertKind;
  threshold: number | null;
  note?: string | null;
}) {
  const id = randomUUID();
  await db.insert(alerts)
    .values({
      id,
      userId,
      symbol: input.symbol,
      kind: input.kind,
      threshold: input.threshold,
      active: true,
      note: input.note ?? null,
      createdAt: new Date(),
    })
    .run();
  return id;
}

export async function deleteAlert(userId: string, id: string) {
  // Owner check first, so events of someone else's alert are never touched.
  const owned = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.userId, userId)))
    .get();
  if (!owned) return;
  await db.delete(alertEvents).where(eq(alertEvents.alertId, id)).run();
  await db.delete(alerts).where(eq(alerts.id, id)).run();
}

export async function setAlertActive(userId: string, id: string, active: boolean) {
  await db
    .update(alerts)
    .set({ active })
    .where(and(eq(alerts.id, id), eq(alerts.userId, userId)))
    .run();
}

export async function acknowledgeEvent(userId: string, id: string) {
  await db.update(alertEvents)
    .set({ acknowledged: true })
    .where(and(eq(alertEvents.id, id), eq(alertEvents.userId, userId)))
    .run();
}
