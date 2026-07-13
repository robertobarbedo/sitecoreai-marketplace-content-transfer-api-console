import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import {
  queryItemByPath,
  createItem,
  updateItemFieldByPath,
} from "./sitecore-graphql";
import { ensureFolder } from "./sitecore-settings";
import {
  SITECORE_TEMPLATES,
  MODULES_PARENT_ID,
  SETTINGS_PATHS,
  MARKETPLACE_FOLDER_NAME,
  MODULE_FOLDER_NAME,
  DEFAULT_LANGUAGE,
} from "@/src/constants";
import type { SavedTransfer, TenantInfo } from "@/src/types/transfer";

/**
 * Saved transfers live next to the connection settings, as one JSON list in
 * the Value field of the SavedTransfers item. Saves always target the FIRST
 * tenant in the resource list; loads merge the item from every tenant (a
 * tenant that was first in the past may still hold entries), deduped by id
 * with earlier tenants winning — so after the next save the first tenant's
 * copy is authoritative again.
 */

export const SAVED_TRANSFERS_ITEM_NAME = "SavedTransfers";
export const SAVED_TRANSFERS_ITEM_PATH = `${SETTINGS_PATHS.MODULE_FOLDER}/${SAVED_TRANSFERS_ITEM_NAME}`;

interface SavedTransfersBlob {
  version: 1;
  transfers: SavedTransfer[];
  updatedAt: string;
}

function parseBlob(raw: string | undefined): SavedTransfer[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<SavedTransfersBlob>;
    return Array.isArray(parsed.transfers) ? parsed.transfers : [];
  } catch {
    return [];
  }
}

export interface SavedTransfersLoadResult {
  transfers: SavedTransfer[];
  /** Labels of tenants whose SavedTransfers item could not be read. */
  failedTenants: string[];
}

/** Reads the SavedTransfers item of every tenant and merges the lists. */
export async function loadSavedTransfers(
  client: ClientSDK,
  tenants: TenantInfo[],
): Promise<SavedTransfersLoadResult> {
  const results = await Promise.allSettled(
    tenants.map(async (tenant) => {
      const item = await queryItemByPath(
        client,
        tenant.contextId,
        SAVED_TRANSFERS_ITEM_PATH,
      );
      const valueField = item?.fields?.nodes?.find((f) => f.name === "Value");
      return parseBlob(valueField?.value);
    }),
  );

  const seen = new Set<string>();
  const merged: SavedTransfer[] = [];
  const failedTenants: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failedTenants.push(tenants[index].label);
      return;
    }
    for (const transfer of result.value) {
      if (!transfer?.id || seen.has(transfer.id)) continue;
      seen.add(transfer.id);
      merged.push(transfer);
    }
  });
  return { transfers: merged, failedTenants };
}

/** Persists the full list to the given tenant (callers pass tenants[0]). */
export async function saveSavedTransfers(
  client: ClientSDK,
  tenant: TenantInfo,
  transfers: SavedTransfer[],
): Promise<void> {
  const marketplaceFolder = await ensureFolder(
    client,
    tenant.contextId,
    SETTINGS_PATHS.MARKETPLACE_FOLDER,
    MODULES_PARENT_ID,
    MARKETPLACE_FOLDER_NAME,
    DEFAULT_LANGUAGE,
  );
  const moduleFolder = await ensureFolder(
    client,
    tenant.contextId,
    SETTINGS_PATHS.MODULE_FOLDER,
    marketplaceFolder.itemId,
    MODULE_FOLDER_NAME,
    DEFAULT_LANGUAGE,
  );

  let item = await queryItemByPath(
    client,
    tenant.contextId,
    SAVED_TRANSFERS_ITEM_PATH,
  );
  if (!item) {
    item = await createItem(
      client,
      tenant.contextId,
      moduleFolder.itemId,
      SITECORE_TEMPLATES.SETTINGS_ITEM,
      SAVED_TRANSFERS_ITEM_NAME,
    );
    if (!item) {
      throw new Error("Failed to create the SavedTransfers item");
    }
  }

  const blob: SavedTransfersBlob = {
    version: 1,
    transfers,
    updatedAt: new Date().toISOString(),
  };
  const updated = await updateItemFieldByPath(
    client,
    tenant.contextId,
    SAVED_TRANSFERS_ITEM_PATH,
    "Value",
    JSON.stringify(blob),
  );
  if (!updated) {
    throw new Error("Failed to write the SavedTransfers item");
  }
}
