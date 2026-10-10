"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  mdiAlertCircle,
  mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline,
  mdiCheckCircle,
  mdiDelete,
  mdiDownload,
  mdiFileTree,
  mdiFolderZipOutline,
  mdiLoading,
  mdiPlus,
  mdiStop,
} from "@mdi/js";
import { Icon } from "@/lib/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stepper, type StepperStep } from "@/components/ui/stepper";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarNav,
} from "@/components/ui/sidebar";
import { EnvBadge, StateBadge } from "@/components/badges";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { TreePickerDialog } from "@/components/migration/tree-picker-dialog";
import {
  MERGE_STRATEGIES,
  SCOPES,
} from "@/components/migration/create-transfer-card";
import {
  BACKUP_STAGES,
  useContentBackup,
  type BackupStage,
} from "@/src/utils/hooks/useContentBackup";
import {
  RESTORE_STAGES,
  useContentRestore,
  type RestoreStage,
} from "@/src/utils/hooks/useContentRestore";
import {
  formatBytes,
  manifestDataTrees,
  manifestTotals,
  readArchive,
  SAVE_STRATEGY_LABELS,
  type ArchiveReader,
} from "@/src/utils/backup-archive";
import { loadRecentBackups, type RecentBackup } from "@/src/utils/recent-backups";
import { authoringGraphql } from "@/src/utils/environment-client";
import type {
  DataTree,
  DataTreeScope,
  EnvironmentConnection,
  MergeStrategy,
} from "@/src/types/transfer";

type ShowToast = (
  title: string,
  description?: string,
  variant?: "default" | "success" | "error" | "warning",
) => void;

interface BackupRestoreTabProps {
  /** Backup reads from the selected SOURCE environment. */
  source: EnvironmentConnection | null;
  /** Restore writes into the selected DESTINATION environment. */
  destination: EnvironmentConnection | null;
  showToast: ShowToast;
  /** Reports a running backup/restore so the page can lock the rest. */
  onRunningChange?: (running: boolean) => void;
  /** Selected sidebar view — owned by the page, which disables the unused
   *  side of the environment picker. */
  view: BackupRestoreView;
  onViewChange: (view: BackupRestoreView) => void;
}

export type BackupRestoreView = "backup" | "restore";

/**
 * Backup & Restore (Organization mode only). Backup snapshots content of the
 * source environment into a ZIP (manifest.json + raw transfer chunks);
 * restore replays such a ZIP into the destination environment.
 */
export function BackupRestoreTab({
  source,
  destination,
  showToast,
  onRunningChange,
  view,
  onViewChange: setView,
}: BackupRestoreTabProps) {
  const [backupRunning, setBackupRunning] = useState(false);
  const [restoreRunning, setRestoreRunning] = useState(false);
  const running = backupRunning || restoreRunning;

  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <SidebarNav className="md:w-56 md:shrink-0" aria-label="Backup and restore">
        <SidebarGroup>
          <SidebarGroupLabel>Backup &amp; Restore</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view === "backup"}
                disabled={running && view !== "backup"}
                onClick={() => setView("backup")}
              >
                <Icon path={mdiArchiveArrowDownOutline} size={0.75} />
                <span>Backup</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={view === "restore"}
                disabled={running && view !== "restore"}
                onClick={() => setView("restore")}
              >
                <Icon path={mdiArchiveArrowUpOutline} size={0.75} />
                <span>Restore</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarNav>

      {/* Both stay mounted so a running job survives the view switch. */}
      <div className="min-w-0 flex-1">
        <div hidden={view !== "backup"}>
          <BackupPanel
            source={source}
            showToast={showToast}
            onRunningChange={setBackupRunning}
          />
        </div>
        <div hidden={view !== "restore"}>
          <RestorePanel
            destination={destination}
            showToast={showToast}
            onRunningChange={setRestoreRunning}
          />
        </div>
      </div>
    </div>
  );
}

function SelectionHint({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-border-muted bg-white p-8 text-center text-sm text-text-subtle">
      {text}
    </div>
  );
}

