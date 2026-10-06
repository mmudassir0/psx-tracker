"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { headers } from "next/headers";
import { auth, getCurrentUser, getCurrentUserId } from "@/lib/auth";
import {
  addTransaction,
  deleteTransaction,
  getHoldings,
  importTransactions,
  moveTransaction,
  type TransactionType,
} from "@/lib/portfolio";
import {
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  normaliseRow,
  parseCsv,
  type ColumnMapping,
  type DateOrder,
  type ImportedTx,
} from "@/lib/csv-import";
import {
  createPortfolio,
  deletePortfolio,
  renamePortfolio,
} from "@/lib/portfolios";
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
import { ingestRuns, watchlist } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { setUserSetting } from "@/lib/settings";
import { notifyAlerts } from "@/lib/notify";
import {
  isValidSubscription,
  pushConfigured,
  removeSubscription,
  saveSubscription,
  sendPushToUser,
} from "@/lib/push";
import {
  createTelegramLink,
  deliverAlerts,
  sendTelegram,
  telegramConfigured,
  updateNotifySettings,
  getNotifySettingsFor,
} from "@/lib/user-notify";
import {
  recordScreenHits,
  createCustomScreen,
  updateCustomScreen,
  deleteCustomScreen,
} from "@/lib/screens";
import { getZakatSettings, ZAKAT_SETTINGS_KEY } from "@/lib/zakat";

export interface ActionState {
  ok: boolean;
  message: string;
}

// Every write below resolves the user from the session itself and only ever
// touches that user's rows: hiding a form does not stop a direct call.
const NOT_LOGGED_IN: ActionState = {
  ok: false,
  message: "Log in to make changes.",
};

/** For plain form actions, which have no state to report an error into. */
async function userIdOrThrow(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Log in to make changes.");
  return userId;
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
  price: z.coerce.number().min(0, "Price cannot be negative"),
  fees: z.coerce.number().min(0).default(0),
  note: z.string().trim().max(200).optional(),
});

export async function addTransactionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
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
  await addTransaction(userId, {
    symbol: input.symbol,
    date: input.date,
    type: input.type as TransactionType,
    quantity: input.quantity,
    price: input.price,
    fees: input.fees,
    note: input.note ?? undefined,
    portfolioId: String(formData.get("portfolioId") ?? "") || null,
  });

  revalidatePath("/portfolio");
  revalidatePath("/");
  return {
    ok: true,
    message: `Recorded ${input.type} of ${input.quantity} ${input.symbol}`,
  };
}

export async function deleteTransactionAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteTransaction(userId, id);
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
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
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

  await createAlert(userId, {
    symbol,
    kind: kind as AlertKind,
    threshold: membershipRule ? null : threshold,
    note: note ?? null,
  });

  await evaluateAlerts(userId);

  revalidatePath("/alerts");
  return { ok: true, message: "Alert created" };
}

export async function deleteAlertAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteAlert(userId, id);
  revalidatePath("/alerts");
}

export async function toggleAlertAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  if (id) await setAlertActive(userId, id, active);
  revalidatePath("/alerts");
}

export async function acknowledgeEventAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const id = String(formData.get("id") ?? "");
  if (id) await acknowledgeEvent(userId, id);
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
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
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

  const zakatablePct: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("zakatable_")) continue;
    const symbol = key.slice("zakatable_".length);
    const pct = Number(value);
    if (Number.isFinite(pct)) {
      zakatablePct[symbol] = Math.min(100, Math.max(0, pct));
    }
  }

  const current = await getZakatSettings(userId);
  await setUserSetting(userId, ZAKAT_SETTINGS_KEY, {
    ...current,
    ...parsed.data,
    zakatablePct,
  });

  revalidatePath("/zakat");
  return { ok: true, message: "Saved" };
}

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

