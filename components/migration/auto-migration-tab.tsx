"use client";

import { useEffect, useRef, useState } from "react";
import {
  mdiCheckCircle,
  mdiAlertCircle,
  mdiClose,
  mdiFileTree,
  mdiStop,
  mdiArrowRightBold,
  mdiLoading,
  mdiRestart,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardAction,
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
import { TreePickerDialog } from "@/components/migration/tree-picker-dialog";
import {
  TransferStageDetailsCard,
  TransferStepper,
} from "@/components/migration/transfer-progress";
import {
  SCOPES,
  MERGE_STRATEGIES,
} from "@/components/migration/create-transfer-card";
import {
  useAutoMigration,
  type AutoMigrationStage,
} from "@/src/utils/hooks/useAutoMigration";
import type {
  DataTree,
  DataTreeScope,
  EnvironmentConnection,
  MergeStrategy,
} from "@/src/types/transfer";

/** One content tree path line. */
interface PathRow {
  id: number;
  itemPath: string;
}

let nextRowId = 0;
const newRow = (itemPath = ""): PathRow => ({ id: nextRowId++, itemPath });

/**
 * Keeps exactly one empty line at the end — filling the last line (typing,
 * pasting or picking) opens the next one. Emptied lines in the middle stay
 * (so clearing one to retype doesn't drop it); they are ignored on start.
 */
function withTrailingEmpty(rows: PathRow[]): PathRow[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].itemPath === "") end--;
  const kept = rows.slice(0, end);
  // Reuse an existing empty line so its input keeps focus.
  return [...kept, end < rows.length ? rows[end] : newRow()];
}

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
  const {
    state,
    running,
    progressByChunkSet,
    start,
    cancel,
    confirm,
    decline,
    reset,
  } = useAutoMigration(source, destination);

  useEffect(() => {
    onRunningChange?.(running);
    return () => onRunningChange?.(false);
  }, [running, onRunningChange]);

  const [rows, setRows] = useState<PathRow[]>(() => [newRow()]);
  const [scope, setScope] = useState<DataTreeScope>("SingleItem");
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>(
    "OverrideExistingItem",
  );
  // The line the tree picker fills (null = closed).
  const [pickerRowId, setPickerRowId] = useState<number | null>(null);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  // What the running/finished transfer was started with (the lines may be
  // edited meanwhile).
  const startedPathsRef = useRef<string[]>([]);

  // Surface terminal transitions once (toast on success, onError on failure —
  // which also reopens the settings dialog for credential problems).
  const reportedStageRef = useRef<AutoMigrationStage>("idle");
  useEffect(() => {
    if (state.stage === reportedStageRef.current) return;
    reportedStageRef.current = state.stage;
    if (state.stage === "done") {
      const started = startedPathsRef.current;
      showToast(
        "Transfer complete",
        `${
          started.length === 1 ? started[0] : `${started.length} paths`
        } ${started.length === 1 ? "was" : "were"} transferred from ${source.label} to ${destination.label}.`,
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

  // A run that fails while the confirmation is open closes it so the
  // failure shows in the progress card.
  useEffect(() => {
    if (state.stage === "failed") setConfirmStartOpen(false);
  }, [state.stage]);

  const setRowPath = (id: number, itemPath: string) =>
    setRows((prev) =>
      withTrailingEmpty(
        prev.map((row) => (row.id === id ? { ...row, itemPath } : row)),
      ),
    );

  const removeRow = (id: number) =>
    setRows((prev) => withTrailingEmpty(prev.filter((row) => row.id !== id)));

  /** A multi-line paste fills one line per path. Returns false for one line. */
  const pasteLines = (id: number, text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      return withTrailingEmpty([
        ...prev.slice(0, index),
        ...lines.map((line) => newRow(line)),
        ...prev.slice(index + 1),
      ]);
    });
    return true;
  };

  // Trimmed, deduped paths of the filled lines.
  const paths = [
    ...new Set(rows.map((row) => row.itemPath.trim()).filter(Boolean)),
  ];
  const invalidPaths = paths.filter((path) => !path.startsWith("/sitecore"));
  const pathValid = paths.length > 0 && invalidPaths.length === 0;
  const canStart = pathValid && !running;

  /**
   * Opens the confirmation and starts preparing behind it: the transfer runs
   * up to the upload into the destination and installs only once confirmed
   * (declining discards what was prepared).
   */
  const handleStart = () => {
    const dataTrees: DataTree[] = paths.map((ItemPath) => ({
      ItemPath,
      Scope: scope,
      MergeStrategy: mergeStrategy,
    }));
    startedPathsRef.current = paths;
    reset();
    start({ dataTrees, awaitConfirmation: true });
    setConfirmStartOpen(true);
  };

  const closeConfirmation = (confirmed: boolean) => {
    setConfirmStartOpen(false);
    if (confirmed) confirm();
    else decline();
  };

  /** Clears the finished run and the form for the next transfer. */
  const startOver = () => {
    reset();
    setRows([newRow()]);
    setScope("SingleItem");
    setMergeStrategy("OverrideExistingItem");
  };

  // The form gives way to the progress once the user confirmed (or a
  // pre-staged run failed); a declined run that is cleaning up keeps the form.
  const showProgress =
    state.stage !== "idle" && (state.confirmed || state.stage === "failed");
  const finished = state.stage === "done" || state.stage === "failed";

  const overrideTree = mergeStrategy === "OverrideExistingTree";

  return (
    <div className="flex flex-col gap-4">
      {!showProgress && (
        <Card style="outline" padding="md">
          <CardHeader>
            <CardTitle>Automatic content transfer</CardTitle>
            <CardDescription className="text-muted-foreground">
              Pick one or more content tree paths and how to merge them — the
              transfer, chunk copying, .raif generation, consumption into the
              destination database ({/* hidden default */}master), and cleanup
              all run automatically. Use the Advanced tab for a different scope
              or merge strategy per path, other databases, or step-by-step
              control.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex min-w-72 flex-1 flex-col gap-1.5">
                <label
                  htmlFor={`auto-path-${rows[0].id}`}
                  className="text-sm font-medium"
                >
                  Content tree paths
                </label>
                {rows.map((row, index) => {
                  const trailing = index === rows.length - 1;
                  return (
                    <div key={row.id} className="flex gap-1.5">
                      <Input
                        id={`auto-path-${row.id}`}
                        value={row.itemPath}
                        autoComplete="off"
                        onChange={(e) => setRowPath(row.id, e.target.value)}
                        onPaste={(e) => {
                          if (
                            pasteLines(row.id, e.clipboardData.getData("text"))
                          ) {
                            e.preventDefault();
                          }
                        }}
                        placeholder={
                          index === 0
                            ? "/sitecore/content/Home/MyItem"
                            : "Add another path (optional)"
                        }
                        aria-label={`Content tree path ${index + 1}`}
                        className="flex-1 font-mono text-xs"
                        disabled={running}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setPickerRowId(row.id)}
                        disabled={running}
                        aria-label="Browse the source content tree"
                        title="Browse the source content tree"
                      >
                        <Icon path={mdiFileTree} />
                      </Button>
                      {/* The trailing empty line is where the next path goes —
                        it keeps the slot so the lines stay aligned. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(row.id)}
                        disabled={running || trailing}
                        className={trailing ? "invisible" : undefined}
                        aria-label="Remove this path"
                        title="Remove this path"
                      >
                        <Icon path={mdiClose} />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Scope</label>
                <Select
                  value={scope}
                  onValueChange={(value) => setScope(value as DataTreeScope)}
                  disabled={running}
                >
                  <SelectTrigger className="w-52" aria-label="Scope">
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
                  <SelectTrigger className="w-72" aria-label="Merge strategy">
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
              <Button onClick={handleStart} disabled={!canStart}>
                Start transfer
              </Button>
              {running && !confirmStartOpen && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon path={mdiLoading} size={0.6} className="animate-spin" />
                  Discarding the prepared transfer…
                </p>
              )}
              {invalidPaths.length > 0 && (
                <p className="text-xs text-danger-fg">
                  Every path must start with /sitecore.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {showProgress && (
        <Card style="outline" padding="md">
          <CardHeader>
            <CardTitle>Progress</CardTitle>
            {state.transferIds.length > 0 && (
              <CardDescription className="font-mono text-xs">
                Transfer {state.transferIds.join(" · ")}
              </CardDescription>
            )}
            {running && (
              <CardAction>
                <Button
                  variant="outline"
                  colorScheme="danger"
                  size="sm"
                  onClick={cancel}
                >
                  <Icon path={mdiStop} />
                  Cancel transfer
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            <TransferStepper state={state} />

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
                  {state.discarded
                    ? "Nothing was installed — the prepared transfer was discarded."
                    : "The transfer ID was saved to your recent transfers — you can continue or clean it up from the Advanced tab."}
                </p>
              </div>
            )}
            {finished && (
              <div className="mt-4 flex justify-center">
                <Button onClick={startOver}>
                  <Icon path={mdiRestart} />
                  New Quick Transfer
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showProgress && (
        <TransferStageDetailsCard
          state={state}
          progressByChunkSet={progressByChunkSet}
          collapsible
          defaultOpen={false}
        />
      )}

      <TreePickerDialog
        open={pickerRowId !== null}
        onOpenChange={(open) => {
          if (!open) setPickerRowId(null);
        }}
        source={source}
        database="master"
        onSelect={(path) => {
          if (pickerRowId !== null) setRowPath(pickerRowId, path);
        }}
      />

      <Dialog
        open={confirmStartOpen}
        onOpenChange={(open) => {
          if (!open) closeConfirmation(false);
        }}
      >
        <DialogContent className={overrideTree ? "border-danger" : undefined}>
          <DialogHeader>
            <DialogTitle
              className={overrideTree ? "text-danger-fg" : undefined}
            >
              Start this transfer?
            </DialogTitle>
            <DialogDescription>
              {paths.length === 1 ? "This path" : `These ${paths.length} paths`}{" "}
              ({SCOPES.find((s) => s.value === scope)?.label.toLowerCase()})
              will be transferred:
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-40 overflow-y-auto rounded-lg border border-border-muted px-3 py-2 font-mono text-xs">
            {paths.map((path) => (
              <li key={path} className="truncate" title={path}>
                {path}
              </li>
            ))}
          </ul>

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
              matching {paths.length === 1 ? "this path" : "each path"} in{" "}
              {destination.label}.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => closeConfirmation(false)}>
              Cancel
            </Button>
            <Button
              colorScheme={overrideTree ? "danger" : undefined}
              onClick={() => closeConfirmation(true)}
            >
              Start transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
