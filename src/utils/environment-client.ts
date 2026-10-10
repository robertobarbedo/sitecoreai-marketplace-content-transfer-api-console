"use client";

import { callTransferApi, copyChunk } from "@/src/utils/transfer-api";
import { getInitializedMarketplaceClient } from "@/src/utils/hooks/useMarketplaceClient";
import type {
  BlobSourceState,
  BlobState,
  ChunkCopyResult,
  CompleteChunkSetResult,
  ContentTreeItem,
  ContentTransferStatus,
  CreateTransferInput,
  DataTree,
  EnvironmentConnection,
  ItemChildrenResult,
  StartItemTransferResult,
  TenantInfo,
  TransferMode,
} from "@/src/types/transfer";

/**
 * Single dispatch point for every Content Transfer / Item Transfer operation
 * the transfer flows need. Organization-mode environments (kind
 * "organization") go through the Marketplace SDK (`xmc.contentTransfer.*`,
 * `xmc.authoring.graphql`) addressed by their sitecoreContextId — no
 * credentials. Every other environment goes through the app's own API routes
 * with the stored credentials, exactly as before.
 *
 * Operations the SDK does not expose (Item Transfer lists, history, blob
 * listing/discard, retry) are NOT here — those stay REST-only and their UI is
 * gated to Cross-Organization mode.
 */

export function isOrganizationEnvironment(
  environment: EnvironmentConnection,
): boolean {
  return environment.kind === "organization";
}

export function modeOf(environment: EnvironmentConnection): TransferMode {
  return isOrganizationEnvironment(environment) ? "organization" : "cross-org";
}

/** The installed environments, as Organization-mode connections. */
export function organizationEnvironments(
  tenants: TenantInfo[],
): EnvironmentConnection[] {
  return tenants.map((tenant) => ({
    id: tenant.tenantId,
    label: tenant.label,
    host: "",
    clientId: "",
    clientSecret: "",
    kind: "organization",
    contextId: tenant.contextId,
  }));
}

/** Dropdown / badge text: installed environments have no host to show. */
export function environmentDisplayName(environment: EnvironmentConnection): string {
  return environment.host
    ? `${environment.label} (${environment.host})`
    : environment.label;
}

// ---------------------------------------------------------------------------
// Media vs content
// ---------------------------------------------------------------------------

/** Items under the Media Library produce media chunks. */
export function isMediaPath(itemPath: string): boolean {
  return itemPath.trim().toLowerCase().startsWith("/sitecore/media library");
}

/**
 * true = every tree is media, false = none is, null = mixed or unknown.
 * The SDK's getChunk does not expose the Content-Disposition header the REST
 * copy route reads `IsMedia` from, so Organization mode derives it from the
 * paths and must never mix media and content in one transfer.
 */
export function dataTreesMediaKind(dataTrees: DataTree[]): boolean | null {
  if (dataTrees.length === 0) return null;
  const media = dataTrees.filter((tree) => isMediaPath(tree.ItemPath)).length;
  if (media === dataTrees.length) return true;
  if (media === 0) return false;
  return null;
}

// ---------------------------------------------------------------------------
// SDK response handling
// ---------------------------------------------------------------------------

/** Error raised by an Organization-mode (SDK) call. */
export class SdkTransferError extends Error {
  constructor(
    message: string,
    public status?: number,
    public raw?: unknown,
  ) {
    super(message);
    this.name = "SdkTransferError";
  }
}

function describeSdkError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    for (const key of ["Message", "message", "detail", "title", "error"]) {
      if (typeof e[key] === "string" && e[key]) return e[key] as string;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // fall through
    }
  }
  return "The Sitecore API request failed.";
}

interface SdkEnvelope {
  data?: unknown;
  error?: unknown;
  response?: { status?: number };
}

/**
 * client.query() returns { data: <hey-api result> } where the hey-api result
 * is { data, error, response }; client.mutate() returns the hey-api result
 * directly (sometimes with the payload nested one level deeper). Walks down
 * the envelopes, throwing on the first error, and returns the payload.
 */
function unwrapSdk<T>(result: unknown): T | null {
  let current = result as SdkEnvelope | undefined;
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== "object") break;
    if (current.error) {
      throw new SdkTransferError(
        describeSdkError(current.error),
        current.response?.status,
        current.error,
      );
    }
    const inner = current.data as SdkEnvelope | undefined;
    const isEnvelope =
      !!inner &&
      typeof inner === "object" &&
      !(inner instanceof Blob) &&
      ("data" in inner || "error" in inner || "response" in inner);
    if (!isEnvelope) return (current.data as T) ?? null;
    current = inner;
  }
  return null;
}

