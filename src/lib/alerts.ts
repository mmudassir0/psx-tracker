import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts, alertEvents } from "@/db/schema";
import { getConstituents, latestQuoteDate } from "@/lib/market";
import { detectRecomposition } from "@/lib/psx/ingest";
import { getHoldings } from "@/lib/portfolio";
import { todayPkt } from "@/lib/dates";
import type { AlertKind } from "@/lib/alert-types";

// Re-exported so server callers have a single import site.
export {
  ALERT_LABELS,
  needsThreshold,
  type AlertKind,
} from "@/lib/alert-types";

export interface FiredAlert {
  alertId: string;
  symbol: string | null;
  message: string;
  value: number | null;
}

/**
 * Evaluate every active alert against the latest data and log new events.
 *
 * An alert fires at most once per calendar day, so re-running the ingest
 * doesn't spam the log.
 */
export function evaluateAlerts(): FiredAlert[] {
  const date = latestQuoteDate() ?? todayPkt();
  const rules = db.select().from(alerts).where(eq(alerts.active, true)).all();
  if (rules.length === 0) return [];

  const constituents = getConstituents();
  const bySymbol = new Map(constituents.map((c) => [c.symbol, c]));
  const recomposition = detectRecomposition();
  const heldSymbols = new Set(getHoldings().map((h) => h.symbol));

  const fired: FiredAlert[] = [];

  for (const rule of rules) {
    if (hasFiredOn(rule.id, date)) continue;

    const kind = rule.kind as AlertKind;
    let hit: { message: string; value: number | null } | null = null;

    if (kind === "dropped_from_kmi30" || kind === "added_to_kmi30") {
      const moved =
        kind === "dropped_from_kmi30"
          ? recomposition.dropped
          : recomposition.added;

      // A symbol-scoped rule watches that name; an unscoped rule watches the
      // whole portfolio, which is the case people actually want.
      const relevant = rule.symbol
        ? moved.filter((s) => s === rule.symbol)
        : moved.filter((s) => heldSymbols.has(s));

      if (relevant.length > 0) {
        hit = {
          message:
            kind === "dropped_from_kmi30"
              ? `${relevant.join(", ")} dropped from KMI30 as of ${recomposition.currentDate} — no longer Shariah-screened for this index`
              : `${relevant.join(", ")} added to KMI30 as of ${recomposition.currentDate}`,
          value: relevant.length,
        };
      }
    } else {
      const row = rule.symbol ? bySymbol.get(rule.symbol) : undefined;
      const threshold = rule.threshold;
      if (!row || threshold == null) continue;

      switch (kind) {
        case "price_above":
          if (row.close != null && row.close > threshold)
            hit = {
              message: `${row.symbol} at ${fmt(row.close)} is above ${fmt(threshold)}`,
              value: row.close,
            };
          break;
        case "price_below":
          if (row.close != null && row.close < threshold)
            hit = {
              message: `${row.symbol} at ${fmt(row.close)} is below ${fmt(threshold)}`,
              value: row.close,
            };
          break;
        case "pe_above":
          if (row.peTtm != null && row.peTtm > threshold)
            hit = {
              message: `${row.symbol} P/E ${fmt(row.peTtm)} is above ${fmt(threshold)}`,
              value: row.peTtm,
            };
          break;
        case "pe_below":
          if (row.peTtm != null && row.peTtm < threshold)
            hit = {
              message: `${row.symbol} P/E ${fmt(row.peTtm)} is below ${fmt(threshold)}`,
              value: row.peTtm,
            };
          break;
        case "near_52w_high": {
          if (row.close == null || row.week52High == null) break;
          const gap = ((row.week52High - row.close) / row.week52High) * 100;
          if (gap <= threshold)
            hit = {
              message: `${row.symbol} is ${gap.toFixed(1)}% from its 52-week high of ${fmt(row.week52High)}`,
              value: gap,
            };
          break;
        }
        case "near_52w_low": {
          if (row.close == null || row.week52Low == null || row.week52Low === 0)
            break;
          const gap = ((row.close - row.week52Low) / row.week52Low) * 100;
          if (gap <= threshold)
            hit = {
              message: `${row.symbol} is ${gap.toFixed(1)}% above its 52-week low of ${fmt(row.week52Low)}`,
              value: gap,
            };
          break;
        }
      }
    }

    if (!hit) continue;

    db.insert(alertEvents)
      .values({
        id: randomUUID(),
        alertId: rule.id,
        symbol: rule.symbol,
        date,
        message: hit.message,
        value: hit.value,
        acknowledged: false,
        createdAt: new Date(),
      })
      .run();

    fired.push({
      alertId: rule.id,
      symbol: rule.symbol,
      message: hit.message,
      value: hit.value,
    });
  }

  return fired;
}

function hasFiredOn(alertId: string, date: string): boolean {
  const existing = db
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(and(eq(alertEvents.alertId, alertId), eq(alertEvents.date, date)))
    .get();
  return Boolean(existing);
}

function fmt(value: number): string {
  return value.toLocaleString("en-PK", { maximumFractionDigits: 2 });
}

export function listAlerts() {
  return db.select().from(alerts).orderBy(desc(alerts.createdAt)).all();
}

export function listAlertEvents(limit = 100) {
  return db
    .select()
    .from(alertEvents)
    .orderBy(desc(alertEvents.createdAt))
    .limit(limit)
    .all();
}

export function createAlert(input: {
  symbol: string | null;
  kind: AlertKind;
  threshold: number | null;
  note?: string | null;
}) {
  const id = randomUUID();
  db.insert(alerts)
    .values({
      id,
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

export function deleteAlert(id: string) {
  db.delete(alertEvents).where(eq(alertEvents.alertId, id)).run();
  db.delete(alerts).where(eq(alerts.id, id)).run();
}

export function setAlertActive(id: string, active: boolean) {
  db.update(alerts).set({ active }).where(eq(alerts.id, id)).run();
}

export function acknowledgeEvent(id: string) {
  db.update(alertEvents)
    .set({ acknowledged: true })
    .where(eq(alertEvents.id, id))
    .run();
}
