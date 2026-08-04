import Link from "next/link";
import type { ReactNode } from "react";
import { toneClass } from "@/lib/format";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A single headline number. Deliberately not a one-bar chart.
 * Values use proportional figures; only table columns get tabular-nums.
 */
export function StatTile({
  label,
  value,
  delta,
  hint,
  large = false,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: ReactNode;
  large?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div
        className={`mt-1.5 font-semibold tracking-tight ${large ? "text-4xl" : "text-2xl"}`}
      >
        {value}
      </div>
      {delta != null && Number.isFinite(delta) && (
        <div className={`mt-1 text-sm font-medium ${toneClass(delta)}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}{" "}
          {Math.abs(delta).toFixed(2)}%
        </div>
      )}
      {hint && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-sm font-medium">{title}</p>
      {children && (
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {children}
        </div>
      )}
    </div>
  );
}

/** Wide tables scroll inside their own container, never the page body. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>;
}

export function Th({
  children = null,
  align = "left",
  className = "",
}: {
  /** Optional so action columns can have an empty header. */
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400 text-${align} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children = null,
  align = "left",
  className = "",
}: {
  /** Optional so spacer cells in totals rows can be left empty. */
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={`whitespace-nowrap border-b border-slate-100 px-3 py-2 dark:border-slate-800/60 text-${align} ${className}`}
    >
      {children}
    </td>
  );
}

export function SymbolLink({ symbol }: { symbol: string }) {
  return (
    <Link
      href={`/symbol/${symbol}`}
      className="font-medium text-slate-900 underline-offset-2 hover:underline dark:text-slate-100"
    >
      {symbol}
    </Link>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "critical";
}) {
  const tones = {
    neutral:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    warning:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
    critical: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
