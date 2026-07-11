"use client";

import { useEffect, useState } from "react";
import {
  mdiEye,
  mdiEyeOff,
  mdiCheckCircle,
  mdiAlertCircle,
  mdiLoading,
  mdiPencil,
  mdiDelete,
  mdiPlus,
  mdiServerNetwork,
  mdiInformationOutline,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  validateConnection,
  getEncryptionStatus,
  encryptSecretRemote,
  isEncryptedSecret,
} from "@/src/utils/transfer-api";
import type { EnvironmentConnection, TenantInfo } from "@/src/types/transfer";

interface ConnectionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: EnvironmentConnection[];
  /** Persists the full connection list; throws on failure. */
  onSave: (connections: EnvironmentConnection[]) => Promise<void>;
  /** Tenants the (global) standalone app can store its settings in. */
  tenants: TenantInfo[];
  selectedTenantId: string;
  onTenantChange: (tenantId: string) => void;
  /** True while the selected tenant's connections are being (re)loaded. */
  loadingConnections?: boolean;
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "valid" }
  | { status: "invalid"; message: string };

interface FormState {
  id: string | null; // null = creating a new connection
  label: string;
  host: string;
  clientId: string;
  /** Secret typed in this session (empty while editing = keep the stored one). */
  clientSecret: string;
  /** Stored (usually encrypted) secret of the connection being edited. */
  existingSecret: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  host: "",
  clientId: "",
  clientSecret: "",
  existingSecret: "",
};

function normalizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
}

