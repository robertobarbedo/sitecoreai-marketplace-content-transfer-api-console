"use client";

import { useEffect, useRef, useState } from "react";
import {
  mdiCheckCircle,
  mdiCircleOutline,
  mdiAlertCircle,
  mdiLoading,
  mdiFileTree,
  mdiStop,
  mdiArrowRightBold,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EnvBadge, StateBadge } from "@/components/badges";
import { TreePickerDialog } from "@/components/migration/tree-picker-dialog";
import {
  SCOPES,
  MERGE_STRATEGIES,
} from "@/components/migration/create-transfer-card";
import {
  useAutoMigration,
  AUTO_MIGRATION_STAGES,
  type AutoMigrationStage,
} from "@/src/utils/hooks/useAutoMigration";
import { summarizeProgress } from "@/src/utils/hooks/useChunkCopy";
import type {
  DataTreeScope,
  EnvironmentConnection,
  MergeStrategy,
} from "@/src/types/transfer";

const STAGE_LABELS: Record<
  (typeof AUTO_MIGRATION_STAGES)[number],
  { label: string; env: "source" | "destination" | "both" }
> = {
  create: { label: "Create the transfer operation", env: "source" },
  snapshot: { label: "Snapshot content into chunk sets", env: "source" },
  copy: { label: "Copy chunks to the destination", env: "both" },
  complete: { label: "Generate .raif files", env: "destination" },
  consume: { label: "Consume into the destination database", env: "destination" },
  cleanup: { label: "Clean up transfer and blobs", env: "both" },
};

interface AutoMigrationTabProps {
  source: EnvironmentConnection;
  destination: EnvironmentConnection;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
  /** Reports the pipeline state so the page can lock the rest of the UI. */
  onRunningChange?: (running: boolean) => void;
}

