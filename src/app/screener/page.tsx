import { getConstituents, isDatabaseEmpty } from "@/lib/market";
import { ScreenerTable } from "@/components/ScreenerTable";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ScreenerPage() {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> to populate the database.
      </EmptyState>
    );
  }

  const rows = await getConstituents();

  return (
    <div>
      <PageHeader
        title="Screener"
        description="Sort and filter the 30 KMI30 constituents on valuation, momentum and size. Click any column header to sort."
      />
      <Card>
        <ScreenerTable rows={rows} />
      </Card>
    </div>
  );
}
