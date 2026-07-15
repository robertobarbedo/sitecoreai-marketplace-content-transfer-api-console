"use client";

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
} from "@/src/utils/hooks/useAutoMigration";
import { summarizeProgress } from "@/src/utils/hooks/useChunkCopy";

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
    detail: "Clean up transfer and blobs",
    env: "both",
  },
};

type PipelineState = ReturnType<typeof useAutoMigration>["state"];

/** Index of the running/failed stage; AUTO_MIGRATION_STAGES.length = done. */
function currentStageIndex(state: PipelineState): number {
  return state.stage === "done"
    ? AUTO_MIGRATION_STAGES.length
    : AUTO_MIGRATION_STAGES.indexOf(
        (state.stage === "failed"
          ? (state.failedAt ?? "create")
          : state.stage) as never,
      );
}

/** The horizontal pipeline stepper — render it inside your own card. */
export function TransferStepper({
  state,
  extraSteps = [],
}: {
  state: PipelineState;
  /** Post-transfer steps (reconcile, publish) appended after cleanup. */
  extraSteps?: StepperStep[];
}) {
  const currentIndex = currentStageIndex(state);

  const steps: StepperStep[] = AUTO_MIGRATION_STAGES.map((stage, index) => {
    const status: StepperStatus =
      index < currentIndex
        ? "completed"
        : index > currentIndex
          ? "pending"
          : state.stage === "failed"
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
}: {
  state: PipelineState;
  progressByChunkSet: ReturnType<typeof useAutoMigration>["progressByChunkSet"];
  /** Collapsible header; auto-collapses when the pipeline completes. */
  collapsible?: boolean;
}) {
  const currentIndex = currentStageIndex(state);
  if (currentIndex < 0) return null;

  const startedStages = AUTO_MIGRATION_STAGES.slice(
    0,
    Math.min(currentIndex + 1, AUTO_MIGRATION_STAGES.length),
  );

  const body = (
    <ol className="flex flex-col gap-3">
          {startedStages.map((stage, index) => {
            const status: "completed" | "active" | "failed" =
              index < currentIndex
                ? "completed"
                : state.stage === "failed"
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
