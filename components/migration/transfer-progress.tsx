"use client";

import { useEffect, useRef, useState } from "react";
import { mdiAlertCircle, mdiCheckCircle, mdiOpenInNew } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import {
  Stepper,
  type StepperStatus,
  type StepperStep,
} from "@/components/ui/stepper";
import { EnvBadge, StateBadge } from "@/components/badges";
import {
  useAutoMigration,
  AUTO_MIGRATION_STAGES,
  pipelineStages,
} from "@/src/utils/hooks/useAutoMigration";
import { summarizeProgress } from "@/src/utils/hooks/useChunkCopy";
import { formatBytes } from "@/src/utils/backup-archive";

/**
 * The automatic pipeline rendered as a horizontal Blok stepper plus a
 * separate card detailing the stage that is currently running (or failed).
 * Shared by the Quick Transfer tab and the Saved Transfers execution view;
 * the latter appends extra steps for its chained reconcile/publish phases.
 */

const STAGE_META: Record<
  (typeof AUTO_MIGRATION_STAGES)[number],
  {
    /** Short title shown in the horizontal stepper. */
    title: string;
    /** Short environment hint shown under the title. */
    hint: string;
    /** Full label shown in the detail card. */
    detail: string;
    env: "source" | "destination" | "both";
  }
> = {
  create: {
    title: "Create",
    hint: "Source",
    detail: "Create the transfer operation",
    env: "source",
  },
  snapshot: {
    title: "Snapshot",
    hint: "Source",
    detail: "Snapshot content into chunk sets",
    env: "source",
  },
  copy: {
    title: "Copy chunks",
    hint: "Both",
    detail: "Copy chunks to the destination",
    env: "both",
  },
  backup: {
    title: "Backup",
    hint: "Destination",
    detail: "Back up the destination's current content",
    env: "destination",
  },
  complete: {
    title: "Generate",
    hint: "Destination",
    detail: "Generate .raif files",
    env: "destination",
  },
  consume: {
    title: "Consume",
    hint: "Destination",
    detail: "Consume into the destination database",
    env: "destination",
  },
  cleanup: {
    title: "Clean up",
    hint: "Both",
    detail: "Clean up transfer resources",
    env: "both",
  },
};

type PipelineState = ReturnType<typeof useAutoMigration>["state"];

/** Index of the running/failed stage in `pipelineStages`; length = done. */
function currentStageIndex(state: PipelineState): number {
  const stages = pipelineStages(state);
  return state.stage === "done"
    ? stages.length
    : stages.indexOf(
        (state.stage === "failed"
          ? (state.failedAt ?? "create")
          : state.stage) as never,
      );
}

/** How long each already-finished stage "runs" in the staged reveal. */
const REVEAL_STEP_MS = 600;

/**
 * Staged reveal for stages that finished in the background before the
 * progress became visible (Quick Transfer pre-stages behind its confirm
 * dialog). When `shown` turns true while stages are already done, returns a
 * cap that walks 0 → real index, one stage per `REVEAL_STEP_MS`, so each one
 * briefly shows as running; returns `undefined` once caught up (or when
 * nothing was pre-completed), after which the real progress shows as-is.
 */
