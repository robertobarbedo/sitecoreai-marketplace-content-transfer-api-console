"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import {
  accessibleEnvironmentsHint,
  getReconciliationEnvironments,
  matchEnvironmentToConnection,
} from "@/src/utils/reconciliation";
import {
  fetchPublishJobs,
  getEnvironmentLanguages,
  startPublish,
  watchPublishJobs,
  type PublishJobInfo,
  type PublishRequestRow,
} from "@/src/utils/publish";
import type { EnvironmentConnection, PublishMode } from "@/src/types/transfer";

/** skipped = an earlier step failed, so nothing was published. */
export type PublishPhase = "idle" | "running" | "done" | "failed" | "skipped";

export interface PublishRunInput {
  /** Root paths; each gets one publish (subitems included). */
  paths: string[];
  mode: PublishMode;
  /** Name of the publishing job shown in Sitecore, per path. */
  displayName: (path: string) => string;
}

export type PublishOutcome =
  | { kind: "done"; failedCount: number; jobCount: number; identified: boolean }
  | { kind: "failed"; error: string }
  | { kind: "stopped" };

/**
 * Publishes the DESTINATION after a transfer (Saved Transfers' "publish at
 * the end" and Quick Transfer's publish option): resolves the destination to
 * its SitecoreAI environment, reads its languages (falls back to "en" with a
 * note), fires one publishItem per path (see publish.ts for the invariants)
 * and watches the publishing jobs. Toasts are left to the caller, based on
 * the returned outcome.
 */
export function useDestinationPublish(
  client: ClientSDK | null,
  destination: EnvironmentConnection,
) {
  const [phase, setPhase] = useState<PublishPhase>("idle");
  const [rows, setRows] = useState<PublishRequestRow[]>([]);
  const [jobs, setJobs] = useState<PublishJobInfo[]>([]);
  const [error, setError] = useState("");
  /** Non-fatal notes: languages fallback, unobservable jobs, timeout. */
  const [note, setNote] = useState("");

  // Publishing polls the destination's jobs; stop when the owner unmounts.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // Each run gets an id; reset() bumps it so an abandoned run (the user
  // started over while it was publishing) stops updating this state. The
  // publish already fired keeps running in Sitecore.
  const runIdRef = useRef(0);

  const run = useCallback(
    async (input: PublishRunInput): Promise<PublishOutcome> => {
      const runId = ++runIdRef.current;
      const live = () => activeRef.current && runIdRef.current === runId;
      const appendNote = (text: string) => {
        if (live()) setNote((prev) => [prev, text].filter(Boolean).join(" "));
      };
      setPhase("running");
      setError("");
      setNote("");
      setRows([]);
      setJobs([]);
      try {
        if (!client) {
          throw new Error(
            "The Marketplace SDK is not available — publishing needs it.",
          );
        }
        const envs = await getReconciliationEnvironments(client);
        const target = matchEnvironmentToConnection(envs, destination);
        if (!target) {
          throw new Error(
            `Could not match the destination environment (${destination.label}, ${destination.host}) to any SitecoreAI environment this app can access — publishing needs the matching environment's authoring GraphQL. ${accessibleEnvironmentsHint(envs)}`,
          );
        }

        let languages: string[];
        try {
          languages = await getEnvironmentLanguages(client, target.contextId);
          if (languages.length === 0) throw new Error("No languages returned");
        } catch {
          languages = ["en"];
          appendNote(
            'The destination\'s languages could not be read — publishing "en" only.',
          );
        }

        // Snapshot the jobs BEFORE firing, so ours are the ones that appear.
        const baseline = new Set(
          (await fetchPublishJobs(client, target.contextId).catch(() => [])).map(
            (job) => job.handle,
          ),
        );

        const fired: PublishRequestRow[] = [];
        for (const path of [...new Set(input.paths)]) {
          try {
            const operationId = await startPublish(client, target.contextId, {
              rootItemPath: path,
              mode: input.mode,
              languages,
              displayName: input.displayName(path),
            });
            fired.push({ path, operationId });
          } catch (err) {
            fired.push({
              path,
              operationId: null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          if (live()) setRows([...fired]);
        }

        const failedRows = fired.filter((r) => r.operationId === null);
        if (failedRows.length === fired.length) {
          throw new Error(
            failedRows[0]?.error ?? "No publish operation could be started.",
          );
        }

        const watch = await watchPublishJobs(
          client,
          target.contextId,
          baseline,
          fired.length - failedRows.length,
          (jobs) => {
            if (live()) setJobs(jobs);
          },
          live,
        );
        if (!live()) return { kind: "stopped" };

        if (!watch.identified) {
          appendNote(
            "The publish operation was queued, but its job did not show up in the destination's job list — check the publishing dashboard for progress.",
          );
        } else if (watch.timedOut) {
          appendNote(
            "Stopped watching after 10 minutes — the publishing job(s) are still running on the destination.",
          );
        }
        setPhase("done");
        const failedJobs = watch.jobs.filter((j) => j.jobState === "Failed");
        return {
          kind: "done",
          failedCount: failedRows.length + failedJobs.length,
          jobCount: watch.jobs.length,
          identified: watch.identified,
        };
      } catch (err) {
        if (!live()) return { kind: "stopped" };
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setPhase("failed");
        return { kind: "failed", error: message };
      }
    },
    [client, destination],
  );

  const skip = useCallback(() => {
    runIdRef.current++;
    setPhase("skipped");
  }, []);

  /** Clears the state and abandons a run in flight (stops watching it). */
  const reset = useCallback(() => {
    runIdRef.current++;
    setPhase("idle");
    setRows([]);
    setJobs([]);
    setError("");
    setNote("");
  }, []);

  return { phase, rows, jobs, error, note, run, skip, reset };
}

export type DestinationPublish = ReturnType<typeof useDestinationPublish>;
