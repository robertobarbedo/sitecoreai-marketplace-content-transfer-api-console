"use client";

import { useCallback, useRef, useState } from "react";
import type { EnvironmentConnection } from "@/src/types/transfer";
import { copyChunk } from "@/src/utils/transfer-api";

export type ChunkStatus = "pending" | "copying" | "done" | "failed";

export interface ChunkSetProgress {
  running: boolean;
  /** Per-chunk status, index = chunkId. */
  chunks: ChunkStatus[];
  itemsProcessed: number;
  itemsSkipped: number;
  bytes: number;
  /** Message of the last failure, if any chunk failed. */
  error?: string;
}

/** How many chunks are copied in parallel per chunk set. */
const CONCURRENCY = 3;

export function summarizeProgress(progress: ChunkSetProgress | undefined) {
  const chunks = progress?.chunks ?? [];
  const done = chunks.filter((c) => c === "done").length;
  const failed = chunks.filter((c) => c === "failed").length;
  return { done, failed, total: chunks.length };
}

/**
 * Client-side orchestration of the chunk copy phase: for a chunk set, walk
 * chunkIds 0 … ChunkCount − 1 and call the app's server-side copy route with
 * bounded parallelism. Progress is tracked per chunk so a failed run can be
 * resumed without re-copying finished chunks.
 */
export function useChunkCopy(
  source: EnvironmentConnection | null,
  destination: EnvironmentConnection | null,
) {
  const [progressByChunkSet, setProgressByChunkSet] = useState<
    Record<string, ChunkSetProgress>
  >({});

  // Mirror of the state for synchronous reads inside the copy loop, and a
  // per-chunk-set cancellation flag.
  const progressRef = useRef<Record<string, ChunkSetProgress>>({});
  const cancelledRef = useRef<Record<string, boolean>>({});

  const update = useCallback(
    (
      chunksetId: string,
      mutate: (previous: ChunkSetProgress) => ChunkSetProgress,
    ) => {
      const previous = progressRef.current[chunksetId] ?? {
        running: false,
        chunks: [],
        itemsProcessed: 0,
        itemsSkipped: 0,
        bytes: 0,
      };
      progressRef.current = {
        ...progressRef.current,
        [chunksetId]: mutate(previous),
      };
      setProgressByChunkSet(progressRef.current);
    },
    [],
  );

  const setChunkStatus = useCallback(
    (chunksetId: string, chunkId: number, status: ChunkStatus) => {
      update(chunksetId, (prev) => {
        const chunks = [...prev.chunks];
        chunks[chunkId] = status;
        return { ...prev, chunks };
      });
    },
    [update],
  );

  /**
   * Copies every chunk of the set that is not already done. Returns true if
   * all chunks ended up copied.
   */
  const copyChunkSet = useCallback(
    async (
      transferId: string,
      chunksetId: string,
      chunkCount: number,
    ): Promise<boolean> => {
      if (!source || !destination) return false;

      cancelledRef.current[chunksetId] = false;

      // Initialize / reset progress, keeping previously copied chunks.
      update(chunksetId, (prev) => {
        const chunks: ChunkStatus[] =
          prev.chunks.length === chunkCount
            ? prev.chunks.map((c) => (c === "done" ? "done" : "pending"))
            : Array.from({ length: chunkCount }, () => "pending");
        return { ...prev, running: true, chunks, error: undefined };
      });

      const pendingChunkIds = (
        progressRef.current[chunksetId]?.chunks ?? []
      ).flatMap((status, chunkId) => (status === "done" ? [] : [chunkId]));

      let nextIndex = 0;
      let lastError: string | undefined;

      const worker = async () => {
        for (;;) {
          if (cancelledRef.current[chunksetId]) return;
          const index = nextIndex++;
          if (index >= pendingChunkIds.length) return;
          const chunkId = pendingChunkIds[index];

          setChunkStatus(chunksetId, chunkId, "copying");
          try {
            const result = await copyChunk(
              source,
              destination,
              transferId,
              chunksetId,
              chunkId,
            );
            update(chunksetId, (prev) => {
              const chunks = [...prev.chunks];
              chunks[chunkId] = "done";
              return {
                ...prev,
                chunks,
                itemsProcessed: prev.itemsProcessed + result.itemsProcessed,
                itemsSkipped: prev.itemsSkipped + result.itemsSkipped,
                bytes: prev.bytes + result.bytes,
              };
            });
          } catch (error) {
            lastError =
              error instanceof Error ? error.message : "Chunk copy failed";
            setChunkStatus(chunksetId, chunkId, "failed");
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(CONCURRENCY, Math.max(pendingChunkIds.length, 1)) },
          worker,
        ),
      );

      update(chunksetId, (prev) => ({
        ...prev,
        running: false,
        // Anything still marked "copying" was interrupted by a cancel.
        chunks: prev.chunks.map((c) => (c === "copying" ? "pending" : c)),
        error: lastError,
      }));

      const finalChunks = progressRef.current[chunksetId]?.chunks ?? [];
      return (
        finalChunks.length === chunkCount &&
        finalChunks.every((c) => c === "done")
      );
    },
    [source, destination, update, setChunkStatus],
  );

  /** Copies a single chunk (advanced / manual repair). */
  const copySingleChunk = useCallback(
    async (
      transferId: string,
      chunksetId: string,
      chunkId: number,
      chunkCount: number,
    ): Promise<void> => {
      if (!source || !destination) return;

      update(chunksetId, (prev) => {
        const chunks: ChunkStatus[] =
          prev.chunks.length === chunkCount
            ? [...prev.chunks]
            : Array.from({ length: chunkCount }, () => "pending");
        chunks[chunkId] = "copying";
        return { ...prev, chunks };
      });

      try {
        const result = await copyChunk(
          source,
          destination,
          transferId,
          chunksetId,
          chunkId,
        );
        update(chunksetId, (prev) => {
          const chunks = [...prev.chunks];
          chunks[chunkId] = "done";
          return {
            ...prev,
            chunks,
            itemsProcessed: prev.itemsProcessed + result.itemsProcessed,
            itemsSkipped: prev.itemsSkipped + result.itemsSkipped,
            bytes: prev.bytes + result.bytes,
          };
        });
      } catch (error) {
        setChunkStatus(chunksetId, chunkId, "failed");
        throw error;
      }
    },
    [source, destination, update, setChunkStatus],
  );

  const cancelChunkSet = useCallback((chunksetId: string) => {
    cancelledRef.current[chunksetId] = true;
  }, []);

  const resetProgress = useCallback(() => {
    progressRef.current = {};
    cancelledRef.current = {};
    setProgressByChunkSet({});
  }, []);

  return {
    progressByChunkSet,
    copyChunkSet,
    copySingleChunk,
    cancelChunkSet,
    resetProgress,
  };
}