export function useStagedReveal(
  state: PipelineState,
  shown: boolean,
): number | undefined {
  const [reveal, setReveal] = useState<number | null>(null);
  const wasShownRef = useRef(false);
  const realIndex = currentStageIndex(state);
  const failed = state.stage === "failed";

  useEffect(() => {
    const wasShown = wasShownRef.current;
    wasShownRef.current = shown;
    if (!shown) {
      setReveal(null);
      return;
    }
    // Only on the transition to visible, and only when stages already ran.
    if (!wasShown && !failed && realIndex > 0) setReveal(0);
  }, [shown, failed, realIndex]);

  useEffect(() => {
    if (reveal === null) return;
    if (failed || reveal >= realIndex) {
      setReveal(null);
      return;
    }
    const timer = setTimeout(
      () => setReveal((index) => (index === null ? null : index + 1)),
      REVEAL_STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [reveal, realIndex, failed]);

  return reveal ?? undefined;
}

/**
 * The index to display and whether it is capped by a staged reveal (a capped
 * index always shows as running, never as failed).
 */
function displayedStageIndex(
  state: PipelineState,
  revealIndex: number | undefined,
): { index: number; capped: boolean } {
  const real = currentStageIndex(state);
  if (revealIndex !== undefined && revealIndex < real) {
    return { index: revealIndex, capped: true };
  }
  return { index: real, capped: false };
}

/** The horizontal pipeline stepper — render it inside your own card. */
export function TransferStepper({
  state,
  extraSteps = [],
  revealIndex,
}: {
  state: PipelineState;
  /** Post-transfer steps (reconcile, publish) appended after cleanup. */
  extraSteps?: StepperStep[];
  /** Cap from `useStagedReveal`. */
  revealIndex?: number;
}) {
  const { index: currentIndex, capped } = displayedStageIndex(
    state,
    revealIndex,
  );

  const steps: StepperStep[] = pipelineStages(state).map((stage, index) => {
    const status: StepperStatus =
      index < currentIndex
        ? "completed"
        : index > currentIndex
          ? "pending"
          : state.stage === "failed" && !capped
            ? "failed"
            : "active";
    return {
      label: STAGE_META[stage].title,
      description: STAGE_META[stage].hint,
      status,
    };
  });

  return <Stepper steps={[...steps, ...extraSteps]} />;
}

/**
 * "Transfer details" card: one entry per stage that has started, appended as
 * the pipeline progresses. Entries accumulate and stay visible (including
 * after completion); the card only hides while the pipeline is idle.
 */
export function TransferStageDetailsCard({
  state,
  progressByChunkSet,
  collapsible = false,
  defaultOpen = true,
  revealIndex,
}: {
  state: PipelineState;
  progressByChunkSet: ReturnType<typeof useAutoMigration>["progressByChunkSet"];
  /** Collapsible header; auto-collapses when the pipeline completes. */
  collapsible?: boolean;
  /** With `collapsible`, whether the card starts expanded. */
  defaultOpen?: boolean;
  /** Cap from `useStagedReveal`. */
  revealIndex?: number;
}) {
  const { index: currentIndex, capped } = displayedStageIndex(
    state,
    revealIndex,
  );
  if (currentIndex < 0) return null;

  const stages = pipelineStages(state);
  const startedStages = stages.slice(
    0,
    Math.min(currentIndex + 1, stages.length),
  );
  const backup = state.backup;

  const body = (
    <ol className="flex flex-col gap-3">
          {startedStages.map((stage, index) => {
            const status: "completed" | "active" | "failed" =
              index < currentIndex
                ? "completed"
                : state.stage === "failed" && !capped
                  ? "failed"
                  : "active";
            const meta = STAGE_META[stage];
            return (
              <li key={stage} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {status === "completed" && (
                    <span className="text-success">
                      <Icon path={mdiCheckCircle} size={0.7} />
                    </span>
                  )}
                  {status === "failed" && (
                    <span className="text-danger">
                      <Icon path={mdiAlertCircle} size={0.7} />
                    </span>
                  )}
                  <span
                    className={
                      status === "active"
                        ? "text-sm font-semibold"
                        : status === "failed"
                          ? "text-sm font-semibold text-danger-fg"
                          : "text-sm"
                    }
                  >
                    {meta.detail}
                  </span>
                  {meta.env !== "both" ? (
                    <EnvBadge env={meta.env} />
                  ) : (
                    <>
                      <EnvBadge env="source" />
                      <EnvBadge env="destination" />
                    </>
                  )}
                </div>

                {/* Live details for the data-heavy stages */}
                {stage === "copy" && state.chunkSets.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-xs text-text-subtle">
                    {state.chunkSets.map((chunkSet) => {
                      const { done, failed: failedChunks } = summarizeProgress(
                        progressByChunkSet[chunkSet.ChunkSetId],
                      );
                      return (
                        <li key={chunkSet.ChunkSetId} className="font-mono">
                          {chunkSet.ChunkSetId.slice(0, 8)}… — {done}/
                          {chunkSet.ChunkCount} chunks
                          {failedChunks > 0 && (
                            <span className="text-danger-fg">
                              {" "}
                              · {failedChunks} failed
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {stage === "backup" && backup && (
                  <div className="flex flex-col gap-0.5 text-xs text-text-subtle">
                    <span className="font-mono">{backup.fileName}</span>
                    {backup.progress?.detail && (
                      <span>{backup.progress.detail}</span>
                    )}
                    {backup.progress?.stage === "download" &&
                      backup.progress.chunksTotal !== undefined && (
                        <span>
                          {backup.progress.chunksDone ?? 0}/
                          {backup.progress.chunksTotal} chunks ·{" "}
                          {formatBytes(backup.progress.bytes ?? 0)}
                        </span>
                      )}
                    {backup.skippedPaths.length > 0 && (
                      <span>
                        Not in the destination yet (nothing to back up):{" "}
                        <span className="font-mono">
                          {backup.skippedPaths.join(", ")}
                        </span>
                      </span>
                    )}
                    {backup.nothingToBackUp && (
                      <span>
                        None of the paths exist in the destination yet — no
                        backup file was needed.
                      </span>
                    )}
                    {backup.delivery && (
                      <span className="text-success-fg">
                        Backup saved
                        {backup.delivery.sizeBytes !== null &&
                          ` (${formatBytes(backup.delivery.sizeBytes)})`}
                        {backup.delivery.redeliver && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className="underline"
                              onClick={backup.delivery.redeliver}
                            >
                              download again
                            </button>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                )}
                {stage === "consume" &&
                  Object.keys(state.consumption).length > 0 && (
                    <ul className="flex flex-col gap-1 text-xs">
                      {Object.entries(state.consumption).map(
                        ([name, progress]) => (
                          <li
                            key={name}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span
                              className="max-w-80 truncate font-mono text-text-subtle"
                              title={name}
                            >
                              {name}
                            </span>
                            <StateBadge
                              state={
                                progress.state === "Waiting"
                                  ? "Queued"
                                  : progress.state
                              }
                            />
                            {progress.detail && (
                              <span className="text-text-subtle">
                                {progress.detail}
                              </span>
                            )}
                          </li>
                        ),
                      )}
                    </ul>
                  )}
              </li>
            );
          })}
    </ol>
  );

  if (collapsible) {
    return (
      <CollapsibleCard
        icon={mdiOpenInNew}
        title="Transfer details"
        done={state.stage === "done"}
        defaultOpen={defaultOpen}
      >
        {body}
      </CollapsibleCard>
    );
  }

  return (
    <Card style="outline" padding="md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon path={mdiOpenInNew} size={0.8} />
          Transfer details
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
