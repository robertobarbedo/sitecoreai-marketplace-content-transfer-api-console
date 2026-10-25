import { cn } from "@/lib/utils";

/**
 * The Content Transfer workflow calls different endpoints against different
 * environments; every action in the UI is badged with the environment it
 * runs on to keep that visible.
 */
export function EnvBadge({
  env,
  name,
  className,
}: {
  env: "source" | "destination";
  /** Label of the selected environment, shown in parentheses. */
  name?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
        env === "source"
          ? "bg-[#c6f1ff] text-[#003767]"
          : "bg-success-bg text-success-fg",
        className,
      )}
    >
      {env === "source" ? "runs on source" : "runs on destination"}
      {name ? ` (${name})` : ""}
    </span>
  );
}

type BadgeTone = "primary" | "success" | "danger" | "warning" | "neutral";

const STATE_TONES: Record<string, BadgeTone> = {
  // Content Transfer states
  Running: "primary",
  Completed: "success",
  Failed: "danger",
  NotFound: "neutral",
  // Item Transfer states
  InProgress: "primary",
  Finished: "success",
  Queued: "primary",
  Discarded: "neutral",
  Unknown: "neutral",
  // Blob states
  Uploading: "primary",
  Uploaded: "success",
  Initializing: "primary",
  Error: "danger",
  Consumed: "success",
  Transferred: "success",
  TransferredWithErrors: "warning",
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  primary: "bg-primary-bg text-primary-fg",
  success: "bg-success-bg text-success-fg",
  danger: "bg-danger-bg text-danger-fg",
  warning: "bg-[#ffe6bd] text-[#953d00]",
  neutral: "bg-neutral-bg text-neutral-fg",
};

/** Colored pill for Content Transfer / Item Transfer / blob states. */
export function StateBadge({
  state,
  className,
}: {
  state: string | undefined | null;
  className?: string;
}) {
  if (!state) return <span className="text-text-subtle">—</span>;
  const tone = STATE_TONES[state] ?? "neutral";
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {state}
    </span>
  );
}
