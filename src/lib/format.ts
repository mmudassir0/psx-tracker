const PKR = new Intl.NumberFormat("en-PK", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const PLAIN = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** Price or amount with 2dp. */
export function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return PKR.format(value);
}

/** Whole-number quantities and volumes. */
export function count(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return PLAIN.format(value);
}

/** Signed percentage, e.g. "+1.47%". */
export function pct(
  value: number | null | undefined,
  digits = 2,
  signed = true,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** Large PKR amounts as bn/mn/k so tables stay narrow. */
export function compactPkr(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}bn`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}mn`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}

/** Signed PKR amount for P&L cells. */
export function signedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${PKR.format(Math.abs(value))}`;
}

/** Tailwind class for a gain/loss value. Zero stays neutral. */
export function toneClass(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0)
    return "text-slate-500 dark:text-slate-400";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

/** "2026-08-03" -> "3 Aug 2026". */
export function prettyDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function relativeTime(input: Date | number | null | undefined): string {
  if (input == null) return "never";
  const ts = input instanceof Date ? input.getTime() : input;
  const diffMs = Date.now() - ts;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Sector codes seen in market-watch, for names the company page didn't fill. */
export function sectorLabel(
  sectorName: string | null,
  sectorCode: string | null,
): string {
  if (sectorName) return sectorName;
  return sectorCode ? `Sector ${sectorCode}` : "Unknown";
}
