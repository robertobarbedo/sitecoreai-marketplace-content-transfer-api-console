"use client";

import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
import type { DataTree, DataTreeScope, MergeStrategy } from "@/src/types/transfer";

/**
 * Content backup archives: a store-only ZIP holding `manifest.json` plus the
 * RAW Content Transfer chunks (`chunks/{media|content}/<chunkSetId>/<n>.raif`)
 * exactly as getChunk returned them. Restore replays them with saveChunk →
 * complete → consume, so the bytes must survive untouched — no compression,
 * no re-encoding (content chunks are encrypted, media chunks compressed).
 *
 * The manifest follows the v1 layout of the sibling backup app (camelCase
 * dataTrees, sub-transfers split by isMedia) so archives are interchangeable;
 * the extra fields this app writes are optional on read.
 */

// Every entry is STORED, so no codec is needed — workers would only add a
// bundler-resolved worker URL and failure modes inside the Marketplace iframe.
configure({ useWebWorkers: false });

export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_ENTRY = "manifest.json";

export interface BackupAuthor {
  id: string;
  name: string;
  email: string;
}

/** Manifest form of a DataTree (camelCase, as in the sibling app). */
export interface BackupDataTree {
  itemPath: string;
  scope: DataTreeScope;
  mergeStrategy: MergeStrategy;
}

export interface BackupChunkRef {
  chunkId: number;
  /** ZIP entry holding this chunk's raw bytes. */
  entry: string;
  size: number;
  /** Hex SHA-256 of the chunk bytes (this app; optional on read). */
  sha256?: string;
}

export interface BackupChunkSet {
  chunkSetId: string;
  chunkCount: number;
  totalItemCount: number;
  chunks: BackupChunkRef[];
}

/**
 * One media or content sub-transfer: saveChunk needs `isMedia` on restore,
 * and the recorded transferId / chunkSetIds are replayed verbatim.
 */
export interface BackupSubTransfer {
  isMedia: boolean;
  transferId: string;
  dataTrees: BackupDataTree[];
  chunkSets: BackupChunkSet[];
}

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  createdBy: BackupAuthor | null;
  label: string;
  /** Tenant the backup was taken from — restoring into it shows a warning. */
  sourceTenantId: string;
  sourceTenantName: string;
  subTransfers: BackupSubTransfer[];
  /** Written by this app (optional on read). */
  app?: { name: string; version: string };
  database?: string;
}

export function toBackupDataTree(tree: DataTree): BackupDataTree {
  return {
    itemPath: tree.ItemPath,
    scope: tree.Scope,
    mergeStrategy: tree.MergeStrategy,
  };
}

/** ZIP entry name for one chunk; recorded verbatim in the manifest. */
export function chunkEntryName(
  isMedia: boolean,
  chunkSetId: string,
  chunkId: number,
): string {
  const safeSetId = chunkSetId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `chunks/${isMedia ? "media" : "content"}/${safeSetId}/${chunkId}.raif`;
}

