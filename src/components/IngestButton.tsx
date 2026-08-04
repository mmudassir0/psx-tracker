"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startIngestAction,
  getIngestStatusAction,
  revalidateAllAction,
  type IngestScope,
  type IngestStatus,
} from "@/app/actions";

const SCOPES: { key: IngestScope; label: string; hint: string }[] = [
  { key: "quick", label: "Quick", hint: "Quotes & membership · ~5s" },
  { key: "kmi30", label: "KMI30", hint: "KMI30 fundamentals · ~30s" },
  { key: "full", label: "Full", hint: "Everything · ~4min" },
];

/**
 * Starts an ingest and polls for progress.
 *
 * A full run takes minutes, so the action returns as soon as the run starts
 * and progress is read back from the database. Polling also means a run
 * started by the CLI or the scheduled LaunchAgent shows up here — the button
 * disables itself rather than letting two writers hit the same SQLite file.
 */
export function IngestButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    const next = await getIngestStatusAction();
    setStatus(next);

    // Refresh the page data once, on the transition from running to done.
    if (wasRunning.current && !next.running) {
      await revalidateAllAction();
      router.refresh();
      setMessage(
        next.status === "ok" ? "Finished" : (next.detail ?? "Finished with errors"),
      );
    }
    wasRunning.current = next.running;
  }, [router]);

  useEffect(() => {
    void poll();
  }, [poll]);

  // Poll hard while a run is in flight, gently otherwise — this page can sit
  // open for hours and the scheduled run should still show up.
  useEffect(() => {
    const interval = status?.running ? 1500 : 30_000;
    const id = setInterval(() => void poll(), interval);
    return () => clearInterval(id);
  }, [status?.running, poll]);

  const running = status?.running ?? false;

  function start(scope: IngestScope) {
    setOpen(false);
    setMessage(null);
    startTransition(async () => {
      const result = await startIngestAction(scope);
      setMessage(result.message);
      if (result.ok) wasRunning.current = true;
      await poll();
    });
  }

  const elapsed =
    running && status?.startedAt
      ? Math.max(0, Math.round((Date.now() - status.startedAt) / 1000))
      : null;

  return (
    <div className="relative flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {running ? (
          <span className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700">
            <Spinner />
            <span className="font-medium">Ingesting…</span>
            {elapsed != null && (
              <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                {elapsed}s
              </span>
            )}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {pending ? "Starting…" : "Refresh data"}
          </button>
        )}
      </div>

      {open && !running && (
        <div className="absolute top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => start(s.key)}
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <span className="text-sm font-medium">{s.label}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {s.hint}
              </span>
            </button>
          ))}
        </div>
      )}

      {running && status?.progress && !compact && (
        <span className="max-w-[280px] truncate text-xs text-slate-500 dark:text-slate-400">
          {status.progress}
        </span>
      )}

      {!running && message && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {message}
        </span>
      )}

      {!running && status?.trigger === "schedule" && !message && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Last run was scheduled
        </span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-slate-600 dark:border-t-slate-100"
    />
  );
}
