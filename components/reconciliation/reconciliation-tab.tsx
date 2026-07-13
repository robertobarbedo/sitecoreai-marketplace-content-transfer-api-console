"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { mdiAlertCircleOutline, mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { ApplyView } from "@/components/reconciliation/apply-view";
import {
  detectReconciliationMarkers,
  environmentLabel,
  getReconciliationEnvironments,
  loadReconciliationData,
} from "@/src/utils/reconciliation";
import type {
  ReconciliationData,
  ReconciliationEnvironment,
} from "@/src/types/reconciliation";

type Phase = "checking" | "not-installed" | "ready" | "error";

interface ReconciliationTabProps {
  client: ClientSDK;
}

/**
 * Reconciliation tab: verifies that the Content Reconciliation marketplace
 * app is set up (Base/Secondary marker items exist) in every environment,
 * then offers that app's "Preview and apply changes" workflow against the
 * data it stored in the base environment.
 */
export function ReconciliationTab({ client }: ReconciliationTabProps) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [gateMessage, setGateMessage] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [environments, setEnvironments] = useState<ReconciliationEnvironment[]>([]);
  const [baseEnv, setBaseEnv] = useState<ReconciliationEnvironment | null>(null);
  const [data, setData] = useState<ReconciliationData | null>(null);

  const runCheck = useCallback(async () => {
    setPhase("checking");
    setFatalError("");
    try {
      const envs = await getReconciliationEnvironments(client);
      setEnvironments(envs);
      if (envs.length === 0) {
        setFatalError(
          "No environments with a preview context are accessible to this app.",
        );
        setPhase("error");
        return;
      }

      const markerStatuses = await detectReconciliationMarkers(client, envs);

      const unreachable = markerStatuses.filter((s) => s.error);
      const missing = markerStatuses.filter(
        (s) => !s.error && !s.hasBase && !s.hasSecondary,
      );
      const bases = markerStatuses.filter((s) => s.hasBase);

      if (missing.length > 0) {
        setGateMessage(
          "The Content Reconciliation configuration was not found in every environment. Install and set up the Content Reconciliation app in the same environments the Content Transfer tool is installed on, then check again.",
        );
        setPhase("not-installed");
        return;
      }
      if (unreachable.length > 0) {
        setGateMessage(
          `Some environments could not be checked for the Content Reconciliation configuration (${unreachable
            .map((s) => environmentLabel(s.env))
            .join(", ")}). Check again once they are reachable.`,
        );
        setPhase("not-installed");
        return;
      }
      if (bases.length === 0) {
        setGateMessage(
          "No base environment marker was found. Open the Content Reconciliation app and complete its setup, then check again.",
        );
        setPhase("not-installed");
        return;
      }
      if (bases.length > 1) {
        setGateMessage(
          "More than one environment holds the Base marker. Open the Content Reconciliation app to resolve the conflict, then check again.",
        );
        setPhase("not-installed");
        return;
      }

      const base = bases[0].env;
      const loadResult = await loadReconciliationData(client, base, envs);
      if (!loadResult.ok) {
        setFatalError(loadResult.error);
        setPhase("error");
        return;
      }
      setBaseEnv(base);
      setData(loadResult.data);
      setPhase("ready");
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : String(error));
      setPhase("error");
    }
  }, [client]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  if (phase === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border-muted bg-white py-16 text-text-subtle">
        <Icon path={mdiLoading} className="animate-spin" />
        Checking the Content Reconciliation setup in every environment&hellip;
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
        <div>
          <h3 className="mb-1 font-bold">Reconciliation check failed</h3>
          <p className="text-sm">{fatalError}</p>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={runCheck}>
            <Icon path={mdiRefresh} />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "not-installed") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border-muted bg-white py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-[#ffe6bd] text-[#953d00]">
          <Icon path={mdiAlertCircleOutline} size={1} />
        </div>
        <div className="max-w-[560px]">
          <p className="font-bold">Content Reconciliation is not ready</p>
          <p className="mt-1 text-sm text-text-subtle">{gateMessage}</p>
        </div>
        <Button variant="outline" size="sm" onClick={runCheck}>
          <Icon path={mdiRefresh} />
          Check again
        </Button>
      </div>
    );
  }

  // phase === "ready"
  if (!baseEnv || !data) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <ApplyView client={client} environments={environments} data={data} />
    </div>
  );
}
