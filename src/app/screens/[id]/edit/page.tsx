import Link from "next/link";
import { notFound } from "next/navigation";
import { getScreen, toPreviewRows } from "@/lib/screens";
import { isDatabaseEmpty } from "@/lib/market";
import { ScreenBuilder } from "@/components/ScreenBuilder";
import { Card, PageHeader, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditScreenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (await isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> first.
      </EmptyState>
    );
  }

  const { id } = await params;
  const screen = await getScreen(id);
  if (!screen) notFound();

  const previewRows = await toPreviewRows();

  // Built-ins live in code, so editing one here would silently do nothing.
  if (screen.builtIn) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={screen.name}
          description="This is a built-in screen"
        />
        <EmptyState title="Built-in screens can't be edited">
          <p>
            Their definitions live in the codebase so they stay consistent. To
            adapt one, create a new screen with the criteria you want.
          </p>
          <Link
            href="/screens/new"
            className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          >
            New screen
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Edit ${screen.name}`}
        description="Changes take effect immediately; the next ingest re-records matches."
        actions={
          <Link
            href={`/screens/${screen.id}`}
            className="text-xs underline underline-offset-2"
          >
            ← Back to screen
          </Link>
        }
      />

      <Card>
        <ScreenBuilder
          rows={previewRows}
          existing={{
            id: screen.id,
            name: screen.name,
            description: screen.description,
            rules: screen.rules,
            universe: screen.universe,
          }}
        />
      </Card>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Editing clears this screen&apos;s stored match history — those rows were
        produced by the old criteria, so keeping them would make the next
        &ldquo;new today&rdquo; diff meaningless.
      </p>
    </div>
  );
}
