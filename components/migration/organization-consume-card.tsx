"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mdiDatabaseImport, mdiLoading, mdiPlus, mdiRefresh } from "@mdi/js";
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
import {
  blobStateToConsumption,
  getBlobSourceState,
  SourceNotReadyError,
  startConsume,
} from "@/src/utils/environment-client";
import type { RecentTransfer } from "@/src/utils/recent-transfers";
import type { EnvironmentConnection } from "@/src/types/transfer";

const POLL_INTERVAL_MS = 5000;

interface Row {
  /** Last blob state reported by getBlobState (raw). */
  blobState?: string;
  /** Consumption monitor, set once Consume was clicked. */
  consumption?: "InProgress" | "Finished" | "Failed";
  detail?: string;
}

interface OrganizationConsumeCardProps {
  destination: EnvironmentConnection;
  activeTransfer: RecentTransfer | null;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

/**
 * Step 3 in Organization mode. The Marketplace SDK exposes only consumeFile
 * and getBlobState of the Item Transfer API — there is no blob listing,
 * discard, retry or transfers list — so this card works on blob names: the
 * .raif files produced by the active transfer, plus any name typed in.
 */
export function OrganizationConsumeCard({
  destination,
  activeTransfer,
  onError,
  showToast,
}: OrganizationConsumeCardProps) {
  const [database, setDatabase] = useState("master");
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [manualName, setManualName] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const names = useMemo(() => {
    const own = Object.values(activeTransfer?.raifFiles ?? {});
    return Array.from(new Set([...own, ...extraNames]));
  }, [activeTransfer, extraNames]);

  const ownNames = useMemo(
    () => new Set(Object.values(activeTransfer?.raifFiles ?? {})),
    [activeTransfer],
  );

  const refreshStates = useCallback(
    async (targets: string[]) => {
      for (const name of targets) {
        try {
          const state = await getBlobSourceState(destination, name);
          setRows((prev) => {
            const row = prev[name] ?? {};
            const next: Row = { ...row, blobState: state?.BlobState };
            if (row.consumption) {
              const progress = blobStateToConsumption(state);
              next.consumption = progress.state;
              next.detail = progress.detail;
            }
            return { ...prev, [name]: next };
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          setRows((prev) => {
            const row = prev[name] ?? {};
            // After consumeFile the blob is renamed "consumed.*", so a
            // missing original name means the import ran.
            if (row.consumption && message.includes("BlobNotFound")) {
              return { ...prev, [name]: { ...row, consumption: "Finished" } };
            }
            return {
              ...prev,
              [name]: { ...row, blobState: row.blobState ?? "Unknown" },
            };
          });
        }
      }
    },
    [destination],
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await refreshStates(names);
    } finally {
      setLoading(false);
    }
  }, [names, refreshStates]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Poll consumptions still in progress.
  useEffect(() => {
    const active = Object.entries(rows)
      .filter(([, row]) => row.consumption === "InProgress")
      .map(([name]) => name);
    if (active.length === 0) return;
    const timer = setInterval(() => refreshStates(active), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [rows, refreshStates]);

  const handleConsume = async (name: string) => {
    setStarting(name);
    try {
      await startConsume(destination, database.trim(), name);
      setRows((prev) => ({
        ...prev,
        [name]: { ...prev[name], consumption: "InProgress", detail: undefined },
      }));
      showToast(
        "Consumption started",
        `${name} is being consumed into the ${database.trim()} database.`,
        "success",
      );
    } catch (error) {
      if (error instanceof SourceNotReadyError) {
        showToast(
          "Not ready yet",
          "The .raif file is still being assembled on the destination. Try again in a few seconds.",
          "warning",
        );
      } else {
        onError(error, "start the consumption");
      }
    } finally {
      setStarting(null);
    }
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    setExtraNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setManualName("");
    refreshStates([name]);
  };

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Step 3 — Consume .raif sources into the database</CardTitle>
          <EnvBadge env="destination" name={destination.label} />
        </div>
        <CardDescription className="text-muted-foreground">
          Consume each .raif file completed in step 2 into the target database,
          then watch it until the import finishes. Organization mode can&apos;t
          list, discard or retry blob sources — switch to Cross-Organization
          mode in settings for those.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="org-consume-db" className="text-sm font-medium">
              Target database
            </label>
            <Input
              id="org-consume-db"
              value={database}
              autoComplete="off"
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="master"
              className="w-48"
            />
          </div>
          <div className="flex min-w-72 flex-1 flex-col gap-1.5">
            <label htmlFor="org-consume-name" className="text-sm font-medium">
              Add a .raif blob by name
            </label>
            <div className="flex gap-2">
              <Input
                id="org-consume-name"
                value={manualName}
                autoComplete="off"
                onChange={(e) => setManualName(e.target.value)}
                placeholder="e.g. 3f1c….raif"
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={addManual}
                disabled={manualName.trim() === ""}
                aria-label="Add blob name"
              >
                <Icon path={mdiPlus} />
              </Button>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={loading || names.length === 0}
          >
            <Icon path={mdiRefresh} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {names.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-subtle">
            No .raif files yet. Complete a chunk set in step 2, or add a blob
            name above.
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
                  {names.map((name) => {
                    const row = rows[name] ?? {};
                    return (
                      <tr
                        key={name}
                        className="border-b border-border-muted last:border-b-0 hover:bg-surface-container-low/60"
                      >
                        <td
                          className="max-w-[380px] truncate px-4 py-3 font-mono text-xs"
                          title={name}
                        >
                          {name}
                          {ownNames.has(name) && (
                            <span className="ml-2 rounded-full bg-primary-bg px-2 py-0.5 text-[10px] font-semibold text-primary-fg">
                              this migration
                            </span>
                          )}
                          {row.detail && (
                            <p className="mt-1 text-[10px] text-text-subtle">
                              {row.detail}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {row.consumption === "InProgress" && (
                              <Icon
                                path={mdiLoading}
                                size={0.7}
                                className="animate-spin text-text-subtle"
                              />
                            )}
                            <StateBadge
                              state={row.consumption ?? row.blobState ?? "Unknown"}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <Button
                              size="xs"
                              onClick={() => handleConsume(name)}
                              disabled={
                                starting === name ||
                                database.trim() === "" ||
                                row.consumption === "InProgress" ||
                                row.consumption === "Finished"
                              }
                            >
                              <Icon
                                path={starting === name ? mdiLoading : mdiDatabaseImport}
                                className={starting === name ? "animate-spin" : ""}
                              />
                              Consume
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
