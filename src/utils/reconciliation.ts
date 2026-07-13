import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import { SITECORE_DATABASES, DEFAULT_LANGUAGE, type Language } from "@/src/constants";
import type {
  ReconciliationData,
  ReconciliationEnvironment,
} from "@/src/types/reconciliation";

/**
 * Read-only integration with the Content Reconciliation marketplace app: the
 * Reconciliation tab detects that app's marker items, loads its stored data
 * blob and applies desired values — it never creates or repairs the storage
 * items (that is the Content Reconciliation app's job).
 */

export const RECONCILIATION_PATHS = {
  MODULE_FOLDER: "/sitecore/system/Modules/Marketplace/ContentReconciliation",
  BASE_MARKER: "/sitecore/system/Modules/Marketplace/ContentReconciliation/Base",
  SECONDARY_MARKER:
    "/sitecore/system/Modules/Marketplace/ContentReconciliation/Secondary",
  DATA_ITEM: "/sitecore/system/Modules/Marketplace/ContentReconciliation/Data",
} as const;

/**
 * Inner key used in TrackedField.values for shared fields, whose single value
 * applies to every language.
 */
export const SHARED_VALUE_KEY = "*";

// ---------------------------------------------------------------------------
// Authoring GraphQL (mirrored from the Content Reconciliation app)
// ---------------------------------------------------------------------------

export interface FieldNode {
  name: string;
  fieldId?: string;
  value: string;
}

export interface ReconciliationSitecoreItem {
  itemId: string;
  name: string;
  path: string;
  fields?: { nodes: FieldNode[] };
}

export interface ItemWithFields extends ReconciliationSitecoreItem {
  version?: number;
  versions?: { version: number }[];
}

/**
 * Desired values are arbitrary user input (multi-line, quotes, tabs), so
 * unlike the console's settings escaping, control characters must be escaped
 * too — same as the Content Reconciliation app.
 */
function escapeGraphQL(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Runs an authoring GraphQL document against the environment identified by
 * `sitecoreContextId`. Throws when the response carries GraphQL errors —
 * marker detection must distinguish "item missing" from "query failed".
 */
async function runAuthoring<T>(
  client: ClientSDK,
  sitecoreContextId: string,
  query: string,
): Promise<T> {
  const response = await client.mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId },
      body: { query },
    },
  });

  const payload = (
    response as Record<string, unknown> & {
      data?: { data?: T; errors?: { message?: string }[] };
    }
  ).data;

  if (payload?.errors?.length) {
    throw new Error(
      payload.errors.map((e) => e.message ?? "Unknown GraphQL error").join("; "),
    );
  }
  if (payload?.data === undefined || payload?.data === null) {
    throw new Error("Empty GraphQL response");
  }
  return payload.data;
}

