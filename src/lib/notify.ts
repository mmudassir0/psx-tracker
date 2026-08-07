import { execFile } from "node:child_process";
import { getSetting } from "@/lib/settings";

/**
 * Native macOS notifications for fired alerts.
 *
 * Alerts otherwise only exist in the UI, which means you have to go and look —
 * useless for the one that matters (a holding dropping out of KMI30).
 *
 * Deliberately defensive: notification failures must never break an ingest, so
 * every path here swallows its errors. On non-macOS it is a no-op.
 */

export const NOTIFY_SETTINGS_KEY = "notifications";

export interface NotifySettings {
  enabled: boolean;
  /** Also notify when an ingest finishes, not just when alerts fire. */
  onIngestComplete: boolean;
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  enabled: true,
  onIngestComplete: false,
};

export function getNotifySettings(): NotifySettings {
  return getSetting<NotifySettings>(
    NOTIFY_SETTINGS_KEY,
    DEFAULT_NOTIFY_SETTINGS,
  );
}

export function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * AppleScript string literals escape backslash and double-quote only, so
 * neutralising those is sufficient to keep alert text from breaking out of
 * the script. Newlines are collapsed because osascript rejects raw ones.
 */
function escapeAppleScript(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
    .slice(0, 400);
}

export function notify(
  title: string,
  message: string,
  subtitle?: string,
): void {
  if (!isMacOS()) return;
  if (!getNotifySettings().enabled) return;

  const script =
    `display notification "${escapeAppleScript(message)}" ` +
    `with title "${escapeAppleScript(title)}"` +
    (subtitle ? ` subtitle "${escapeAppleScript(subtitle)}"` : "");

  try {
    execFile("osascript", ["-e", script], (err) => {
      if (err) {
        // Most likely cause is the host app lacking notification permission.
        console.warn("notification failed:", err.message);
      }
    });
  } catch (err) {
    console.warn("notification failed to spawn:", err);
  }
}

export interface FiredAlertLike {
  symbol: string | null;
  message: string;
}

/**
 * Announce fired alerts.
 *
 * One notification per alert up to a small cap, then a single summary — a
 * screenful of banners is worse than none, and a recomposition event can fire
 * many rules at once.
 */
export function notifyAlerts(fired: FiredAlertLike[]): void {
  if (fired.length === 0) return;
  if (!isMacOS() || !getNotifySettings().enabled) return;

  const MAX_INDIVIDUAL = 3;

  if (fired.length <= MAX_INDIVIDUAL) {
    for (const alert of fired) {
      notify("KMI30 Tracker", alert.message, alert.symbol ?? undefined);
    }
    return;
  }

  notify(
    "KMI30 Tracker",
    `${fired.length} alerts fired. Open the Alerts page for detail.`,
    fired[0].message,
  );
}

export function notifyIngestComplete(summary: string, hadErrors: boolean): void {
  if (!getNotifySettings().onIngestComplete) return;
  notify(
    "KMI30 Tracker",
    summary,
    hadErrors ? "Completed with errors" : "Ingest complete",
  );
}
