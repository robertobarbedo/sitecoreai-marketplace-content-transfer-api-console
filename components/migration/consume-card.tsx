"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  mdiRefresh,
  mdiLoading,
  mdiDatabaseImport,
  mdiDelete,
  mdiReplay,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EnvBadge, StateBadge } from "@/components/badges";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { callTransferApi } from "@/src/utils/transfer-api";
import type { RecentTransfer } from "@/src/utils/recent-transfers";
import type {
  BlobSource,
  BlobSourcesPage,
  EnvironmentConnection,
  ItemTransferDetails,
  ItemTransfersPage,
  StartItemTransferResult,
} from "@/src/types/transfer";

const POLL_INTERVAL_MS = 5000;
const ACTIVE_STATES = new Set(["InProgress", "Queued", "Unknown"]);

interface ConsumeCardProps {
  destination: EnvironmentConnection;
  activeTransfer: RecentTransfer | null;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

export function ConsumeCard({
  destination,
  activeTransfer,
  onError,
  showToast,
}: ConsumeCardProps) {
  const [database, setDatabase] = useState("master");
  const [blobs, setBlobs] = useState<BlobSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingBlob, setStartingBlob] = useState<string | null>(null);
  const [blobToDelete, setBlobToDelete] = useState<string | null>(null);
  const [monitored, setMonitored] = useState<
    Record<string, ItemTransferDetails | null>
  >({});
  const [retrying, setRetrying] = useState<string | null>(null);

  // .raif files produced by the currently active migration, for highlighting.
  const ownRaifFiles = useMemo(
    () => new Set(Object.values(activeTransfer?.raifFiles ?? {})),
    [activeTransfer],
  );

  const refreshBlobs = useCallback(async () => {
    setLoading(true);
    try {
      const page = await callTransferApi<BlobSourcesPage>(
        destination,
        "/api/item-transfer/sources/blobs?pageSize=50",
      );
      setBlobs(page?.Sources ?? []);
    } catch (error) {
      onError(error, "load the blob sources");
    } finally {
      setLoading(false);
    }
  }, [destination, onError]);

  useEffect(() => {
    refreshBlobs();
  }, [refreshBlobs]);

  // Mirror for synchronous reads inside the poll loop.
  const monitoredRef = useRef(monitored);
  useEffect(() => {
    monitoredRef.current = monitored;
  }, [monitored]);

  /**
   * The GET /transfers/{transferId} detail endpoint can return 404 for a
   * blob-name id even while (or after) the source is consumed, so the
   * authoritative state comes from the GET /transfers list, matched by
   * source name. The detail endpoint is only best-effort enrichment
   * (item counts, validation errors).
   */
  const refreshMonitors = useCallback(
    async (sourceNames: string[]) => {
      if (sourceNames.length === 0) return;

      let transfersPage: ItemTransfersPage | null;
      try {
        transfersPage = await callTransferApi<ItemTransfersPage>(
          destination,
          "/api/item-transfer/transfers?page=1&pageSize=50",
        );
      } catch {
        return; // Transient — the next poll tick retries.
      }
      const transfers = transfersPage?.Transfers ?? [];
      let becameTerminal = false;

      for (const sourceName of sourceNames) {
        const wanted = sourceName.toLowerCase();
        const entry = transfers.find(
          (t) =>
            t.SourceName?.toLowerCase() === wanted ||
            t.Id?.toLowerCase() === wanted,
        );
        if (!entry) continue; // Not registered yet — keep waiting.

        let details: ItemTransferDetails = entry;
        for (const id of new Set([entry.Id, entry.SourceName])) {
          if (!id) continue;
          try {
            const enriched = await callTransferApi<ItemTransferDetails>(
              destination,
              `/api/item-transfer/transfers/${encodeURIComponent(id)}`,
            );
            if (enriched) {
              details = { ...entry, ...enriched };
              break;
            }
          } catch {
            // Fall back to the list entry.
          }
        }

        const previous = monitoredRef.current[sourceName];
        const wasActive = !previous || ACTIVE_STATES.has(previous.TransferState);
        if (wasActive && !ACTIVE_STATES.has(details.TransferState)) {
          becameTerminal = true;
        }
        setMonitored((prev) => ({ ...prev, [sourceName]: details }));
      }

      // A finished consumption changes the blob's state too.
      if (becameTerminal) refreshBlobs();
    },
    [destination, refreshBlobs],
  );

