import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { ensureDefaultPortfolio, listPortfolios } from "@/lib/portfolios";
import { Card, PageHeader } from "@/components/ui";
import { CsvImporter } from "@/components/CsvImporter";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const user = await requireUser("/portfolio/import");
  const defaultId = await ensureDefaultPortfolio(user.id);
  const portfolios = (await listPortfolios(user.id)).map(({ id, name }) => ({ id, name }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Import transactions"
        description="Upload a trade history CSV from your broker. Nothing is saved until you press Import, and rows you already recorded are skipped."
        actions={
          <Link href="/portfolio" className="text-sm underline">
            Back to portfolio
          </Link>
        }
      />
      <Card>
        <CsvImporter portfolios={portfolios} defaultPortfolioId={defaultId} />
      </Card>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Most brokers can export a trade or contract-note history as CSV or Excel (save Excel as CSV first).
        Each row needs a date, symbol, quantity and price; buy/sell, fees and a note are optional.
      </p>
    </div>
  );
}