function sdk() {
  return getInitializedMarketplaceClient();
}

function contextOf(environment: EnvironmentConnection): string {
  if (!environment.contextId) {
    throw new SdkTransferError(
      `${environment.label} has no Sitecore context ID.`,
    );
  }
  return environment.contextId;
}

/** Per-call timeout for chunk operations (the SDK default is ~30 s). */
const CHUNK_TIMEOUT_MS = 6 * 60 * 1000;
const CHUNK_RETRIES = 3;
const CHUNK_RETRY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Content Transfer API
// ---------------------------------------------------------------------------

export async function createTransfer(
  environment: EnvironmentConnection,
  input: CreateTransferInput,
): Promise<void> {
  if (!isOrganizationEnvironment(environment)) {
    await callTransferApi(environment, "/api/transfer/transfers", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return;
  }
  // The SDK variant always reads the master database (no Database field).
  const result = await sdk().mutate("xmc.contentTransfer.createContentTransfer", {
    params: {
      body: {
        transferId: input.TransferId,
        configuration: {
          dataTrees: input.Configuration.DataTrees.map((tree) => ({
            itemPath: tree.ItemPath,
            scope: tree.Scope,
            mergeStrategy: tree.MergeStrategy,
          })),
        },
      },
      query: { sitecoreContextId: contextOf(environment) },
    },
  });
  unwrapSdk(result);
}

export async function getTransferStatus(
  environment: EnvironmentConnection,
  transferId: string,
): Promise<ContentTransferStatus | null> {
  if (!isOrganizationEnvironment(environment)) {
    return callTransferApi<ContentTransferStatus>(
      environment,
      `/api/transfer/transfers/${encodeURIComponent(transferId)}/status`,
    );
  }
  const result = await sdk().query("xmc.contentTransfer.getContentTransferStatus", {
    params: {
      path: { transferId },
      query: { sitecoreContextId: contextOf(environment) },
    },
  });
  return unwrapSdk<ContentTransferStatus>(result);
}

export async function deleteTransfer(
  environment: EnvironmentConnection,
  transferId: string,
): Promise<void> {
  if (!isOrganizationEnvironment(environment)) {
    await callTransferApi<void>(
      environment,
      `/api/transfer/transfers/${encodeURIComponent(transferId)}`,
      { method: "DELETE" },
    );
    return;
  }
  const result = await sdk().mutate("xmc.contentTransfer.deleteContentTransfer", {
    params: {
      path: { transferId },
      query: { sitecoreContextId: contextOf(environment) },
    },
  });
  unwrapSdk(result);
}

export async function completeChunkSet(
  environment: EnvironmentConnection,
  transferId: string,
  chunksetId: string,
): Promise<CompleteChunkSetResult | null> {
  if (!isOrganizationEnvironment(environment)) {
    return callTransferApi<CompleteChunkSetResult>(
      environment,
      `/api/transfer/transfers/${encodeURIComponent(transferId)}/chunksets/${encodeURIComponent(chunksetId)}/complete`,
      { method: "POST" },
    );
  }
  const result = await sdk().mutate("xmc.contentTransfer.completeChunkSetTransfer", {
    params: {
      path: { transferId, chunksetId },
      query: { sitecoreContextId: contextOf(environment) },
    },
  });
  return unwrapSdk<CompleteChunkSetResult>(result);
}

async function sdkGetChunk(
  source: EnvironmentConnection,
  transferId: string,
  chunksetId: string,
  chunkId: number,
): Promise<Blob> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    if (attempt > 0) await sleep(CHUNK_RETRY_BASE_MS * 2 ** (attempt - 1));
    try {
      const result = await sdk().query("xmc.contentTransfer.getChunk", {
        params: {
          path: { transferId, chunksetId, chunkId },
          query: { sitecoreContextId: contextOf(source) },
        },
        timeoutMs: CHUNK_TIMEOUT_MS,
      });
      const blob = unwrapSdk<Blob>(result);
      if (blob instanceof Blob && blob.size > 0) return blob;
      lastError = new Error("The source returned an empty chunk.");
    } catch (error) {
      lastError = error;
    }
  }
  throw new SdkTransferError(
    `Could not retrieve chunk ${chunkId} from the source: ${describeSdkError(
      lastError instanceof Error ? lastError.message : lastError,
    )}`,
  );
}

