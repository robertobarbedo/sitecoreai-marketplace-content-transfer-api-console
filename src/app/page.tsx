"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { mdiCog, mdiLoading } from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { ConnectionGate } from "@/components/connection-gate";
import { ConnectionsModal } from "@/components/connections/connections-modal";
import { EnvironmentPicker } from "@/components/migration/environment-picker";
import { AutoMigrationTab } from "@/components/migration/auto-migration-tab";
import { MigrationTab } from "@/components/migration/migration-tab";
import { ItemTransfersTab } from "@/components/item-transfers/item-transfers-tab";
import { HistoryTab } from "@/components/history/history-tab";
import { ReconciliationTab } from "@/components/reconciliation/reconciliation-tab";
import { SavedTransfersTab } from "@/components/saved-transfers/saved-transfers-tab";
import { useMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import { getTenants } from "@/src/utils/sitecore-graphql";
import {
  loadConsoleSettings,
  saveConsoleSettings,
} from "@/src/utils/sitecore-settings";
import { isInvalidCredentialsError } from "@/src/utils/transfer-api";
import type { EnvironmentConnection, TenantInfo } from "@/src/types/transfer";

type ToastVariant = "default" | "success" | "error" | "warning";

interface ToastState {
  open: boolean;
  title: string;
  description?: string;
  variant: ToastVariant;
}

/** Remembers the last tenant whose settings the user worked with. */
const SELECTED_TENANT_KEY = "content-transfer-console.settings-tenant";

export default function StandaloneExtension() {
  const { client, error, isInitialized } = useMarketplaceClient();

  // Standalone extensions are global (not per tenant). The tenant selection
  // only controls WHERE new settings are saved; the source/destination
  // dropdowns always list the connections of ALL tenants.
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [connectionsByTenant, setConnectionsByTenant] = useState<
    Record<string, EnvironmentConnection[]>
  >({});
  const [bootstrapped, setBootstrapped] = useState(false);

  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  // While a transfer pipeline runs (Quick Transfer or an executing saved
  // transfer), the whole interface locks — only its Cancel button stays live.
  const [quickRunning, setQuickRunning] = useState(false);
  const [savedRunning, setSavedRunning] = useState(false);
  const transferRunning = quickRunning || savedRunning;
  const [toast, setToast] = useState<ToastState>({
    open: false,
    title: "",
    variant: "default",
  });

  const showToast = useCallback(
    (title: string, description?: string, variant: ToastVariant = "default") => {
      setToast({ open: true, title, description, variant });
    },
    [],
  );

  // Once the SDK is up: list the tenants, restore the last save-target
  // selection, and load the stored connections of EVERY tenant.
  useEffect(() => {
    if (!isInitialized || !client) return;

    let cancelled = false;
    (async () => {
      try {
        const list = await getTenants(client);
        if (cancelled) return;
        setTenants(list);

        const stored = window.localStorage.getItem(SELECTED_TENANT_KEY);
        const initial = list.find((t) => t.tenantId === stored) ?? list[0];
        if (initial) setSelectedTenantId(initial.tenantId);

        const results = await Promise.allSettled(
          list.map(async (tenant) => ({
            tenantId: tenant.tenantId,
            label: tenant.label,
            connections: (await loadConsoleSettings(client, tenant.contextId))
              .connections,
          })),
        );
        if (cancelled) return;

        const byTenant: Record<string, EnvironmentConnection[]> = {};
        const failed: string[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            byTenant[result.value.tenantId] = result.value.connections;
          } else {
            byTenant[list[index].tenantId] = [];
            failed.push(list[index].label);
          }
        });
        setConnectionsByTenant(byTenant);
        if (failed.length > 0) {
          showToast(
            "Some settings could not be loaded",
            `Could not read stored connections from: ${failed.join(", ")}.`,
            "warning",
          );
        }
      } catch (err) {
        console.error("Error loading application context/settings:", err);
        if (!cancelled) {
          showToast(
            "Failed to load application context",
            "Could not list the tenants this app has access to.",
            "error",
          );
        }
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isInitialized, client, showToast]);

  const selectedTenant =
    tenants.find((t) => t.tenantId === selectedTenantId) ?? null;

  /** Connections stored in the currently selected settings tenant. */
  const tenantConnections = connectionsByTenant[selectedTenantId] ?? [];

  /**
   * Every connection across all tenants — what the source/destination
   * dropdowns offer. Deduped by id (ids are UUIDs, so collisions only happen
   * if the same list was copied between tenants).
   */
  const allConnections = useMemo(() => {
    const seen = new Set<string>();
    const merged: EnvironmentConnection[] = [];
    for (const tenant of tenants) {
      for (const connection of connectionsByTenant[tenant.tenantId] ?? []) {
        if (seen.has(connection.id)) continue;
        seen.add(connection.id);
        merged.push(connection);
      }
    }
    return merged;
  }, [tenants, connectionsByTenant]);

  const handleTenantChange = useCallback((tenantId: string) => {
    try {
      window.localStorage.setItem(SELECTED_TENANT_KEY, tenantId);
    } catch {
      // Remembering the choice is a convenience only.
    }
    setSelectedTenantId(tenantId);
  }, []);

  const handleSaveConnections = useCallback(
    async (next: EnvironmentConnection[]) => {
      if (!client || !selectedTenant) return;
      try {
        await saveConsoleSettings(client, selectedTenant.contextId, next);
        setConnectionsByTenant((prev) => ({
          ...prev,
          [selectedTenant.tenantId]: next,
        }));
        showToast(
          "Connections saved",
          `Stored in ${selectedTenant.label}.`,
          "success",
        );
      } catch (err) {
        console.error("Error saving connections:", err);
        showToast(
          "Save failed",
          `Could not persist the connections to ${selectedTenant.label}.`,
          "error",
        );
        throw err;
      }
    },
    [client, selectedTenant, showToast],
  );

  const handleApiError = useCallback(
    (err: unknown, action: string) => {
      console.error(`Error trying to ${action}:`, err);
      if (isInvalidCredentialsError(err)) {
        showToast(
          "Credentials rejected",
          "The environment rejected the stored credentials. Update the connection in settings.",
          "error",
        );
        setConnectionsOpen(true);
      } else {
        showToast(
          `Failed to ${action}`,
          err instanceof Error ? err.message : undefined,
          "error",
        );
      }
    },
    [showToast],
  );

  const source = allConnections.find((c) => c.id === sourceId) ?? null;
  const destination =
    allConnections.find((c) => c.id === destinationId) ?? null;
  const pairReady = !!source && !!destination && source.id !== destination.id;

  // ---- Render states ----

  if (error) {
    return (
      <main className="p-(--spacing-margin-page) min-h-screen bg-surface-bright">
        <div className="mx-auto max-w-[1280px]">
          <div className="rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
            <h2 className="mb-1 font-bold">Failed to connect to Sitecore</h2>
            <p className="text-sm">
              The Marketplace SDK could not be initialized. Make sure this app
              is opened from inside SitecoreAI. ({error.message})
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!isInitialized || !bootstrapped) {
    return (
      <main className="p-(--spacing-margin-page) min-h-screen bg-surface-bright">
        <div className="mx-auto flex max-w-[1280px] items-center justify-center py-32">
          <div className="flex items-center gap-3 text-text-subtle">
            <Icon path={mdiLoading} size={1} className="animate-spin" />
            <span>Connecting to Sitecore&hellip;</span>
          </div>
        </div>
      </main>
    );
  }

  if (tenants.length === 0) {
    return (
      <main className="p-(--spacing-margin-page) min-h-screen bg-surface-bright">
        <div className="mx-auto max-w-[1280px]">
          <div className="rounded-xl border border-danger bg-danger-bg p-6 text-danger-fg">
            <h2 className="mb-1 font-bold">No tenant access</h2>
            <p className="text-sm">
              This app has no access to any SitecoreAI tenant. Grant the app
              access to at least one tenant in the Sitecore Cloud Portal, then
              reload.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ToastProvider swipeDirection="right">
      <main className="p-(--spacing-margin-page) min-h-screen bg-surface-bright">
        <div className="mx-auto max-w-[1280px] space-y-5">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icon.svg"
                alt="Content Transfer Console"
                width={40}
                height={40}
                className="shrink-0"
              />
              <div>
                <h1 className="text-lg font-bold text-on-surface">
                  Content Transfer Console
                </h1>
                <p className="text-[11px] text-text-subtle">
                  Transfer content and media between SitecoreAI environments with
                  the Content Transfer and Item Transfer APIs.
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConnectionsOpen(true)}
              disabled={transferRunning}
              aria-label="Manage environment connections"
            >
              <Icon path={mdiCog} />
            </Button>
          </header>

          {allConnections.length === 0 ? (
            <ConnectionGate onConfigure={() => setConnectionsOpen(true)} />
          ) : (
            <>
              <EnvironmentPicker
                connections={allConnections}
                sourceId={sourceId}
                destinationId={destinationId}
                onSourceChange={setSourceId}
                onDestinationChange={setDestinationId}
                disabled={transferRunning}
              />

              <Tabs defaultValue="transfer">
                <TabsList>
                  <TabsTrigger value="transfer" disabled={transferRunning}>
                    Quick Transfer
                  </TabsTrigger>
                  <TabsTrigger value="saved" disabled={transferRunning}>
                    Saved Transfers
                  </TabsTrigger>
                  <TabsTrigger value="reconciliation" disabled={transferRunning}>
                    Reconciliation
                  </TabsTrigger>
                  <TabsTrigger value="advanced" disabled={transferRunning}>
                    Advanced
                  </TabsTrigger>
                  <TabsTrigger value="item-transfers" disabled={transferRunning}>
                    Transfer Details History
                  </TabsTrigger>
                  <TabsTrigger value="history" disabled={transferRunning}>
                    Transfer Timeline
                  </TabsTrigger>
                </TabsList>
                {/* forceMount keeps a running automatic migration alive when
                    the user switches tabs (Radix hides it via `hidden`). */}
                <TabsContent value="transfer" forceMount>
                  {pairReady ? (
                    <AutoMigrationTab
                      key={`${source.id}->${destination.id}`}
                      source={source}
                      destination={destination}
                      onError={handleApiError}
                      showToast={showToast}
                      onRunningChange={setQuickRunning}
                    />
                  ) : (
                    <SelectionHint text="Select a source and a (different) destination environment above to start a migration." />
                  )}
                </TabsContent>
                <TabsContent value="advanced">
                  {pairReady ? (
                    <MigrationTab
                      key={`${source.id}->${destination.id}`}
                      source={source}
                      destination={destination}
                      onError={handleApiError}
                      showToast={showToast}
                    />
                  ) : (
                    <SelectionHint text="Select a source and a (different) destination environment above to start a migration." />
                  )}
                </TabsContent>
                <TabsContent value="item-transfers">
                  {destination ? (
                    <ItemTransfersTab
                      key={destination.id}
                      destination={destination}
                      onError={handleApiError}
                      showToast={showToast}
                    />
                  ) : (
                    <SelectionHint text="Select a destination environment above to inspect its item transfers." />
                  )}
                </TabsContent>
                <TabsContent value="history">
                  {destination ? (
                    <HistoryTab
                      key={destination.id}
                      destination={destination}
                      onError={handleApiError}
                    />
                  ) : (
                    <SelectionHint text="Select a destination environment above to inspect its consumption history." />
                  )}
                </TabsContent>
                {/* forceMount so switching tabs doesn't kill an executing
                    saved transfer (same reason as the transfer tab). */}
                <TabsContent value="saved" forceMount>
                  {client && (
                    <SavedTransfersTab
                      client={client}
                      tenants={tenants}
                      connections={allConnections}
                      onError={handleApiError}
                      showToast={showToast}
                      onRunningChange={setSavedRunning}
                    />
                  )}
                </TabsContent>
                {/* The reconciliation tab talks to the environments via the
                    Marketplace SDK (authoring GraphQL), not the stored
                    connections — no source/destination selection needed. */}
                <TabsContent value="reconciliation">
                  {client && <ReconciliationTab client={client} />}
                </TabsContent>
              </Tabs>
            </>
          )}

          <ConnectionsModal
            open={connectionsOpen}
            onOpenChange={setConnectionsOpen}
            connections={tenantConnections}
            onSave={handleSaveConnections}
            tenants={tenants}
            selectedTenantId={selectedTenantId}
            onTenantChange={handleTenantChange}
          />
        </div>
      </main>

      <Toast
        open={toast.open}
        onOpenChange={(open) => setToast((t) => ({ ...t, open }))}
        variant={toast.variant}
        duration={5000}
      >
        <div className="flex flex-col gap-0.5">
          <ToastTitle>{toast.title}</ToastTitle>
          {toast.description && (
            <ToastDescription>{toast.description}</ToastDescription>
          )}
        </div>
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}

function SelectionHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-border-muted bg-white p-8 text-center text-sm text-text-subtle">
      {text}
    </div>
  );
}
