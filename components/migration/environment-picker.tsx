"use client";

import { mdiArrowRightBold } from "@mdi/js";
import { Icon } from "@/lib/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EnvironmentConnection } from "@/src/types/transfer";

interface EnvironmentPickerProps {
  connections: EnvironmentConnection[];
  sourceId: string;
  destinationId: string;
  onSourceChange: (id: string) => void;
  onDestinationChange: (id: string) => void;
}

/**
 * Selects the source / destination environment pair that is the working
 * context of the whole migration workspace.
 */
export function EnvironmentPicker({
  connections,
  sourceId,
  destinationId,
  onSourceChange,
  onDestinationChange,
}: EnvironmentPickerProps) {
  const same = sourceId !== "" && sourceId === destinationId;

  return (
    <div className="rounded-xl border border-border-muted bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[#003767]">
            Source environment
          </label>
          <Select value={sourceId} onValueChange={onSourceChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select the environment to transfer from" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label} ({c.host})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden pb-2 text-text-subtle sm:block">
          <Icon path={mdiArrowRightBold} size={1} />
        </div>

        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-success-fg">
            Destination environment
          </label>
          <Select value={destinationId} onValueChange={onDestinationChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select the environment to transfer to" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label} ({c.host})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {same && (
        <p className="mt-2 text-sm text-danger-fg">
          The source and destination environments must be different.
        </p>
      )}
    </div>
  );
}