  // Poll monitored consumptions that are still in progress.
  useEffect(() => {
    const active = Object.entries(monitored)
      .filter(([, details]) => !details || ACTIVE_STATES.has(details.TransferState))
      .map(([sourceName]) => sourceName);
    if (active.length === 0) return;
    const timer = setInterval(() => refreshMonitors(active), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [monitored, refreshMonitors]);

  const handleConsume = async (blob: BlobSource) => {
    setStartingBlob(blob.Name);
    try {
      const result = await callTransferApi<StartItemTransferResult>(
        destination,
        `/api/item-transfer/databases/${encodeURIComponent(database.trim())}/sources?blobName=${encodeURIComponent(blob.Name)}`,
        { method: "POST" },
      );
      const sourceName = result?.sourceName ?? blob.Name;
      setMonitored((prev) => ({ ...prev, [sourceName]: null }));
      showToast(
        "Consumption started",
        `${blob.Name} is being consumed into the ${database.trim()} database.`,
        "success",
      );
      refreshMonitors([sourceName]);
    } catch (error) {
      onError(error, "start the consumption");
    } finally {
      setStartingBlob(null);
    }
  };

  const handleRetry = async (monitorKey: string, details: ItemTransferDetails) => {
    setRetrying(details.SourceName);
    try {
      await callTransferApi(
        destination,
        `/api/item-transfer/databases/${encodeURIComponent(details.DatabaseName || database.trim())}/sources/${encodeURIComponent(details.SourceName)}`,
        { method: "PUT" },
      );
      showToast("Retry queued", `${details.SourceName} was re-queued.`, "success");
      refreshMonitors([monitorKey]);
    } catch (error) {
      onError(error, "retry the transfer");
    } finally {
      setRetrying(null);
    }
  };

  const handleDeleteBlob = async () => {
    if (!blobToDelete) return;
    try {
      await callTransferApi<void>(
        destination,
        `/api/item-transfer/sources/blobs/${encodeURIComponent(blobToDelete)}`,
        { method: "DELETE" },
      );
      showToast("Blob discarded", blobToDelete, "success");
      await refreshBlobs();
    } catch (error) {
      onError(error, "discard the blob");
      throw error;
    }
  };

  const monitoredEntries = Object.entries(monitored);

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Step 3 — Consume .raif sources into the database</CardTitle>
          <EnvBadge env="destination" name={destination.label} />
        </div>
        <CardDescription className="text-muted-foreground">
          Completed chunk sets appear here as .raif blob sources on{" "}
          {destination.label}. Consume each one into the target database via
          the Item Transfer API, then watch the consumption until it finishes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="consume-db" className="text-sm font-medium">
              Target database
            </label>
            <Input
              id="consume-db"
              value={database}
              autoComplete="off"
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="master"
              className="w-48"
            />
          </div>
          <Button variant="outline" size="sm" onClick={refreshBlobs} disabled={loading}>
            <Icon path={mdiRefresh} className={loading ? "animate-spin" : ""} />
            Refresh blobs
          </Button>
        </div>

        {blobs.length === 0 && !loading ? (
          <p className="py-4 text-center text-sm text-text-subtle">
            No blob sources on the destination environment yet. Complete a
            chunk set in step 2 first.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border-muted bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border-muted bg-surface-grey">
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Blob source
                    </th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      State
                    </th>
                    <th className="px-4 py-3 text-right font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {blobs.map((blob) => (
                    <tr
                      key={blob.Name}
                      className="border-b border-border-muted last:border-b-0 hover:bg-surface-container-low/60"
                    >
                      <td
                        className="max-w-[380px] truncate px-4 py-3 font-mono text-xs"
                        title={blob.Name}
                      >
                        {blob.Name}
                        {ownRaifFiles.has(blob.Name) && (
                          <span className="ml-2 rounded-full bg-primary-bg px-2 py-0.5 text-[10px] font-semibold text-primary-fg">
                            this migration
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StateBadge state={blob.BlobState} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="xs"
                            onClick={() => handleConsume(blob)}
                            disabled={
                              startingBlob === blob.Name ||
                              database.trim() === ""
                            }
                          >
                            <Icon
                              path={
                                startingBlob === blob.Name
                                  ? mdiLoading
                                  : mdiDatabaseImport
                              }
                              className={
                                startingBlob === blob.Name ? "animate-spin" : ""
                              }
                            />
                            Consume
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            colorScheme="danger"
                            onClick={() => setBlobToDelete(blob.Name)}
                            aria-label={`Discard ${blob.Name}`}
                            title="Discard this blob"
                          >
                            <Icon path={mdiDelete} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {monitoredEntries.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Consumption monitor</p>
            {monitoredEntries.map(([sourceName, details]) => (
              <div
                key={sourceName}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-muted bg-surface-container-low px-3 py-2"
              >
                <div className="min-w-0">
                  <p
                    className="max-w-96 truncate font-mono text-xs"
                    title={sourceName}
                  >
                    {sourceName}
                  </p>
                  <p className="text-xs text-text-subtle">
                    {details
                      ? `${details.TransferredItemsCount ?? 0}/${details.TotalItemsCount ?? "?"} items · ${details.DatabaseName ?? ""}`
                      : "Waiting for first status…"}
                    {details?.Description ? ` · ${details.Description}` : ""}
                  </p>
                  {details?.ValidationErrors &&
                    details.ValidationErrors.length > 0 && (
                      <p className="mt-1 text-xs text-danger-fg">
                        {details.ValidationErrors.length} validation error(s):{" "}
                        {details.ValidationErrors.slice(0, 3).join("; ")}
                        {details.ValidationErrors.length > 3 && "…"}
                      </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                  {!details || ACTIVE_STATES.has(details.TransferState) ? (
                    <Icon
                      path={mdiLoading}
                      size={0.7}
                      className="animate-spin text-text-subtle"
                    />
                  ) : null}
                  <StateBadge state={details?.TransferState ?? "Queued"} />
                  {details?.TransferState === "Failed" && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleRetry(sourceName, details)}
                      disabled={retrying === details.SourceName}
                    >
                      <Icon
                        path={retrying === details.SourceName ? mdiLoading : mdiReplay}
                        className={retrying === details.SourceName ? "animate-spin" : ""}
                      />
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <ConfirmDestructiveDialog
          open={blobToDelete !== null}
          onOpenChange={(open) => {
            if (!open) setBlobToDelete(null);
          }}
          title="Discard this blob source?"
          description={
            <>
              This permanently removes{" "}
              <span className="font-mono text-xs">{blobToDelete}</span> from the
              destination environment&apos;s blob storage and caches. A
              discarded blob can no longer be consumed.
            </>
          }
          confirmLabel="Discard blob"
          onConfirm={handleDeleteBlob}
        />
      </CardContent>
    </Card>
  );
}
