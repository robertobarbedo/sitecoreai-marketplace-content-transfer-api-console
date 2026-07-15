"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import {
  mdiArrowLeft,
  mdiContentSave,
  mdiDelete,
  mdiFileTree,
  mdiLoading,
  mdiCloudUploadOutline,
  mdiPencil,
  mdiPlaylistPlus,
  mdiPlus,
  mdiRefresh,
  mdiSquareEditOutline,
  mdiStop,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StateBadge } from "@/components/badges";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { TreePickerDialog } from "@/components/migration/tree-picker-dialog";
import {
  SCOPES,
  MERGE_STRATEGIES,
} from "@/components/migration/create-transfer-card";
import {
  TransferStageDetailsCard,
  TransferStepper,
} from "@/components/migration/transfer-progress";
import type { StepperStatus, StepperStep } from "@/components/ui/stepper";
import { ApplyRowsTable } from "@/components/reconciliation/apply-rows-table";
import { useAutoMigration } from "@/src/utils/hooks/useAutoMigration";
import {
  loadSavedTransfers,
  saveSavedTransfers,
} from "@/src/utils/saved-transfers-store";
import {
  detectReconciliationMarkers,
  getReconciliationEnvironments,
  isReconciliationReady,
  loadReconciliationData,
  matchEnvironmentToConnection,
} from "@/src/utils/reconciliation";
import {
  fetchPublishJobs,
  getEnvironmentLanguages,
  startPublish,
  watchPublishJobs,
  type PublishJobInfo,
  type PublishRequestRow,
} from "@/src/utils/publish";
import { cn } from "@/lib/utils";
import {
  planApplyRows,
  fetchCurrentValues,
  executeApplyRows,
  type ApplyRow,
} from "@/src/utils/reconciliation-apply";
import type {
  DataTree,
  DataTreeScope,
  EnvironmentConnection,
  MergeStrategy,
  PublishMode,
  PublishTarget,
  SavedTransfer,
  TenantInfo,
} from "@/src/types/transfer";

const DEFAULT_TREE: DataTree = {
  ItemPath: "",
  Scope: "SingleItem",
  MergeStrategy: "OverrideExistingItem",
};

const PUBLISH_TARGETS: { value: PublishTarget; label: string }[] = [
  { value: "TransferredPaths", label: "Only transferred paths" },
  { value: "EntireTree", label: "Publish entire content tree" },
];

const PUBLISH_MODES: { value: PublishMode; label: string }[] = [
  { value: "SMART", label: "Smart" },
  { value: "FULL", label: "Republish" },
];

type ToastVariant = "default" | "success" | "error" | "warning";

interface SavedTransfersTabProps {
  client: ClientSDK;
  /** Tenants in resource-list order — saves go to the first one. */
  tenants: TenantInfo[];
  /** All stored connections (merged across tenants). */
  connections: EnvironmentConnection[];
  onError: (error: unknown, action: string) => void;
  showToast: (title: string, description?: string, variant?: ToastVariant) => void;
  /** Reports an executing transfer so the page can lock the rest of the UI. */
  onRunningChange?: (running: boolean) => void;
}

type View =
  | { kind: "list" }
  | { kind: "form"; editing: SavedTransfer | null }
  | { kind: "execute"; transfer: SavedTransfer };

