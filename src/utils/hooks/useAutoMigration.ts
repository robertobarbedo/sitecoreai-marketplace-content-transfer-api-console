"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { callTransferApi } from "@/src/utils/transfer-api";
import {
  blobStateToConsumption,
  completeChunkSet,
  createTransfer,
  deleteTransfer,
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
  | "complete"
  | "consume"
  | "cleanup"
  | "done"
  | "failed";

/** Pipeline stages in execution order (for checklist rendering). */
export const AUTO_MIGRATION_STAGES: Exclude<
  AutoMigrationStage,
  "idle" | "done" | "failed"
>[] = ["create", "snapshot", "copy", "complete", "consume", "cleanup"];

export interface AutoMigrationInput {
  /** One or more content trees to move in a single transfer operation. */
  dataTrees: DataTree[];
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
   * Transfer operation id(s). Cross-org runs one transfer; Organization mode
   * runs one per media/content group.
   */
  transferIds: string[];
  chunkSets: ChunkSetMetadata[];
  /** ChunkSetId → .raif file name */
  raifFiles: Record<string, string>;
  /** .raif source name → consumption progress */
  consumption: Record<string, ConsumptionProgress>;
}

const IDLE_STATE: AutoMigrationState = {
  stage: "idle",
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
    state.stage !== "idle" && state.stage !== "done" && state.stage !== "failed";

  const start = useCallback(
    async (input: AutoMigrationInput) => {
      if (running) return;

      cancelledRef.current = false;
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
              { dataTrees: trees.filter((t) => isMediaPath(t.ItemPath)), isMedia: true },
              { dataTrees: trees.filter((t) => !isMediaPath(t.ItemPath)), isMedia: false },
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
                throw new Error(blob.Error || `Blob ${name} reported an error.`);
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
              failures.push(`${name}${progress.detail ? ` (${progress.detail})` : ""}`);
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

      setState({
        ...IDLE_STATE,
        stage: "create",
        transferIds,
      });

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
          recordRaifFile(sub.transferId, chunkSet.ChunkSetId, fileName);
          patch({ raifFiles: { ...raifFiles } });
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
  }, [cancelChunkSet]);

  const reset = useCallback(() => {
    if (running) return;
    resetProgress();
    setState(IDLE_STATE);
  }, [running, resetProgress]);

  return { state, running, progressByChunkSet, start, cancel, reset };
}
