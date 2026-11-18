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
import {
  TreePickerDialog,
  type PickedTreeItem,
} from "@/components/migration/tree-picker-dialog";
import {
  TransferStageDetailsCard,
  TransferStepper,
} from "@/components/migration/transfer-progress";
import {
  SCOPES,
  MERGE_STRATEGIES,
} from "@/components/migration/create-transfer-card";
import {
  PublishProgressCard,
  phaseStepStatus,
} from "@/components/migration/publish-progress-card";
import {
  useAutoMigration,
  type AutoMigrationStage,
} from "@/src/utils/hooks/useAutoMigration";
import { useDestinationPublish } from "@/src/utils/hooks/useDestinationPublish";
import { isOrganizationEnvironment } from "@/src/utils/environment-client";
import {
  archiveFileName,
  createArchiveWriter,
  type ArchiveWriter,
} from "@/src/utils/backup-archive";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import type {
  DataTree,
  DataTreeScope,
  EnvironmentConnection,
  MergeStrategy,
} from "@/src/types/transfer";

/** One content tree path line, with its own scope and merge strategy. */
interface PathRow {
  id: number;
  itemPath: string;
  scope: DataTreeScope;
  mergeStrategy: MergeStrategy;
}

let nextRowId = 0;
/** A new line copies the scope and merge strategy of `from` (the line above). */
const newRow = (itemPath = "", from?: PathRow): PathRow => ({
  id: nextRowId++,
  itemPath,
  scope: from?.scope ?? "SingleItem",
  mergeStrategy: from?.mergeStrategy ?? "OverrideExistingItem",
});

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
  return [
    ...kept,
    end < rows.length ? rows[end] : newRow("", kept[kept.length - 1]),
  ];
}

const scopeLabel = (value: DataTreeScope) =>
  SCOPES.find((s) => s.value === value)?.label ?? value;
const mergeLabel = (value: MergeStrategy) =>
  MERGE_STRATEGIES.find((s) => s.value === value)?.label ?? value;

interface AutoMigrationTabProps {
  /** Marketplace SDK client (publishing the destination after the transfer). */
  client: ClientSDK | null;
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
  client,
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
  const publisher = useDestinationPublish(client, destination);

  // Lock the rest of the UI while the transfer runs. The publish afterwards
  // doesn't lock anything — starting over just stops watching it (the
  // publish itself keeps running in Sitecore).
  useEffect(() => {
    onRunningChange?.(running);
    return () => onRunningChange?.(false);
  }, [running, onRunningChange]);

  const [rows, setRows] = useState<PathRow[]>(() => [newRow()]);
  // The line the tree picker fills (null = closed).
  const [pickerRowId, setPickerRowId] = useState<number | null>(null);
  const [confirmStartOpen, setConfirmStartOpen] = useState(false);
  // Confirmation options (off by default, reset for every transfer).
  const [backupFirst, setBackupFirst] = useState(false);
  const [publishAfter, setPublishAfter] = useState(false);
  // The backup archive is being opened.
  const [openingBackup, setOpeningBackup] = useState(false);
  // What the running/finished transfer was started with (the lines may be
  // edited meanwhile).
  const startedPathsRef = useRef<string[]>([]);
  // Publish was requested for the running/finished transfer.
  const [publishRequested, setPublishRequested] = useState(false);
  // Read after the (async) backup archive is opened.
  const confirmStartOpenRef = useRef(false);
  useEffect(() => {
    confirmStartOpenRef.current = confirmStartOpen;
  }, [confirmStartOpen]);
  // Destination backups need the SDK (chunks pass through the browser).
  const backupAvailable = isOrganizationEnvironment(destination);

