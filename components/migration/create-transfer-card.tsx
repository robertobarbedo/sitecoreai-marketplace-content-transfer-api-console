"use client";

import { useState } from "react";
import {
  mdiPlus,
  mdiDelete,
  mdiLoading,
  mdiRefresh,
  mdiHistory,
  mdiFileTree,
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
import { EnvBadge } from "@/components/badges";
import { TreePickerDialog } from "@/components/migration/tree-picker-dialog";
import { callTransferApi } from "@/src/utils/transfer-api";
import type { RecentTransfer } from "@/src/utils/recent-transfers";
import type {
  CreateTransferInput,
  DataTree,
  DataTreeScope,
  EnvironmentConnection,
  MergeStrategy,
} from "@/src/types/transfer";

export const SCOPES: { value: DataTreeScope; label: string }[] = [
  { value: "SingleItem", label: "Single item" },
  { value: "ItemAndDescendants", label: "Item + descendants" },
];

export const MERGE_STRATEGIES: { value: MergeStrategy; label: string }[] = [
  { value: "OverrideExistingItem", label: "Override existing item (default)" },
  { value: "KeepExistingItem", label: "Keep existing item" },
  { value: "LatestWin", label: "Latest wins" },
  { value: "OverrideExistingTree", label: "Override existing tree" },
];

const DEFAULT_TREE: DataTree = {
  ItemPath: "",
  Scope: "SingleItem",
  MergeStrategy: "OverrideExistingItem",
};

interface CreateTransferCardProps {
  source: EnvironmentConnection;
  destination: EnvironmentConnection;
  activeTransfer: RecentTransfer | null;
  recentTransfers: RecentTransfer[];
  onTransferReady: (transfer: RecentTransfer) => void;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

export function CreateTransferCard({
  source,
  destination,
  activeTransfer,
  recentTransfers,
  onTransferReady,
  onError,
  showToast,
}: CreateTransferCardProps) {
  const [transferId, setTransferId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [database, setDatabase] = useState("master");
  const [trees, setTrees] = useState<DataTree[]>([{ ...DEFAULT_TREE }]);
  const [creating, setCreating] = useState(false);
  const [attachId, setAttachId] = useState("");
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const updateTree = (index: number, patch: Partial<DataTree>) => {
    setTrees((prev) =>
      prev.map((tree, i) => (i === index ? { ...tree, ...patch } : tree)),
    );
  };

  const canCreate =
    !creating &&
    /^[0-9a-f-]{36}$/i.test(transferId.trim()) &&
    database.trim() !== "" &&
    trees.length > 0 &&
    trees.every((t) => t.ItemPath.trim().startsWith("/sitecore"));

  const buildRecentEntry = (id: string, dataTrees: DataTree[]): RecentTransfer => ({
    transferId: id,
    createdAt: new Date().toISOString(),
    database: database.trim(),
    sourceConnectionId: source.id,
    destinationConnectionId: destination.id,
    sourceLabel: source.label,
    destinationLabel: destination.label,
    dataTrees,
  });

  const handleCreate = async () => {
    setCreating(true);
    const id = transferId.trim().toLowerCase();
    const input: CreateTransferInput = {
      TransferId: id,
      Configuration: {
        Database: database.trim(),
        DataTrees: trees.map((t) => ({ ...t, ItemPath: t.ItemPath.trim() })),
      },
    };
    try {
      await callTransferApi(source, "/api/transfer/transfers", {
        method: "POST",
        body: JSON.stringify(input),
      });
      showToast(
        "Transfer created",
        `Operation ${id} accepted by ${source.label}. Retrieve its status to see the chunk sets.`,
        "success",
      );
      onTransferReady(buildRecentEntry(id, input.Configuration.DataTrees));
      setTransferId(crypto.randomUUID());
    } catch (error) {
      onError(error, "create the transfer");
    } finally {
      setCreating(false);
    }
  };

  const handleAttach = () => {
    const id = attachId.trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(id)) return;
    onTransferReady(buildRecentEntry(id, []));
    setAttachId("");
  };

  const reusedId = recentTransfers.some(
    (t) => t.transferId === transferId.trim().toLowerCase(),
  );

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Step 1 — Create a content transfer</CardTitle>
          <EnvBadge env="source" name={source.label} />
        </div>
        <CardDescription className="text-muted-foreground">
          Nominate one or more items of the source environment for transfer.
          The operation snapshots the data into chunk sets you copy in the next
          steps.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="transfer-id" className="text-sm font-medium">
              Transfer ID
            </label>
            <div className="flex gap-2">
              <Input
                id="transfer-id"
                value={transferId}
                autoComplete="off"
                onChange={(e) => setTransferId(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTransferId(crypto.randomUUID())}
                aria-label="Generate a new transfer ID"
                title="Generate a new UUID"
              >
                <Icon path={mdiRefresh} />
              </Button>
            </div>
            {reusedId && (
              <p className="text-xs text-danger-fg">
                Warning: this ID was already used. Reusing it overwrites the
                previous transfer operation on the source environment.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="transfer-db" className="text-sm font-medium">
              Source database
            </label>
            <Input
              id="transfer-db"
              value={database}
              autoComplete="off"
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="master"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Data trees</p>
          {trees.map((tree, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border-muted bg-surface-container-low p-2"
            >
              <div className="flex min-w-64 flex-1 gap-1.5">
                <Input
                  value={tree.ItemPath}
                  autoComplete="off"
                  onChange={(e) => updateTree(index, { ItemPath: e.target.value })}
                  placeholder="/sitecore/content/Home/MyItem"
                  className="flex-1 font-mono text-xs"
                  aria-label={`Item path ${index + 1}`}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPickerIndex(index)}
                  aria-label={`Browse the source content tree for path ${index + 1}`}
                  title="Browse the source content tree"
                >
                  <Icon path={mdiFileTree} />
                </Button>
              </div>
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
                disabled={trees.length === 1}
                onClick={() =>
                  setTrees((prev) => prev.filter((_, i) => i !== index))
                }
                aria-label={`Remove data tree ${index + 1}`}
              >
                <Icon path={mdiDelete} />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTrees((prev) => [...prev, { ...DEFAULT_TREE }])}
            >
              <Icon path={mdiPlus} />
              Add data tree
            </Button>
            <p className="text-xs text-text-subtle">
              &quot;Override existing tree&quot; replaces the whole matching
              tree in the destination — use with care.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleCreate} disabled={!canCreate}>
            {creating && (
              <Icon path={mdiLoading} size={0.8} className="animate-spin" />
            )}
            Create transfer
          </Button>
          {activeTransfer && (
            <p className="text-xs text-text-subtle">
              Active transfer:{" "}
              <span className="font-mono">{activeTransfer.transferId}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-border-muted pt-3">
          <div className="flex min-w-72 flex-col gap-1.5">
            <label htmlFor="attach-id" className="text-sm font-medium">
              Or attach an existing transfer
            </label>
            <Input
              id="attach-id"
              value={attachId}
              autoComplete="off"
              onChange={(e) => setAttachId(e.target.value)}
              placeholder="Transfer ID (UUID)"
              className="font-mono text-xs"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleAttach}
            disabled={!/^[0-9a-f-]{36}$/i.test(attachId.trim())}
          >
            Attach
          </Button>
          {recentTransfers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Icon path={mdiHistory} size={0.7} className="text-text-subtle" />
              {recentTransfers.slice(0, 5).map((t) => (
                <button
                  key={t.transferId}
                  type="button"
                  onClick={() => onTransferReady(t)}
                  className="cursor-pointer rounded-full bg-neutral-bg px-2 py-0.5 font-mono text-[10px] text-neutral-fg hover:bg-neutral-bg-active"
                  title={`${t.sourceLabel} → ${t.destinationLabel} (${new Date(t.createdAt).toLocaleString()})`}
                >
                  {t.transferId.slice(0, 8)}…
                </button>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <TreePickerDialog
        open={pickerIndex !== null}
        onOpenChange={(open) => {
          if (!open) setPickerIndex(null);
        }}
        source={source}
        database={database}
        onSelect={(path) => {
          if (pickerIndex !== null) updateTree(pickerIndex, { ItemPath: path });
        }}
      />
    </Card>
  );
}