export function AutoMigrationTab({
  source,
  destination,
  onError,
  showToast,
  onRunningChange,
}: AutoMigrationTabProps) {
  const { state, running, progressByChunkSet, start, cancel, reset } =
    useAutoMigration(source, destination);

  useEffect(() => {
    onRunningChange?.(running);
    return () => onRunningChange?.(false);
  }, [running, onRunningChange]);

  const [itemPath, setItemPath] = useState("");
  const [scope, setScope] = useState<DataTreeScope>("SingleItem");
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>(
    "OverrideExistingItem",
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);

  // Surface terminal transitions once (toast on success, onError on failure —
  // which also reopens the connections modal for credential problems).
  const reportedStageRef = useRef<AutoMigrationStage>("idle");
  useEffect(() => {
    if (state.stage === reportedStageRef.current) return;
    reportedStageRef.current = state.stage;
    if (state.stage === "done") {
      showToast(
        "Transfer complete",
        `${itemPath.trim()} was transferred from ${source.label} to ${destination.label}.`,
        "success",
      );
    } else if (state.stage === "failed" && !state.cancelled) {
      onError(
        state.rawError ?? new Error(state.error ?? "The transfer failed."),
        "run the automatic transfer",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage]);

  const pathValid = itemPath.trim().startsWith("/sitecore");
  const canStart = pathValid && !running;

  const beginMigration = () => {
    reset();
    start({
      dataTrees: [
        { ItemPath: itemPath.trim(), Scope: scope, MergeStrategy: mergeStrategy },
      ],
    });
  };

  const handleStart = () => setConfirmStartOpen(true);

  const overrideTree = mergeStrategy === "OverrideExistingTree";

  return (
    <div className="flex flex-col gap-4">
      <Card style="outline" padding="md">
        <CardHeader>
          <CardTitle>Automatic content transfer</CardTitle>
          <CardDescription className="text-muted-foreground">
            Pick one content tree path and how to merge it — the transfer,
            chunk copying, .raif generation, consumption into the destination
            database ({/* hidden default */}master), and cleanup all run
            automatically. Use the Advanced tab for multiple paths,
            other databases, or step-by-step control.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-72 flex-1 flex-col gap-1.5">
              <label htmlFor="auto-path" className="text-sm font-medium">
                Content tree path
              </label>
              <div className="flex gap-1.5">
                <Input
                  id="auto-path"
                  value={itemPath}
                  autoComplete="off"
                  onChange={(e) => setItemPath(e.target.value)}
                  placeholder="/sitecore/content/Home/MyItem"
                  className="flex-1 font-mono text-xs"
                  disabled={running}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPickerOpen(true)}
                  disabled={running}
                  aria-label="Browse the source content tree"
                  title="Browse the source content tree"
                >
                  <Icon path={mdiFileTree} />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Scope</label>
              <Select
                value={scope}
                onValueChange={(value) => setScope(value as DataTreeScope)}
                disabled={running}
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
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">Merge strategy</label>
              <Select
                value={mergeStrategy}
                onValueChange={(value) =>
                  setMergeStrategy(value as MergeStrategy)
                }
                disabled={running}
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
            </div>
          </div>

          {mergeStrategy === "OverrideExistingTree" && (
            <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              &quot;Override existing tree&quot; replaces the whole matching
              tree in the destination environment.
            </p>
          )}

          <div className="flex flex-col items-center gap-2">
            {running ? (
              <Button variant="outline" colorScheme="danger" onClick={cancel}>
                <Icon path={mdiStop} />
                Cancel transfer
              </Button>
            ) : (
              <Button onClick={handleStart} disabled={!canStart}>
                Start transfer
              </Button>
            )}
            {!pathValid && itemPath.trim() !== "" && (
              <p className="text-xs text-danger-fg">
                The path must start with /sitecore.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {state.stage !== "idle" && (
        <Card style="outline" padding="md">
          <CardHeader>
            <CardTitle>Progress</CardTitle>
            {state.transferId && (
              <CardDescription className="font-mono text-xs">
                Transfer {state.transferId}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {AUTO_MIGRATION_STAGES.map((stage) => (
                <StageRow
                  key={stage}
                  stage={stage}
                  state={state}
                  progressByChunkSet={progressByChunkSet}
                />
              ))}
            </ol>

            {state.stage === "done" && (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
                <Icon path={mdiCheckCircle} size={0.8} />
                Transfer complete — the content is in {destination.label} and
                all temporary resources were cleaned up.
              </p>
            )}
            {state.stage === "failed" && (
              <div className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                <p className="flex items-center gap-2 font-semibold">
                  <Icon path={mdiAlertCircle} size={0.8} />
                  {state.cancelled ? "Transfer cancelled" : "Transfer failed"}
                </p>
                {state.error && <p className="mt-1">{state.error}</p>}
                <p className="mt-1">
                  The transfer ID was saved to your recent transfers — you can
                  continue or clean it up from the Advanced tab.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <TreePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        source={source}
        database="master"
        onSelect={setItemPath}
      />

      <Dialog open={confirmStartOpen} onOpenChange={setConfirmStartOpen}>
        <DialogContent className={overrideTree ? "border-danger" : undefined}>
          <DialogHeader>
            <DialogTitle className={overrideTree ? "text-danger-fg" : undefined}>
              Start this transfer?
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{itemPath.trim()}</span> (
              {SCOPES.find((s) => s.value === scope)?.label.toLowerCase()}) will
              be transferred:
            </DialogDescription>
          </DialogHeader>

          {/* Transfer direction, using the source/destination color code */}
          <div className="flex flex-wrap items-center justify-center gap-3 py-1">
            <div className="flex min-w-28 flex-col items-center rounded-lg border border-[#003767]/15 bg-[#c6f1ff] px-4 py-1.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#003767]/70">
                Source
              </span>
              <span
                className="max-w-44 truncate text-xs font-bold text-[#003767]"
                title={source.host}
              >
                {source.label}
              </span>
            </div>
            <Icon
              path={mdiArrowRightBold}
              size={0.9}
              className="shrink-0 text-text-subtle"
            />
            <div className="flex min-w-28 flex-col items-center rounded-lg border border-success/20 bg-success-bg px-4 py-1.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-success-fg/70">
                Destination
              </span>
              <span
                className="max-w-44 truncate text-xs font-bold text-success-fg"
                title={destination.host}
              >
                {destination.label}
              </span>
            </div>
          </div>

          {overrideTree && (
            <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
              &quot;Override existing tree&quot; replaces the whole tree
              matching{" "}
              <span className="font-mono text-xs">{itemPath.trim()}</span> in{" "}
              {destination.label}.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStartOpen(false)}>
              Cancel
            </Button>
            <Button
              colorScheme={overrideTree ? "danger" : undefined}
              onClick={() => {
                setConfirmStartOpen(false);
                beginMigration();
              }}
            >
              Start transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One row of the pipeline checklist — also used by the Saved Transfers tab. */
export function StageRow({
  stage,
  state,
  progressByChunkSet,
}: {
  stage: (typeof AUTO_MIGRATION_STAGES)[number];
  state: ReturnType<typeof useAutoMigration>["state"];
  progressByChunkSet: ReturnType<typeof useAutoMigration>["progressByChunkSet"];
}) {
  const order = AUTO_MIGRATION_STAGES;
  const currentIndex =
    state.stage === "done"
      ? order.length
      : order.indexOf(
          (state.stage === "failed" ? (state.failedAt ?? "create") : state.stage) as never,
        );
  const stageIndex = order.indexOf(stage);

  const status: "pending" | "active" | "done" | "failed" =
    stageIndex < currentIndex
      ? "done"
      : stageIndex > currentIndex
        ? "pending"
        : state.stage === "failed"
          ? "failed"
          : "active";

  const { label, env } = STAGE_LABELS[stage];

  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 shrink-0",
          status === "done" && "text-success",
          status === "failed" && "text-danger",
          status === "active" && "text-primary",
          status === "pending" && "text-text-subtle",
        )}
      >
        <Icon
          path={
            status === "done"
              ? mdiCheckCircle
              : status === "failed"
                ? mdiAlertCircle
                : status === "active"
                  ? mdiLoading
                  : mdiCircleOutline
          }
          size={0.8}
          className={status === "active" ? "animate-spin" : ""}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm",
              status === "pending" ? "text-text-subtle" : "text-on-surface",
              status === "active" && "font-semibold",
            )}
          >
            {label}
          </span>
          {env !== "both" ? (
            <EnvBadge env={env} />
          ) : (
            <>
              <EnvBadge env="source" />
              <EnvBadge env="destination" />
            </>
          )}
        </div>

        {/* Live details for the data-heavy stages */}
        {stage === "copy" && status !== "pending" && state.chunkSets.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-text-subtle">
            {state.chunkSets.map((chunkSet) => {
              const { done, failed } = summarizeProgress(
                progressByChunkSet[chunkSet.ChunkSetId],
              );
              return (
                <li key={chunkSet.ChunkSetId} className="font-mono">
                  {chunkSet.ChunkSetId.slice(0, 8)}… — {done}/{chunkSet.ChunkCount}{" "}
                  chunks
                  {failed > 0 && (
                    <span className="text-danger-fg"> · {failed} failed</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {stage === "consume" &&
          status !== "pending" &&
          Object.keys(state.consumption).length > 0 && (
            <ul className="mt-1 flex flex-col gap-1 text-xs">
              {Object.entries(state.consumption).map(([name, progress]) => (
                <li key={name} className="flex flex-wrap items-center gap-2">
                  <span
                    className="max-w-80 truncate font-mono text-text-subtle"
                    title={name}
                  >
                    {name}
                  </span>
                  <StateBadge
                    state={progress.state === "Waiting" ? "Queued" : progress.state}
                  />
                  {progress.detail && (
                    <span className="text-text-subtle">{progress.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </li>
  );
}