export function archiveFileName(label: string, createdAt: Date): string {
  const slug =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "content-backup";
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug}_${stamp}.zip`;
}

export function manifestTotals(manifest: BackupManifest) {
  let bytes = 0;
  let chunks = 0;
  let items = 0;
  for (const sub of manifest.subTransfers) {
    for (const set of sub.chunkSets) {
      items += set.totalItemCount;
      chunks += set.chunks.length;
      for (const chunk of set.chunks) bytes += chunk.size;
    }
  }
  return { bytes, chunks, items };
}

export function manifestDataTrees(manifest: BackupManifest): BackupDataTree[] {
  return manifest.subTransfers.flatMap((sub) => sub.dataTrees);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/** Parses and validates a manifest, rejecting formats this build can't replay. */
export function parseManifest(raw: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ManifestError("manifest.json is not valid JSON.");
  }
  const m = parsed as Partial<BackupManifest>;
  if (typeof m?.formatVersion !== "number") {
    throw new ManifestError("manifest.json is missing formatVersion.");
  }
  if (m.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new ManifestError(
      `This archive uses backup format v${m.formatVersion}; this app understands up to v${BACKUP_FORMAT_VERSION}.`,
    );
  }
  if (!Array.isArray(m.subTransfers) || m.subTransfers.length === 0) {
    throw new ManifestError("manifest.json contains no sub-transfers.");
  }
  for (const sub of m.subTransfers) {
    if (typeof sub.transferId !== "string" || !sub.transferId) {
      throw new ManifestError("A sub-transfer is missing its transferId.");
    }
    if (typeof sub.isMedia !== "boolean") {
      throw new ManifestError(
        `Sub-transfer ${sub.transferId} does not say whether it is media.`,
      );
    }
    if (!Array.isArray(sub.chunkSets) || sub.chunkSets.length === 0) {
      throw new ManifestError(`Sub-transfer ${sub.transferId} has no chunk sets.`);
    }
    for (const set of sub.chunkSets) {
      if (!Array.isArray(set.chunks) || set.chunks.length === 0) {
        throw new ManifestError(`Chunk set ${set.chunkSetId} has no chunks.`);
      }
      if (set.chunks.length !== set.chunkCount) {
        throw new ManifestError(
          `Chunk set ${set.chunkSetId} lists ${set.chunks.length} of ${set.chunkCount} chunks — the backup is incomplete.`,
        );
      }
    }
  }
  return {
    formatVersion: m.formatVersion,
    createdAt: m.createdAt ?? "",
    createdBy: m.createdBy ?? null,
    label: m.label ?? "",
    sourceTenantId: m.sourceTenantId ?? "",
    sourceTenantName: m.sourceTenantName ?? "",
    subTransfers: m.subTransfers.map((sub) => ({
      ...sub,
      dataTrees: Array.isArray(sub.dataTrees) ? sub.dataTrees : [],
    })),
    app: m.app,
    database: m.database,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type SaveStrategy = "file-picker" | "opfs-download" | "memory-download";

export const SAVE_STRATEGY_LABELS: Record<SaveStrategy, string> = {
  "file-picker": "Saved through the save dialog (streamed to disk)",
  "opfs-download": "Browser download (staged in private browser storage)",
  "memory-download": "Browser download (held in memory)",
};

const OPFS_STAGING_PREFIX = "content-transfer-console-backup-";

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Removes staging files of earlier backups (best-effort). */
async function purgeOpfsStaging(keepName?: string): Promise<void> {
  try {
    const dir = await navigator.storage.getDirectory();
    const names = (
      dir as unknown as { keys?: () => AsyncIterableIterator<string> }
    ).keys?.();
    if (!names) return;
    for await (const name of names) {
      if (name.startsWith(OPFS_STAGING_PREFIX) && name !== keepName) {
        await dir.removeEntry(name).catch(() => {});
      }
    }
  } catch {
    // OPFS unavailable — nothing to clean.
  }
}

export interface ArchiveDelivery {
  strategy: SaveStrategy;
  /** Re-triggers the browser download; null when saved via the dialog. */
  redeliver: (() => void) | null;
  sizeBytes: number | null;
}

export interface ArchiveWriter {
  strategy: SaveStrategy;
  addChunk(entryName: string, blob: Blob): Promise<void>;
  addJson(entryName: string, value: unknown): Promise<void>;
  close(): Promise<ArchiveDelivery>;
  abort(): Promise<void>;
}

interface WriteTarget {
  strategy: SaveStrategy;
  sink: WritableStream | BlobWriter;
  deliver: (closeResult: unknown) => Promise<ArchiveDelivery>;
  cleanup: () => Promise<void>;
}

/**
 * Best available way to get a possibly multi-GB file to disk:
 * 1. showSaveFilePicker — streams to the chosen file (often blocked in the
 *    cross-origin SitecoreAI iframe → falls through);
 * 2. an OPFS staging file + download (bytes on disk, not in RAM);
 * 3. an in-memory Blob + download (last resort).
 * Must start from a user gesture for (1) to be allowed.
 */
async function resolveWriteTarget(fileName: string): Promise<WriteTarget> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: fileName,
        types: [
          {
            description: "Content backup archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      return {
        strategy: "file-picker",
        sink: writable as unknown as WritableStream,
        deliver: async () => ({
          strategy: "file-picker",
          redeliver: null,
          sizeBytes: await handle
            .getFile()
            .then((f) => f.size)
            .catch(() => null),
        }),
        cleanup: async () => {
          await (writable as unknown as { abort?: () => Promise<void> })
            .abort?.()
            .catch(() => {});
        },
      };
    } catch (error) {
      // The user dismissed the dialog: a real cancellation, no fallback.
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // SecurityError (cross-origin iframe) etc. → next strategy.
    }
  }

  try {
    const dir = await navigator.storage.getDirectory();
    const stagingName = `${OPFS_STAGING_PREFIX}${Date.now()}.zip`;
    const handle = await dir.getFileHandle(stagingName, { create: true });
    if (
      typeof (handle as unknown as { createWritable?: unknown }).createWritable ===
      "function"
    ) {
      await purgeOpfsStaging(stagingName);
      const writable = await handle.createWritable();
      return {
        strategy: "opfs-download",
        sink: writable as unknown as WritableStream,
        deliver: async () => {
          const file = await handle.getFile();
          const redeliver = () => triggerDownload(file, fileName);
          redeliver();
          return { strategy: "opfs-download", redeliver, sizeBytes: file.size };
        },
        // On success the staging file stays (removing it would cancel the
        // download); the next backup purges it.
        cleanup: async () => {
          await dir.removeEntry(stagingName).catch(() => {});
        },
      };
    }
    await dir.removeEntry(stagingName).catch(() => {});
  } catch {
    // OPFS unavailable — fall through.
  }

  const blobWriter = new BlobWriter("application/zip");
  return {
    strategy: "memory-download",
    sink: blobWriter,
    deliver: async (closeResult) => {
      const blob = closeResult as Blob;
      const redeliver = () => triggerDownload(blob, fileName);
      redeliver();
      return { strategy: "memory-download", redeliver, sizeBytes: blob.size };
    },
    cleanup: async () => {},
  };
}

/** Opens a store-only zip64 archive. Call from a user gesture. */
export async function createArchiveWriter(fileName: string): Promise<ArchiveWriter> {
  const target = await resolveWriteTarget(fileName);
  const zipWriter = new ZipWriter(target.sink as unknown as WritableStream, {
    level: 0,
    zip64: true,
    // Physically ordered entries keep a truncated archive coherent.
    keepOrder: true,
  });
  let closed = false;

  return {
    strategy: target.strategy,
    async addChunk(entryName, blob) {
      await zipWriter.add(entryName, new BlobReader(blob), { level: 0 });
    },
    async addJson(entryName, value) {
      const text = JSON.stringify(value, null, 2);
      await zipWriter.add(entryName, new BlobReader(new Blob([text])), {
        level: 0,
      });
    },
    async close() {
      const result = await zipWriter.close();
      closed = true;
      return target.deliver(result);
    },
    async abort() {
      if (closed) return;
      try {
        await zipWriter.close();
      } catch {
        // Discarding the archive anyway.
      }
      await target.cleanup();
    },
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ArchiveReader {
  manifest: BackupManifest;
  /** Random access — a multi-GB archive streams one chunk at a time. */
  getChunk(entryName: string): Promise<Blob>;
  close(): Promise<void>;
}

export async function readArchive(file: Blob): Promise<ArchiveReader> {
  // Random access: ZipReader seeks straight to the central directory, so
  // reading the manifest is instant even for a huge archive.
  const zipReader = new ZipReader(new BlobReader(file));
  let entries;
  try {
    entries = await zipReader.getEntries();
  } catch (error) {
    await zipReader.close().catch(() => {});
    throw new ManifestError(
      `That file could not be read as a ZIP archive: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const byName = new Map(
    entries.filter((e) => !e.directory).map((e) => [e.filename, e]),
  );
  const manifestEntry = byName.get(MANIFEST_ENTRY);
  if (!manifestEntry || manifestEntry.directory) {
    await zipReader.close().catch(() => {});
    throw new ManifestError(
      "This ZIP has no manifest.json, so it is not a content backup.",
    );
  }

  let manifest: BackupManifest;
  try {
    manifest = parseManifest(await manifestEntry.getData(new TextWriter()));
  } catch (error) {
    await zipReader.close().catch(() => {});
    throw error;
  }

  // Fail before anything is uploaded if chunk data is missing.
  for (const sub of manifest.subTransfers) {
    for (const set of sub.chunkSets) {
      for (const chunk of set.chunks) {
        if (!byName.has(chunk.entry)) {
          await zipReader.close().catch(() => {});
          throw new ManifestError(
            `The archive is incomplete: "${chunk.entry}" is listed in manifest.json but missing from the ZIP.`,
          );
        }
      }
    }
  }

  return {
    manifest,
    async getChunk(entryName) {
      const entry = byName.get(entryName);
      if (!entry || entry.directory) {
        throw new ManifestError(`Chunk entry "${entryName}" is missing.`);
      }
      return entry.getData(new BlobWriter("application/octet-stream"));
    },
    async close() {
      await zipReader.close().catch(() => {});
    },
  };
}
