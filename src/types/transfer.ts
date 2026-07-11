/**
 * Shared types for the Content Transfer API (v1) and Item Transfer API (v3).
 * Used by both the API route handlers and the client components.
 */

// ---------------------------------------------------------------------------
// Marketplace tenants (standalone extension: the app is global, so the user
// picks which tenant's content tree stores the settings)
// ---------------------------------------------------------------------------

export interface TenantInfo {
  tenantId: string;
  /** Display label shown on the tenant buttons. */
  label: string;
  /** sitecoreContextId used by the authoring GraphQL for this tenant. */
  contextId: string;
}

// ---------------------------------------------------------------------------
// Environment connections (stored in the content tree, selected in the UI)
// ---------------------------------------------------------------------------

export interface EnvironmentConnection {
  /** Stable identifier generated when the connection is created. */
  id: string;
  /** Display label, e.g. "Prod EU" */
  label: string;
  /** Environment host name, e.g. "my-env.sitecorecloud.io" (no protocol). */
  host: string;
  /** Automation client credentials created in SitecoreAI Deploy. */
  clientId: string;
  clientSecret: string;
}

// ---------------------------------------------------------------------------
// Content Transfer API (source → destination chunk streaming)
// ---------------------------------------------------------------------------

export type DataTreeScope = "SingleItem" | "ItemAndDescendants";

export type MergeStrategy =
  | "OverrideExistingItem"
  | "KeepExistingItem"
  | "LatestWin"
  | "OverrideExistingTree";

export interface DataTree {
  ItemPath: string;
  Scope: DataTreeScope;
  MergeStrategy: MergeStrategy;
}

export interface CreateTransferInput {
  TransferId: string;
  Configuration: {
    Database: string;
    DataTrees: DataTree[];
  };
}

export type ContentTransferState =
  | "Running"
  | "Completed"
  | "Failed"
  | "NotFound";

export interface ChunkSetMetadata {
  ChunkSetId: string;
  ChunkCount: number;
  TotalItemCount: number;
}

export interface ContentTransferStatus {
  State: ContentTransferState;
  ChunkSetsMetadata: ChunkSetMetadata[];
}

/** Result of the app's server-side chunk copy (GET source → PUT destination). */
export interface ChunkCopyResult {
  chunkId: number;
  isMedia: boolean;
  itemsProcessed: number;
  itemsSkipped: number;
  /** Bytes forwarded to the destination. */
  bytes: number;
}

export interface CompleteChunkSetResult {
  ContentTransferFileName: string;
}

// ---------------------------------------------------------------------------
// Item Transfer API (destination-only: consume .raif sources)
// ---------------------------------------------------------------------------

export type ItemTransferState =
  | "Unknown"
  | "InProgress"
  | "Finished"
  | "Failed"
  | "Queued"
  | "Discarded";

export type BlobState =
  | "Unknown"
  | "Uploading"
  | "Uploaded"
  | "Initializing"
  | "Error"
  | "Consumed"
  | "Transferred"
  | "TransferredWithErrors"
  | "Queued"
  | "Discarded";

export interface ItemTransferEntry {
  Id: string;
  SourceName: string;
  DatabaseName: string;
  ConsumedDate?: string;
  TransferState: ItemTransferState;
  Strategy?: MergeStrategy;
  Description?: string;
}

export interface ItemTransferDetails extends ItemTransferEntry {
  TotalItemsCount?: number;
  TransferredItemsCount?: number;
  ValidationErrors?: string[] | null;
  SourcesCount?: number;
}

export interface ItemTransfersPage {
  Page: number;
  PageSize: number;
  TotalCount: number;
  Transfers: ItemTransferEntry[];
}

export interface StartItemTransferResult {
  /** Value of the upstream `location` header. */
  location: string | null;
  /** Final path segment of the location URL (blob/file name = transfer id). */
  sourceName: string | null;
}

export interface RetryItemTransferResult {
  DatabaseName: string;
  SourceName: string;
}

export interface TransferredItem {
  Id: string;
  Name: string;
  ParentId?: string;
  TemplateId?: string;
  MasterId?: string;
  IsTransferred: boolean;
  TimeStamp?: number;
  TimeStampDate?: string;
  SourceName?: string;
}

export interface TransferredItemsPage {
  Page: number;
  PageSize: number;
  TotalCount: number;
  Items: TransferredItem[];
}

/** Per-item detail shape is not fully documented; render defensively. */
export type TransferredItemDetails = Record<string, unknown>;

export interface BlobSource {
  Name: string;
  BlobState: BlobState;
}

export interface BlobSourcesPage {
  Page: number;
  PageSize: number;
  TotalCount: number;
  Sources: BlobSource[];
}

export interface BlobSourceState {
  BlobState: BlobState;
  Error?: string | null;
  SourceName: string;
}

export interface FileSourcesPage {
  Page?: number;
  PageSize?: number;
  TotalCount?: number;
  Sources?: unknown[];
  [key: string]: unknown;
}

export interface HistoryEvent {
  Name: ItemTransferState;
  Date: string;
}

export interface HistoryEntry {
  Name: string;
  SourceName: string;
  ConsumeDate?: string;
  Strategy?: MergeStrategy;
  Events?: HistoryEvent[];
}

export interface HistoryPage {
  Page: number;
  PageSize: number;
  TotalCount: number;
  Sources: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Content tree browsing (Authoring GraphQL on the source environment)
// ---------------------------------------------------------------------------

export interface ContentTreeItem {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
}

export interface ItemChildrenResult {
  item: ContentTreeItem | null;
  children: ContentTreeItem[];
}

// ---------------------------------------------------------------------------
// Typed error shape returned by this app's own API routes
// ---------------------------------------------------------------------------

export interface TransferApiError {
  error:
    | "missing_credentials"
    | "invalid_credentials"
    | "validation"
    | "transfer_api_error"
    | "upstream_unreachable"
    | "encryption_error";
  status?: number;
  field?: string;
  detail?: string;
}