export async function getIngestStatusAction(): Promise<IngestStatus> {
  const run = await db
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

export async function startIngestAction(
  scope: IngestScope = "full",
): Promise<ActionState> {
  // Ingests hit PSX and rewrite shared market data: admins only.
  const user = await getCurrentUser();
  if (!user) return NOT_LOGGED_IN;
  if (user.role !== "admin") {
    return { ok: false, message: "Only an admin can refresh market data." };
  }
  // PSX answers Vercel's IPs with HTTP 462, so a run started here can only
  // fail. The daily GitHub Actions workflow does the real updates.
  if (process.env.VERCEL) {
    return {
      ok: false,
      message:
        "PSX blocks refreshes from this server. Data updates automatically every weekday around 4–6 PM PKT.",
    };
  }

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

  void runIngest({ ...options, trigger: "ui" })
    .then(async () => {
      try {
        await recordScreenHits();
        // Every user's alerts, as the daily job does.
        const fired = await evaluateAlerts();
        notifyAlerts(fired);
        await deliverAlerts(fired);
      } catch {
      }
    })
    .catch((err) => {
      console.error("UI-triggered ingest failed:", err);
    });

  return { ok: true, message: `Started: ${SCOPE_LABELS[scope]}` };
}

export async function revalidateAllAction() {
  revalidatePath("/", "layout");
}

export async function addToWatchlistAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!symbol) return { ok: false, message: "Symbol is required" };

  const { getConstituent } = await import("@/lib/market");
  const view = await getConstituent(symbol, "ALLSHR");
  if (!view) {
    return { ok: false, message: `${symbol} is not a symbol PSX lists` };
  }

  await db.insert(watchlist)
    .values({
      userId,
      symbol,
      note,
      addedPrice: view.close ?? null,
      addedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [watchlist.userId, watchlist.symbol],
      set: { note },
    })
    .run();

  revalidatePath("/watchlist");
  return { ok: true, message: `${symbol} added` };
}

export async function removeFromWatchlistAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const symbol = String(formData.get("symbol") ?? "");
  if (symbol) {
    await db
      .delete(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol)))
      .run();
  }
  revalidatePath("/watchlist");
}

const screenRuleSchema = z.object({
  metric: z.enum([
    "dividendYieldPct",
    "peTtm",
    "epsGrowthPct",
    "revenueGrowthPct",
    "netMarginPct",
    "ytdChangePct",
    "year1ChangePct",
    "drawdownFrom52wPct",
    "changePct",
    "marketCap",
    "tradedValue",
  ]),
  op: z.enum(["gte", "lte", "gt", "lt"]),
  value: z.number().finite(),
});

const screenSchema = z.object({
  name: z.string().trim().min(1, "Give the screen a name").max(60),
  description: z.string().trim().max(200).optional(),
  universe: z.enum(["all", "shariah"]),
  rules: z.array(screenRuleSchema).min(1, "Add at least one rule").max(8),
});

function parseScreenForm(formData: FormData) {
  let rules: unknown = [];
  try {
    rules = JSON.parse(String(formData.get("rules") ?? "[]"));
  } catch {
    rules = [];
  }

  return screenSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    universe: formData.get("universe"),
    rules,
  });
}

export async function saveScreenAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const parsed = parseScreenForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid screen",
    };
  }

  const existingId = String(formData.get("id") ?? "").trim();
  if (existingId) {
    await updateCustomScreen(userId, existingId, parsed.data);
    revalidatePath("/screens");
    revalidatePath(`/screens/${existingId}`);
    return { ok: true, message: "Screen updated" };
  }

  const id = await createCustomScreen(userId, parsed.data);
  revalidatePath("/screens");
  redirect(`/screens/${id}`);
}

export async function deleteScreenAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteCustomScreen(userId, id);
  revalidatePath("/screens");
  redirect("/screens");
}

export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function createPortfolioAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await createPortfolio(userId, String(formData.get("name") ?? ""));
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath("/portfolio");
  redirect(`/portfolio?p=${result.id}`);
}

export async function renamePortfolioAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await renamePortfolio(
    userId,
    String(formData.get("portfolioId") ?? ""),
    String(formData.get("name") ?? ""),
  );
  revalidatePath("/portfolio");
  return result;
}

export async function deletePortfolioAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const result = await deletePortfolio(userId, String(formData.get("portfolioId") ?? ""));
  if (!result.ok) return result;
  revalidatePath("/portfolio");
  redirect("/portfolio");
}