function stepperSteps<S extends string>(
  stages: readonly S[],
  meta: Record<S, { title: string; hint: string }>,
  stage: string,
  failedAt: string | undefined,
): StepperStep[] {
  const current =
    stage === "done"
      ? stages.length
      : stages.indexOf((stage === "failed" ? failedAt : stage) as S);
  return stages.map((s, index) => ({
    label: meta[s].title,
    description: meta[s].hint,
    status:
      index < current
        ? "completed"
        : index > current
          ? "pending"
          : stage === "failed"
            ? "failed"
            : "active",
  }));
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-bg">
        <div
          className="h-full rounded-full bg-success transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs text-text-subtle">
        {done}/{total} chunks
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const BACKUP_META: Record<(typeof BACKUP_STAGES)[number], { title: string; hint: string }> = {
  create: { title: "Create", hint: "Source" },
  snapshot: { title: "Snapshot", hint: "Source" },
  download: { title: "Download", hint: "Browser" },
  archive: { title: "Save ZIP", hint: "Browser" },
  cleanup: { title: "Clean up", hint: "Source" },
};

const DEFAULT_TREE: DataTree = {
  ItemPath: "",
  Scope: "ItemAndDescendants",
  MergeStrategy: "OverrideExistingItem",
};

function BackupPanel({
  source,
  showToast,
  onRunningChange,
}: {
  source: EnvironmentConnection | null;
  showToast: ShowToast;
  onRunningChange: (running: boolean) => void;
}) {
  const { state, running, start, cancel, reset } = useContentBackup(source);
  const [label, setLabel] = useState("");
  const [trees, setTrees] = useState<DataTree[]>([{ ...DEFAULT_TREE }]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentBackup[]>([]);

  useEffect(() => {
    onRunningChange(running);
  }, [running, onRunningChange]);

  // Toast terminal transitions once; refresh the recent list.
  const reportedRef = useRef<BackupStage>("idle");
  useEffect(() => {
    if (state.stage === reportedRef.current) return;
    reportedRef.current = state.stage;
    if (state.stage === "done") {
      showToast("Backup complete", state.fileName, "success");
      setRecent(loadRecentBackups());
    } else if (state.stage === "failed" && !state.cancelled) {
      showToast("Backup failed", state.error, "error");
    }
  }, [state.stage, state.fileName, state.error, state.cancelled, showToast]);

  useEffect(() => {
    setRecent(loadRecentBackups());
  }, []);

  if (!source) {
    return (
      <SelectionHint text="Select a source environment above — the backup is taken from it." />
    );
  }

  const updateTree = (index: number, patch: Partial<DataTree>) =>
    setTrees((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const valid =
    label.trim() !== "" &&
    trees.length > 0 &&
    trees.every((t) => t.ItemPath.trim().startsWith("/sitecore"));

  return (
    <div className="flex flex-col gap-4">
      <Card style="outline" padding="md">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Back up content to a ZIP</CardTitle>
            <EnvBadge env="source" name={source.label} />
          </div>
          <CardDescription className="text-muted-foreground">
            Snapshots the selected paths of {source.label} (master database)
            into a ZIP you keep: a manifest plus the raw transfer packages.
            Restore it later into any environment where this app is installed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="backup-label" className="text-sm font-medium">
              Backup name
            </label>
            <Input
              id="backup-label"
              value={label}
              autoComplete="off"
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Home page before redesign"
              disabled={running}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Paths</span>
            {trees.map((tree, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border-muted bg-surface-container-low p-2"
              >
                <div className="flex min-w-64 flex-1 gap-1.5">
                  <Input
                    value={tree.ItemPath}
                    autoComplete="off"
                    onChange={(e) => updateTree(index, { ItemPath: e.target.value })}
                    placeholder="/sitecore/content/Home"
                    className="flex-1 font-mono text-xs"
                    aria-label={`Item path ${index + 1}`}
                    disabled={running}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setPickerIndex(index)}
                    disabled={running}
                    aria-label={`Browse the source content tree for path ${index + 1}`}
                    title="Browse the source content tree"
                  >
                    <Icon path={mdiFileTree} />
                  </Button>
                </div>
                <Select
                  value={tree.Scope}
                  onValueChange={(v) => updateTree(index, { Scope: v as DataTreeScope })}
                  disabled={running}
                >
                  <SelectTrigger className="w-44" aria-label="Scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={tree.MergeStrategy}
                  onValueChange={(v) =>
                    updateTree(index, { MergeStrategy: v as MergeStrategy })
                  }
                  disabled={running}
                >
                  <SelectTrigger className="w-60" aria-label="Merge strategy on restore">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MERGE_STRATEGIES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  colorScheme="danger"
                  disabled={trees.length === 1 || running}
                  onClick={() => setTrees((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remove path ${index + 1}`}
                >
                  <Icon path={mdiDelete} />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTrees((prev) => [...prev, { ...DEFAULT_TREE }])}
                disabled={running}
              >
                <Icon path={mdiPlus} />
                Add path
              </Button>
              <p className="max-w-xl text-xs text-text-subtle">
                The merge strategy is stored in the backup and decides how it
                is applied when restored — &quot;Override existing tree&quot;
                also removes items added after the backup.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {running ? (
              <Button variant="outline" onClick={cancel}>
                <Icon path={mdiStop} />
                Cancel backup
              </Button>
            ) : (
              <Button
                onClick={() => {
                  reset();
                  start({ label, dataTrees: trees });
                }}
                disabled={!valid}
              >
                <Icon path={mdiArchiveArrowDownOutline} />
                Start backup
              </Button>
            )}
            <p className="text-xs text-text-subtle">
              Your browser may ask where to save the file. Keep this tab open
              until the backup finishes.
            </p>
          </div>
        </CardContent>
      </Card>

      {state.stage !== "idle" && (
        <Card style="outline" padding="md">
          <CardContent className="flex flex-col gap-4">
            <Stepper
              steps={stepperSteps(BACKUP_STAGES, BACKUP_META, state.stage, state.failedAt)}
            />
            {state.stage === "download" && (
              <ProgressBar done={state.chunksDone} total={state.chunksTotal} />
            )}
            {state.detail && (
              <p className="flex items-center gap-2 text-sm text-text-subtle">
                {running && <Icon path={mdiLoading} size={0.7} className="animate-spin" />}
                {state.detail}
              </p>
            )}
            {state.stage === "done" && state.delivery && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-success-bg p-3 text-sm text-success-fg">
                <div className="flex items-start gap-2">
                  <Icon path={mdiCheckCircle} size={0.8} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">{state.fileName}</p>
                    <p className="text-xs">
                      {state.delivery.sizeBytes !== null &&
                        `${formatBytes(state.delivery.sizeBytes)} · `}
                      {SAVE_STRATEGY_LABELS[state.delivery.strategy]}
                    </p>
                  </div>
                </div>
                {state.delivery.redeliver && (
                  <Button variant="outline" size="sm" onClick={state.delivery.redeliver}>
                    <Icon path={mdiDownload} />
                    Download again
                  </Button>
                )}
              </div>
            )}
            {state.stage === "failed" && (
              <div className="flex items-start gap-2 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
                <Icon path={mdiAlertCircle} size={0.8} className="mt-0.5 shrink-0" />
                <p>
                  {state.error} The staged transfer on {source.label} was
                  cleaned up; no partial ZIP is kept.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {recent.length > 0 && (
        <Card style="outline" padding="md">
          <CardHeader>
            <CardTitle className="text-sm">Backups made in this browser</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {recent.map((backup) => (
              <div
                key={backup.fileName}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-muted bg-surface-container-low px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{backup.label}</p>
                  <p className="truncate font-mono text-[11px] text-text-subtle" title={backup.paths.join(", ")}>
                    {backup.fileName}
                  </p>
                </div>
                <p className="text-xs text-text-subtle">
                  {backup.sourceLabel} · {new Date(backup.createdAt).toLocaleString()} ·{" "}
                  {formatBytes(backup.sizeBytes)} · {backup.items} items
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <TreePickerDialog
        open={pickerIndex !== null}
        onOpenChange={(open) => {
          if (!open) setPickerIndex(null);
        }}
        source={source}
        database="master"
        onSelect={(path) => {
          if (pickerIndex !== null) updateTree(pickerIndex, { ItemPath: path });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const RESTORE_META: Record<(typeof RESTORE_STAGES)[number], { title: string; hint: string }> = {
  upload: { title: "Upload", hint: "Destination" },
  assemble: { title: "Assemble", hint: "Destination" },
  import: { title: "Import", hint: "Destination" },
};

interface PathPreview {
  path: string;
  status: "loading" | "found" | "missing" | "error";
  error?: string;
  templateName?: string;
  updated?: string;
  children: string[];
  moreChildren: boolean;
}

const PATH_PREVIEW_QUERY = `
  query RestorePathPreview($path: String!) {
    item(where: { database: "master", path: $path, language: "en" }) {
      name
      template { name }
      updated: field(name: "__Updated") { value }
      children(first: 10) {
        pageInfo { hasNextPage }
        nodes { name }
      }
    }
  }
`;

interface PathPreviewData {
  item?: {
    name: string;
    template?: { name: string } | null;
    updated?: { value: string } | null;
    children?: {
      pageInfo?: { hasNextPage: boolean };
      nodes: ({ name: string } | null)[];
    } | null;
  } | null;
}

/** "20250101T120000Z" (Sitecore field format) → locale string. */
function formatSitecoreDate(value?: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return value;
  return new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
  ).toLocaleString();
}

function RestorePanel({
  destination,
  showToast,
  onRunningChange,
}: {
  destination: EnvironmentConnection | null;
  showToast: ShowToast;
  onRunningChange: (running: boolean) => void;
}) {
  const { state, running, start, cancel, reset } = useContentRestore(destination);
  const [archive, setArchive] = useState<ArchiveReader | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [previews, setPreviews] = useState<PathPreview[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onRunningChange(running);
  }, [running, onRunningChange]);

  // Release the open archive when it is replaced or the panel unmounts.
  useEffect(() => {
    return () => {
      archive?.close();
    };
  }, [archive]);

  const reportedRef = useRef<RestoreStage>("idle");
  useEffect(() => {
    if (state.stage === reportedRef.current) return;
    reportedRef.current = state.stage;
    if (state.stage === "done") {
      showToast("Restore complete", destination?.label, "success");
    } else if (state.stage === "failed" && !state.cancelled) {
      showToast("Restore failed", state.error, "error");
    }
  }, [state.stage, state.error, state.cancelled, destination?.label, showToast]);

  const manifest = archive?.manifest ?? null;
  const paths = useMemo(
    () =>
      manifest
        ? Array.from(new Set(manifestDataTrees(manifest).map((t) => t.itemPath)))
        : [],
    [manifest],
  );

  // Live state of each restored path on the destination.
  useEffect(() => {
    if (!destination || paths.length === 0) {
      setPreviews([]);
      return;
    }
    let cancelled = false;
    setPreviews(paths.map((path) => ({ path, status: "loading", children: [], moreChildren: false })));
    paths.forEach(async (path, index) => {
      let preview: PathPreview;
      try {
        const data = await authoringGraphql<PathPreviewData>(destination, PATH_PREVIEW_QUERY, { path });
        const item = data?.item;
        preview = item
          ? {
              path,
              status: "found",
              templateName: item.template?.name,
              updated: formatSitecoreDate(item.updated?.value),
              children: (item.children?.nodes ?? [])
                .filter((n): n is { name: string } => !!n)
                .map((n) => n.name),
              moreChildren: !!item.children?.pageInfo?.hasNextPage,
            }
          : { path, status: "missing", children: [], moreChildren: false };
      } catch (error) {
        preview = {
          path,
          status: "error",
          error: error instanceof Error ? error.message : "Could not read the destination.",
          children: [],
          moreChildren: false,
        };
      }
      if (!cancelled) {
        setPreviews((prev) => prev.map((p, i) => (i === index ? preview : p)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [destination, paths]);

  if (!destination) {
    return (
      <SelectionHint text="Select a destination environment above — the backup is restored into it." />
    );
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setReadError(null);
    setReading(true);
    setArchive(null);
    setFileName(file.name);
    try {
      setArchive(await readArchive(file));
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Could not read the archive.");
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const totals = manifest ? manifestTotals(manifest) : null;
  const sameEnvironment = !!manifest && manifest.sourceTenantId === destination.id;
  const overrideTree =
    !!manifest &&
    manifestDataTrees(manifest).some((t) => t.mergeStrategy === "OverrideExistingTree");

  return (
    <div className="flex flex-col gap-4">
      <Card style="outline" padding="md">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Restore a backup ZIP</CardTitle>
            <EnvBadge env="destination" name={destination.label} />
          </div>
          <CardDescription className="text-muted-foreground">
            Pick a backup made with this app (or a compatible one). Nothing is
            written until you confirm the restore.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={running || reading}
            >
              <Icon
                path={reading ? mdiLoading : mdiFolderZipOutline}
                className={reading ? "animate-spin" : ""}
              />
              {archive ? "Choose another file" : "Choose backup file"}
            </Button>
            {fileName && (
              <span className="truncate font-mono text-xs text-text-subtle">{fileName}</span>
            )}
          </div>

          {readError && (
            <div className="flex items-start gap-2 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
              <Icon path={mdiAlertCircle} size={0.8} className="mt-0.5 shrink-0" />
              <p>{readError}</p>
            </div>
          )}

          {manifest && totals && (
            <div className="flex flex-col gap-3">
              <div className="grid gap-2 rounded-lg border border-border-muted bg-surface-container-low p-3 text-sm sm:grid-cols-2">
                <SummaryRow label="Backup">{manifest.label || "—"}</SummaryRow>
                <SummaryRow label="Created">
                  {manifest.createdAt ? new Date(manifest.createdAt).toLocaleString() : "—"}
                  {manifest.createdBy?.name ? ` by ${manifest.createdBy.name}` : ""}
                </SummaryRow>
                <SummaryRow label="Source">{manifest.sourceTenantName || "—"}</SummaryRow>
                <SummaryRow label="Contents">
                  {totals.items} items · {totals.chunks} chunks · {formatBytes(totals.bytes)}
                  {manifest.subTransfers.some((s) => s.isMedia) && " · includes media"}
                </SummaryRow>
              </div>

              <div className="overflow-hidden rounded-xl border border-border-muted bg-white">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-muted bg-surface-grey">
                      {["Path", "Scope / merge", `Now on ${destination.label}`].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-on-surface-variant"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {manifestDataTrees(manifest).map((tree, index) => {
                      const preview = previews.find((p) => p.path === tree.itemPath);
                      return (
                        <tr key={index} className="border-b border-border-muted align-top last:border-b-0">
                          <td className="max-w-[320px] break-all px-4 py-3 font-mono text-xs">
                            {tree.itemPath}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {SCOPES.find((s) => s.value === tree.scope)?.label ?? tree.scope}
                            <br />
                            <span
                              className={cn(
                                "text-text-subtle",
                                tree.mergeStrategy === "OverrideExistingTree" && "font-semibold text-danger-fg",
                              )}
                            >
                              {MERGE_STRATEGIES.find((s) => s.value === tree.mergeStrategy)?.label ??
                                tree.mergeStrategy}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <PathPreviewCell preview={preview} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {sameEnvironment && (
                <Warning>
                  This backup was taken from {destination.label} itself — restoring
                  rolls these paths back to the backed-up state.
                </Warning>
              )}
              {overrideTree && (
                <Warning>
                  Some paths use &quot;Override existing tree&quot;: the whole
                  matching tree in {destination.label} is replaced, including
                  items created after the backup.
                </Warning>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {running ? (
                  <Button
                    variant="outline"
                    onClick={cancel}
                    disabled={!state.cancellable}
                    title={
                      state.cancellable
                        ? undefined
                        : "Packages are already assembled on the destination — the restore can no longer be cancelled."
                    }
                  >
                    <Icon path={mdiStop} />
                    Cancel restore
                  </Button>
                ) : (
                  <Button
                    colorScheme={overrideTree || sameEnvironment ? "danger" : undefined}
                    onClick={() => setConfirmOpen(true)}
                    disabled={state.stage === "done"}
                  >
                    <Icon path={mdiArchiveArrowUpOutline} />
                    Restore into {destination.label}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {state.stage !== "idle" && (
        <Card style="outline" padding="md">
          <CardContent className="flex flex-col gap-4">
            <Stepper
              steps={stepperSteps(RESTORE_STAGES, RESTORE_META, state.stage, state.failedAt)}
            />
            {state.stage === "upload" && (
              <ProgressBar done={state.chunksDone} total={state.chunksTotal} />
            )}
            {state.detail && (
              <p className="flex items-center gap-2 text-sm text-text-subtle">
                {running && <Icon path={mdiLoading} size={0.7} className="animate-spin" />}
                {state.detail}
              </p>
            )}
            {Object.keys(state.consumption).length > 0 && (
              <div className="flex flex-col gap-1.5">
                {Object.entries(state.consumption).map(([name, progress]) => (
                  <div
                    key={name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-muted bg-surface-container-low px-3 py-2"
                  >
                    <span className="max-w-96 truncate font-mono text-xs" title={name}>
                      {name}
                    </span>
                    <span className="flex items-center gap-2">
                      {progress.detail && (
                        <span className="text-xs text-text-subtle">{progress.detail}</span>
                      )}
                      <StateBadge state={progress.state} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!state.cancellable && running && (
              <p className="text-xs text-text-subtle">
                The packages are assembled on {destination.label}; the restore
                can no longer be cancelled.
              </p>
            )}
            {state.stage === "done" && (
              <div className="flex items-start gap-2 rounded-lg bg-success-bg p-3 text-sm text-success-fg">
                <Icon path={mdiCheckCircle} size={0.8} className="mt-0.5 shrink-0" />
                <p>
                  The backup was restored into {destination.label} (master).
                  Publish it if it should go live.
                </p>
              </div>
            )}
            {state.stage === "failed" && (
              <div className="flex items-start gap-2 rounded-lg bg-danger-bg p-3 text-sm text-danger-fg">
                <Icon path={mdiAlertCircle} size={0.8} className="mt-0.5 shrink-0" />
                <p>{state.error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDestructiveDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Restore into ${destination.label}?`}
        description={
          <>
            {paths.length} path(s) from &quot;{manifest?.label}&quot; are
            written into the master database of {destination.label} using the
            merge strategies stored in the backup. Once the packages are
            assembled the restore can&apos;t be cancelled.
          </>
        }
        confirmWord="RESTORE"
        confirmLabel="Start restore"
        onConfirm={async () => {
          if (archive) start(archive);
        }}
      />
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wider text-text-subtle">{label}</p>
      <p className="truncate">{children}</p>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-[#ffe6bd] px-3 py-2.5 text-sm text-[#953d00]">
      <Icon path={mdiAlertCircle} size={0.8} className="mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function PathPreviewCell({ preview }: { preview?: PathPreview }) {
  if (!preview || preview.status === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-text-subtle">
        <Icon path={mdiLoading} size={0.6} className="animate-spin" />
        Checking…
      </span>
    );
  }
  if (preview.status === "missing") {
    return <span className="text-text-subtle">Not present — will be created</span>;
  }
  if (preview.status === "error") {
    return <span className="text-danger-fg">{preview.error}</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span>
        Exists{preview.templateName ? ` · ${preview.templateName}` : ""}
        {preview.updated ? ` · updated ${preview.updated}` : ""}
      </span>
      {preview.children.length > 0 && (
        <span className="text-text-subtle">
          Children: {preview.children.join(", ")}
          {preview.moreChildren ? ", …" : ""}
        </span>
      )}
    </div>
  );
}
