"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addTransaction,
  deleteTransaction,
  type TransactionType,
} from "@/lib/portfolio";
import {
  createAlert,
  deleteAlert,
  setAlertActive,
  acknowledgeEvent,
  evaluateAlerts,
  type AlertKind,
} from "@/lib/alerts";
import { runIngest } from "@/lib/psx/ingest";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { ingestRuns } from "@/db/schema";
import { setSetting } from "@/lib/settings";
import { getZakatSettings, ZAKAT_SETTINGS_KEY } from "@/lib/zakat";

export interface ActionState {
  ok: boolean;
  message: string;
}

const transactionSchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1, "Symbol is required")
    .max(20)
    .transform((s) => s.toUpperCase()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"),
  type: z.enum(["buy", "sell", "dividend", "bonus", "rights"]),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  // Bonus shares are issued at no cost, so zero is valid here.
  price: z.coerce.number().min(0, "Price cannot be negative"),
  fees: z.coerce.number().min(0).default(0),
  note: z.string().trim().max(200).optional(),
});

export async function addTransactionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = transactionSchema.safeParse({
    symbol: formData.get("symbol"),
    date: formData.get("date"),
    type: formData.get("type"),
    quantity: formData.get("quantity"),
    price: formData.get("price"),
    fees: formData.get("fees") || 0,
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const input = parsed.data;
  addTransaction({
    symbol: input.symbol,
    date: input.date,
    type: input.type as TransactionType,
    quantity: input.quantity,
    price: input.price,
    fees: input.fees,
    note: input.note ?? null,
  });

  revalidatePath("/portfolio");
  revalidatePath("/");
  return {
    ok: true,
    message: `Recorded ${input.type} of ${input.quantity} ${input.symbol}`,
  };
}

export async function deleteTransactionAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) deleteTransaction(id);
  revalidatePath("/portfolio");
  revalidatePath("/");
}

const alertSchema = z.object({
  symbol: z
    .string()
    .trim()
    .transform((s) => (s ? s.toUpperCase() : null))
    .nullable(),
  kind: z.enum([
    "price_above",
    "price_below",
    "pe_above",
    "pe_below",
    "near_52w_high",
    "near_52w_low",
    "dropped_from_kmi30",
    "added_to_kmi30",
  ]),
  threshold: z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : Number(s)))
    .nullable(),
  note: z.string().trim().max(200).optional(),
});

export async function createAlertAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = alertSchema.safeParse({
    symbol: formData.get("symbol") || null,
    kind: formData.get("kind"),
    threshold: formData.get("threshold") ?? "",
    note: formData.get("note") || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid alert",
    };
  }

  const { symbol, kind, threshold, note } = parsed.data;
  const membershipRule =
    kind === "dropped_from_kmi30" || kind === "added_to_kmi30";

  if (!membershipRule && (threshold == null || !Number.isFinite(threshold))) {
    return { ok: false, message: "This alert type needs a numeric threshold" };
  }
  if (!membershipRule && !symbol) {
    return { ok: false, message: "This alert type needs a symbol" };
  }

  createAlert({
    symbol,
    kind: kind as AlertKind,
    threshold: membershipRule ? null : threshold,
    note: note ?? null,
  });

  // Fire immediately if the condition already holds, rather than waiting
  // for the next ingest.
  evaluateAlerts();

  revalidatePath("/alerts");
  return { ok: true, message: "Alert created" };
}

export async function deleteAlertAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) deleteAlert(id);
  revalidatePath("/alerts");
}

export async function toggleAlertAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (id) setAlertActive(id, active);
  revalidatePath("/alerts");
}

export async function acknowledgeEventAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (id) acknowledgeEvent(id);
  revalidatePath("/alerts");
}

const zakatSchema = z.object({
  nisabBasis: z.enum(["gold", "silver"]),
  metalPricePerGram: z.coerce.number().min(0),
  year: z.enum(["lunar", "solar"]),
  otherAssets: z.coerce.number().min(0),
  liabilities: z.coerce.number().min(0),
  defaultZakatablePct: z.coerce.number().min(0).max(100),
});

