import {
  listAlerts,
  listAlertEvents,
  ALERT_LABELS,
  type AlertKind,
} from "@/lib/alerts";
import { getConstituents, isDatabaseEmpty } from "@/lib/market";
import {
  deleteAlertAction,
  toggleAlertAction,
  acknowledgeEventAction,
} from "@/app/actions";
import { AlertForm } from "@/components/AlertForm";
import {
  Card,
  StatTile,
  PageHeader,
  EmptyState,
  Badge,
  SymbolLink,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
import { prettyDate, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function AlertsPage() {
  if (isDatabaseEmpty()) {
    return (
      <EmptyState title="No data yet">
        Run <code>npm run setup</code> before creating alerts.
      </EmptyState>
    );
  }

  const alerts = listAlerts();
  const events = listAlertEvents(60);
  const constituents = getConstituents();
  const unacknowledged = events.filter((e) => !e.acknowledged);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Alerts"
        description="Rules are evaluated after each ingest and fire at most once per day, so re-running the ingest will not spam the log."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Unread triggers"
          value={unacknowledged.length}
          hint={unacknowledged.length > 0 ? "Needs review" : "All clear"}
          large
        />
        <StatTile
          label="Active rules"
          value={alerts.filter((a) => a.active).length}
          hint={`${alerts.length} total`}
        />
        <StatTile label="Events logged" value={events.length} hint="Most recent 60" />
      </div>

      {unacknowledged.length > 0 && (
        <Card title="Triggered" subtitle="Newest first">
          <ul className="flex flex-col gap-2">
            {unacknowledged.map((event) => (
              <li
                key={event.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40"
              >
                <div>
                  <p>{event.message}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {prettyDate(event.date)}
                  </p>
                </div>
                <form action={acknowledgeEventAction}>
                  <input type="hidden" name="id" value={event.id} />
                  <button
                    type="submit"
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-white dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Mark read
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Create an alert">
        <AlertForm symbols={constituents.map((c) => c.symbol)} />
      </Card>

      <Card title="Rules">
        {alerts.length > 0 ? (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <Th>Condition</Th>
                  <Th>Symbol</Th>
                  <Th align="right">Threshold</Th>
                  <Th>Status</Th>
                  <Th>Note</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody className="tabular">
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <Td>{ALERT_LABELS[alert.kind as AlertKind] ?? alert.kind}</Td>
                    <Td>
                      {alert.symbol ? (
                        <SymbolLink symbol={alert.symbol} />
                      ) : (
                        <span className="text-slate-500">all holdings</span>
                      )}
                    </Td>
                    <Td align="right">
                      {alert.threshold != null ? money(alert.threshold) : "—"}
                    </Td>
                    <Td>
                      {alert.active ? (
                        <Badge tone="good">active</Badge>
                      ) : (
                        <Badge tone="neutral">paused</Badge>
                      )}
                    </Td>
                    <Td className="max-w-[200px] truncate text-slate-500">
                      {alert.note ?? "—"}
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <form action={toggleAlertAction}>
                          <input type="hidden" name="id" value={alert.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={alert.active ? "false" : "true"}
                          />
                          <button
                            type="submit"
                            className="text-xs underline-offset-2 hover:underline"
                          >
                            {alert.active ? "Pause" : "Resume"}
                          </button>
                        </form>
                        <form action={deleteAlertAction}>
                          <input type="hidden" name="id" value={alert.id} />
                          <button
                            type="submit"
                            className="text-xs text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">
            No rules yet. The most useful first alert is{" "}
            <em>Dropped from KMI30</em> with the symbol left blank — it watches
            every position you hold for a Shariah-screen failure.
          </p>
        )}
      </Card>

      {events.length > 0 && (
        <Card title="Event log" subtitle="Including already-read triggers">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {events.map((event) => (
              <li key={event.id} className="flex gap-3 py-2">
                <span className="tabular w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {prettyDate(event.date)}
                </span>
                <span className="flex-1">{event.message}</span>
                {event.acknowledged && <Badge tone="neutral">read</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