export async function moveTransactionAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const id = String(formData.get("id") ?? "");
  const portfolioId = String(formData.get("portfolioId") ?? "");
  if (id && portfolioId) await moveTransaction(userId, id, portfolioId);
  revalidatePath("/portfolio");
}

const dividendSchema = z.object({
  symbol: z.string().trim().min(1, "Pick a symbol").max(20).transform((s) => s.toUpperCase()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"),
  perShare: z.coerce.number().positive("Enter the dividend per share"),
  quantity: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  taxMode: z.enum(["filer", "nonfiler", "none", "custom"]),
  taxAmount: z.union([z.literal(""), z.coerce.number().min(0)]).optional(),
});

/** Withholding tax on dividends in Pakistan: 15% for filers, 30% otherwise. */
const DIVIDEND_TAX_RATE = { filer: 0.15, nonfiler: 0.3, none: 0 } as const;

export async function recordDividendAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const parsed = dividendSchema.safeParse({
    symbol: formData.get("symbol"),
    date: formData.get("date"),
    perShare: formData.get("perShare"),
    quantity: formData.get("quantity") ?? "",
    taxMode: formData.get("taxMode"),
    taxAmount: formData.get("taxAmount") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid dividend" };
  }
  const { symbol, date, perShare, taxMode } = parsed.data;
  const portfolioId = String(formData.get("portfolioId") ?? "") || null;

  // Blank quantity: what this portfolio held on that date.
  let quantity = typeof parsed.data.quantity === "number" ? parsed.data.quantity : 0;
  if (!quantity) {
    const held = await getHoldings(userId, { portfolioId, asOf: date });
    quantity = held.find((h) => h.symbol === symbol)?.quantity ?? 0;
    if (quantity <= 0) {
      return { ok: false, message: `You held no ${symbol} on ${date}. Enter the number of shares.` };
    }
  }

  const gross = quantity * perShare;
  const tax =
    taxMode === "custom"
      ? typeof parsed.data.taxAmount === "number"
        ? parsed.data.taxAmount
        : 0
      : Math.round(gross * DIVIDEND_TAX_RATE[taxMode] * 100) / 100;
  if (tax > gross) return { ok: false, message: "Tax withheld can't be more than the dividend." };

  await addTransaction(userId, {
    symbol,
    date,
    type: "dividend",
    quantity,
    price: perShare,
    fees: tax,
    portfolioId,
  });

  revalidatePath("/portfolio");
  return {
    ok: true,
    message: `Recorded ${symbol} dividend: ${quantity} × ${perShare} = ${gross.toFixed(2)}, tax ${tax.toFixed(2)}, net ${(gross - tax).toFixed(2)}`,
  };
}

export interface ImportState extends ActionState {
  imported?: number;
  skipped?: number;
  rejected?: number;
}

/**
 * The browser sends the raw CSV plus the column mapping it previewed; rows
 * are parsed again here with the same functions, so nothing the client
 * computed is trusted.
 */
export async function importTransactionsAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;

  const text = String(formData.get("csv") ?? "");
  if (text.length > 2_000_000) return { ok: false, message: "That file is too large (2 MB max)." };

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(String(formData.get("mapping") ?? "{}")) as ColumnMapping;
  } catch {
    return { ok: false, message: "Invalid column mapping." };
  }
  const order: DateOrder = formData.get("dateOrder") === "mdy" ? "mdy" : "dmy";
  const hasHeader = formData.get("hasHeader") !== "false";

  const rows = parseCsv(text).slice(hasHeader ? 1 : 0);
  if (rows.length === 0) return { ok: false, message: "No rows found." };
  if (rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, message: `Up to ${MAX_IMPORT_ROWS} rows per import; split the file.` };
  }
  for (const field of IMPORT_FIELDS) {
    if (field.required && !(Number.isInteger(mapping[field.key]) && mapping[field.key] >= 0)) {
      return { ok: false, message: `Choose which column holds "${field.label}".` };
    }
  }

  const valid: ImportedTx[] = [];
  for (const row of rows) {
    const result = normaliseRow(row, mapping, order);
    if (result.ok) valid.push(result.tx);
  }
  const rejected = rows.length - valid.length;
  if (valid.length === 0) return { ok: false, message: "None of the rows could be read.", rejected };

  const { imported, skipped } = await importTransactions(
    userId,
    String(formData.get("portfolioId") ?? "") || null,
    valid,
  );
  revalidatePath("/portfolio");
  return {
    ok: true,
    message:
      `Imported ${imported} transaction${imported === 1 ? "" : "s"}` +
      (skipped ? `, skipped ${skipped} already recorded` : "") +
      (rejected ? `, ${rejected} unreadable row${rejected === 1 ? "" : "s"} left out` : "") +
      ".",
    imported,
    skipped,
    rejected,
  };
}

