"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { callTransferApi } from "@/src/utils/transfer-api";
import {
  blobStateToConsumption,
  completeChunkSet,
  createTransfer,
  deleteTransfer,
  fetchItemChildren,
  getBlobSourceState,
  getTransferStatus,
  isMediaPath,
  isOrganizationEnvironment,
  modeOf,
  SourceNotReadyError,
  startConsume,
} from "@/src/utils/environment-client";
import { useChunkCopy } from "@/src/utils/hooks/useChunkCopy";
import {
  BackupCancelledError,
  runContentBackup,
  type BackupProgress,
} from "@/src/utils/hooks/useContentBackup";
import type { ArchiveDelivery, ArchiveWriter } from "@/src/utils/backup-archive";
import {
  upsertRecentTransfer,
  recordRaifFile,
  removeRecentTransfer,
} from "@/src/utils/recent-transfers";
import type {
  ChunkSetMetadata,
  ContentTransferStatus,
  CreateTransferInput,
  DataTree,
  EnvironmentConnection,
  ItemTransfersPage,
  ItemTransferState,
} from "@/src/types/transfer";

/** The automatic mode hides databases; everything runs against master. */
const DATABASE = "master";

const STATUS_POLL_MS = 5000;
const CONSUME_POLL_MS = 5000;
const BLOB_READY_POLL_MS = 3000;
const BLOB_READY_TIMEOUT_MS = 60000;
/** Organization mode: consumeFile retries while the .raif assembles. */
const MAX_CONSUME_ATTEMPTS = 10;

export type AutoMigrationStage =
  | "idle"
  | "create"
  | "snapshot"
  | "copy"
  | "backup"
  | "complete"
  | "consume"
  | "cleanup"
  | "done"
  | "failed";

/**
 * Pipeline stages in execution order (for checklist rendering). "backup"
 * only runs when the user asked for a destination backup — render the list
 * from `pipelineStages(state)`.
 */
export const AUTO_MIGRATION_STAGES: Exclude<
  AutoMigrationStage,
  "idle" | "done" | "failed"
>[] = ["create", "snapshot", "copy", "backup", "complete", "consume", "cleanup"];

/** The stages this run goes through (without "backup" unless requested). */
export function pipelineStages(state: { backup?: unknown }) {
  return state.backup
    ? AUTO_MIGRATION_STAGES
    : AUTO_MIGRATION_STAGES.filter((stage) => stage !== "backup");
}

/**
 * Back up the destination's current content before installing (Organization
 * mode only). The archive must be opened inside the confirm click's user
 * gesture (`createArchiveWriter`), so it is handed over ready to write.
 */
export interface PreTransferBackup {
  archive: ArchiveWriter;
  fileName: string;
  createdAt: Date;
  label: string;
}

export interface PreTransferBackupState {
  fileName: string;
  progress?: BackupProgress;
  /** Paths that don't exist in the destination yet (nothing to back up). */
  skippedPaths: string[];
  /** None of the paths exist in the destination — no archive was written. */
  nothingToBackUp?: boolean;
  /** Set once the archive is saved. */
  delivery?: ArchiveDelivery;
}

export interface AutoMigrationInput {
  /** One or more content trees to move in a single transfer operation. */
  dataTrees: DataTree[];
  /**
   * Pre-stage while the user confirms: run up to the upload into the
   * destination and wait for `confirm()` before installing (consuming).
   * `decline()` discards everything prepared so far and returns to idle.
   */
  awaitConfirmation?: boolean;
}

export interface ConsumptionProgress {
  state: ItemTransferState | "Waiting";
  detail?: string;
}