async function sdkSaveChunk(
  destination: EnvironmentConnection,
  transferId: string,
  chunksetId: string,
  chunkId: number,
  body: Blob,
  isMedia: boolean,
): Promise<void> {
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    if (attempt > 0) await sleep(CHUNK_RETRY_BASE_MS * 2 ** (attempt - 1));
    try {
      // The raw Blob must be passed as-is (the SDK sends it as
      // application/octet-stream without serialization; an ArrayBuffer would
      // be JSON-serialized to {}). isMedia must always be sent explicitly —
      // omitting it makes the endpoint answer 405.
      const result = await sdk().mutate("xmc.contentTransfer.saveChunk", {
        params: {
          path: { transferId, chunksetId, chunkId },
          body,
          query: { sitecoreContextId: contextOf(destination), isMedia },
        },
        timeoutMs: CHUNK_TIMEOUT_MS,
      });
      unwrapSdk(result);
      return;
    } catch (error) {
      // 4xx responses are not transient — fail fast. Bridge/network errors
      // (no status) and 5xx are retried.
      const status = error instanceof SdkTransferError ? error.status : undefined;
      const retryable = status === undefined || status >= 500;
      if (!retryable || attempt === CHUNK_RETRIES) {
        const message = error instanceof Error ? error.message : describeSdkError(error);
        throw new SdkTransferError(
          status === 405
            ? `Saving chunk ${chunkId} returned 405 (isMedia=${isMedia}) — the destination rejected the chunk type.`
            : `Could not save chunk ${chunkId} to the destination: ${message}`,
          status,
          error,
        );
      }
    }
  }
}

/**
 * Copies one chunk source → destination, forwarding the bytes untouched.
 * Cross-org: the server-side copy route (bytes never reach the browser).
 * Organization: SDK getChunk → raw Blob → SDK saveChunk; `isMedia` must be
 * supplied by the caller (derived from the data tree paths).
 */
export async function copyChunkBetween(
  source: EnvironmentConnection,
  destination: EnvironmentConnection,
  transferId: string,
  chunksetId: string,
  chunkId: number,
  isMedia?: boolean,
): Promise<ChunkCopyResult> {
  const sourceOrg = isOrganizationEnvironment(source);
  if (sourceOrg !== isOrganizationEnvironment(destination)) {
    throw new Error(
      "The source and destination belong to different transfer modes — pick both environments in the same mode.",
    );
  }
  if (!sourceOrg) {
    return copyChunk(source, destination, transferId, chunksetId, chunkId);
  }
  if (isMedia === undefined) {
    throw new Error(
      "Unknown chunk type: Organization mode needs to know whether this transfer is media or content.",
    );
  }
  const blob = await sdkGetChunk(source, transferId, chunksetId, chunkId);
  await sdkSaveChunk(destination, transferId, chunksetId, chunkId, blob, isMedia);
  return {
    chunkId,
    isMedia,
    // The SDK does not expose the Content-Disposition item counters.
    itemsProcessed: 0,
    itemsSkipped: 0,
    bytes: blob.size,
  };
}

// ---------------------------------------------------------------------------
// Item Transfer API (the subset the SDK exposes)
// ---------------------------------------------------------------------------

/** consumeFile was called before the .raif finished assembling — retry. */
export class SourceNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceNotReadyError";
  }
}

