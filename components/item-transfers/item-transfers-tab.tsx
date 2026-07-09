"use client";

import { useCallback, useEffect, useState } from "react";
import {
  mdiRefresh,
  mdiLoading,
  mdiEye,
  mdiReplay,
  mdiDatabaseImport,
  mdiChevronLeft,
  mdiChevronRight,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StateBadge } from "@/components/badges";
import { callTransferApi } from "@/src/utils/transfer-api";
import type {
  EnvironmentConnection,
  ItemTransferDetails,
  ItemTransferEntry,
  ItemTransfersPage,
  TransferredItemsPage,
} from "@/src/types/transfer";

const PAGE_SIZE = 20;

interface ItemTransfersTabProps {
  destination: EnvironmentConnection;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

export function ItemTransfersTab({
  destination,
  onError,
  showToast,
}: ItemTransfersTabProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItemTransfersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ItemTransferEntry | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callTransferApi<ItemTransfersPage>(
        destination,
        `/api/item-transfer/transfers?page=${page}&pageSize=${PAGE_SIZE}`,
      );
      setData(result);
    } catch (error) {
      onError(error, "load the item transfers");
    } finally {
      setLoading(false);
    }
  }, [destination, page, onError]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRetry = async (entry: ItemTransferEntry) => {
    setRetrying(entry.SourceName);
    try {
      await callTransferApi(
        destination,
        `/api/item-transfer/databases/${encodeURIComponent(entry.DatabaseName)}/sources/${encodeURIComponent(entry.SourceName)}`,
        { method: "PUT" },
      );
      showToast("Retry queued", entry.SourceName, "success");
      await refresh();
    } catch (error) {
      onError(error, "retry the transfer");
    } finally {
      setRetrying(null);
    }
  };

  const transfers = data?.Transfers ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.TotalCount / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-muted bg-white p-4">
        <p className="text-sm text-text-subtle">
          Active and completed consumptions on{" "}
          <strong>{destination.label}</strong>, across all databases.
        </p>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <Icon path={mdiRefresh} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-text-subtle">
          <Icon path={mdiLoading} className="animate-spin" />
          Loading item transfers&hellip;
        </div>
      ) : transfers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border-muted bg-white py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-fg">
            <Icon path={mdiDatabaseImport} size={1} />
          </div>
          <div>
            <p className="font-bold">No item transfers</p>
            <p className="text-sm text-text-subtle">
              Consumed .raif sources will appear here.
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
                    Database
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Consumed
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    State
                  </th>
                  <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Strategy
                  </th>
                  <th className="px-4 py-3 text-right font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((entry) => (
                  <tr
                    key={`${entry.DatabaseName}-${entry.Id}`}
                    className="border-b border-border-muted last:border-b-0 hover:bg-surface-container-low/60"
                  >
                    <td
                      className="max-w-[320px] truncate px-4 py-3 font-mono text-xs"
                      title={entry.SourceName}
                    >
                      {entry.SourceName}
                    </td>
                    <td className="px-4 py-3">{entry.DatabaseName || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDate(entry.ConsumedDate)}
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge state={entry.TransferState} />
                    </td>
                    <td className="px-4 py-3 text-xs">{entry.Strategy ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setSelected(entry)}
                          aria-label={`View ${entry.SourceName}`}
                        >
                          <Icon path={mdiEye} />
                        </Button>
                        {entry.TransferState === "Failed" && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRetry(entry)}
                            disabled={retrying === entry.SourceName}
                            aria-label={`Retry ${entry.SourceName}`}
                            title="Retry this failed transfer"
                          >
                            <Icon
                              path={retrying === entry.SourceName ? mdiLoading : mdiReplay}
                              className={retrying === entry.SourceName ? "animate-spin" : ""}
                            />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.TotalCount > PAGE_SIZE && (
        <Pager page={page} totalPages={totalPages} onPageChange={setPage} />
      )}

      <TransferDetailsDialog
        destination={destination}
        entry={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // .NET serializes an unset DateTime as 0001-01-01; treat it as "no date".
  if (date.getFullYear() <= 1) return "—";
  return date.toLocaleString();
}

export function Pager({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <Icon path={mdiChevronLeft} />
      </Button>
      <span className="text-xs text-text-subtle">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <Icon path={mdiChevronRight} />
      </Button>
    </div>
  );
}

