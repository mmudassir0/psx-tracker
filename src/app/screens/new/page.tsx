import Link from "next/link";
import { toPreviewRows } from "@/lib/screens";
import { isDatabaseEmpty } from "@/lib/market";
import { ScreenBuilder } from "@/components/ScreenBuilder";
import { Card, PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function NewScreenPage() {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> before building screens.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New screen"
        description="Combine criteria and watch the match count update as you go."
        actions={
          <Link href="/screens" className="text-xs underline underline-offset-2">
            ← All screens
          </Link>
        }
      />

      <Card>
        <ScreenBuilder rows={toPreviewRows()} />
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Saved screens are evaluated on every ingest alongside the built-in ones,
        and their matches are recorded so you get a daily list of what newly
        entered. A criterion never matches a company that doesn&apos;t report
        that metric — around 55 of ~494 symbols have no fundamentals at all.
      </p>
    </div>
  );
}