export interface TelegramLinkState extends ActionState {
  link?: string;
}

/** A one-time t.me link; opening it in Telegram links that chat to you. */
export async function telegramLinkAction(): Promise<TelegramLinkState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  if (!telegramConfigured()) return { ok: false, message: "Telegram isn't set up on this site." };
  return {
    ok: true,
    message: "Open this link on the device where you use Telegram and press Start. It works once, for 15 minutes.",
    link: await createTelegramLink(userId),
  };
}

export async function disconnectTelegramAction() {
  const userId = await userIdOrThrow();
  await updateNotifySettings(userId, { telegramChatId: null });
  revalidatePath("/account");
}

export async function testTelegramAction(): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const { telegramChatId } = await getNotifySettingsFor(userId);
  if (!telegramChatId) return { ok: false, message: "Telegram isn't connected." };
  const ok = await sendTelegram(telegramChatId, "Test from PSX Tracker: alerts will arrive here.");
  return ok ? { ok: true, message: "Sent. Check Telegram." } : { ok: false, message: "Telegram didn't accept the message." };
}

export async function setEmailAlertsAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const user = await getCurrentUser();
  const enable = formData.get("enabled") === "true";
  // Only a verified address can receive alerts, or anyone could make the
  // site email a stranger by signing up with their address.
  if (enable && !user?.emailVerified) throw new Error("Verify your email first.");
  await updateNotifySettings(userId, { email: enable });
  revalidatePath("/account");
}

export async function dismissOnboardingAction() {
  const userId = await userIdOrThrow();
  await setUserSetting(userId, "onboarding", { dismissed: true });
  revalidatePath("/");
}

/** Store this browser's push subscription for the logged-in user. */
export async function savePushSubscriptionAction(
  subscription: unknown,
  device: string,
): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  if (!pushConfigured()) return { ok: false, message: "Notifications aren't set up on this site." };
  if (!isValidSubscription(subscription)) return { ok: false, message: "The browser sent an invalid subscription." };
  const result = await saveSubscription(userId, subscription, device || null);
  if (!result.ok) return { ok: false, message: result.message ?? "Couldn't save." };
  revalidatePath("/account");
  return { ok: true, message: "Notifications are on for this device." };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  if (typeof endpoint === "string" && endpoint) await removeSubscription(userId, endpoint);
  revalidatePath("/account");
  return { ok: true, message: "Notifications are off for this device." };
}

export async function testPushAction(): Promise<ActionState> {
  const userId = await getCurrentUserId();
  if (!userId) return NOT_LOGGED_IN;
  const delivered = await sendPushToUser(userId, {
    title: "PSX Tracker",
    body: "Test notification: your alerts will arrive like this.",
    url: "/account#notifications",
    tag: "psx-test",
  });
  return delivered > 0
    ? { ok: true, message: `Sent to ${delivered} device${delivered === 1 ? "" : "s"}.` }
    : { ok: false, message: "No device accepted it. Turn notifications on first." };
}

/** Save which index the dashboard opens on for this user. */
export async function setDashboardIndexAction(formData: FormData) {
  const userId = await userIdOrThrow();
  const code = String(formData.get("index") ?? "").toUpperCase();
  const { getTrackedIndexCodes } = await import("@/lib/market");
  if (!(await getTrackedIndexCodes()).includes(code)) return;
  await setUserSetting(userId, "dashboard", { index: code });
  revalidatePath("/");
  redirect("/");
}
