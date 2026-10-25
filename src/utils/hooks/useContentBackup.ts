"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createTransfer,
  deleteTransfer,
  downloadChunk,
  getCurrentUser,
  getTransferStatus,
  isMediaPath,
} from "@/src/utils/environment-client";
import {
  archiveFileName,
  BACKUP_FORMAT_VERSION,
  chunkEntryName,
  createArchiveWriter,
  MANIFEST_ENTRY,
  sha256Hex,
  toBackupDataTree,
  type ArchiveDelivery,
  type ArchiveWriter,
  type BackupChunkSet,
  type BackupManifest,
} from "@/src/utils/backup-archive";
import { recordRecentBackup } from "@/src/utils/recent-backups";
import type {
  ContentTransferStatus,
  DataTree,
  EnvironmentConnection,
} from "@/src/types/transfer";

const DATABASE = "master";
const STATUS_POLL_MS = 5000;

export type BackupStage =
  | "idle"
  | "create"
  | "snapshot"
  | "download"
  | "archive"
  | "cleanup"
  | "done"
  | "failed";

/** Stages in execution order (for the stepper). */
export const BACKUP_STAGES: Exclude<BackupStage, "idle" | "done" | "failed">[] = [
  "create",
  "snapshot",
  "download",
  "archive",
  "cleanup",
];

export interface BackupState {
  stage: BackupStage;
  failedAt?: BackupStage;
  error?: string;
  cancelled?: boolean;
  detail?: string;
  chunksDone: number;
  chunksTotal: number;
  bytes: number;
  fileName?: string;
  delivery?: ArchiveDelivery;
  manifest?: BackupManifest;
}

const IDLE: BackupState = { stage: "idle", chunksDone: 0, chunksTotal: 0, bytes: 0 };

export interface BackupInput {
  label: string;
  dataTrees: DataTree[];
}

