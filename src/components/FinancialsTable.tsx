import type { CompanyFinancials } from "@/lib/financials";
import { TableWrap, Th, Td } from "@/components/ui";
import { toneClass } from "@/lib/format";

/**
 * Annual financials and ratios, years across the top as PSX presents them.
 *
 * Units are mixed within a single table — monetary rows are PKR thousands,
 * EPS is PKR per share, ratio rows are percentages or bare multiples — so
 * each row is formatted by its own inferred unit rather than one blanket rule.
 */
export function FinancialsTable({ data }: { data: CompanyFinancials }) {
  const { years, financials, ratios } = data;

  if (years.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No financials published for this company on PSX.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Section title="Financials" years={years} rows={financials} />
      <Section title="Ratios" years={years} rows={ratios} />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Monetary figures are in PKR thousands, as published. Line items differ
        by sector — banks report mark-up earned where other companies report
        sales — so a blank row means PSX does not publish that item for this
        company.
      </p>
    </div>
  );
}

function Section({
  title,
  years,
  rows,
}: {
  title: string;
  years: string[];
  rows: CompanyFinancials["financials"];
}) {
  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>Line item</Th>
              {years.map((y) => (
                <Th key={y} align="right">
                  {y}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((row) => (
              <tr key={row.lineItem}>
                <Td className="text-slate-600 dark:text-slate-400">
                  {row.lineItem}
                </Td>
                {years.map((y) => {
                  const value = row.byYear[y] ?? null;
                  // Growth can be negative and is worth colouring; a level
                  // like Sales is not a gain or loss, so it stays neutral.
                  const isDelta = /growth/i.test(row.lineItem);
                  return (
                    <Td
                      key={y}
                      align="right"
                      className={isDelta ? toneClass(value) : undefined}
                    >
                      {formatCell(value, row.unit)}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function formatCell(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "pkr_per_share") return value.toFixed(2);
  if (unit === "ratio") return value.toFixed(2);
  // PKR thousands: show in millions/billions so columns stay readable.
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}bn`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}mn`;
  return value.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}
