"use client";

import { useCallback, useEffect, useState } from "react";
import {
  mdiRefresh,
  mdiLoading,
  mdiContentCopy,
  mdiCheckDecagram,
  mdiStop,
  mdiTune,
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
import { EnvBadge, StateBadge } from "@/components/badges";
import { callTransferApi } from "@/src/utils/transfer-api";
import { useChunkCopy, summarizeProgress } from "@/src/utils/hooks/useChunkCopy";
import type { RecentTransfer } from "@/src/utils/recent-transfers";
import type {
  ChunkSetMetadata,
  CompleteChunkSetResult,
  ContentTransferStatus,
  EnvironmentConnection,
} from "@/src/types/transfer";

const POLL_INTERVAL_MS = 5000;

interface ChunkSetsCardProps {
  source: EnvironmentConnection;
  destination: EnvironmentConnection;
  transfer: RecentTransfer;
  onRaifFile: (chunksetId: string, fileName: string) => void;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

export function ChunkSetsCard({
  source,
  destination,
  transfer,
  onRaifFile,
  onError,
  showToast,
}: ChunkSetsCardProps) {
  const [status, setStatus] = useState<ContentTransferStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});
  const [raifFiles, setRaifFiles] = useState<Record<string, string>>(
    transfer.raifFiles ?? {},
  );
  const [advancedFor, setAdvancedFor] = useState<string | null>(null);
  const [singleChunkId, setSingleChunkId] = useState("0");

  const {
    progressByChunkSet,
    copyChunkSet,
    copySingleChunk,
    cancelChunkSet,
  } = useChunkCopy(source, destination);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const result = await callTransferApi<ContentTransferStatus>(
          source,
          `/api/transfer/transfers/${encodeURIComponent(transfer.transferId)}/status`,
        );
        setStatus(result);
      } catch (error) {
        if (!silent) onError(error, "retrieve the transfer status");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [source, transfer.transferId, onError],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-poll while the source is still building chunk sets.
  useEffect(() => {
    if (status?.State !== "Running") return;
    const timer = setInterval(() => refresh(true), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status?.State, refresh]);

  const handleCopy = async (chunkSet: ChunkSetMetadata) => {
    const ok = await copyChunkSet(
      transfer.transferId,
      chunkSet.ChunkSetId,
      chunkSet.ChunkCount,
    );
    if (ok) {
      showToast(
        "Chunk set copied",
        `All ${chunkSet.ChunkCount} chunks of ${shortId(chunkSet.ChunkSetId)} were saved to ${destination.label}.`,
        "success",
      );
    } else {
      showToast(
        "Chunk copy incomplete",
        "Some chunks failed or were cancelled. Use Resume to retry the remaining chunks.",
        "warning",
      );
    }
  };

  const handleComplete = async (chunkSet: ChunkSetMetadata) => {
    setCompleting((prev) => ({ ...prev, [chunkSet.ChunkSetId]: true }));
    try {
      const result = await callTransferApi<CompleteChunkSetResult>(
        destination,
        `/api/transfer/transfers/${encodeURIComponent(transfer.transferId)}/chunksets/${encodeURIComponent(chunkSet.ChunkSetId)}/complete`,
        { method: "POST" },
      );
      const fileName = result?.ContentTransferFileName ?? "";
      setRaifFiles((prev) => ({ ...prev, [chunkSet.ChunkSetId]: fileName }));
      onRaifFile(chunkSet.ChunkSetId, fileName);
      showToast(
        "Chunk set completed",
        fileName
          ? `Generated ${fileName} on ${destination.label}.`
          : `Chunk set ${shortId(chunkSet.ChunkSetId)} completed.`,
        "success",
      );
    } catch (error) {
      onError(error, "complete the chunk set");
    } finally {
      setCompleting((prev) => ({ ...prev, [chunkSet.ChunkSetId]: false }));
    }
  };

  const handleSingleChunk = async (chunkSet: ChunkSetMetadata) => {
    const chunkId = Number(singleChunkId);
    if (
      !Number.isInteger(chunkId) ||
      chunkId < 0 ||
      chunkId >= chunkSet.ChunkCount
    ) {
      showToast(
        "Invalid chunk ID",
        `Enter a value between 0 and ${chunkSet.ChunkCount - 1}.`,
        "warning",
      );
      return;
    }
    try {
      await copySingleChunk(
        transfer.transferId,
        chunkSet.ChunkSetId,
        chunkId,
        chunkSet.ChunkCount,
      );
      showToast("Chunk copied", `Chunk ${chunkId} saved to ${destination.label}.`, "success");
    } catch (error) {
      onError(error, `copy chunk ${chunkId}`);
    }
  };

  const chunkSets = status?.ChunkSetsMetadata ?? [];

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Step 2 — Copy chunk sets to the destination</CardTitle>
          <EnvBadge env="source" name={source.label} />
          <span className="text-xs text-text-subtle">then</span>
          <EnvBadge env="destination" name={destination.label} />
        </div>
        <CardDescription className="text-muted-foreground">
          Transfer{" "}
          <span className="font-mono text-xs">{transfer.transferId}</span> —
          copy every chunk of each set from {source.label} to{" "}
          {destination.label} (bytes are forwarded untouched), then complete
          each set to generate its .raif file.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={loading}
          >
            <Icon path={mdiRefresh} className={loading ? "animate-spin" : ""} />
            Refresh status
          </Button>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-subtle">Operation state:</span>
            {loading && !status ? (
              <Icon path={mdiLoading} size={0.7} className="animate-spin text-text-subtle" />
            ) : (
              <StateBadge state={status?.State} />
            )}
            {status?.State === "Running" && (
              <span className="text-xs text-text-subtle">
                (building chunk sets — refreshing automatically)
              </span>
            )}
          </div>
        </div>

        {status?.State === "NotFound" && (
          <p className="rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
            The source environment has no transfer with this ID. It may have
            been deleted, or it was created against a different environment.
          </p>
        )}

        {chunkSets.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border-muted bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border-muted bg-surface-grey">
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Chunk set
                    </th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Chunks
                    </th>
                    <th className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Items
                    </th>
                    <th className="w-64 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Copy progress
                    </th>
                    <th className="px-4 py-3 text-right font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {chunkSets.map((chunkSet) => {
                    const progress = progressByChunkSet[chunkSet.ChunkSetId];
                    const { done, failed } = summarizeProgress(progress);
                    const total = chunkSet.ChunkCount;
                    const running = progress?.running ?? false;
                    const allCopied = done === total && total > 0;
                    const raifFile = raifFiles[chunkSet.ChunkSetId];
                    const isCompleting = completing[chunkSet.ChunkSetId] ?? false;
                    const advanced = advancedFor === chunkSet.ChunkSetId;

                    return (
                      <ChunkSetRow
                        key={chunkSet.ChunkSetId}
                        chunkSet={chunkSet}
                        done={done}
                        failed={failed}
                        running={running}
                        allCopied={allCopied}
                        raifFile={raifFile}
                        isCompleting={isCompleting}
                        advanced={advanced}
                        error={progress?.error}
                        itemsProcessed={progress?.itemsProcessed ?? 0}
                        itemsSkipped={progress?.itemsSkipped ?? 0}
                        singleChunkId={singleChunkId}
                        onSingleChunkIdChange={setSingleChunkId}
                        onToggleAdvanced={() =>
                          setAdvancedFor(advanced ? null : chunkSet.ChunkSetId)
                        }
                        onCopy={() => handleCopy(chunkSet)}
                        onCancel={() => cancelChunkSet(chunkSet.ChunkSetId)}
                        onComplete={() => handleComplete(chunkSet)}
                        onCopySingle={() => handleSingleChunk(chunkSet)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {status && status.State !== "NotFound" && chunkSets.length === 0 && (
          <p className="py-4 text-center text-sm text-text-subtle">
            No chunk sets reported yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

interface ChunkSetRowProps {
  chunkSet: ChunkSetMetadata;
  done: number;
  failed: number;
  running: boolean;
  allCopied: boolean;
  raifFile?: string;
  isCompleting: boolean;
  advanced: boolean;
  error?: string;
  itemsProcessed: number;
  itemsSkipped: number;
  singleChunkId: string;
  onSingleChunkIdChange: (value: string) => void;
  onToggleAdvanced: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onComplete: () => void;
  onCopySingle: () => void;
}

function ChunkSetRow({
  chunkSet,
  done,
  failed,
  running,
  allCopied,
  raifFile,
  isCompleting,
  advanced,
  error,
  itemsProcessed,
  itemsSkipped,
  singleChunkId,
  onSingleChunkIdChange,
  onToggleAdvanced,
  onCopy,
  onCancel,
  onComplete,
  onCopySingle,
}: ChunkSetRowProps) {
  const total = chunkSet.ChunkCount;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const started = done + failed > 0 || running;

  return (
    <>
      <tr className="border-b border-border-muted last:border-b-0 hover:bg-surface-container-low/60">
        <td className="px-4 py-3 font-mono text-xs" title={chunkSet.ChunkSetId}>
          {shortId(chunkSet.ChunkSetId)}
          {raifFile && (
            <p
              className="mt-1 max-w-56 truncate font-mono text-[10px] text-success-fg"
              title={raifFile}
            >
              ✓ {raifFile}
            </p>
          )}
        </td>
        <td className="px-4 py-3">{total}</td>
        <td className="px-4 py-3">{chunkSet.TotalItemCount}</td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-neutral-bg">
              <div
                className={`h-full rounded-full transition-all ${failed > 0 ? "bg-danger" : "bg-success"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="whitespace-nowrap text-xs text-text-subtle">
              {done}/{total}
              {failed > 0 && (
                <span className="text-danger-fg"> · {failed} failed</span>
              )}
            </span>
          </div>
          {started && (
            <p className="mt-1 text-[10px] text-text-subtle">
              {itemsProcessed} items processed
              {itemsSkipped > 0 && `, ${itemsSkipped} skipped`}
            </p>
          )}
          {error && !running && (
            <p className="mt-1 max-w-56 truncate text-[10px] text-danger-fg" title={error}>
              {error}
            </p>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap justify-end gap-1.5">
            {running ? (
              <Button variant="outline" size="xs" onClick={onCancel}>
                <Icon path={mdiStop} />
                Cancel
              </Button>
            ) : (
              <Button
                variant="outline"
                size="xs"
                onClick={onCopy}
                disabled={allCopied}
              >
                <Icon path={mdiContentCopy} />
                {failed > 0 || (started && !allCopied)
                  ? "Resume copy"
                  : "Copy chunks"}
              </Button>
            )}
            <Button
              size="xs"
              colorScheme="success"
              onClick={onComplete}
              disabled={!allCopied || isCompleting || !!raifFile}
              title={
                allCopied
                  ? undefined
                  : "Copy all chunks before completing the set"
              }
            >
              <Icon
                path={isCompleting ? mdiLoading : mdiCheckDecagram}
                className={isCompleting ? "animate-spin" : ""}
              />
              {raifFile ? "Completed" : "Complete set"}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleAdvanced}
              aria-label="Advanced chunk actions"
              title="Advanced: copy a single chunk"
            >
              <Icon path={mdiTune} />
            </Button>
          </div>
        </td>
      </tr>
      {advanced && (
        <tr className="border-b border-border-muted bg-surface-container-low/40 last:border-b-0">
          <td colSpan={5} className="px-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-text-subtle">
                Recovery: copy a single chunk (0 – {total - 1})
              </span>
              <Input
                value={singleChunkId}
                onChange={(e) => onSingleChunkIdChange(e.target.value)}
                className="h-7 w-20 px-2 py-1 text-xs"
                aria-label="Chunk ID"
              />
              <Button variant="outline" size="xs" onClick={onCopySingle} disabled={running}>
                Copy chunk
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
