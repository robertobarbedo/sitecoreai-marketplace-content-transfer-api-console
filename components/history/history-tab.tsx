"use client";

import { useCallback, useEffect, useState } from "react";
import { mdiRefresh, mdiLoading, mdiHistory } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/badges";
import {
  Pager,
  formatDate,
} from "@/components/item-transfers/item-transfers-tab";
import { callTransferApi } from "@/src/utils/transfer-api";
import type {
  EnvironmentConnection,
  HistoryPage,
} from "@/src/types/transfer";

const PAGE_SIZE = 20;

/**
 * The history endpoint can leave ConsumeDate unset (serialized as the .NET
 * minimum date 0001-01-01). Fall back to the Finished event's timestamp —
 * the actual consumed moment — or the latest transition otherwise.
 */
function resolveConsumeDate(entry: {
  ConsumeDate?: string;
  Events?: { Name: string; Date: string }[];
}): string | undefined {
  if (entry.ConsumeDate) {
    const date = new Date(entry.ConsumeDate);
    if (!Number.isNaN(date.getTime()) && date.getFullYear() > 1) {
      return entry.ConsumeDate;
    }
  }
  const events = entry.Events ?? [];
  const finished = [...events].reverse().find((e) => e.Name === "Finished");
  return finished?.Date ?? events[events.length - 1]?.Date;
}

interface HistoryTabProps {
  destination: EnvironmentConnection;
  onError: (error: unknown, action: string) => void;
}

export function HistoryTab({ destination, onError }: HistoryTabProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callTransferApi<HistoryPage>(
        destination,
        `/api/item-transfer/history?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      setData(result);
    } catch (error) {
      onError(error, "load the transfer history");
    } finally {
      setLoading(false);
    }
  }, [destination, page, onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sources = data?.Sources ?? [];
  const totalPages = data
    ? Math.max(1, Math.ceil(data.TotalCount / PAGE_SIZE))
    : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-muted bg-white p-4">
        <p className="text-sm text-text-subtle">
          Timeline of sources consumed on <strong>{destination.label}</strong>,
          newest first. Expand a row to see its state transitions.
        </p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <Icon path={mdiRefresh} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-text-subtle">
          <Icon path={mdiLoading} className="animate-spin" />
          Loading history&hellip;
        </div>
      ) : sources.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border-muted bg-white py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-fg">
            <Icon path={mdiHistory} size={1} />
          </div>
          <div>
            <p className="font-bold">No history yet</p>
            <p className="text-sm text-text-subtle">
              Consumed sources and their state transitions will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-muted bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-muted bg-surface-grey">
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Source
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Consumed
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Strategy
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Last state
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => {
                  const lastEvent = source.Events?.[source.Events.length - 1];
                  const isExpanded = expanded === source.Name;
                  return (
                    <HistoryRow
                      key={source.Name}
                      sourceName={source.SourceName}
                      consumeDate={resolveConsumeDate(source)}
                      strategy={source.Strategy}
                      lastState={lastEvent?.Name}
                      events={source.Events ?? []}
                      expanded={isExpanded}
                      onToggle={() =>
                        setExpanded(isExpanded ? null : source.Name)
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.TotalCount > PAGE_SIZE && (
        <Pager page={page} totalPages={totalPages} onPageChange={setPage} />
      )}
    </div>
  );
}

function HistoryRow({
  sourceName,
  consumeDate,
  strategy,
  lastState,
  events,
  expanded,
  onToggle,
}: {
  sourceName: string;
  consumeDate?: string;
  strategy?: string;
  lastState?: string;
  events: { Name: string; Date: string }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-border-muted last:border-b-0 hover:bg-surface-container-low/60"
        onClick={onToggle}
      >
        <td
          className="max-w-[360px] truncate px-4 py-3 font-mono text-xs"
          title={sourceName}
        >
          {sourceName}
        </td>
        <td className="whitespace-nowrap px-4 py-3">{formatDate(consumeDate)}</td>
        <td className="px-4 py-3 text-xs">{strategy ?? "—"}</td>
        <td className="px-4 py-3">
          <StateBadge state={lastState} />
        </td>
      </tr>
      {expanded && events.length > 0 && (
        <tr className="border-b border-border-muted bg-surface-container-low/40 last:border-b-0">
          <td colSpan={4} className="px-4 py-3">
            <ol className="flex flex-wrap items-center gap-2 text-xs">
              {events.map((event, index) => (
                <li key={index} className="flex items-center gap-2">
                  {index > 0 && <span className="text-text-subtle">→</span>}
                  <StateBadge state={event.Name} />
                  <span className="text-text-subtle">
                    {formatDate(event.Date)}
                  </span>
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}
