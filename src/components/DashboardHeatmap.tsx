"use client";

import { useState } from "react";
import { saveHeatmapViewAction } from "@/app/actions";
import { MarketHeatmap, type HeatmapDatum } from "@/components/MarketHeatmap";
import { MarketSunburst } from "@/components/MarketSunburst";

type View = "boxes" | "rings";

/** The dashboard heatmap with a Boxes / Rings switch, remembered per account. */
export function DashboardHeatmap({
  data,
  indexCode,
  indexChangePct,
  initialView,
  canSave,
}: {
  data: HeatmapDatum[];
  indexCode: string;
  indexChangePct: number | null;
  initialView: View;
  /** Logged in: the choice is saved to the account. */
  canSave: boolean;
}) {
  const [view, setView] = useState<View>(initialView);

  const choose = (next: View) => {
    setView(next);
    if (canSave) void saveHeatmapViewAction(next);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-1 text-sm" role="group" aria-label="Heatmap style">
        {(["boxes", "rings"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => choose(v)}
            className={
              view === v
                ? "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                : "rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800"
            }
          >
            {v === "boxes" ? "Boxes" : "Rings"}
          </button>
        ))}
      </div>
      {view === "rings" ? (
        <MarketSunburst key={indexCode} data={data} centreLabel={indexCode} centreChangePct={indexChangePct} />
      ) : (
        <MarketHeatmap data={data} />
      )}
    </div>
  );
}