export function ConnectionsModal({
  open,
  onOpenChange,
  connections,
  onSave,
  tenants,
  selectedTenantId,
  onTenantChange,
  loadingConnections = false,
}: ConnectionsModalProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState<
    boolean | null
  >(null);

  // Check once per open whether the server can encrypt secrets at rest.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getEncryptionStatus().then((configured) => {
      if (!cancelled) setEncryptionConfigured(configured);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset the view when the dialog opens or the settings tenant switches.
  useEffect(() => {
    if (open && !loadingConnections) {
      setForm(connections.length === 0 ? { ...EMPTY_FORM } : null);
      setShowSecret(false);
      setTest({ status: "idle" });
      setSaving(false);
      setDeletingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedTenantId, loadingConnections, connections.length]);

  const startEdit = (connection: EnvironmentConnection) => {
    // The browser only holds ciphertext for saved secrets, so the field
    // starts empty; leaving it blank keeps the stored secret.
    setForm({
      id: connection.id,
      label: connection.label,
      host: connection.host,
      clientId: connection.clientId,
      clientSecret: "",
      existingSecret: connection.clientSecret,
    });
    setShowSecret(false);
    setTest({ status: "idle" });
  };

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    if (test.status !== "idle") setTest({ status: "idle" });
  };

  // While editing, a blank secret field means "keep the stored secret"; the
  // server decrypts stored ciphertext transparently, so tests work with it.
  const effectiveSecret = form
    ? form.clientSecret.trim() || form.existingSecret
    : "";

  const formComplete =
    !!form &&
    form.label.trim() !== "" &&
    normalizeHost(form.host) !== "" &&
    form.clientId.trim() !== "" &&
    effectiveSecret !== "";

  const handleTest = async () => {
    if (!form) return;
    setTest({ status: "testing" });
    const result = await validateConnection({
      id: form.id ?? "",
      label: form.label.trim(),
      host: normalizeHost(form.host),
      clientId: form.clientId.trim(),
      clientSecret: effectiveSecret,
    });
    if (result.ok) {
      setTest({ status: "valid" });
    } else {
      setTest({
        status: "invalid",
        message:
          result.error === "invalid_credentials"
            ? "The Client ID or Client Secret is not valid for this environment."
            : result.error === "upstream_unreachable"
              ? "Could not reach the environment host. Check the host name."
              : result.detail || "Connection test failed.",
      });
    }
  };

  const handleSaveForm = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const entry: EnvironmentConnection = {
        id: form.id ?? crypto.randomUUID(),
        label: form.label.trim(),
        host: normalizeHost(form.host),
        clientId: form.clientId.trim(),
        clientSecret: effectiveSecret,
      };
      const next = form.id
        ? connections.map((c) => (c.id === form.id ? entry : c))
        : [...connections, entry];

      // Encrypt every plaintext secret in the list (idempotent — already
      // encrypted values pass through), so one save also migrates legacy
      // plaintext connections. Falls back to plaintext when no key is set.
      const normalized = await Promise.all(
        next.map(async (connection) =>
          isEncryptedSecret(connection.clientSecret)
            ? connection
            : {
                ...connection,
                clientSecret: (
                  await encryptSecretRemote(connection.clientSecret)
                ).value,
              },
        ),
      );

      await onSave(normalized);
      setForm(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onSave(connections.filter((c) => c.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Environment connections</DialogTitle>
        </DialogHeader>

        {/* Standalone apps are global: pick which tenant stores the settings */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {tenants.map((tenant) => (
              <Button
                key={tenant.tenantId}
                size="sm"
                variant={
                  tenant.tenantId === selectedTenantId ? "default" : "outline"
                }
                onClick={() => onTenantChange(tenant.tenantId)}
                disabled={saving || deletingId !== null || loadingConnections}
              >
                {tenant.label}
              </Button>
            ))}
          </div>
          {tenants.length > 1 && (
            <p className="text-xs text-text-subtle">
              This only chooses where connections are stored and which list is
              edited below — the transfer dropdowns always offer the
              connections of every environment.
            </p>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-primary-bg px-3 py-2.5 text-sm text-primary-fg">
          <Icon
            path={mdiInformationOutline}
            size={0.8}
            className="mt-0.5 shrink-0"
          />
          <p>
            No credential is shared or stored anywhere outside of this
            Sitecore instance.
            {encryptionConfigured && (
              <> Client secrets are encrypted at rest.</>
            )}
          </p>
        </div>

        {encryptionConfigured === false && (
          <div className="flex items-start gap-2 rounded-lg bg-[#ffe6bd] px-3 py-2.5 text-sm text-[#953d00]">
            <Icon
              path={mdiAlertCircle}
              size={0.8}
              className="mt-0.5 shrink-0"
            />
            <p>
              No encryption key is configured on the server, so client secrets
              will be stored <strong>unencrypted</strong> in the content tree.
              Set the <span className="font-mono">CT_ENCRYPTION_KEY</span>{" "}
              environment variable and re-save the connections to encrypt
              them.
            </p>
          </div>
        )}

        {loadingConnections && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-subtle">
            <Icon path={mdiLoading} className="animate-spin" />
            Loading connections&hellip;
          </div>
        )}

        {/* Connection list */}
        {!loadingConnections && !form && (
          <div className="flex flex-col gap-2">
            {connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-muted bg-surface-container-low px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Icon
                    path={mdiServerNetwork}
                    size={0.8}
                    className="shrink-0 text-primary-fg"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{connection.label}</p>
                    <p className="truncate font-mono text-xs text-text-subtle">
                      {connection.host}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => startEdit(connection)}
                    aria-label={`Edit ${connection.label}`}
                  >
                    <Icon path={mdiPencil} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    colorScheme="danger"
                    disabled={deletingId === connection.id}
                    onClick={() => handleDelete(connection.id)}
                    aria-label={`Delete ${connection.label}`}
                  >
                    <Icon
                      path={deletingId === connection.id ? mdiLoading : mdiDelete}
                      className={deletingId === connection.id ? "animate-spin" : ""}
                    />
                  </Button>
                </div>
              </div>
            ))}
            {connections.length === 0 && (
              <p className="py-4 text-center text-sm text-text-subtle">
                No connections yet.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setForm({ ...EMPTY_FORM })}
            >
              <Icon path={mdiPlus} />
              Add connection
            </Button>
          </div>
        )}

        {/* Add / edit form */}
        {!loadingConnections && form && (
          <div className="flex flex-col gap-4">
            {connections.length > 0 && (
              <>
                <Separator />
                <p className="text-sm font-semibold">
                  {form.id ? "Edit connection" : "New connection"}
                </p>
              </>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="conn-label" className="text-sm font-medium">
                Label
              </label>
              <Input
                id="conn-label"
                value={form.label}
                autoComplete="off"
                onChange={(e) => updateForm({ label: e.target.value })}
                placeholder="e.g. Production EU"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="conn-host" className="text-sm font-medium">
                Environment host name
              </label>
              <Input
                id="conn-host"
                value={form.host}
                autoComplete="off"
                onChange={(e) => updateForm({ host: e.target.value })}
                placeholder="your-environment.sitecorecloud.io"
              />
              <p className="text-xs text-text-subtle">
                SitecoreAI Deploy &gt; Projects &gt; your project &gt; Authoring
                environments &gt; Details &gt; Environment host name.{" "}
                <a
                  href="https://deploy.sitecorecloud.io/projects"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-fg underline hover:text-primary-fg/80"
                >
                  Ctrl+click to go to projects
                </a>
                .
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="conn-client-id" className="text-sm font-medium">
                Client ID
              </label>
              <Input
                id="conn-client-id"
                value={form.clientId}
                autoComplete="off"
                onChange={(e) => updateForm({ clientId: e.target.value })}
                placeholder="e.g. AbCdEf123..."
              />
              <p className="text-xs text-text-subtle">
                SitecoreAI Deploy &gt; Credentials &gt; Environment &gt; Create
                credentials &gt; Automation.{" "}
                <a
                  href="https://deploy.sitecorecloud.io/credentials/environment"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-fg underline hover:text-primary-fg/80"
                >
                  Ctrl+click to create credentials
                </a>
                .
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="conn-client-secret" className="text-sm font-medium">
                Client Secret
              </label>
              <div className="relative">
                <Input
                  id="conn-client-secret"
                  type={showSecret ? "text" : "password"}
                  value={form.clientSecret}
                  autoComplete="off"
                  onChange={(e) => updateForm({ clientSecret: e.target.value })}
                  placeholder={
                    form.id ? "Leave blank to keep the current secret" : ""
                  }
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label={showSecret ? "Hide secret" : "Show secret"}
                >
                  <Icon path={showSecret ? mdiEyeOff : mdiEye} size={0.8} />
                </button>
              </div>
            </div>

            {test.status === "valid" && (
              <div className="flex items-center gap-2 text-sm text-success-fg">
                <Icon path={mdiCheckCircle} size={0.8} />
                Connection successful
              </div>
            )}
            {test.status === "invalid" && (
              <div className="flex items-center gap-2 text-sm text-danger-fg">
                <Icon path={mdiAlertCircle} size={0.8} />
                {test.message}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {form && !loadingConnections ? (
            <>
              {connections.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => setForm(null)}
                  disabled={saving}
                >
                  Back
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!formComplete || test.status === "testing"}
              >
                {test.status === "testing" && (
                  <Icon path={mdiLoading} size={0.8} className="animate-spin" />
                )}
                Test connection
              </Button>
              <Button
                onClick={handleSaveForm}
                disabled={test.status !== "valid" || saving}
              >
                {saving && (
                  <Icon path={mdiLoading} size={0.8} className="animate-spin" />
                )}
                Save connection
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