async function queryItemByPath(
  client: ClientSDK,
  sitecoreContextId: string,
  path: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<ReconciliationSitecoreItem | null> {
  const data = await runAuthoring<{ item: ReconciliationSitecoreItem | null }>(
    client,
    sitecoreContextId,
    `
      query {
        item(where: { database: "${SITECORE_DATABASES.MASTER}", path: "${escapeGraphQL(path)}", language: "${escapeGraphQL(language)}" }) {
          itemId
          name
          path
          fields(ownFields: true, excludeStandardFields: true) {
            nodes { name value }
          }
        }
      }
    `,
  );
  return data.item ?? null;
}

/**
 * Full item read used by the Apply preview/execute: every field plus the
 * version list of the requested language.
 */
export async function getItemWithFields(
  client: ClientSDK,
  sitecoreContextId: string,
  itemId: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<ItemWithFields | null> {
  const data = await runAuthoring<{ item: ItemWithFields | null }>(
    client,
    sitecoreContextId,
    `
      query {
        item(where: { database: "${SITECORE_DATABASES.MASTER}", itemId: "${escapeGraphQL(itemId)}", language: "${escapeGraphQL(language)}" }) {
          itemId
          name
          path
          version
          versions {
            version
          }
          fields(ownFields: false, excludeStandardFields: false) {
            nodes { name fieldId value }
          }
        }
      }
    `,
  );
  return data.item ?? null;
}

/** Batched updateItem — one mutation per item per language. */
export async function updateItemFields(
  client: ClientSDK,
  sitecoreContextId: string,
  itemId: string,
  itemPath: string,
  fields: { name: string; value: string }[],
  language: Language,
  version: number,
): Promise<ReconciliationSitecoreItem | null> {
  const fieldEntries = fields
    .map(
      (f) => `
        {
          name: "${escapeGraphQL(f.name)}",
          value: "${escapeGraphQL(f.value)}",
          reset: false
        }`,
    )
    .join(",");

  const data = await runAuthoring<{
    updateItem: { item: ReconciliationSitecoreItem | null } | null;
  }>(
    client,
    sitecoreContextId,
    `
      mutation {
        updateItem(input: {
          fields: [${fieldEntries}]
          database: "${SITECORE_DATABASES.MASTER}"
          itemId: "${escapeGraphQL(itemId)}"
          language: "${escapeGraphQL(language)}"
          path: "${escapeGraphQL(itemPath)}"
          version: ${version}
        }) {
          item {
            name
            itemId
            fields(ownFields: true, excludeStandardFields: true) {
              nodes { name value }
            }
          }
        }
      }
    `,
  );
  return data.updateItem?.item ?? null;
}

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

/**
 * Lists the environments this app has access to, keeping the raw tenantName —
 * the reconciliation blob keys desired values by tenantName, so the console's
 * TenantInfo (which collapses names into a display label) is not enough here.
 */
export async function getReconciliationEnvironments(
  client: ClientSDK,
): Promise<ReconciliationEnvironment[]> {
  const contextResponse = await client.query("application.context");
  const appContext = contextResponse.data as Record<string, unknown> | undefined;
  const resourceAccess = (appContext?.resourceAccess ?? appContext?.resources) as
    | Array<{
        tenantId?: string;
        tenantName?: string;
        tenantDisplayName?: string;
        context?: { preview?: string };
      }>
    | undefined;

  return (resourceAccess ?? [])
    .filter((resource) => resource.context?.preview)
    .map((resource, index) => ({
      tenantId: resource.tenantId ?? resource.context?.preview ?? String(index),
      tenantName:
        resource.tenantName ?? resource.tenantId ?? `environment-${index + 1}`,
      tenantDisplayName: resource.tenantDisplayName,
      contextId: resource.context?.preview ?? "",
    }));
}

export function environmentLabel(env: {
  tenantDisplayName?: string;
  tenantName: string;
}): string {
  return env.tenantDisplayName || env.tenantName;
}

// ---------------------------------------------------------------------------
// Marker detection
// ---------------------------------------------------------------------------

export interface EnvironmentMarkerStatus {
  env: ReconciliationEnvironment;
  hasBase: boolean;
  hasSecondary: boolean;
  /** Set when the detection queries against this environment failed. */
  error?: string;
}

/**
 * Queries every environment for the Base/Secondary marker items the Content
 * Reconciliation app creates during its setup.
 */
export async function detectReconciliationMarkers(
  client: ClientSDK,
  environments: ReconciliationEnvironment[],
): Promise<EnvironmentMarkerStatus[]> {
  return Promise.all(
    environments.map(async (env): Promise<EnvironmentMarkerStatus> => {
      try {
        const [baseItem, secondaryItem] = await Promise.all([
          queryItemByPath(client, env.contextId, RECONCILIATION_PATHS.BASE_MARKER),
          queryItemByPath(
            client,
            env.contextId,
            RECONCILIATION_PATHS.SECONDARY_MARKER,
          ),
        ]);
        return { env, hasBase: !!baseItem, hasSecondary: !!secondaryItem };
      } catch (error) {
        return {
          env,
          hasBase: false,
          hasSecondary: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

/**
 * Quick readiness probe: true when every environment carries a marker item
 * and exactly one Base exists — the same gate the Reconciliation tab
 * enforces before offering the apply view.
 */
export async function isReconciliationReady(client: ClientSDK): Promise<boolean> {
  const envs = await getReconciliationEnvironments(client);
  if (envs.length === 0) return false;
  const statuses = await detectReconciliationMarkers(client, envs);
  const bases = statuses.filter((s) => s.hasBase);
  const notReady = statuses.some(
    (s) => s.error || (!s.hasBase && !s.hasSecondary),
  );
  return !notReady && bases.length === 1;
}

// ---------------------------------------------------------------------------
// Data load
// ---------------------------------------------------------------------------

export type ReconciliationLoadResult =
  | { ok: true; data: ReconciliationData }
  | { ok: false; error: string };

/**
 * Loads the reconciliation blob from the base environment's Data item. A
 * missing Data item (or empty Value) yields an empty dataset; an unparsable
 * blob is an error — repairing it is the Content Reconciliation app's job.
 */
export async function loadReconciliationData(
  client: ClientSDK,
  baseEnv: ReconciliationEnvironment,
  allEnvironments: ReconciliationEnvironment[],
): Promise<ReconciliationLoadResult> {
  const dataItem = await queryItemByPath(
    client,
    baseEnv.contextId,
    RECONCILIATION_PATHS.DATA_ITEM,
  );
  const raw =
    dataItem?.fields?.nodes?.find((f) => f.name === "Value")?.value || null;

  const fallback: ReconciliationData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    baseEnvironment: {
      tenantId: baseEnv.tenantId,
      tenantName: baseEnv.tenantName,
      tenantDisplayName: baseEnv.tenantDisplayName,
    },
    environments: allEnvironments.map((e) => ({
      tenantId: e.tenantId,
      tenantName: e.tenantName,
      tenantDisplayName: e.tenantDisplayName,
    })),
    items: [],
  };

  if (!raw) {
    return { ok: true, data: fallback };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReconciliationData>;
    return {
      ok: true,
      data: {
        ...fallback,
        ...parsed,
        version: 1,
        baseEnvironment: parsed.baseEnvironment ?? fallback.baseEnvironment,
        environments: Array.isArray(parsed.environments)
          ? parsed.environments
          : fallback.environments,
        items: Array.isArray(parsed.items) ? parsed.items : [],
      },
    };
  } catch {
    return {
      ok: false,
      error:
        "The reconciliation data stored in the base environment could not be parsed. Open the Content Reconciliation app to inspect and repair it.",
    };
  }
}
