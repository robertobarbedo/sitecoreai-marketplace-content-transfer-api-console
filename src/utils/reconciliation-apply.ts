import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { DEFAULT_LANGUAGE } from "@/src/constants";
import {
  SHARED_VALUE_KEY,
  getItemWithFields,
  updateItemFields,
} from "@/src/utils/reconciliation";
import type {
  ReconciliationData,
  ReconciliationEnvironment,
} from "@/src/types/reconciliation";

/**
 * The apply engine shared by the Reconciliation tab's interactive view and
 * the saved-transfer "reconcile at the end" step: plan one row per stored
 * desired value, fetch the current values from the target environment, then
 * run the update batches. All functions mutate the passed rows in place so
 * callers can re-render incrementally.
 */

export type ApplyRowStatus =
  | "will-update"
  | "unchanged"
  | "item-missing"
  | "no-version"
  | "updated"
  | "failed";

export interface ApplyRow {
  key: string;
  itemId: string;
  itemPath: string;
  itemName: string;
  fieldId: string;
  fieldName: string;
  /** GraphQL language the update runs in. */
  language: string;
  /** Display key: language name, or "*" for shared fields. */
  valueKey: string;
  desired: string;
  current: string | null;
  status: ApplyRowStatus;
  error?: string;
}

/** tenantName key under which values for `env` are stored in the blob. */
function storedKeyFor(
  data: ReconciliationData,
  env: ReconciliationEnvironment,
): string {
  return (
    data.environments.find((e) => e.tenantId === env.tenantId)?.tenantName ??
    env.tenantName
  );
}

/** One row per stored desired value for the target environment. */
export function planApplyRows(
  data: ReconciliationData,
  env: ReconciliationEnvironment,
): ApplyRow[] {
  const valuesKey = storedKeyFor(data, env);
  const planned: ApplyRow[] = [];
  for (const item of data.items) {
    for (const field of item.fields) {
      const envValues = field.values[valuesKey] ?? {};
      const entries = field.shared
        ? envValues[SHARED_VALUE_KEY] !== undefined
          ? [[SHARED_VALUE_KEY, envValues[SHARED_VALUE_KEY]] as const]
          : []
        : Object.entries(envValues);
      for (const [valueKey, desired] of entries) {
        planned.push({
          key: `${item.itemId}|${field.fieldId}|${valueKey}`,
          itemId: item.itemId,
          itemPath: item.path,
          itemName: item.name,
          fieldId: field.fieldId,
          fieldName: field.name,
          language: valueKey === SHARED_VALUE_KEY ? DEFAULT_LANGUAGE : valueKey,
          valueKey,
          desired,
          current: null,
          status: "will-update",
        });
      }
    }
  }
  return planned;
}

/** Groups rows into one GraphQL round trip per (item, language). */
function groupRows(rows: ApplyRow[]): Map<string, ApplyRow[]> {
  const groups = new Map<string, ApplyRow[]>();
  for (const row of rows) {
    const groupKey = `${row.itemId}|${row.language}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), row]);
  }
  return groups;
}

/**
 * Fetches the current values per (item, language) from the target
 * environment, marking each row unchanged / will-update / item-missing /
 * no-version / failed in place.
 */
export async function fetchCurrentValues(
  client: ClientSDK,
  env: ReconciliationEnvironment,
  rows: ApplyRow[],
  onProgress?: (message: string) => void,
): Promise<void> {
  const groups = groupRows(rows);
  let done = 0;
  for (const [, groupRows] of groups) {
    const { itemId, language } = groupRows[0];
    onProgress?.(
      `Checking ${done + 1}/${groups.size}: ${groupRows[0].itemPath} (${language})`,
    );
    try {
      const item = await getItemWithFields(client, env.contextId, itemId, language);
      if (!item) {
        for (const row of groupRows) row.status = "item-missing";
      } else if (!item.versions?.length) {
        for (const row of groupRows) row.status = "no-version";
      } else {
        for (const row of groupRows) {
          const fieldNode =
            item.fields?.nodes?.find((f) => f.fieldId === row.fieldId) ??
            item.fields?.nodes?.find((f) => f.name === row.fieldName);
          row.current = fieldNode?.value ?? null;
          row.itemPath = item.path;
          row.status =
            row.current === row.desired ? "unchanged" : "will-update";
        }
      }
    } catch (error) {
      for (const row of groupRows) {
        row.status = "failed";
        row.error = `Fetch failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    done++;
  }
}

/**
 * Runs the update batches for the rows in will-update/failed status. The
 * version (and path) are re-fetched right before each mutation so retries
 * and slow previews never write against a stale version.
 */
export async function executeApplyRows(
  client: ClientSDK,
  env: ReconciliationEnvironment,
  rows: ApplyRow[],
  onProgress?: (message: string) => void,
  /** Called after each (item, language) batch — for incremental re-renders. */
  onBatchDone?: () => void,
): Promise<void> {
  const pending = rows.filter(
    (r) => r.status === "will-update" || r.status === "failed",
  );
  const groups = groupRows(pending);

  let done = 0;
  for (const [, groupRows] of groups) {
    const { itemId, language } = groupRows[0];
    onProgress?.(
      `Applying ${done + 1}/${groups.size}: ${groupRows[0].itemPath} (${language})`,
    );
    try {
      const item = await getItemWithFields(client, env.contextId, itemId, language);
      if (!item) {
        throw new Error("Item not found in the target environment");
      }
      const versions = (item.versions ?? []).map((v) => v.version);
      if (!versions.length) {
        throw new Error(`No version exists in language "${language}"`);
      }
      const updated = await updateItemFields(
        client,
        env.contextId,
        itemId,
        item.path,
        groupRows.map((r) => ({ name: r.fieldName, value: r.desired })),
        language,
        Math.max(...versions),
      );
      if (!updated) {
        throw new Error("updateItem returned no item");
      }
      for (const row of groupRows) {
        row.status = "updated";
        row.error = undefined;
      }
    } catch (error) {
      for (const row of groupRows) {
        row.status = "failed";
        row.error = error instanceof Error ? error.message : String(error);
      }
    }
    done++;
    onBatchDone?.();
  }
}