  /** Smart publish of every transferred path (subitems included). */
  const runPublish = async () => {
    const started = startedPathsRef.current;
    const outcome = await publisher.run({
      paths: started,
      mode: "SMART",
      displayName: (path) => `Content Transfer Console: Quick Transfer — ${path}`,
    });
    if (outcome.kind === "failed") {
      showToast("Publishing failed", outcome.error, "warning");
    } else if (outcome.kind === "done") {
      if (outcome.failedCount > 0) {
        showToast(
          "Publishing had failures",
          `${outcome.failedCount} publish operation(s) failed on ${destination.label}.`,
          "warning",
        );
      } else {
        showToast(
          "Publish complete",
          outcome.identified
            ? `${outcome.jobCount} publishing job(s) finished on ${destination.label}.`
            : `The publish was queued on ${destination.label}.`,
          "success",
        );
      }
    }
  };

  // Surface terminal transitions once (toast on success, onError on failure —
  // which also reopens the settings dialog for credential problems).
  const reportedStageRef = useRef<AutoMigrationStage>("idle");
  useEffect(() => {
    if (state.stage === reportedStageRef.current) return;
    reportedStageRef.current = state.stage;
    if (state.stage === "done") {
      // The transfer is the outcome; a requested publish follows on its own.
      const started = startedPathsRef.current;
      showToast(
        "Transfer complete",
        `${
          started.length === 1 ? started[0] : `${started.length} paths`
        } ${started.length === 1 ? "was" : "were"} transferred from ${source.label} to ${destination.label}.${
          publishRequested
            ? " Publishing to Experience Edge in the background."
            : ""
        }`,
        "success",
      );
      if (publishRequested) runPublish();
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

  const updateRow = (id: number, update: Partial<PathRow>) =>
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...update } : row)),
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
        ...lines.map((line) => newRow(line, prev[index])),
        ...prev.slice(index + 1),
      ]);
    });
    return true;
  };

  /**
   * The tree picker's multi-select: the first picked item fills line `id`,
   * the others are inserted right below it (each with its own scope, the
   * merge strategy copied from line `id`). Paths already on another line
   * are skipped.
   */
  const pickLines = (id: number, items: PickedTreeItem[]) =>
    setRows((prev) => {
      const index = prev.findIndex((row) => row.id === id);
      if (index < 0) return prev;
      const base = prev[index];
      const taken = new Set(
        prev
          .filter((row) => row.id !== id)
          .map((row) => row.itemPath.trim().toLowerCase())
          .filter(Boolean),
      );
      const picked: PathRow[] = [];
      for (const item of items) {
        const key = item.path.toLowerCase();
        if (taken.has(key)) continue;
        taken.add(key);
        const scope: DataTreeScope = item.includeSubitems
          ? "ItemAndDescendants"
          : "SingleItem";
        picked.push(
          picked.length === 0
            ? { ...base, itemPath: item.path, scope }
            : { ...newRow(item.path, base), scope },
        );
      }
      if (picked.length === 0) return prev;
      return withTrailingEmpty([
        ...prev.slice(0, index),
        ...picked,
        ...prev.slice(index + 1),
      ]);
    });

  // The filled lines as data trees, trimmed and deduped by path (the first
  // line of a repeated path wins).
  const dataTrees: DataTree[] = [];
  for (const row of rows) {
    const ItemPath = row.itemPath.trim();
    if (!ItemPath || dataTrees.some((tree) => tree.ItemPath === ItemPath)) {
      continue;
    }
    dataTrees.push({
      ItemPath,
      Scope: row.scope,
      MergeStrategy: row.mergeStrategy,
    });
  }
  const paths = dataTrees.map((tree) => tree.ItemPath);
  const invalidPaths = paths.filter((path) => !path.startsWith("/sitecore"));
  const pathValid = paths.length > 0 && invalidPaths.length === 0;
  const canStart = pathValid && !running;

  /**
   * Opens the confirmation and starts preparing behind it: the transfer runs
   * up to the upload into the destination and installs only once confirmed
   * (declining discards what was prepared).
   */
  const handleStart = () => {
    startedPathsRef.current = paths;
    setPublishRequested(false);
    reset();
    publisher.reset();
    setBackupFirst(false);
    setPublishAfter(false);
    start({ dataTrees, awaitConfirmation: true });
    setConfirmStartOpen(true);
  };

  const closeConfirmation = (confirmed: boolean) => {
    if (openingBackup) return;
    setConfirmStartOpen(false);
    if (confirmed) {
      setPublishRequested(publishAfter);
      confirm();
    } else {
      decline();
    }
  };

  /**
   * Confirm with "back up the destination first": the backup archive is
   * opened here (no save dialog — it downloads automatically when sealed);
   * the pipeline fills it right before installing.
   */
  const confirmWithBackup = async () => {
    const createdAt = new Date();
    const label = `${destination.label} before Quick Transfer`;
    const fileName = archiveFileName(label, createdAt);
    setOpeningBackup(true);
    let archive: ArchiveWriter;
    try {
      // No save dialog: the ZIP downloads automatically once it's sealed.
      archive = await createArchiveWriter(fileName, { autoDownload: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showToast(
          "Could not create the backup file",
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
      return;
    } finally {
      setOpeningBackup(false);
    }
    // The pre-staged run may have failed meanwhile.
    if (!confirmStartOpenRef.current) {
      await archive.abort().catch(() => {});
      return;
    }
    setConfirmStartOpen(false);
    setPublishRequested(publishAfter);
    confirm({ backup: { archive, fileName, createdAt, label } });
  };

  /** Clears the finished run and the form for the next transfer. */
  const startOver = () => {
    reset();
    publisher.reset();
    setRows([newRow()]);
  };

  // The form gives way to the progress once the user confirmed (or a
  // pre-staged run failed); a declined run that is cleaning up keeps the form.
  const showProgress =
    state.stage !== "idle" && (state.confirmed || state.stage === "failed");
  const finished = state.stage === "done" || state.stage === "failed";

  const overrideTreeCount = dataTrees.filter(
    (tree) => tree.MergeStrategy === "OverrideExistingTree",
  ).length;
  const overrideTree = overrideTreeCount > 0;

  return (
    <div className="flex flex-col gap-4">
      {!showProgress && (
        <Card style="outline" padding="md">
          <CardHeader>
            <CardTitle>Automatic content transfer</CardTitle>
            <CardDescription className="text-muted-foreground">
              Transfers the selected paths into the destination&rsquo;s master
              database in one run. For other databases or step-by-step control,
              use the Advanced tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              {/* Column labels (md+ only; narrow screens stack each line). */}
              <div className="hidden gap-1.5 text-sm font-medium md:grid md:grid-cols-[minmax(0,1fr)_2.5rem_13rem_18rem_2.5rem]">
                <label htmlFor={`auto-path-${rows[0].id}`}>
                  Content tree paths
                </label>
                <span />
                <span>Scope</span>
                <span>Merge strategy</span>
              </div>
              {rows.map((row, index) => {
                const trailing = index === rows.length - 1;
                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap gap-1.5 md:grid md:grid-cols-[minmax(0,1fr)_2.5rem_13rem_18rem_2.5rem]"
                  >
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
                      className="min-w-60 flex-1 font-mono text-xs"
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
                    <Select
                      value={row.scope}
                      onValueChange={(value) =>
                        updateRow(row.id, { scope: value as DataTreeScope })
                      }
                      disabled={running}
                    >
                      <SelectTrigger
                        className="w-52 md:w-full"
                        aria-label={`Scope for path ${index + 1}`}
                      >
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
                      value={row.mergeStrategy}
                      onValueChange={(value) =>
                        updateRow(row.id, {
                          mergeStrategy: value as MergeStrategy,
                        })
                      }
                      disabled={running}
                    >
                      <SelectTrigger
                        className={`w-72 md:w-full ${
                          row.mergeStrategy === "OverrideExistingTree"
                            ? "border-danger text-danger-fg"
                            : ""
                        }`}
                        aria-label={`Merge strategy for path ${index + 1}`}
                      >
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

            {overrideTree && (
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
            <TransferStepper
              state={state}
              extraSteps={
                publishRequested
                  ? [
                      // Runs on its own after the transfer — shown as
                      // "In background" (static), never as a step to wait on.
                      publisher.phase === "running"
                        ? {
                            label: "Publish",
                            description: "In background",
                            status: "background" as const,
                          }
                        : {
                            label: "Publish",
                            description: "Destination",
                            status: phaseStepStatus(publisher.phase),
                          },
                    ]
                  : []
              }
            />

            {state.stage === "done" && (
              <p className="mt-4 flex items-center gap-2 rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
                <Icon path={mdiCheckCircle} size={0.8} />
                Transfer complete — the content is in {destination.label} and
                all temporary resources were cleaned up.
              </p>
            )}
            {state.stage === "done" && publisher.phase === "running" && (
              <p className="mt-2 px-3 text-sm text-text-subtle">
                Publishing to Experience Edge in the background — you can start
                a new transfer, it will finish on its own.
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

      {showProgress && (
        <PublishProgressCard
          publish={publisher}
          destinationLabel={destination.label}
          description="Transferred paths · Smart · subitems included · related items excluded"
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
        showSubitemsToggle
        onSelect={(path, includeSubitems) => {
          if (pickerRowId === null) return;
          pickLines(pickerRowId, [{ path, includeSubitems }]);
        }}
        onSelectMany={(items) => {
          if (pickerRowId === null) return;
          pickLines(pickerRowId, items);
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
              will be transferred:
            </DialogDescription>
          </DialogHeader>

          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border-muted px-3 py-2">
            {dataTrees.map((tree) => (
              <li key={tree.ItemPath} className="min-w-0">
                <p className="truncate font-mono text-xs" title={tree.ItemPath}>
                  {tree.ItemPath}
                </p>
                <p
                  className={`text-xs ${
                    tree.MergeStrategy === "OverrideExistingTree"
                      ? "text-danger-fg"
                      : "text-text-subtle"
                  }`}
                >
                  {scopeLabel(tree.Scope)} · {mergeLabel(tree.MergeStrategy)}
                </p>
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
              matching{" "}
              {overrideTreeCount === 1
                ? paths.length === 1
                  ? "this path"
                  : "the path marked with it"
                : "each path marked with it"}{" "}
              in {destination.label}.
            </p>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-border-muted px-3 py-2.5">
            <label
              className={`flex items-start gap-2 text-sm ${
                backupAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={backupFirst}
                disabled={!backupAvailable || openingBackup}
                onChange={(e) => setBackupFirst(e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  Back up {destination.label} first
                </span>
                <span className="text-xs text-text-subtle">
                  {backupAvailable
                    ? "Right before the content is installed, these paths are downloaded from the destination into a ZIP that downloads automatically — you can restore it from the Backup & Restore tab."
                    : "Available in Organization mode only — backups download the content through the browser."}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={publishAfter}
                disabled={openingBackup}
                onChange={(e) => setPublishAfter(e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">
                  Publish to Experience Edge afterwards
                </span>
                <span className="text-xs text-text-subtle">
                  Once the transfer completes, each transferred path is
                  published in {destination.label} — smart publish, subitems
                  included, related items excluded.
                </span>
              </span>
            </label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeConfirmation(false)}
              disabled={openingBackup}
            >
              Cancel
            </Button>
            <Button
              colorScheme={overrideTree ? "danger" : undefined}
              onClick={() =>
                backupFirst && backupAvailable
                  ? confirmWithBackup()
                  : closeConfirmation(true)
              }
              disabled={openingBackup}
            >
              {openingBackup && (
                <Icon path={mdiLoading} className="animate-spin" />
              )}
              Start transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
