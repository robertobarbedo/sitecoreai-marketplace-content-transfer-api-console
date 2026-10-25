"use client";

import { useState } from "react";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { mdiLoading } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { environmentLabel } from "@/src/utils/reconciliation";
import {
  planApplyRows,
  fetchCurrentValues,
  executeApplyRows,
  type ApplyRow,
} from "@/src/utils/reconciliation-apply";
import { ApplyRowsTable } from "@/components/reconciliation/apply-rows-table";
import type {
  ReconciliationData,
  ReconciliationEnvironment,
} from "@/src/types/reconciliation";

type Phase = "pick" | "fetching" | "preview" | "executing" | "done";

interface ApplyViewProps {
  client: ClientSDK;
  environments: ReconciliationEnvironment[];
  /** The last-saved dataset loaded from the base environment's Data item. */
  data: ReconciliationData;
}

/**
 * Port of the Content Reconciliation app's "Preview and apply changes" view:
 * pick a target environment, preview what would change (current vs desired),
 * then run the updateItem mutations with per-field results.
 */
export function ApplyView({ client, environments, data }: ApplyViewProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [target, setTarget] = useState<ReconciliationEnvironment | null>(null);
  const [rows, setRows] = useState<ApplyRow[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState("");

  const buildAndFetch = async (env: ReconciliationEnvironment) => {
    setTarget(env);
    setPhase("fetching");

    const planned = planApplyRows(data, env);
    if (planned.length > 0) {
      await fetchCurrentValues(client, env, planned, setProgress);
    }
    setRows(planned);
    setProgress("");
    setPhase("preview");
  };

  const execute = async (targetRows: ApplyRow[]) => {
    if (!target) return;
    setPhase("executing");
    await executeApplyRows(client, target, targetRows, setProgress, () =>
      setRows((prev) => [...prev]),
    );
    setProgress("");
    setRows((prev) => [...prev]);
    setPhase("done");
  };

  const reset = () => {
    setPhase("pick");
    setTarget(null);
    setRows([]);
  };

  const willUpdate = rows.filter((r) => r.status === "will-update");
  const failed = rows.filter((r) => r.status === "failed");
  const updated = rows.filter((r) => r.status === "updated");
  const skipped = rows.filter(
    (r) =>
      r.status === "unchanged" ||
      r.status === "item-missing" ||
      r.status === "no-version",
  );

  return (
    <div className="flex flex-col gap-4">
      {phase === "pick" && (
        <div className="rounded-xl border border-border-muted bg-white p-6">
          <h3 className="mb-1 font-bold text-on-surface">Apply reconciliation</h3>
          <p className="mb-4 text-sm text-text-subtle">
            Select the environment to reconcile. The tool fetches the current
            values of every tracked field from that environment, shows you a
            preview of what would change, and only writes after you confirm.
          </p>
          <div className="flex max-w-[480px] flex-col gap-2">
            {environments.map((env) => (
              <button
                key={env.tenantId}
                type="button"
                onClick={() => buildAndFetch(env)}
                className="flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border border-border-muted bg-white px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary-bg/30"
              >
                <span className="font-semibold text-on-surface">
                  {environmentLabel(env)}
                </span>
                <span className="font-mono text-xs text-text-subtle">
                  {env.tenantName}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "fetching" && (
        <div className="rounded-xl border border-border-muted bg-white p-6">
          <div className="flex items-center gap-2 text-sm text-text-subtle">
            <Icon path={mdiLoading} className="animate-spin" />
            Fetching current values from{" "}
            {target ? environmentLabel(target) : ""}&hellip;
          </div>
          <div className="mt-2 text-xs text-text-subtle">{progress}</div>
        </div>
      )}

      {(phase === "preview" || phase === "executing" || phase === "done") &&
        target && (
          <div className="rounded-xl border border-border-muted bg-white p-6">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h3 className="font-bold text-on-surface">
                {phase === "done" ? "Results" : "Preview"} —{" "}
                {environmentLabel(target)}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                disabled={phase === "executing"}
              >
                ← choose another environment
              </Button>
            </div>

            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {phase === "done" ? (
                <>
                  <span className="text-success">{updated.length} updated</span>
                  <span className="text-danger">{failed.length} failed</span>
                  <span className="text-text-subtle">
                    {skipped.length} skipped
                  </span>
                </>
              ) : (
                <>
                  <span className="text-primary">
                    {willUpdate.length} to update
                  </span>
                  <span className="text-text-subtle">
                    {skipped.length} skipped
                  </span>
                  {failed.length > 0 && (
                    <span className="text-danger">
                      {failed.length} fetch failures
                    </span>
                  )}
                </>
              )}
            </div>

            {phase === "executing" && (
              <div className="mb-3 flex items-center gap-2 text-sm text-text-subtle">
                <Icon path={mdiLoading} className="animate-spin" />
                {progress || "Applying…"}
              </div>
            )}

            {rows.length === 0 ? (
              <div className="rounded-lg border border-primary bg-primary-bg/40 p-4 text-sm">
                No desired values are stored for this environment yet. Capture
                values in the Content Reconciliation app (and save) first.
              </div>
            ) : (
              <ApplyRowsTable rows={rows} />
            )}

            <div className="mt-4 flex gap-2">
              {phase === "preview" && (
                <Button
                  disabled={willUpdate.length === 0}
                  onClick={() => setConfirming(true)}
                >
                  Apply {willUpdate.length} change(s)
                </Button>
              )}
              {phase === "done" && failed.length > 0 && (
                <Button onClick={() => execute(failed)}>
                  Retry failed ({failed.length})
                </Button>
              )}
            </div>
          </div>
        )}

      {target && (
        <ConfirmDestructiveDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Apply reconciliation"
          description={`This writes ${willUpdate.length} field value(s) to real content items in ${environmentLabel(target)}. Continue?`}
          confirmLabel={`Apply to ${environmentLabel(target)}`}
          onConfirm={async () => {
            // Kick off without awaiting: the dialog closes immediately and
            // the executing phase renders its own progress.
            void execute(willUpdate);
          }}
        />
      )}
    </div>
  );
}
