import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import {
  SITECORE_DATABASES,
  DEFAULT_LANGUAGE,
  type Language,
} from "@/src/constants";
import type { TenantInfo } from "@/src/types/transfer";

export interface SitecoreItem {
  itemId: string;
  name: string;
  path: string;
  fields?: { nodes: { name: string; value: string }[] };
}

function escapeGraphQL(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Lists the tenants this (standalone, hence org-global) app has access to —
 * one resourceAccess entry per tenant, each carrying the sitecoreContextId
 * its authoring GraphQL expects. The user picks which tenant's content tree
 * stores the console settings.
 */
export async function getTenants(client: ClientSDK): Promise<TenantInfo[]> {
  const contextResponse = await client.query("application.context");
  const appContext = contextResponse.data as Record<string, unknown>;
  const resourceAccess = appContext?.resourceAccess as
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
      label:
        resource.tenantDisplayName ||
        resource.tenantName ||
        resource.tenantId ||
        `Environment ${index + 1}`,
      contextId: resource.context?.preview ?? "",
    }));
}

export async function queryItemByPath(
  client: ClientSDK,
  sitecoreContextId: string,
  path: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<SitecoreItem | null> {
  const response = await client.mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId },
      body: {
        query: `
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
      },
    },
  });

  return (response as Record<string, unknown> & { data?: { data?: { item?: SitecoreItem } } })
    .data?.data?.item ?? null;
}

export async function createItem(
  client: ClientSDK,
  sitecoreContextId: string,
  parentId: string,
  templateId: string,
  itemName: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<SitecoreItem | null> {
  const response = await client.mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId },
      body: {
        query: `
          mutation {
            createItem(input: {
              database: "${SITECORE_DATABASES.MASTER}"
              name: "${escapeGraphQL(itemName)}"
              parent: "${escapeGraphQL(parentId)}"
              templateId: "${escapeGraphQL(templateId)}"
              language: "${escapeGraphQL(language)}"
            }) {
              item {
                itemId
                name
                path
                fields(ownFields: true, excludeStandardFields: true) {
                  nodes { name value }
                }
              }
            }
          }
        `,
      },
    },
  });

  type CreateResponse = Record<string, unknown> & {
    data?: { data?: { createItem?: { item?: SitecoreItem } } };
  };

  return (response as CreateResponse).data?.data?.createItem?.item ?? null;
}

export async function updateItemField(
  client: ClientSDK,
  sitecoreContextId: string,
  itemId: string,
  itemPath: string,
  fieldName: string,
  fieldValue: string,
  language: Language = DEFAULT_LANGUAGE,
  version: number = 1,
): Promise<SitecoreItem | null> {
  const response = await client.mutate("xmc.authoring.graphql", {
    params: {
      query: { sitecoreContextId },
      body: {
        query: `
          mutation {
            updateItem(input: {
              fields: [
                {
                  name: "${escapeGraphQL(fieldName)}",
                  value: "${escapeGraphQL(fieldValue)}",
                  reset: false
                }
              ]
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
      },
    },
  });

  type UpdateResponse = Record<string, unknown> & {
    data?: {
      data?: {
        updateItem?: { item?: SitecoreItem };
      };
    };
  };

  return (response as UpdateResponse).data?.data?.updateItem?.item ?? null;
}

export async function updateItemFieldByPath(
  client: ClientSDK,
  sitecoreContextId: string,
  itemPath: string,
  fieldName: string,
  fieldValue: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<SitecoreItem | null> {
  // First get the item to retrieve its ID and version
  const item = await queryItemByPath(client, sitecoreContextId, itemPath, language);

  if (!item) {
    return null;
  }

  // Then use the existing updateItemField function
  return await updateItemField(
    client,
    sitecoreContextId,
    item.itemId,
    itemPath,
    fieldName,
    fieldValue,
    language,
    1
  );
}
