"use client";

import type { ReactNode } from "react";
import { mdiCloudUploadOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { StateBadge } from "@/components/badges";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import type { DestinationPublish } from "@/src/utils/hooks/useDestinationPublish";

/**
 * Progress of a post-transfer publish of the destination (see
 * useDestinationPublish). Shared by Quick Transfer and Saved Transfers.
 */
export function PublishProgressCard({
  publish,
  destinationLabel,
  description,
  skippedText,
  defaultOpen = true,
}: {
  /** Whether the card starts expanded. */
  defaultOpen?: boolean;
  publish: DestinationPublish;
  destinationLabel: string;
  description?: ReactNode;
  /** Shown when the publish was skipped because an earlier step failed. */
  skippedText?: string;
}) {
  const { phase, rows, jobs, error, note } = publish;
  if (phase === "idle") return null;

  return (
    <CollapsibleCard
      icon={mdiCloudUploadOutline}
      title={`Publish — ${destinationLabel}`}
      description={description}
      done={phase === "done"}
      defaultOpen={defaultOpen}
      contentClassName="flex flex-col gap-3"
    >
      {phase === "skipped" && skippedText && (
        <p className="rounded-lg bg-[#ffe6bd] px-3 py-2 text-sm text-[#953d00]">
          {skippedText}
        </p>
      )}
      {phase === "running" && (
        <div className="flex items-center gap-2 text-sm text-text-subtle">
          <Icon path={mdiLoading} className="animate-spin" />
          Publishing to Experience Edge…
        </div>
      )}
      {note && (
        <p className="rounded-lg bg-[#ffe6bd] px-3 py-2 text-xs text-[#953d00]">
          {note}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {rows.map((row) => (
            <li key={row.path} className="flex flex-wrap items-center gap-2">
              <span
                className="max-w-80 truncate font-mono text-text-subtle"
                title={row.path}
              >
                {row.path}
              </span>
              {row.operationId ? (
                <StateBadge state="Queued" />
              ) : (
                <>
                  <StateBadge state="Failed" />
                  {row.error && (
                    <span className="text-danger-fg">{row.error}</span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {jobs.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-subtle">
            Publishing jobs on {destinationLabel}
          </span>
          <ul className="flex flex-col gap-1 text-xs">
            {jobs.map((job) => (
              <li key={job.handle} className="flex flex-wrap items-center gap-2">
                <span
                  className="max-w-80 truncate font-mono text-text-subtle"
                  title={job.name}
                >
                  {job.name}
                </span>
                <StateBadge state={job.jobState ?? "Unknown"} />
                {job.processed !== null && (
                  <span className="text-text-subtle">
                    {job.processed} item(s)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {phase === "failed" && (
        <div className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <p className="font-semibold">Publishing failed</p>
          <p className="mt-1">{error}</p>
          <p className="mt-1">
            The transfer itself completed — you can publish the destination
            manually.
          </p>
        </div>
      )}
      {phase === "done" && (
        <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success-fg">
          {jobs.length > 0
            ? `Publishing finished — ${jobs.filter((j) => j.jobState !== "Failed").length}/${jobs.length} job(s) completed on ${destinationLabel}.`
            : `The publish was queued on ${destinationLabel}.`}
        </p>
      )}
    </CollapsibleCard>
  );
}

/** Stepper status for a chained post-transfer phase ("skipped" = pending). */
export function phaseStepStatus(
  phase: "idle" | "running" | "done" | "failed" | "skipped",
): "active" | "completed" | "failed" | "pending" {
  return phase === "running"
    ? "active"
    : phase === "done"
      ? "completed"
      : phase === "failed"
        ? "failed"
        : "pending";
}
