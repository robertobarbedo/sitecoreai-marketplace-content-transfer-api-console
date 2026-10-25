/**
 * Types mirrored from the Content Reconciliation marketplace app
 * (sitecoreai-marketplace-content-reconciliation). The Reconciliation tab
 * reads the JSON blob that app stores in the `Value` field of the `Data`
 * item under /sitecore/system/Modules/Marketplace/ContentReconciliation in
 * the base environment — keep these shapes in sync with that app.
 */

export interface EnvironmentRef {
  tenantId: string;
  tenantName: string;
  tenantDisplayName?: string;
}

/** A live environment resolved from application.context. */
export interface ReconciliationEnvironment extends EnvironmentRef {
  /** sitecoreContextId (context.preview) for authoring GraphQL calls. */
  contextId: string;
}

export interface TrackedField {
  /** Field-definition item id. */
  fieldId: string;
  name: string;
  /** Shared fields store a single value under SHARED_VALUE_KEY ("*"). */
  shared: boolean;
  isSystem: boolean;
  /**
   * Desired values. Outer key: tenantName; inner key: language name, or
   * SHARED_VALUE_KEY ("*") when shared === true. A missing inner key means
   * "no desired value" (Apply skips it); an empty string means "clear the
   * field".
   */
  values: Record<string, Record<string, string>>;
}

export interface TrackedItem {
  /** Item GUID as returned by GraphQL — stable across environments. */
  itemId: string;
  /** Base-environment path at track time (display only). */
  path: string;
  name: string;
  fields: TrackedField[];
}

export interface ReconciliationData {
  version: 1;
  /** ISO timestamp of the last save. */
  updatedAt: string;
  baseEnvironment: EnvironmentRef;
  /** Snapshot of known environments at last save (rename resolution). */
  environments: EnvironmentRef[];
  items: TrackedItem[];
}

/** JSON stored in the Value field of the Base/Secondary marker items. */
export interface MarkerData {
  tenantId: string;
  tenantName: string;
  createdAt: string;
}
