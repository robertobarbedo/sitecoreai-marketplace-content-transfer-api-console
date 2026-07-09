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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateConnection } from "@/src/utils/transfer-api";
import type { EnvironmentConnection } from "@/src/types/transfer";

interface ConnectionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connections: EnvironmentConnection[];
  /** Persists the full connection list; throws on failure. */
  onSave: (connections: EnvironmentConnection[]) => Promise<void>;
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
  clientSecret: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  host: "",
  clientId: "",
  clientSecret: "",
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
}: ConnectionsModalProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(connections.length === 0 ? { ...EMPTY_FORM } : null);
      setShowSecret(false);
      setTest({ status: "idle" });
      setSaving(false);
      setDeletingId(null);
    }
  }, [open, connections.length]);

  const startEdit = (connection: EnvironmentConnection) => {
    setForm({ ...connection });
    setShowSecret(false);
    setTest({ status: "idle" });
  };

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    if (test.status !== "idle") setTest({ status: "idle" });
  };

  const formComplete =
    !!form &&
    form.label.trim() !== "" &&
    normalizeHost(form.host) !== "" &&
    form.clientId.trim() !== "" &&
    form.clientSecret.trim() !== "";

  const handleTest = async () => {
    if (!form) return;
    setTest({ status: "testing" });
    const result = await validateConnection({
      id: form.id ?? "",
      label: form.label.trim(),
      host: normalizeHost(form.host),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret.trim(),
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
        clientSecret: form.clientSecret.trim(),
      };
      const next = form.id
        ? connections.map((c) => (c.id === form.id ? entry : c))
        : [...connections, entry];
      await onSave(next);
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Environment connections</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                Each connection is a SitecoreAI environment host plus the
                Client ID / Client Secret of an automation client created in
                SitecoreAI Deploy. Connections are stored in the Sitecore
                content tree under /sitecore/system/Modules.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-lg bg-primary-bg px-3 py-2.5 text-sm text-primary-fg">
          <Icon
            path={mdiInformationOutline}
            size={0.8}
            className="mt-0.5 shrink-0"
          />
          <p>
            No credential is shared or stored anywhere outside of this
            Sitecore instance. Connections are kept in this environment&apos;s
            content tree and only used server-side to call the Sitecore APIs.
          </p>
        </div>

        {/* Connection list */}
        {!form && (
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
        {form && (
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
          {form ? (
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
