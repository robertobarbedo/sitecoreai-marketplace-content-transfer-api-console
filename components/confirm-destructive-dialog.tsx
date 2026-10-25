"use client";

import { useEffect, useState } from "react";
import { mdiLoading } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** When set, the user must type this word to enable the confirm button. */
  confirmWord?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmWord,
  confirmLabel,
  onConfirm,
}: ConfirmDestructiveDialogProps) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setPending(false);
    }
  }, [open]);

  const canConfirm = (!confirmWord || typed === confirmWord) && !pending;

  const handleConfirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller reports the error via toast; keep the dialog open.
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-danger">
        <DialogHeader>
          <DialogTitle className="text-danger-fg">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {confirmWord && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-word" className="text-sm">
              Type <span className="font-mono font-semibold">{confirmWord}</span>{" "}
              to confirm:
            </label>
            <Input
              id="confirm-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button colorScheme="danger" onClick={handleConfirm} disabled={!canConfirm}>
            {pending && (
              <Icon path={mdiLoading} size={0.8} className="animate-spin" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