/** Starts consuming a completed .raif blob into `database` on `environment`. */
export async function startConsume(
  environment: EnvironmentConnection,
  database: string,
  blobName: string,
): Promise<StartItemTransferResult | null> {
  if (!isOrganizationEnvironment(environment)) {
    return callTransferApi<StartItemTransferResult>(
      environment,
      `/api/item-transfer/databases/${encodeURIComponent(database)}/sources?blobName=${encodeURIComponent(blobName)}`,
      { method: "POST" },
    );
  }
  try {
    // consumeFile addresses blob sources with the blob:// scheme; every other
    // endpoint (getBlobState included) uses the raw name.
    const result = await sdk().query("xmc.contentTransfer.consumeFile", {
      params: {
        query: {
          databaseName: database,
          fileName: `blob://${blobName}`,
          sitecoreContextId: contextOf(environment),
        },
      },
    });
    unwrapSdk(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : describeSdkError(error);
    if (message.toLowerCase().includes("does not exist")) {
      throw new SourceNotReadyError(message);
    }
    throw error;
  }
  return { location: null, sourceName: blobName };
}

/** State of a .raif blob source (raw blob name, no scheme prefix). */
export async function getBlobSourceState(
  environment: EnvironmentConnection,
  blobName: string,
): Promise<BlobSourceState | null> {
  if (!isOrganizationEnvironment(environment)) {
    return callTransferApi<BlobSourceState>(
      environment,
      `/api/item-transfer/sources/blobs/${encodeURIComponent(blobName)}`,
    );
  }
  const result = await sdk().query("xmc.contentTransfer.getBlobState", {
    params: {
      query: { fileName: blobName, sitecoreContextId: contextOf(environment) },
    },
  });
  const data = unwrapSdk<{
    BlobState?: string;
    status?: string;
    Error?: string | null;
    details?: unknown;
    ConsumedName?: string | null;
  }>(result);
  if (!data) return null;
  const error =
    data.Error ?? (typeof data.details === "string" ? data.details : null);
  return {
    BlobState: (data.BlobState ?? data.status ?? "Unknown") as BlobState,
    Error: error,
    SourceName: data.ConsumedName || blobName,
    ConsumedName: data.ConsumedName ?? null,
  };
}

/**
 * Organization-mode consumption progress, derived from getBlobState (the SDK
 * has no Item Transfer list). Once the import worker picks a consumed source
 * up it renames the blob ("consumed.*"), so after a successful consumeFile a
 * BlobNotFound / populated ConsumedName / Consumed state means the import
 * ran; Transferred* states are final.
 */
export function blobStateToConsumption(
  state: BlobSourceState | null,
): { state: "InProgress" | "Finished" | "Failed"; detail?: string } {
  if (!state) return { state: "InProgress" };
  const error = state.Error ?? "";
  switch (state.BlobState as string) {
    case "Transferred":
    case "Consumed":
    case "Completed":
    case "OK":
      return { state: "Finished" };
    case "TransferredWithErrors":
      return { state: "Finished", detail: "Transferred with errors" };
    case "Error":
      if (error.includes("BlobNotFound")) return { state: "Finished" };
      return { state: "Failed", detail: error || "The blob reported an error." };
    case "Discarded":
      return { state: "Failed", detail: "The blob was discarded." };
    default:
      if (state.ConsumedName) return { state: "Finished" };
      return { state: "InProgress", detail: state.BlobState };
  }
}

// ---------------------------------------------------------------------------
// Content tree browsing (Authoring GraphQL)
// ---------------------------------------------------------------------------

const CHILDREN_QUERY = `
  query ItemChildren($path: String!, $database: String!, $language: String!) {
    item(where: { database: $database, path: $path, language: $language }) {
      itemId
      name
      path
      hasChildren
      children(first: 100) {
        nodes {
          itemId
          name
          path
          hasChildren
        }
      }
    }
  }
`;

interface GraphQLItem extends ContentTreeItem {
  children?: { nodes?: ContentTreeItem[] };
}

/** An item and its children, for the content tree picker. */
export async function fetchItemChildren(
  environment: EnvironmentConnection,
  path: string,
  database: string,
): Promise<ItemChildrenResult> {
  if (!isOrganizationEnvironment(environment)) {
    return callTransferApi<ItemChildrenResult>(
      environment,
      "/api/authoring/item-children",
      {
        method: "POST",
        body: JSON.stringify({ path, database }),
      },
    );
  }
  const response = await sdk().mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId: contextOf(environment) },
      body: {
        query: CHILDREN_QUERY,
        variables: { path, database, language: "en" },
      },
    },
  });
  const envelope = response as unknown as {
    error?: unknown;
    data?: {
      data?: { item?: GraphQLItem | null };
      errors?: { message?: string }[];
    };
  };
  if (envelope.error) {
    throw new SdkTransferError(describeSdkError(envelope.error));
  }
  if (envelope.data?.errors?.length) {
    throw new SdkTransferError(
      envelope.data.errors
        .map((e) => e.message)
        .filter(Boolean)
        .join("; "),
    );
  }
  const item = envelope.data?.data?.item ?? null;
  return item
    ? {
        item: {
          itemId: item.itemId,
          name: item.name,
          path: item.path,
          hasChildren: item.hasChildren,
        },
        children: item.children?.nodes ?? [],
      }
    : { item: null, children: [] };
}
