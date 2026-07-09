"use client";

import { useCallback, useEffect, useState } from "react";
import { CreateTransferCard } from "./create-transfer-card";
import { ChunkSetsCard } from "./chunk-sets-card";
import { ConsumeCard } from "./consume-card";
import { CleanupCard } from "./cleanup-card";
import {
  loadRecentTransfers,
  upsertRecentTransfer,
  recordRaifFile,
  removeRecentTransfer,
  type RecentTransfer,
} from "@/src/utils/recent-transfers";
import type { EnvironmentConnection } from "@/src/types/transfer";

interface MigrationTabProps {
  source: EnvironmentConnection;
  destination: EnvironmentConnection;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

/**
 * The step-by-step migration workspace: create a transfer on the source,
 * copy and complete its chunk sets, consume the resulting .raif sources on
 * the destination, then clean up.
 */
export function MigrationTab({
  source,
  destination,
  onError,
  showToast,
}: MigrationTabProps) {
  const [recentTransfers, setRecentTransfers] = useState<RecentTransfer[]>([]);
  const [activeTransfer, setActiveTransfer] = useState<RecentTransfer | null>(
    null,
  );

  useEffect(() => {
    setRecentTransfers(loadRecentTransfers());
  }, []);

  const handleTransferReady = useCallback((transfer: RecentTransfer) => {
    setRecentTransfers(upsertRecentTransfer(transfer));
    setActiveTransfer(transfer);
  }, []);

  const handleRaifFile = useCallback(
    (chunksetId: string, fileName: string) => {
      if (!activeTransfer) return;
      const updated = recordRaifFile(
        activeTransfer.transferId,
        chunksetId,
        fileName,
      );
      setRecentTransfers(updated);
      setActiveTransfer((prev) =>
        prev
          ? { ...prev, raifFiles: { ...prev.raifFiles, [chunksetId]: fileName } }
          : prev,
      );
    },
    [activeTransfer],
  );

  const handleDeleted = useCallback(() => {
    if (!activeTransfer) return;
    setRecentTransfers(removeRecentTransfer(activeTransfer.transferId));
    setActiveTransfer(null);
  }, [activeTransfer]);

  return (
    <div className="flex flex-col gap-4">
      <CreateTransferCard
        source={source}
        destination={destination}
        activeTransfer={activeTransfer}
        recentTransfers={recentTransfers}
        onTransferReady={handleTransferReady}
        onError={onError}
        showToast={showToast}
      />

      {activeTransfer && (
        <ChunkSetsCard
          key={activeTransfer.transferId}
          source={source}
          destination={destination}
          transfer={activeTransfer}
          onRaifFile={handleRaifFile}
          onError={onError}
          showToast={showToast}
        />
      )}

      <ConsumeCard
        destination={destination}
        activeTransfer={activeTransfer}
        onError={onError}
        showToast={showToast}
      />

      {activeTransfer && (
        <CleanupCard
          source={source}
          transfer={activeTransfer}
          onDeleted={handleDeleted}
          onError={onError}
          showToast={showToast}
        />
      )}
    </div>
  );
}