export interface AutoMigrationState {
  stage: AutoMigrationStage;
  /** Stage that was running when the pipeline failed. */
  failedAt?: AutoMigrationStage;
  error?: string;
  /** Raw error object, for credential detection in the UI. */
  rawError?: unknown;
  cancelled?: boolean;
  /**
   * False while a pre-staged run waits for the user's go-ahead (see
   * `AutoMigrationInput.awaitConfirmation`); true otherwise.
   */
  confirmed: boolean;
  /**
   * The run failed before the go-ahead and what it prepared was discarded
   * (nothing to continue in the Advanced tab).
   */
  discarded?: boolean;
  /**
   * Transfer operation id(s). Cross-org runs one transfer; Organization mode
   * runs one per media/content group.
   */
  transferIds: string[];
  chunkSets: ChunkSetMetadata[];
  /** ChunkSetId → .raif file name */
  raifFiles: Record<string, string>;
  /** .raif source name → consumption progress */
  consumption: Record<string, ConsumptionProgress>;
  /** Present when the destination is backed up before installing. */
  backup?: PreTransferBackupState;
}

const IDLE_STATE: AutoMigrationState = {
  stage: "idle",
  confirmed: true,
  transferIds: [],
  chunkSets: [],
  raifFiles: {},
  consumption: {},
};