export function SavedTransfersTab({
  client,
  tenants,
  connections,
  onError,
  showToast,
  onRunningChange,
}: SavedTransfersTabProps) {
  const [transfers, setTransfers] = useState<SavedTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "list" });
  const [confirmDelete, setConfirmDelete] = useState<SavedTransfer | null>(null);
  const [confirmExecute, setConfirmExecute] = useState<SavedTransfer | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Saves always target the first tenant, but older entries may live in
      // any tenant's module folder — merge them all.
      const result = await loadSavedTransfers(client, tenants);
      setTransfers(result.transfers);
      if (result.failedTenants.length > 0) {
        showToast(
          "Some saved transfers could not be loaded",
          `Could not read the SavedTransfers item from: ${result.failedTenants.join(", ")}.`,
          "warning",
        );
      }
    } catch (error) {
      onError(error, "load the saved transfers");
    } finally {
      setLoading(false);
    }
  }, [client, tenants, onError, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const persist = async (next: SavedTransfer[]) => {
    if (tenants.length === 0) {
      throw new Error("No tenant is available to store the saved transfers.");
    }
    await saveSavedTransfers(client, tenants[0], next);
    setTransfers(next);
  };

  const handleSave = async (saved: SavedTransfer) => {
    const next = transfers.some((t) => t.id === saved.id)
      ? transfers.map((t) => (t.id === saved.id ? saved : t))
      : [...transfers, saved];
    try {
      await persist(next);
      showToast("Saved transfer stored", `Stored in ${tenants[0].label}.`, "success");
      setView({ kind: "list" });
    } catch (error) {
      onError(error, "save the transfer");
    }
  };

  const handleDelete = async (transfer: SavedTransfer) => {
    await persist(transfers.filter((t) => t.id !== transfer.id));
    showToast("Saved transfer deleted", transfer.name, "success");
  };

  const startExecute = (transfer: SavedTransfer) => {
    if (transfer.dataTrees.some((t) => t.MergeStrategy === "OverrideExistingTree")) {
      setConfirmExecute(transfer);
      return;
    }
    setView({ kind: "execute", transfer });
  };

  const connectionFor = (id: string) => connections.find((c) => c.id === id) ?? null;

  if (view.kind === "form") {
    return (
      <SavedTransferForm
        client={client}
        editing={view.editing}
        connections={connections}
        onCancel={() => setView({ kind: "list" })}
        onSave={handleSave}
      />
    );
  }

  if (view.kind === "execute") {
    const source = connectionFor(view.transfer.sourceConnectionId);
    const destination = connectionFor(view.transfer.destinationConnectionId);
    if (!source || !destination) {
      return (
        <div className="flex flex-col gap-4 rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
          <div>
            <h3 className="mb-1 font-bold">Connection missing</h3>
            <p className="text-sm">
              The {!source ? `source (${view.transfer.sourceLabel})` : ""}
              {!source && !destination ? " and " : ""}
              {!destination
                ? `destination (${view.transfer.destinationLabel})`
                : ""}{" "}
              connection of this saved transfer no longer exists. Edit the
              saved transfer or restore the connection in settings.
            </p>
          </div>
          <div>
            <Button variant="outline" size="sm" onClick={() => setView({ kind: "list" })}>
              <Icon path={mdiArrowLeft} />
              Back to saved transfers
            </Button>
          </div>
        </div>
      );
    }
    return (
      <ExecuteSavedTransfer
        key={view.transfer.id}
        client={client}
        transfer={view.transfer}
        source={source}
        destination={destination}
        onBack={() => setView({ kind: "list" })}
        onError={onError}
        showToast={showToast}
        onRunningChange={onRunningChange}
      />
    );
  }

  // ---- list ----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-muted bg-white p-4">
        <p className="text-sm text-text-subtle">
          &nbsp;
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <Icon path={mdiRefresh} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setView({ kind: "form", editing: null })}>
            <Icon path={mdiPlus} />
            New saved transfer
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border-muted bg-white py-16 text-text-subtle">
          <Icon path={mdiLoading} className="animate-spin" />
          Loading saved transfers&hellip;
        </div>
      ) : transfers.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border-muted bg-white py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary-bg text-primary-fg">
            <Icon path={mdiPlaylistPlus} size={1} />
          </div>
          <div>
            <p className="font-bold">No saved transfers yet</p>
            <p className="text-sm text-text-subtle">
              Save a source/destination pair with its paths once, then execute
              it whenever you need it.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-muted bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border-muted bg-surface-grey">
                  {["Name", "Source → Destination", "Paths", "Reconcile", "Publish", "Actions"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {transfers.map((transfer) => {
                  const source = connectionFor(transfer.sourceConnectionId);
                  const destination = connectionFor(transfer.destinationConnectionId);
                  return (
                    <tr
                      key={transfer.id}
                      className="border-b border-border-muted last:border-b-0"
                    >
                      <td className="px-4 py-3 font-semibold">{transfer.name}</td>
                      <td className="px-4 py-3">
                        <ConnectionLabel
                          label={source?.label ?? transfer.sourceLabel}
                          missing={!source}
                        />
                        <span className="mx-1 text-text-subtle">→</span>
                        <ConnectionLabel
                          label={destination?.label ?? transfer.destinationLabel}
                          missing={!destination}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <ul className="flex flex-col gap-0.5">
                          {transfer.dataTrees.map((tree, index) => (
                            <li key={index} className="font-mono text-xs" title={tree.ItemPath}>
                              <span className="inline-block max-w-[280px] truncate align-bottom">
                                {tree.ItemPath}
                              </span>{" "}
                              <span className="text-text-subtle">
                                ({SCOPES.find((s) => s.value === tree.Scope)?.label},{" "}
                                {
                                  MERGE_STRATEGIES.find(
                                    (s) => s.value === tree.MergeStrategy,
                                  )?.label
                                }
                                )
                              </span>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3">
                        {transfer.reconcile ? (
                          <span className="whitespace-nowrap rounded-full bg-primary-bg px-2 py-0.5 text-xs font-semibold text-primary-fg">
                            {destination?.label ?? transfer.destinationLabel}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {transfer.publish ? (
                          <span className="whitespace-nowrap rounded-full bg-primary-bg px-2 py-0.5 text-xs font-semibold text-primary-fg">
                            {
                              PUBLISH_MODES.find(
                                (m) => m.value === transfer.publish?.mode,
                              )?.label
                            }
                            {" · "}
                            {transfer.publish.target === "EntireTree"
                              ? "entire tree"
                              : "transferred paths"}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            onClick={() => startExecute(transfer)}
                            disabled={!source || !destination}
                            title={
                              !source || !destination
                                ? "A referenced connection no longer exists — edit the saved transfer first."
                                : undefined
                            }
                          >
                            Execute
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setView({ kind: "form", editing: transfer })}
                          >
                            <Icon path={mdiPencil} />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            colorScheme="danger"
                            onClick={() => setConfirmDelete(transfer)}
                            aria-label={`Delete ${transfer.name}`}
                          >
                            <Icon path={mdiDelete} />
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

      <ConfirmDestructiveDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Delete this saved transfer?"
        description={`"${confirmDelete?.name}" will be removed from the stored list. The content it transferred is not affected.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDelete) await handleDelete(confirmDelete);
        }}
      />

      <ConfirmDestructiveDialog
        open={confirmExecute !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmExecute(null);
        }}
        title="Override the existing tree?"
        description={`"${confirmExecute?.name}" uses the "Override existing tree" strategy: the matching tree(s) in ${confirmExecute?.destinationLabel} are replaced, then the transfer runs to completion automatically.`}
        confirmLabel="Start transferring"
        onConfirm={async () => {
          if (confirmExecute) setView({ kind: "execute", transfer: confirmExecute });
        }}
      />
    </div>
  );
}

function ConnectionLabel({ label, missing }: { label: string; missing: boolean }) {
  return (
    <span className={missing ? "text-danger-fg line-through" : undefined} title={missing ? "This connection no longer exists" : undefined}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

function SavedTransferForm({
  client,
  editing,
  connections,
  onCancel,
  onSave,
}: {
  client: ClientSDK;
  editing: SavedTransfer | null;
  connections: EnvironmentConnection[];
  onCancel: () => void;
  onSave: (saved: SavedTransfer) => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [sourceId, setSourceId] = useState(editing?.sourceConnectionId ?? "");
  const [destinationId, setDestinationId] = useState(
    editing?.destinationConnectionId ?? "",
  );
  const [trees, setTrees] = useState<DataTree[]>(
    editing?.dataTrees.length ? editing.dataTrees.map((t) => ({ ...t })) : [{ ...DEFAULT_TREE }],
  );
  const [reconcile, setReconcile] = useState(editing?.reconcile ?? false);
  const [publishAtEnd, setPublishAtEnd] = useState(!!editing?.publish);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>(
    editing?.publish?.target ?? "EntireTree",
  );
  const [publishMode, setPublishMode] = useState<PublishMode>(
    editing?.publish?.mode ?? "SMART",
  );
  /** null = still checking. */
  const [reconReady, setReconReady] = useState<boolean | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // The reconcile option is only offered when the Content Reconciliation app
  // is installed and configured in every environment (see Reconciliation tab).
  useEffect(() => {
    let cancelled = false;
    isReconciliationReady(client)
      .then((ready) => {
        if (!cancelled) setReconReady(ready);
      })
      .catch(() => {
        if (!cancelled) setReconReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // A stored reconcile flag must not survive when the option is unavailable.
  useEffect(() => {
    if (reconReady === false) setReconcile(false);
  }, [reconReady]);

  const source = connections.find((c) => c.id === sourceId) ?? null;
  const destination = connections.find((c) => c.id === destinationId) ?? null;

  const updateTree = (index: number, patch: Partial<DataTree>) => {
    setTrees((prev) =>
      prev.map((tree, i) => (i === index ? { ...tree, ...patch } : tree)),
    );
  };

  const valid =
    name.trim() !== "" &&
    !!source &&
    !!destination &&
    source.id !== destination.id &&
    trees.length > 0 &&
    trees.every((t) => t.ItemPath.trim().startsWith("/sitecore"));

  const handleSave = async () => {
    if (!valid || !source || !destination) return;
    setSaving(true);
    try {
      await onSave({
        id: editing?.id ?? crypto.randomUUID(),
        name: name.trim(),
        sourceConnectionId: source.id,
        destinationConnectionId: destination.id,
        sourceLabel: source.label,
        destinationLabel: destination.label,
        dataTrees: trees.map((t) => ({ ...t, ItemPath: t.ItemPath.trim() })),
        reconcile,
        publish: publishAtEnd
          ? { target: publishTarget, mode: publishMode }
          : undefined,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <CardTitle>
          {editing ? "Edit saved transfer" : "New saved transfer"}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Define the source, destination and paths once; execute the transfer
          from the list whenever you need it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <label htmlFor="saved-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="saved-name"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly home page sync"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Source</label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="w-56" aria-label="Source environment">
                <SelectValue placeholder="Select source" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Destination</label>
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger className="w-56" aria-label="Destination environment">
                <SelectValue placeholder="Select destination" />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {source && destination && source.id === destination.id && (
          <p className="text-xs text-danger-fg">
            Source and destination must be different environments.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Paths</span>
          {trees.map((tree, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              <Input
                value={tree.ItemPath}
                autoComplete="off"
                onChange={(e) => updateTree(index, { ItemPath: e.target.value })}
                placeholder="/sitecore/content/Home/MyItem"
                className="min-w-64 flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPickerIndex(index)}
                disabled={!source}
                aria-label="Browse the source content tree"
                title={
                  source
                    ? "Browse the source content tree"
                    : "Select a source environment first"
                }
              >
                <Icon path={mdiFileTree} />
              </Button>
              <Select
                value={tree.Scope}
                onValueChange={(value) =>
                  updateTree(index, { Scope: value as DataTreeScope })
                }
              >
                <SelectTrigger className="w-44" aria-label="Scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={tree.MergeStrategy}
                onValueChange={(value) =>
                  updateTree(index, { MergeStrategy: value as MergeStrategy })
                }
              >
                <SelectTrigger className="w-60" aria-label="Merge strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MERGE_STRATEGIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                colorScheme="danger"
                onClick={() =>
                  setTrees((prev) => prev.filter((_, i) => i !== index))
                }
                disabled={trees.length === 1}
                aria-label="Remove path"
              >
                <Icon path={mdiDelete} />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTrees((prev) => [...prev, { ...DEFAULT_TREE }])}
            >
              <Icon path={mdiPlus} />
              Add path
            </Button>
          </div>
        </div>

        {trees.some((t) => t.MergeStrategy === "OverrideExistingTree") && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
            &quot;Override existing tree&quot; replaces the whole matching tree
            in the destination environment.
          </p>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-border-muted p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label
              className={cn(
                "flex items-center gap-2 text-sm font-medium",
                reconReady === true
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="checkbox"
                checked={reconcile}
                disabled={reconReady !== true}
                onChange={(e) => setReconcile(e.target.checked)}
              />
              Reconcile at the end
            </label>
            <span className="text-xs text-text-subtle">
              After a successful transfer, the desired values saved in the
              Content Reconciliation app are applied to the destination
              environment.
            </span>
          </div>
          {reconReady === null && (
            <span className="flex items-center gap-1.5 text-xs text-text-subtle">
              <Icon path={mdiLoading} size={0.6} className="animate-spin" />
              Checking the Content Reconciliation setup&hellip;
            </span>
          )}
          {reconReady === false && (
            <p className="rounded-lg bg-[#ffe6bd] px-3 py-2 text-xs text-[#953d00]">
              The Content Reconciliation app needs to be installed and
              configured before transfers can reconcile — see the
              Reconciliation tab for more info.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border-muted p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={publishAtEnd}
                onChange={(e) => setPublishAtEnd(e.target.checked)}
              />
              Publish at the end
            </label>
            <span className="text-xs text-text-subtle">
              After the transfer (and the reconciliation, when enabled)
              succeed, the destination environment is published to Experience
              Edge. Related items are never included.
            </span>
          </div>
          {publishAtEnd && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">What to publish</label>
                <Select
                  value={publishTarget}
                  onValueChange={(value) =>
                    setPublishTarget(value as PublishTarget)
                  }
                >
                  <SelectTrigger className="w-60" aria-label="What to publish">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUBLISH_TARGETS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Publish mode</label>
                <Select
                  value={publishMode}
                  onValueChange={(value) => setPublishMode(value as PublishMode)}
                >
                  <SelectTrigger className="w-44" aria-label="Publish mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUBLISH_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="pb-2 text-xs text-text-subtle">
                {publishTarget === "EntireTree"
                  ? "One publish of /sitecore, including subitems."
                  : "One publish per configured path, including subitems."}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={!valid || saving}>
            <Icon path={saving ? mdiLoading : mdiContentSave} className={saving ? "animate-spin" : ""} />
            Save
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>

      {source && (
        <TreePickerDialog
          open={pickerIndex !== null}
          onOpenChange={(open) => {
            if (!open) setPickerIndex(null);
          }}
          source={source}
          database="master"
          onSelect={(path) => {
            if (pickerIndex !== null) updateTree(pickerIndex, { ItemPath: path });
          }}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

type ReconcilePhase = "idle" | "running" | "done" | "failed";

/** skipped = the reconcile step failed, so nothing was published. */
type PublishPhase = "idle" | "running" | "done" | "failed" | "skipped";

function ExecuteSavedTransfer({
  client,
  transfer,
  source,
  destination,
  onBack,
  onError,
  showToast,
  onRunningChange,
}: {
  client: ClientSDK;
  transfer: SavedTransfer;
  source: EnvironmentConnection;
  destination: EnvironmentConnection;
  onBack: () => void;
  onError: (error: unknown, action: string) => void;
  showToast: (title: string, description?: string, variant?: ToastVariant) => void;
  onRunningChange?: (running: boolean) => void;
}) {
  const { state, running, progressByChunkSet, start, cancel } = useAutoMigration(
    source,
    destination,
  );

  const [reconPhase, setReconPhase] = useState<ReconcilePhase>("idle");
  const [reconProgress, setReconProgress] = useState("");
  const [reconRows, setReconRows] = useState<ApplyRow[]>([]);
  const [reconError, setReconError] = useState("");

  const [publishPhase, setPublishPhase] = useState<PublishPhase>("idle");
  const [publishRows, setPublishRows] = useState<PublishRequestRow[]>([]);
  const [publishJobs, setPublishJobs] = useState<PublishJobInfo[]>([]);
  const [publishError, setPublishError] = useState("");
  /** Non-fatal notes: languages fallback, unobservable jobs, timeout. */
  const [publishNote, setPublishNote] = useState("");

  // Publishing polls the destination's jobs; stop when the view unmounts.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // Auto-start once, deferred a tick: React StrictMode (dev) runs mount →
  // cleanup → mount, and the hook's unmount cleanup flags the run as
  // cancelled — starting synchronously in the first effect pass would abort
  // the pipeline immediately with "Migration cancelled".
  const startedRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      start({ dataTrees: transfer.dataTrees });
    }, 0);
    return () => clearTimeout(timer);
  }, [start, transfer]);

  const runPublish = useCallback(async () => {
    const publish = transfer.publish;
    if (!publish) return;
    setPublishPhase("running");
    setPublishError("");
    try {
      // The publish always targets the DESTINATION environment, resolved to
      // its SitecoreAI tenant the same way the reconcile step resolves it.
      const envs = await getReconciliationEnvironments(client);
      const target = matchEnvironmentToConnection(envs, destination);
      if (!target) {
        throw new Error(
          `Could not match the destination environment (${destination.label}, ${destination.host}) to any SitecoreAI environment this app can access — publishing needs the matching environment's authoring GraphQL.`,
        );
      }

      let languages: string[];
      let note = "";
      try {
        languages = await getEnvironmentLanguages(client, target.contextId);
        if (languages.length === 0) throw new Error("No languages returned");
      } catch {
        languages = ["en"];
        note =
          "The destination's languages could not be read — publishing \"en\" only.";
      }
      setPublishNote(note);

      const paths =
        publish.target === "EntireTree"
          ? ["/sitecore"]
          : [...new Set(transfer.dataTrees.map((t) => t.ItemPath))];

      // Snapshot the jobs BEFORE firing, so ours are the ones that appear.
      const baseline = new Set(
        (await fetchPublishJobs(client, target.contextId).catch(() => [])).map(
          (job) => job.handle,
        ),
      );

      const rows: PublishRequestRow[] = [];
      for (const path of paths) {
        try {
          const operationId = await startPublish(client, target.contextId, {
            rootItemPath: path,
            mode: publish.mode,
            languages,
            displayName: `Content Transfer Console: ${transfer.name} — ${path}`,
          });
          rows.push({ path, operationId });
        } catch (error) {
          rows.push({
            path,
            operationId: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        setPublishRows([...rows]);
      }

      const failedRows = rows.filter((r) => r.operationId === null);
      if (failedRows.length === rows.length) {
        throw new Error(
          failedRows[0]?.error ?? "No publish operation could be started.",
        );
      }

      const watch = await watchPublishJobs(
        client,
        target.contextId,
        baseline,
        rows.length - failedRows.length,
        setPublishJobs,
        () => activeRef.current,
      );
      if (!activeRef.current) return;

      if (!watch.identified) {
        setPublishNote((prev) =>
          [
            prev,
            "The publish operation was queued, but its job did not show up in the destination's job list — check the publishing dashboard for progress.",
          ]
            .filter(Boolean)
            .join(" "),
        );
      } else if (watch.timedOut) {
        setPublishNote((prev) =>
          [
            prev,
            "Stopped watching after 10 minutes — the publishing job(s) are still running on the destination.",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
      setPublishPhase("done");

      const failedJobs = watch.jobs.filter((j) => j.jobState === "Failed");
      if (failedRows.length > 0 || failedJobs.length > 0) {
        showToast(
          "Transfer complete, publishing had failures",
          `${failedRows.length + failedJobs.length} publish operation(s) failed on ${destination.label}.`,
          "warning",
        );
      } else {
        showToast(
          "Transfer and publish complete",
          watch.identified
            ? `${watch.jobs.length} publishing job(s) finished on ${destination.label}.`
            : `The publish was queued on ${destination.label}.`,
          "success",
        );
      }
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
      setPublishPhase("failed");
      showToast(
        "Transfer complete, publishing failed",
        error instanceof Error ? error.message : String(error),
        "warning",
      );
    }
  }, [client, destination, transfer, showToast]);

  const runReconcile = useCallback(async () => {
    setReconPhase("running");
    setReconError("");
    try {
      // Reconciliation always targets the DESTINATION environment. The
      // destination is a host+credentials connection while reconciliation
      // needs the matching SitecoreAI tenant, so resolve it: XM Cloud hosts
      // embed the tenantName; fall back to a label match.
      const envs = await getReconciliationEnvironments(client);
      const target = matchEnvironmentToConnection(envs, destination);
      if (!target) {
        throw new Error(
          `Could not match the destination environment (${destination.label}, ${destination.host}) to any SitecoreAI environment this app can access — reconciliation needs the matching environment's authoring GraphQL.`,
        );
      }
      const markers = await detectReconciliationMarkers(client, envs);
      const bases = markers.filter((s) => s.hasBase);
      if (bases.length !== 1) {
        throw new Error(
          "Content Reconciliation is not (fully) set up — open the Reconciliation tab to see what is missing.",
        );
      }
      const loadResult = await loadReconciliationData(client, bases[0].env, envs);
      if (!loadResult.ok) {
        throw new Error(loadResult.error);
      }

      const rows = planApplyRows(loadResult.data, target);
      setReconRows(rows);
      if (rows.length > 0) {
        // Fetch first so unchanged values are skipped, then write the rest.
        await fetchCurrentValues(client, target, rows, setReconProgress);
        setReconRows([...rows]);
        await executeApplyRows(client, target, rows, setReconProgress, () =>
          setReconRows([...rows]),
        );
        setReconRows([...rows]);
      }
      setReconProgress("");
      setReconPhase("done");

      const failedCount = rows.filter((r) => r.status === "failed").length;
      const updatedCount = rows.filter((r) => r.status === "updated").length;
      if (failedCount > 0) {
        showToast(
          "Transfer complete, reconciliation had failures",
          `${updatedCount} field value(s) applied, ${failedCount} failed.`,
          "warning",
        );
        // Don't push known-wrong values to Edge.
        if (transfer.publish) setPublishPhase("skipped");
      } else {
        showToast(
          "Transfer and reconciliation complete",
          `${updatedCount} field value(s) applied to ${destination.label}.`,
          "success",
        );
        if (transfer.publish) runPublish();
      }
    } catch (error) {
      setReconProgress("");
      setReconError(error instanceof Error ? error.message : String(error));
      setReconPhase("failed");
      if (transfer.publish) setPublishPhase("skipped");
    }
  }, [client, destination, transfer, runPublish, showToast]);

  // Surface terminal transitions once; chain reconciliation, then publish.
  const reportedStageRef = useRef(state.stage);
  useEffect(() => {
    if (state.stage === reportedStageRef.current) return;
    reportedStageRef.current = state.stage;
    if (state.stage === "done") {
      if (transfer.reconcile) {
        runReconcile();
      } else if (transfer.publish) {
        runPublish();
      } else {
        showToast(
          "Transfer complete",
          `"${transfer.name}" was transferred from ${source.label} to ${destination.label}.`,
          "success",
        );
      }
    } else if (state.stage === "failed" && !state.cancelled) {
      onError(
        state.rawError ?? new Error(state.error ?? "The transfer failed."),
        "execute the saved transfer",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage]);

  const busy =
    running || reconPhase === "running" || publishPhase === "running";
  const reconUpdated = reconRows.filter((r) => r.status === "updated");
  const reconFailed = reconRows.filter((r) => r.status === "failed");

  // Extra stepper steps for the chained phases ("skipped" renders pending).
  const phaseStepStatus = (
    phase: ReconcilePhase | PublishPhase,
  ): StepperStatus =>
    phase === "running"
      ? "active"
      : phase === "done"
        ? "completed"
        : phase === "failed"
          ? "failed"
          : "pending";
  const extraSteps: StepperStep[] = [
    ...(transfer.reconcile
      ? [
          {
            label: "Reconcile",
            description: "Destination",
            status: phaseStepStatus(reconPhase),
          },
        ]
      : []),
    ...(transfer.publish
      ? [
          {
            label: "Publish",
            description: "Destination",
            status: phaseStepStatus(publishPhase),
          },
        ]
      : []),
  ];

  // Lock the rest of the UI while the transfer (or the chained
  // reconciliation, which also writes content) is in flight.
  useEffect(() => {
    onRunningChange?.(busy);
    return () => onRunningChange?.(false);
  }, [busy, onRunningChange]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-muted bg-white p-4">
        <div>
          <p className="font-bold">{transfer.name}</p>
          <p className="text-sm text-text-subtle">
            {source.label} → {destination.label} · {transfer.dataTrees.length}{" "}
            path{transfer.dataTrees.length === 1 ? "" : "s"}
            {transfer.reconcile && " · reconcile at the end"}
            {transfer.publish && " · publish at the end"}
          </p>
        </div>
        {running ? (
          <Button variant="outline" colorScheme="danger" onClick={cancel}>
            <Icon path={mdiStop} />
            Cancel transfer
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>
            <Icon path={mdiArrowLeft} />
            Back to saved transfers
          </Button>
        )}
      </div>

      <Card style="outline" padding="md">
        <CardHeader>
          <CardTitle>Transfer progress</CardTitle>
          {state.transferId && (
            <CardDescription className="font-mono text-xs">
              Transfer {state.transferId}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <TransferStepper state={state} extraSteps={extraSteps} />

          {state.stage === "failed" && (
            <div className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              <p className="font-semibold">
                {state.cancelled ? "Transfer cancelled" : "Transfer failed"}
              </p>
              {state.error && <p className="mt-1">{state.error}</p>}
              <p className="mt-1">
                The transfer ID was saved to your recent transfers — you can
                continue or clean it up from the Advanced tab.
              </p>
            </div>
          )}
          {state.stage === "done" && !transfer.reconcile && !transfer.publish && (
            <p className="mt-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
              Transfer complete — the content is in {destination.label} and all
              temporary resources were cleaned up.
            </p>
          )}
        </CardContent>
      </Card>

      <TransferStageDetailsCard
        state={state}
        progressByChunkSet={progressByChunkSet}
        collapsible
      />

      {transfer.reconcile && reconPhase !== "idle" && (
        <CollapsibleCard
          icon={mdiSquareEditOutline}
          title={`Reconciliation — ${destination.label}`}
          done={reconPhase === "done"}
          contentClassName="flex flex-col gap-3"
        >
            {reconPhase === "running" && (
              <div className="flex items-center gap-2 text-sm text-text-subtle">
                <Icon path={mdiLoading} className="animate-spin" />
                {reconProgress || "Applying the saved reconciliation values…"}
              </div>
            )}
            {reconPhase === "failed" && (
              <div className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                <p className="font-semibold">Reconciliation failed</p>
                <p className="mt-1">{reconError}</p>
                <p className="mt-1">
                  The transfer itself completed. You can run the reconciliation
                  manually from the Reconciliation tab.
                </p>
              </div>
            )}
            {reconPhase === "done" && (
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="text-success">{reconUpdated.length} updated</span>
                <span className={reconFailed.length ? "text-danger" : "text-text-subtle"}>
                  {reconFailed.length} failed
                </span>
                <span className="text-text-subtle">
                  {reconRows.length - reconUpdated.length - reconFailed.length} skipped
                </span>
              </div>
            )}
            {reconPhase === "done" && reconRows.length === 0 && (
              <p className="text-sm text-text-subtle">
                No desired values are stored for this environment — nothing to
                reconcile.
              </p>
            )}
            {reconRows.length > 0 && <ApplyRowsTable rows={reconRows} />}
        </CollapsibleCard>
      )}

      {transfer.publish && publishPhase !== "idle" && (
        <CollapsibleCard
          icon={mdiCloudUploadOutline}
          title={`Publish — ${destination.label}`}
          description={
            <>
              {
                PUBLISH_TARGETS.find(
                  (t) => t.value === transfer.publish?.target,
                )?.label
              }
              {" · "}
              {
                PUBLISH_MODES.find((m) => m.value === transfer.publish?.mode)
                  ?.label
              }
              {" · related items excluded"}
            </>
          }
          done={publishPhase === "done"}
          contentClassName="flex flex-col gap-3"
        >
            {publishPhase === "skipped" && (
              <p className="rounded-lg bg-[#ffe6bd] px-3 py-2 text-sm text-[#953d00]">
                Publishing was skipped because the reconciliation step did not
                complete cleanly — publish manually once it is fixed.
              </p>
            )}
            {publishPhase === "running" && (
              <div className="flex items-center gap-2 text-sm text-text-subtle">
                <Icon path={mdiLoading} className="animate-spin" />
                Publishing to Experience Edge…
              </div>
            )}
            {publishNote && (
              <p className="rounded-lg bg-[#ffe6bd] px-3 py-2 text-xs text-[#953d00]">
                {publishNote}
              </p>
            )}
            {publishRows.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {publishRows.map((row) => (
                  <li
                    key={row.path}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span
                      className="max-w-80 truncate font-mono text-text-subtle"
                      title={row.path}
                    >
                      {row.path}
                    </span>
                    {row.operationId ? (
                      <StateBadge state="Queued" />
                    ) : (
                      <>
                        <StateBadge state="Failed" />
                        {row.error && (
                          <span className="text-danger-fg">{row.error}</span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {publishJobs.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-text-subtle">
                  Publishing jobs on {destination.label}
                </span>
                <ul className="flex flex-col gap-1 text-xs">
                  {publishJobs.map((job) => (
                    <li
                      key={job.handle}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span
                        className="max-w-80 truncate font-mono text-text-subtle"
                        title={job.name}
                      >
                        {job.name}
                      </span>
                      <StateBadge state={job.jobState ?? "Unknown"} />
                      {job.processed !== null && (
                        <span className="text-text-subtle">
                          {job.processed} item(s)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {publishPhase === "failed" && (
              <div className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                <p className="font-semibold">Publishing failed</p>
                <p className="mt-1">{publishError}</p>
                <p className="mt-1">
                  The transfer itself completed — you can publish the
                  destination manually.
                </p>
              </div>
            )}
            {publishPhase === "done" && (
              <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
                {publishJobs.length > 0
                  ? `Publishing finished — ${publishJobs.filter((j) => j.jobState !== "Failed").length}/${publishJobs.length} job(s) completed on ${destination.label}.`
                  : `The publish was queued on ${destination.label}.`}
              </p>
            )}
        </CollapsibleCard>
      )}
    </div>
  );
}