function TransferDetailsDialog({
  destination,
  entry,
  onClose,
}: {
  destination: EnvironmentConnection;
  entry: ItemTransferEntry | null;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<ItemTransferDetails | null>(null);
  const [items, setItems] = useState<TransferredItemsPage | null>(null);
  const [itemsPage, setItemsPage] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entry) {
      setDetails(null);
      setItems(null);
      setItemsPage(1);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);

      // The detail endpoint can 404 for blob-name ids; try both known ids
      // and fall back to the list entry so the dialog always has data.
      let detailsResult: ItemTransferDetails = entry;
      for (const id of new Set([entry.Id, entry.SourceName])) {
        if (!id) continue;
        try {
          const enriched = await callTransferApi<ItemTransferDetails>(
            destination,
            `/api/item-transfer/transfers/${encodeURIComponent(id)}`,
          );
          if (enriched) {
            detailsResult = { ...entry, ...enriched };
            break;
          }
        } catch {
          // Fall back to the list entry.
        }
      }

      let itemsResult: TransferredItemsPage | null = null;
      try {
        itemsResult = await callTransferApi<TransferredItemsPage>(
          destination,
          `/api/item-transfer/databases/${encodeURIComponent(entry.DatabaseName)}/sources/${encodeURIComponent(entry.SourceName)}/items?page=${itemsPage}&pageSize=${PAGE_SIZE}`,
        );
      } catch {
        // Items are best-effort; the dialog shows what it could load.
      }

      if (!cancelled) {
        setDetails(detailsResult);
        setItems(itemsResult);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, itemsPage, destination]);

  const itemsTotalPages = items
    ? Math.max(1, Math.ceil(items.TotalCount / PAGE_SIZE))
    : 1;

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer details</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {entry?.SourceName}
          </DialogDescription>
        </DialogHeader>

        {loading && !details ? (
          <div className="flex items-center justify-center gap-2 py-8 text-text-subtle">
            <Icon path={mdiLoading} className="animate-spin" />
            Loading&hellip;
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="State">
                <StateBadge state={details?.TransferState ?? entry?.TransferState} />
              </Stat>
              <Stat label="Database">{details?.DatabaseName ?? entry?.DatabaseName ?? "—"}</Stat>
              <Stat label="Items transferred">
                {details
                  ? `${details.TransferredItemsCount ?? 0} / ${details.TotalItemsCount ?? "?"}`
                  : "—"}
              </Stat>
              <Stat label="Consumed">{formatDate(details?.ConsumedDate ?? entry?.ConsumedDate)}</Stat>
            </div>

            {details?.Description && (
              <p className="text-sm text-text-subtle">{details.Description}</p>
            )}

            {details?.ValidationErrors && details.ValidationErrors.length > 0 && (
              <div className="rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
                <p className="font-semibold">Validation errors</p>
                <ul className="mt-1 list-inside list-disc">
                  {details.ValidationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Transferred items</p>
              {items && items.Items.length > 0 ? (
                <>
                  <div className="overflow-hidden rounded-lg border border-border-muted">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-border-muted bg-surface-grey">
                          <th className="px-3 py-2 font-mono font-bold uppercase tracking-wider text-on-surface-variant">
                            Name
                          </th>
                          <th className="px-3 py-2 font-mono font-bold uppercase tracking-wider text-on-surface-variant">
                            Item ID
                          </th>
                          <th className="px-3 py-2 font-mono font-bold uppercase tracking-wider text-on-surface-variant">
                            Modified
                          </th>
                          <th className="px-3 py-2 font-mono font-bold uppercase tracking-wider text-on-surface-variant">
                            Transferred
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.Items.map((item) => (
                          <tr
                            key={item.Id}
                            className="border-b border-border-muted last:border-b-0"
                          >
                            <td className="px-3 py-2 font-medium">{item.Name}</td>
                            <td className="px-3 py-2 font-mono">{item.Id}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {formatDate(item.TimeStampDate)}
                            </td>
                            <td className="px-3 py-2">
                              {item.IsTransferred ? (
                                <span className="text-success-fg">Yes</span>
                              ) : (
                                <span className="text-danger-fg">No</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {items.TotalCount > PAGE_SIZE && (
                    <Pager
                      page={itemsPage}
                      totalPages={itemsTotalPages}
                      onPageChange={setItemsPage}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-text-subtle">
                  No item details available.
                </p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-container-low p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-subtle">
        {label}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