class CancelledError extends Error {
  constructor() {
    super("Migration cancelled.");
    this.name = "CancelledError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Orchestrates a full migration through the environment client (the same
 * operations the advanced cards use): create → wait for the snapshot → copy
 * every chunk of every set → complete the sets → consume each .raif into the
 * destination database → cleanup (delete the transfer; Cross-Organization
 * mode also discards the blobs, which the SDK cannot do).
 *
 * The transfer is recorded in the recent-transfers list at the start so a
 * failed run can be attached in the Advanced tab; on full success
 * the entry is removed again.
 */
export function useAutoMigration(
  source: EnvironmentConnection,
  destination: EnvironmentConnection,
) {
  const { progressByChunkSet, copyChunkSet, cancelChunkSet, resetProgress } =
    useChunkCopy(source, destination);

  const [state, setState] = useState<AutoMigrationState>(IDLE_STATE);

  const cancelledRef = useRef(false);
  const copyingChunkSetRef = useRef<string | null>(null);
  // Pre-staging gate: confirmedRef may flip before the pipeline reaches the
  // gate; releaseGateRef wakes a pipeline already waiting there.
  const confirmedRef = useRef(true);
  const releaseGateRef = useRef<(() => void) | null>(null);
  // Destination backup requested with the go-ahead (see confirm()).
  const backupRef = useRef<PreTransferBackup | null>(null);

  // Stop the pipeline if the hook's owner unmounts mid-run.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (copyingChunkSetRef.current) {
        cancelChunkSet(copyingChunkSetRef.current);
      }
    };
  }, [cancelChunkSet]);

  const patch = useCallback((update: Partial<AutoMigrationState>) => {
    setState((prev) => ({ ...prev, ...update }));
  }, []);

  const ensureNotCancelled = useCallback(() => {
    if (cancelledRef.current) throw new CancelledError();
  }, []);

  const running =
    state.stage !== "idle" &&
    state.stage !== "done" &&
    state.stage !== "failed";

  const start = useCallback(
    async (input: AutoMigrationInput) => {
      if (running) return;

      cancelledRef.current = false;
      confirmedRef.current = !input.awaitConfirmation;
      releaseGateRef.current = null;
      backupRef.current = null;
      resetProgress();
      const organization = isOrganizationEnvironment(source);
      const mode = modeOf(source);
      const trees = input.dataTrees.map((tree) => ({
        ...tree,
        ItemPath: tree.ItemPath.trim(),
      }));

      // Organization mode cannot read IsMedia from the chunk response (SDK),
      // so media and content paths run as separate sub-transfers with a
      // known chunk type. Cross-org keeps a single transfer.
      const groups: { dataTrees: DataTree[]; isMedia?: boolean }[] =
        organization
          ? [
              {
                dataTrees: trees.filter((t) => isMediaPath(t.ItemPath)),
                isMedia: true,
              },
              {
                dataTrees: trees.filter((t) => !isMediaPath(t.ItemPath)),
                isMedia: false,
              },
            ].filter((group) => group.dataTrees.length > 0)
          : [{ dataTrees: trees }];
      const subTransfers = groups.map((group) => ({
        ...group,
        transferId: crypto.randomUUID(),
      }));
      const transferIds = subTransfers.map((sub) => sub.transferId);

      /** Cross-org: wait for the blob, consume it, monitor via the list. */
      const consumeOverRest = async (sourceNames: string[]) => {
        for (const name of sourceNames) {
          // Wait for the blob to be registered and uploaded.
          const deadline = Date.now() + BLOB_READY_TIMEOUT_MS;
          for (;;) {
            ensureNotCancelled();
            try {
              const blob = await getBlobSourceState(destination, name);
              if (blob?.BlobState === "Error") {
                throw new Error(
                  blob.Error || `Blob ${name} reported an error.`,
                );
              }
              if (blob?.BlobState === "Uploaded") break;
            } catch (error) {
              if (error instanceof CancelledError) throw error;
              // 404 right after completion is expected; other errors are
              // retried until the readiness deadline.
            }
            if (Date.now() > deadline) {
              throw new Error(`Blob ${name} did not become ready to consume.`);
            }
            await sleep(BLOB_READY_POLL_MS);
          }

          ensureNotCancelled();
          await startConsume(destination, DATABASE, name);
          setState((prev) => ({
            ...prev,
            consumption: { ...prev.consumption, [name]: { state: "Queued" } },
          }));
        }

        // Monitor via the transfers list — the detail endpoint can 404 for
        // blob-name ids (see CLAUDE.md), the list is authoritative.
        for (;;) {
          ensureNotCancelled();
          const page = await callTransferApi<ItemTransfersPage>(
            destination,
            "/api/item-transfer/transfers?page=1&pageSize=50",
          );
          const transfers = page?.Transfers ?? [];
          const consumption: Record<string, ConsumptionProgress> = {};
          const failedNames: string[] = [];
          let allFinished = true;

          for (const name of sourceNames) {
            const wanted = name.toLowerCase();
            const entry = transfers.find(
              (t) =>
                t.SourceName?.toLowerCase() === wanted ||
                t.Id?.toLowerCase() === wanted,
            );
            const transferState = entry?.TransferState ?? "Waiting";
            consumption[name] = {
              state: transferState,
              detail: entry?.Description,
            };
            if (transferState === "Failed") failedNames.push(name);
            else if (transferState !== "Finished") allFinished = false;
          }

          patch({ consumption });
          if (failedNames.length > 0) {
            throw new Error(
              `Consumption failed for ${failedNames.join(", ")}. You can retry it from the Advanced tab.`,
            );
          }
          if (allFinished) return;
          await sleep(CONSUME_POLL_MS);
        }
      };

      /**
       * Organization: consumeFile (retried while the .raif is still being
       * assembled), then poll getBlobState — the SDK has no Item Transfer
       * list to monitor.
       */
      const consumeOverSdk = async (sourceNames: string[]) => {
        for (const name of sourceNames) {
          await sleep(BLOB_READY_POLL_MS);
          for (let attempt = 1; ; attempt++) {
            ensureNotCancelled();
            try {
              await startConsume(destination, DATABASE, name);
              break;
            } catch (error) {
              if (
                !(error instanceof SourceNotReadyError) ||
                attempt >= MAX_CONSUME_ATTEMPTS
              ) {
                throw error;
              }
            }
            await sleep(BLOB_READY_POLL_MS);
          }
          setState((prev) => ({
            ...prev,
            consumption: { ...prev.consumption, [name]: { state: "Queued" } },
          }));
        }

        const finished = new Set<string>();
        for (;;) {
          ensureNotCancelled();
          const failures: string[] = [];
          for (const name of sourceNames) {
            if (finished.has(name)) continue;
            let progress: ReturnType<typeof blobStateToConsumption>;
            try {
              progress = blobStateToConsumption(
                await getBlobSourceState(destination, name),
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : "";
              // The consumed blob is renamed "consumed.*" — the original
              // name disappearing after consumeFile means the import ran.
              progress = message.includes("BlobNotFound")
                ? { state: "Finished" }
                : { state: "InProgress" };
            }
            if (progress.state === "Finished") finished.add(name);
            if (progress.state === "Failed") {
              failures.push(
                `${name}${progress.detail ? ` (${progress.detail})` : ""}`,
              );
            }
            const { state: progressState, detail } = progress;
            setState((prev) => ({
              ...prev,
              consumption: {
                ...prev.consumption,
                [name]: { state: progressState, detail },
              },
            }));
          }
          if (failures.length > 0) {
            throw new Error(`Consumption failed for ${failures.join(", ")}.`);
          }
          if (finished.size === sourceNames.length) return;
          await sleep(CONSUME_POLL_MS);
        }
      };

      /**
       * Pre-staging gate: waits for confirm() (returns) or decline()
       * (throws CancelledError).
       */
      const waitForConfirmation = async () => {
        if (!confirmedRef.current && !cancelledRef.current) {
          await new Promise<void>((resolve) => {
            releaseGateRef.current = resolve;
          });
          releaseGateRef.current = null;
        }
        ensureNotCancelled();
      };

      // The backup failed (or was cancelled) before anything was installed:
      // discard the prepared transfer like a declined run.
      let backupFailed = false;
      let backupStarted = false;

      /**
       * Backs up what the destination holds at the transferred paths, right
       * before anything is pushed into it. Paths that don't exist there yet
       * have nothing to back up and are skipped.
       */
      const backupDestination = async () => {
        const backup = backupRef.current;
        if (!backup) return;
        backupStarted = true;
        const setBackup = (update: Partial<PreTransferBackupState>) =>
          setState((prev) => ({
            ...prev,
            backup: {
              fileName: backup.fileName,
              skippedPaths: [],
              ...prev.backup,
              ...update,
            },
          }));
        patch({ stage: "backup" });
        let handedOff = false;
        try {
          const existing: DataTree[] = [];
          const skippedPaths: string[] = [];
          for (const tree of trees) {
            ensureNotCancelled();
            const result = await fetchItemChildren(
              destination,
              tree.ItemPath,
              DATABASE,
            );
            if (result.item) {
              // Restoring the backup overwrites the items with their
              // pre-transfer versions.
              existing.push({ ...tree, MergeStrategy: "OverrideExistingItem" });
            } else {
              skippedPaths.push(tree.ItemPath);
            }
          }
          setBackup({ skippedPaths });
          if (existing.length === 0) {
            await backup.archive.abort().catch(() => {});
            setBackup({ nothingToBackUp: true });
            return;
          }
          handedOff = true;
          const { delivery } = await runContentBackup(
            destination,
            {
              label: backup.label,
              dataTrees: existing,
              archive: backup.archive,
              fileName: backup.fileName,
              createdAt: backup.createdAt,
            },
            (progress) => setBackup({ progress }),
            () => cancelledRef.current,
          );
          setBackup({ delivery, progress: undefined });
        } catch (error) {
          backupFailed = true;
          if (!handedOff) await backup.archive.abort().catch(() => {});
          if (
            error instanceof CancelledError ||
            error instanceof BackupCancelledError ||
            cancelledRef.current
          ) {
            throw new CancelledError();
          }
          throw new Error(
            `The backup of ${destination.label} failed, so nothing was transferred: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      };

      setState({
        ...IDLE_STATE,
        stage: "create",
        confirmed: confirmedRef.current,
        transferIds,
      });

      // Created on the destination before the gate (Cross-Organization
      // completes the sets up front — the blobs can be discarded on decline).
      const preparedRaifs: string[] = [];

      try {
        // 1. Create the transfer operation(s) on the source.
        for (const sub of subTransfers) {
          ensureNotCancelled();
          const createInput: CreateTransferInput = {
            TransferId: sub.transferId,
            Configuration: {
              Database: DATABASE,
              DataTrees: sub.dataTrees,
            },
          };
          await createTransfer(source, createInput);
          upsertRecentTransfer({
            transferId: sub.transferId,
            createdAt: new Date().toISOString(),
            database: DATABASE,
            sourceConnectionId: source.id,
            destinationConnectionId: destination.id,
            sourceLabel: source.label,
            destinationLabel: destination.label,
            dataTrees: sub.dataTrees,
            mode,
            ...(organization ? { isMedia: sub.isMedia } : {}),
          });
        }
        ensureNotCancelled();

        // 2. Wait until the source finished building the chunk sets.
        patch({ stage: "snapshot" });
        const chunkSets: ChunkSetMetadata[] = [];
        /** ChunkSetId → the sub-transfer it belongs to. */
        const owner: Record<string, (typeof subTransfers)[number]> = {};
        for (const sub of subTransfers) {
          let status: ContentTransferStatus | null = null;
          for (;;) {
            status = await getTransferStatus(source, sub.transferId);
            patch({
              chunkSets: [...chunkSets, ...(status?.ChunkSetsMetadata ?? [])],
            });
            if (status && status.State !== "Running") break;
            await sleep(STATUS_POLL_MS);
            ensureNotCancelled();
          }
          if (status?.State !== "Completed") {
            throw new Error(
              `The source reported "${status?.State ?? "unknown"}" while building the snapshot.`,
            );
          }
          for (const chunkSet of status.ChunkSetsMetadata ?? []) {
            chunkSets.push(chunkSet);
            owner[chunkSet.ChunkSetId] = sub;
          }
        }
        if (chunkSets.length === 0) {
          throw new Error("The transfer produced no chunk sets.");
        }

        // 3. Copy every chunk of every set to the destination.
        patch({ stage: "copy", chunkSets });
        for (const chunkSet of chunkSets) {
          ensureNotCancelled();
          const sub = owner[chunkSet.ChunkSetId];
          copyingChunkSetRef.current = chunkSet.ChunkSetId;
          const ok = await copyChunkSet(
            sub.transferId,
            chunkSet.ChunkSetId,
            chunkSet.ChunkCount,
            sub.isMedia,
          );
          copyingChunkSetRef.current = null;
          ensureNotCancelled();
          if (!ok) {
            throw new Error(
              `Chunk set ${chunkSet.ChunkSetId} did not copy completely.`,
            );
          }
        }

        // Organization mode stops before completing: the SDK cannot discard
        // an assembled .raif, so a declined run must not leave one behind.
        if (organization) {
          await waitForConfirmation();
          // 3b. Optional destination backup — nothing is assembled or
          // installed in the destination yet.
          await backupDestination();
        }

        // 4. Complete each chunk set into a .raif file.
        patch({ stage: "complete" });
        const raifFiles: Record<string, string> = {};
        for (const chunkSet of chunkSets) {
          ensureNotCancelled();
          const sub = owner[chunkSet.ChunkSetId];
          const result = await completeChunkSet(
            destination,
            sub.transferId,
            chunkSet.ChunkSetId,
          );
          const fileName = result?.ContentTransferFileName;
          if (!fileName) {
            throw new Error(
              `Completing chunk set ${chunkSet.ChunkSetId} returned no file name.`,
            );
          }
          raifFiles[chunkSet.ChunkSetId] = fileName;
          preparedRaifs.push(fileName);
          recordRaifFile(sub.transferId, chunkSet.ChunkSetId, fileName);
          patch({ raifFiles: { ...raifFiles } });
        }

        // Cross-Organization stops after completing (the blobs are uploaded
        // and can still be discarded on decline).
        if (!organization) {
          await waitForConfirmation();
          // Not offered in Cross-Organization mode (backups need the SDK);
          // kept here so the backup always runs right before consumption.
          await backupDestination();
        }

        // 5. Consume each .raif into the destination database.
        const sourceNames = Object.values(raifFiles);
        patch({
          stage: "consume",
          consumption: Object.fromEntries(
            sourceNames.map((name) => [name, { state: "Waiting" as const }]),
          ),
        });
        if (organization) {
          await consumeOverSdk(sourceNames);
        } else {
          await consumeOverRest(sourceNames);
        }

        // 6. Cleanup: the transfer operation(s) on the source; in
        // Cross-Organization mode also the consumed blobs on the destination
        // (the SDK cannot discard blobs, so Organization mode keeps them).
        patch({ stage: "cleanup" });
        for (const transferId of transferIds) {
          await deleteTransfer(source, transferId);
        }
        if (!organization) {
          for (const name of sourceNames) {
            ensureNotCancelled();
            await callTransferApi<void>(
              destination,
              `/api/item-transfer/sources/blobs/${encodeURIComponent(name)}`,
              { method: "DELETE" },
            );
          }
        }
        for (const transferId of transferIds) {
          removeRecentTransfer(transferId);
        }

        patch({ stage: "done" });
      } catch (error) {
        copyingChunkSetRef.current = null;
        const cancelled =
          error instanceof CancelledError || cancelledRef.current;

        // A destination archive opened for a backup that never ran.
        if (backupRef.current && !backupStarted) {
          await backupRef.current.archive.abort().catch(() => {});
        }

        // Declined (or failed) before the go-ahead: the user never asked for
        // this transfer, so discard what was prepared and return to idle.
        // A failed/cancelled destination backup also discards it (nothing
        // was installed yet) but reports the failure.
        const declined = !confirmedRef.current;
        const discarded = declined || backupFailed;
        if (discarded) {
          if (cancelled && declined) {
            setState((prev) => ({ ...prev, stage: "cleanup" }));
          }
          for (const name of preparedRaifs) {
            await callTransferApi<void>(
              destination,
              `/api/item-transfer/sources/blobs/${encodeURIComponent(name)}`,
              { method: "DELETE" },
            ).catch(() => {});
          }
          for (const transferId of transferIds) {
            await deleteTransfer(source, transferId).catch(() => {});
            // Best effort: drops chunks already staged on the destination.
            await deleteTransfer(destination, transferId).catch(() => {});
            removeRecentTransfer(transferId);
          }
          if (cancelled && declined) {
            setState(IDLE_STATE);
            return;
          }
        }

        setState((prev) => ({
          ...prev,
          stage: "failed",
          failedAt: prev.stage,
          cancelled,
          error: cancelled
            ? "Migration cancelled."
            : error instanceof Error
              ? error.message
              : "The migration failed.",
          rawError: cancelled ? undefined : error,
          discarded,
        }));
      }
    },
    [
      running,
      source,
      destination,
      copyChunkSet,
      resetProgress,
      patch,
      ensureNotCancelled,
    ],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (copyingChunkSetRef.current) {
      cancelChunkSet(copyingChunkSetRef.current);
    }
    releaseGateRef.current?.();
  }, [cancelChunkSet]);

  /**
   * Go-ahead for a pre-staged run: install once the upload is done —
   * optionally backing up the destination first (`backup`).
   */
  const confirm = useCallback(
    (options?: { backup?: PreTransferBackup }) => {
      const backup = options?.backup ?? null;
      backupRef.current = backup;
      confirmedRef.current = true;
      patch({
        confirmed: true,
        backup: backup
          ? { fileName: backup.fileName, skippedPaths: [] }
          : undefined,
      });
      releaseGateRef.current?.();
    },
    [patch],
  );

  /** Decline a pre-staged run: stop it and discard what was prepared. */
  const decline = useCallback(() => {
    if (confirmedRef.current) return;
    cancel();
  }, [cancel]);

  const reset = useCallback(() => {
    if (running) return;
    resetProgress();
    setState(IDLE_STATE);
  }, [running, resetProgress]);

  return {
    state,
    running,
    progressByChunkSet,
    start,
    cancel,
    confirm,
    decline,
    reset,
  };
}
