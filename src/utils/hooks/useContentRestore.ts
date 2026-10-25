"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  blobStateToConsumption,
  completeChunkSet,
  deleteTransfer,
  getBlobSourceState,
  SourceNotReadyError,
  startConsume,
  uploadChunk,
} from "@/src/utils/environment-client";
import {
  manifestTotals,
  sha256Hex,
  type ArchiveReader,
} from "@/src/utils/backup-archive";
import type { EnvironmentConnection } from "@/src/types/transfer";

const DATABASE = "master";
const POLL_MS = 5000;
const CONSUME_RETRY_MS = 3000;
const MAX_CONSUME_ATTEMPTS = 10;

export type RestoreStage =
  | "idle"
  | "upload"
  | "assemble"
  | "import"
  | "done"
  | "failed";

export const RESTORE_STAGES: Exclude<RestoreStage, "idle" | "done" | "failed">[] = [
  "upload",
  "assemble",
  "import",
];

export interface RestoreConsumption {
  state: "Waiting" | "InProgress" | "Finished" | "Failed";
  detail?: string;
}

export interface RestoreState {
  stage: RestoreStage;
  failedAt?: RestoreStage;
  error?: string;
  cancelled?: boolean;
  detail?: string;
  /** False once a chunk set was assembled — from then on there is no undo. */
  cancellable: boolean;
  chunksDone: number;
  chunksTotal: number;
  /** .raif name → import progress. */
  consumption: Record<string, RestoreConsumption>;
}

const IDLE: RestoreState = {
  stage: "idle",
  cancellable: true,
  chunksDone: 0,
  chunksTotal: 0,
  consumption: {},
};

class CancelledError extends Error {
  constructor() {
    super("Restore cancelled.");
    this.name = "CancelledError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replays a backup archive into an installed environment:
 * 1. upload every chunk with its recorded transferId / chunkSetId (verified
 *    against the manifest's size and SHA-256) — cancellable;
 * 2. complete each chunk set into a .raif and consume it — NOT cancellable:
 *    an assembled .raif that is never consumed can't be removed through the
 *    SDK;
 * 3. watch the imports (getBlobState) until they finish.
 */
export function useContentRestore(destination: EnvironmentConnection | null) {
  const [state, setState] = useState<RestoreState>(IDLE);
  const cancelledRef = useRef(false);
  const criticalRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const patch = useCallback((update: Partial<RestoreState>) => {
    setState((prev) => ({ ...prev, ...update }));
  }, []);

  const running =
    state.stage !== "idle" && state.stage !== "done" && state.stage !== "failed";

  const start = useCallback(
    async (archive: ArchiveReader) => {
      if (!destination || runningRef.current) return;
      runningRef.current = true;
      cancelledRef.current = false;
      criticalRef.current = false;
      const ensureNotCancelled = () => {
        if (cancelledRef.current && !criticalRef.current) throw new CancelledError();
      };

      const { manifest } = archive;
      const chunksTotal = manifestTotals(manifest).chunks;
      setState({ ...IDLE, stage: "upload", chunksTotal });

      try {
        // 1. Upload every chunk.
        let chunksDone = 0;
        for (const sub of manifest.subTransfers) {
          for (const set of sub.chunkSets) {
            for (const chunk of set.chunks) {
              ensureNotCancelled();
              patch({
                detail: `Uploading chunk ${chunksDone + 1} of ${chunksTotal}${sub.isMedia ? " (media)" : ""}`,
              });
              const blob = await archive.getChunk(chunk.entry);
              if (blob.size !== chunk.size) {
                throw new Error(
                  `Chunk ${chunk.chunkId} of set ${set.chunkSetId} is ${blob.size} bytes but the manifest records ${chunk.size} — the archive is corrupt.`,
                );
              }
              if (chunk.sha256 && (await sha256Hex(blob)) !== chunk.sha256) {
                throw new Error(
                  `Chunk ${chunk.chunkId} of set ${set.chunkSetId} fails its SHA-256 check — the archive is corrupt.`,
                );
              }
              await uploadChunk(
                destination,
                sub.transferId,
                set.chunkSetId,
                chunk.chunkId,
                blob,
                sub.isMedia,
              );
              chunksDone++;
              patch({ chunksDone });
            }
          }
        }

        // 2. Assemble + consume — the point of no return.
        ensureNotCancelled();
        criticalRef.current = true;
        patch({ stage: "assemble", cancellable: false, detail: undefined });
        const names: string[] = [];
        for (const sub of manifest.subTransfers) {
          for (const set of sub.chunkSets) {
            patch({ detail: `Assembling package ${names.length + 1}…` });
            const result = await completeChunkSet(
              destination,
              sub.transferId,
              set.chunkSetId,
            );
            const name = result?.ContentTransferFileName;
            if (!name) {
              throw new Error(
                `Completing chunk set ${set.chunkSetId} returned no file name.`,
              );
            }
            // The .raif is assembled asynchronously — retry while it isn't
            // there yet.
            await sleep(CONSUME_RETRY_MS);
            for (let attempt = 1; ; attempt++) {
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
              await sleep(CONSUME_RETRY_MS);
            }
            names.push(name);
            setState((prev) => ({
              ...prev,
              consumption: { ...prev.consumption, [name]: { state: "Waiting" } },
            }));
          }
        }

        // 3. Watch the imports.
        patch({ stage: "import", detail: "Importing into the master database…" });
        const finished = new Set<string>();
        for (;;) {
          const failures: string[] = [];
          for (const name of names) {
            if (finished.has(name)) continue;
            let progress: ReturnType<typeof blobStateToConsumption>;
            try {
              progress = blobStateToConsumption(
                await getBlobSourceState(destination, name),
              );
            } catch (error) {
              const message = error instanceof Error ? error.message : "";
              progress = message.includes("BlobNotFound")
                ? { state: "Finished" }
                : { state: "InProgress" };
            }
            if (progress.state === "Finished") finished.add(name);
            if (progress.state === "Failed") {
              failures.push(`${name}${progress.detail ? ` (${progress.detail})` : ""}`);
            }
            const { state: consumptionState, detail } = progress;
            setState((prev) => ({
              ...prev,
              consumption: {
                ...prev.consumption,
                [name]: { state: consumptionState, detail },
              },
            }));
          }
          if (failures.length > 0) {
            throw new Error(`Import failed for ${failures.join(", ")}.`);
          }
          if (finished.size === names.length) break;
          await sleep(POLL_MS);
        }

        // Parity cleanup — the destination may hold transfer records for the
        // replayed ids; a 4xx here is expected and ignored.
        for (const sub of manifest.subTransfers) {
          await deleteTransfer(destination, sub.transferId).catch(() => {});
        }
        patch({ stage: "done", detail: undefined });
      } catch (error) {
        const cancelled = error instanceof CancelledError;
        setState((prev) => ({
          ...prev,
          stage: "failed",
          failedAt: prev.stage,
          cancelled,
          detail: undefined,
          error: cancelled
            ? "Restore cancelled before anything was imported."
            : error instanceof Error
              ? error.message
              : "The restore failed.",
        }));
      } finally {
        criticalRef.current = false;
        runningRef.current = false;
      }
    },
    [destination, patch],
  );

  /** Ignored once assembling started (there is no undo from there). */
  const cancel = useCallback(() => {
    if (criticalRef.current) return;
    cancelledRef.current = true;
  }, []);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setState(IDLE);
  }, []);

  return { state, running, start, cancel, reset };
}
