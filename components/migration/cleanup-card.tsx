"use client";

import { useState } from "react";
import { mdiBroom } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EnvBadge } from "@/components/badges";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { callTransferApi } from "@/src/utils/transfer-api";
import type { RecentTransfer } from "@/src/utils/recent-transfers";
import type { EnvironmentConnection } from "@/src/types/transfer";

interface CleanupCardProps {
  source: EnvironmentConnection;
  transfer: RecentTransfer;
  onDeleted: () => void;
  onError: (error: unknown, action: string) => void;
  showToast: (
    title: string,
    description?: string,
    variant?: "default" | "success" | "error" | "warning",
  ) => void;
}

export function CleanupCard({
  source,
  transfer,
  onDeleted,
  onError,
  showToast,
}: CleanupCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = async () => {
    try {
      await callTransferApi<void>(
        source,
        `/api/transfer/transfers/${encodeURIComponent(transfer.transferId)}`,
        { method: "DELETE" },
      );
      showToast(
        "Transfer deleted",
        `Operation ${transfer.transferId} and its resources were removed from ${source.label}.`,
        "success",
      );
      onDeleted();
    } catch (error) {
      onError(error, "delete the transfer operation");
      throw error;
    }
  };

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Step 4 — Clean up</CardTitle>
          <EnvBadge env="source" name={source.label} />
        </div>
        <CardDescription className="text-muted-foreground">
          Once every chunk set is completed (or if you abandon this migration),
          delete the transfer operation from {source.label} to free its
          resources. Discarding consumed .raif blobs is available per blob in
          step 3.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          colorScheme="danger"
          onClick={() => setConfirmOpen(true)}
        >
          <Icon path={mdiBroom} />
          Delete transfer operation
        </Button>
      </CardContent>

      <ConfirmDestructiveDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete this transfer operation?"
        description={
          <>
            The transfer{" "}
            <span className="font-mono text-xs">{transfer.transferId}</span>{" "}
            and all its chunk data are removed from the source environment.
            Chunks that were not copied to the destination are lost; already
            generated .raif files on the destination are not affected.
          </>
        }
        confirmWord="DELETE"
        confirmLabel="Delete transfer"
        onConfirm={handleDelete}
      />
    </Card>
  );
}
