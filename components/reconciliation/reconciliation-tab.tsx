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

/** The Content Reconciliation app's Marketplace icon (bandaids, duotone). */
function ContentReconciliationAppIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="#2695de"
      viewBox="0 0 256 256"
      aria-hidden="true"
    >
      <path
        d="M206.63,94.63,173.25,128,128,82.75l33.37-33.38a32,32,0,0,1,45.26,45.26ZM49.37,161.37a32,32,0,0,0,45.26,45.26L128,173.25,82.75,128ZM82.75,128,128,82.75,94.63,49.37A32,32,0,0,0,49.37,94.63Zm90.5,0L128,173.25l33.37,33.38a32,32,0,0,0,45.26-45.26Z"
        opacity="0.2"
      />
      <path d="M184.57,128l27.71-27.72a40,40,0,1,0-56.56-56.56L128,71.43,100.28,43.72a40,40,0,1,0-56.56,56.56L71.43,128,43.72,155.72a40,40,0,1,0,56.56,56.56L128,184.57l27.72,27.71a40,40,0,1,0,56.56-56.56ZM167,55A24,24,0,1,1,201,89l-27.72,27.72L139.31,82.75Zm-5.09,73L128,161.94,94.06,128,128,94.06ZM55,89h0A24,24,0,1,1,89,55l27.72,27.72L82.75,116.69ZM89,201A24,24,0,1,1,55,167l27.72-27.72,33.94,33.94Zm112,0A24,24,0,0,1,167,201l-27.72-27.72,33.94-33.94L201,167A24,24,0,0,1,201,201Zm-85-73a12,12,0,1,1,12,12A12,12,0,0,1,116,128Z" />
    </svg>
  );
}

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
  const [gateTitle, setGateTitle] = useState("");
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
        setGateTitle("The Content Reconciliation app is required");
        setGateMessage(
          "This tab works only when the Content Reconciliation app is installed and configured in the same environments as this app.",
        );
        setPhase("not-installed");
        return;
      }
      setGateTitle("Content Reconciliation is not ready");
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
          <p className="font-bold">{gateTitle}</p>
          <p className="mt-1 text-sm text-text-subtle">{gateMessage}</p>
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-[#f5f5f5] px-3 py-2 text-left text-sm">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white">
              <ContentReconciliationAppIcon size={28} />
            </div>
            <div>
              <p className="font-semibold">Content Reconciliation</p>
              <p className="text-text-subtle">
                Look for this app in the SitecoreAI Marketplace.
              </p>
            </div>
          </div>
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
