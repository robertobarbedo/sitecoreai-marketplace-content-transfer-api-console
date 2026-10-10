"use client";

import { mdiArrowRightBold } from "@mdi/js";
import { Icon } from "@/lib/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { environmentDisplayName } from "@/src/utils/environment-client";
import type { EnvironmentConnection, TransferMode } from "@/src/types/transfer";

/** Value of the trailing action item — never a real environment id. */
const ACTION_VALUE = "__environment-action__";

interface EnvironmentSelectProps {
  environments: EnvironmentConnection[];
  value: string;
  onChange: (id: string) => void;
  /** Mode the environments belong to — picks the trailing action's wording. */
  mode: TransferMode;
  role: "source" | "destination";
  /** Called when the trailing action item is chosen (opens settings). */
  onAction: () => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Source/destination dropdown shared by every picker in the app. Its last
 * option is an ACTION, not a value: in Organization mode it leads to the
 * Cross-Organization switch ("Transfer from/to another organization…"), in
 * Cross-Organization mode to the connections editor. Choosing it keeps the
 * current selection.
 */
export function EnvironmentSelect({
  environments,
  value,
  onChange,
  mode,
  role,
  onAction,
  placeholder,
  disabled = false,
  className,
  ariaLabel,
}: EnvironmentSelectProps) {
  const actionLabel =
    mode === "organization"
      ? role === "source"
        ? "Transfer from another organization…"
        : "Transfer to another organization…"
      : "Manage environments…";

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === ACTION_VALUE) {
          onAction();
          return;
        }
        onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        className={
          className ?? "w-full disabled:cursor-not-allowed disabled:opacity-50"
        }
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {environments.map((environment) => (
          <SelectItem key={environment.id} value={environment.id}>
            {environmentDisplayName(environment)}
          </SelectItem>
        ))}
        {environments.length > 0 && <SelectSeparator />}
        <SelectItem value={ACTION_VALUE} className="text-primary-fg">
          {actionLabel}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

interface EnvironmentPickerProps {
  environments: EnvironmentConnection[];
  mode: TransferMode;
  sourceId: string;
  destinationId: string;
  onSourceChange: (id: string) => void;
  onDestinationChange: (id: string) => void;
  /** Opens the settings dialog (dropdown action item). */
  onAction: () => void;
  /** Locks both selects (e.g. while a transfer is running). */
  disabled?: boolean;
  /**
   * Skip the "must be different" warning — for views that use only one side
   * (Backup & Restore: backup reads the source, restore the destination).
   */
  allowSame?: boolean;
}

/**
 * Selects the source / destination environment pair that is the working
 * context of the whole migration workspace.
 */
export function EnvironmentPicker({
  environments,
  mode,
  sourceId,
  destinationId,
  onSourceChange,
  onDestinationChange,
  onAction,
  disabled = false,
  allowSame = false,
}: EnvironmentPickerProps) {
  const same = !allowSame && sourceId !== "" && sourceId === destinationId;

  return (
    <div className="rounded-xl border border-border-muted bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-[#003767]">
            Source environment
          </label>
          <EnvironmentSelect
            environments={environments}
            value={sourceId}
            onChange={onSourceChange}
            mode={mode}
            role="source"
            onAction={onAction}
            placeholder="Select the environment to transfer from"
            disabled={disabled}
          />
        </div>

        <div className="hidden pb-2 text-text-subtle sm:block">
          <Icon path={mdiArrowRightBold} size={1} />
        </div>

        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-wider text-success-fg">
            Destination environment
          </label>
          <EnvironmentSelect
            environments={environments}
            value={destinationId}
            onChange={onDestinationChange}
            mode={mode}
            role="destination"
            onAction={onAction}
            placeholder="Select the environment to transfer to"
            disabled={disabled}
          />
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