class CancelledError extends Error {
  constructor() {
    super("Backup cancelled.");
    this.name = "CancelledError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backs up content of an installed environment into a ZIP: create transfer(s)
 * on the source (media / content split, like Quick Transfer) → wait for the
 * snapshot → download every chunk into the archive → write manifest.json →
 * delete the transfer(s) on the source. Organization mode only.
 */
export function useContentBackup(source: EnvironmentConnection | null) {
  const [state, setState] = useState<BackupState>(IDLE);
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const patch = useCallback((update: Partial<BackupState>) => {
    setState((prev) => ({ ...prev, ...update }));
  }, []);

  const running =
    state.stage !== "idle" && state.stage !== "done" && state.stage !== "failed";

  const start = useCallback(
    async (input: BackupInput) => {
      if (!source || runningRef.current) return;
      runningRef.current = true;
      cancelledRef.current = false;
      const ensureNotCancelled = () => {
        if (cancelledRef.current) throw new CancelledError();
      };

      const createdAt = new Date();
      const fileName = archiveFileName(input.label, createdAt);

      // The archive is opened FIRST, while still inside the click's user
      // gesture, so the browser allows the save dialog.
      let archive: ArchiveWriter | null;
      try {
        archive = await createArchiveWriter(fileName);
      } catch (error) {
        runningRef.current = false;
        if (error instanceof DOMException && error.name === "AbortError") {
          return; // The user dismissed the save dialog.
        }
        setState({
          ...IDLE,
          stage: "failed",
          failedAt: "create",
          error: error instanceof Error ? error.message : "Could not create the archive.",
        });
        return;
      }

      const trees = input.dataTrees.map((tree) => ({
        ...tree,
        ItemPath: tree.ItemPath.trim(),
      }));
      const subs = [
        { isMedia: true, dataTrees: trees.filter((t) => isMediaPath(t.ItemPath)) },
        { isMedia: false, dataTrees: trees.filter((t) => !isMediaPath(t.ItemPath)) },
      ]
        .filter((sub) => sub.dataTrees.length > 0)
        .map((sub) => ({ ...sub, transferId: crypto.randomUUID() }));
      const created: string[] = [];

      setState({ ...IDLE, stage: "create", fileName });

      try {
        const author = await getCurrentUser();
        const manifest: BackupManifest = {
          formatVersion: BACKUP_FORMAT_VERSION,
          createdAt: createdAt.toISOString(),
          createdBy: author,
          label: input.label.trim(),
          sourceTenantId: source.id,
          sourceTenantName: source.label,
          subTransfers: [],
          app: { name: "Content Transfer Console", version: "1" },
          database: DATABASE,
        };

        // 1. Create the transfer(s) on the source.
        for (const sub of subs) {
          ensureNotCancelled();
          await createTransfer(source, {
            TransferId: sub.transferId,
            Configuration: { Database: DATABASE, DataTrees: sub.dataTrees },
          });
          created.push(sub.transferId);
        }

        // 2. Wait for the snapshots.
        patch({ stage: "snapshot", detail: "Waiting for the source to package the content…" });
        const statuses: ContentTransferStatus[] = [];
        for (const sub of subs) {
          for (;;) {
            ensureNotCancelled();
            const status = await getTransferStatus(source, sub.transferId);
            if (status && status.State !== "Running") {
              if (status.State !== "Completed") {
                throw new Error(
                  `The source reported "${status.State}" while packaging the content.`,
                );
              }
              if (!status.ChunkSetsMetadata?.length) {
                throw new Error("The source produced no chunk sets.");
              }
              statuses.push(status);
              break;
            }
            await sleep(STATUS_POLL_MS);
          }
        }

        // 3. Download every chunk into the archive, verbatim.
        const chunksTotal = statuses.reduce(
          (sum, status) =>
            sum + status.ChunkSetsMetadata.reduce((s, set) => s + set.ChunkCount, 0),
          0,
        );
        patch({ stage: "download", chunksTotal, detail: undefined });
        let chunksDone = 0;
        let bytes = 0;
        for (const [index, sub] of subs.entries()) {
          const chunkSets: BackupChunkSet[] = [];
          for (const set of statuses[index].ChunkSetsMetadata) {
            const chunks: BackupChunkSet["chunks"] = [];
            for (let chunkId = 0; chunkId < set.ChunkCount; chunkId++) {
              ensureNotCancelled();
              patch({
                detail: `Downloading chunk ${chunksDone + 1} of ${chunksTotal}${sub.isMedia ? " (media)" : ""}`,
              });
              const blob = await downloadChunk(
                source,
                sub.transferId,
                set.ChunkSetId,
                chunkId,
              );
              const entry = chunkEntryName(sub.isMedia, set.ChunkSetId, chunkId);
              const sha256 = await sha256Hex(blob);
              await archive.addChunk(entry, blob);
              chunks.push({ chunkId, entry, size: blob.size, sha256 });
              chunksDone++;
              bytes += blob.size;
              patch({ chunksDone, bytes });
            }
            chunkSets.push({
              chunkSetId: set.ChunkSetId,
              chunkCount: set.ChunkCount,
              totalItemCount: set.TotalItemCount,
              chunks,
            });
          }
          manifest.subTransfers.push({
            isMedia: sub.isMedia,
            transferId: sub.transferId,
            dataTrees: sub.dataTrees.map(toBackupDataTree),
            chunkSets,
          });
        }

        // 4. Seal the archive (manifest last, so a truncated file is
        // recognisably incomplete).
        ensureNotCancelled();
        patch({ stage: "archive", detail: "Finalising the archive…" });
        await archive.addJson(MANIFEST_ENTRY, manifest);
        const delivery = await archive.close();
        archive = null;

        // 5. Free the staged chunk data on the source.
        patch({ stage: "cleanup", detail: undefined });
        for (const transferId of created) {
          await deleteTransfer(source, transferId).catch(() => {});
        }

        recordRecentBackup({
          fileName,
          label: manifest.label,
          createdAt: manifest.createdAt,
          sourceLabel: source.label,
          paths: trees.map((t) => t.ItemPath),
          sizeBytes: delivery.sizeBytes ?? bytes,
          items: statuses.reduce(
            (sum, status) =>
              sum + status.ChunkSetsMetadata.reduce((s, set) => s + set.TotalItemCount, 0),
            0,
          ),
        });
        patch({ stage: "done", delivery, manifest });
      } catch (error) {
        const cancelled = error instanceof CancelledError || cancelledRef.current;
        await archive?.abort().catch(() => {});
        // Best-effort: never leave staged chunk data behind on the source.
        for (const transferId of created) {
          await deleteTransfer(source, transferId).catch(() => {});
        }
        setState((prev) => ({
          ...prev,
          stage: "failed",
          failedAt: prev.stage,
          cancelled,
          detail: undefined,
          error: cancelled
            ? "Backup cancelled."
            : error instanceof Error
              ? error.message
              : "The backup failed.",
        }));
      } finally {
        runningRef.current = false;
      }
    },
    [source, patch],
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setState(IDLE);
  }, []);

  return { state, running, start, cancel, reset };
}