export async function saveZakatSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = zakatSchema.safeParse({
    nisabBasis: formData.get("nisabBasis"),
    metalPricePerGram: formData.get("metalPricePerGram") || 0,
    year: formData.get("year"),
    otherAssets: formData.get("otherAssets") || 0,
    liabilities: formData.get("liabilities") || 0,
    defaultZakatablePct: formData.get("defaultZakatablePct") || 100,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  // Per-symbol overrides arrive as zakatable_<SYMBOL> fields.
  const zakatablePct: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("zakatable_")) continue;
    const symbol = key.slice("zakatable_".length);
    const pct = Number(value);
    if (Number.isFinite(pct)) {
      zakatablePct[symbol] = Math.min(100, Math.max(0, pct));
    }
  }

  const current = getZakatSettings();
  setSetting(ZAKAT_SETTINGS_KEY, {
    ...current,
    ...parsed.data,
    zakatablePct,
  });

  revalidatePath("/zakat");
  return { ok: true, message: "Saved" };
}

// ---------------------------------------------------------------------------
// Ingest from the UI
// ---------------------------------------------------------------------------

/**
 * A full ingest takes minutes, so the button cannot await it — the request
 * would time out and the user would stare at a spinner with no feedback.
 * Instead the run is started in the background and its progress is written to
 * `ingest_runs`, which the client polls.
 *
 * This works because the app is a long-lived local Node process. It would not
 * survive a serverless deployment, which this is explicitly not.
 */

/** A run stuck in "running" for longer than this is treated as dead. */
const STALE_RUN_MS = 30 * 60 * 1000;

export type IngestScope = "quick" | "kmi30" | "full";

const SCOPE_LABELS: Record<IngestScope, string> = {
  quick: "Quotes & membership only",
  kmi30: "KMI30 fundamentals",
  full: "Everything",
};

export interface IngestStatus {
  running: boolean;
  progress: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  status: "running" | "ok" | "error" | null;
  detail: string | null;
  trigger: string | null;
}

/** Current ingest state, whether started here, by the CLI, or by launchd. */
export async function getIngestStatusAction(): Promise<IngestStatus> {
  const run = db
    .select()
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.startedAt))
    .limit(1)
    .get();

  if (!run) {
    return {
      running: false,
      progress: null,
      startedAt: null,
      finishedAt: null,
      status: null,
      detail: null,
      trigger: null,
    };
  }

  const startedMs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
  const stale = Date.now() - startedMs > STALE_RUN_MS;

  return {
    running: run.status === "running" && !stale,
    progress: run.progress,
    startedAt: startedMs || null,
    finishedAt: run.finishedAt ? new Date(run.finishedAt).getTime() : null,
    status: run.status,
    detail: run.detail,
    trigger: run.trigger,
  };
}

/**
 * Kick off an ingest and return immediately.
 *
 * The concurrency guard reads the database rather than in-process state, so it
 * also refuses to start when the scheduled LaunchAgent run is already going —
 * two processes writing the same SQLite file is worth avoiding.
 */
export async function startIngestAction(
  scope: IngestScope = "full",
): Promise<ActionState> {
  const current = await getIngestStatusAction();
  if (current.running) {
    return {
      ok: false,
      message:
        current.trigger === "schedule"
          ? "The scheduled run is already in progress"
          : "An ingest is already running",
    };
  }

  const options =
    scope === "quick"
      ? { includeFundamentals: false }
      : scope === "kmi30"
        ? {
            includeFundamentals: true,
            fundamentalScope: "indices" as const,
            fundamentalIndices: ["KMI30"],
          }
        : { includeFundamentals: true };

  // Deliberately not awaited: the action returns while the run continues.
  void runIngest({ ...options, trigger: "ui" })
    .then(() => {
      try {
        evaluateAlerts();
      } catch {
        // Alert evaluation failing must not mark the ingest itself failed.
      }
    })
    .catch((err) => {
      console.error("UI-triggered ingest failed:", err);
    });

  return { ok: true, message: `Started: ${SCOPE_LABELS[scope]}` };
}

/** Refresh the cached pages once a run finishes. */
export async function revalidateAllAction() {
  revalidatePath("/", "layout");
}
