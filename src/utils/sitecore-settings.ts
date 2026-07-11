import type { ClientSDK } from "@sitecore-marketplace-sdk/client";
import {
  queryItemByPath,
  createItem,
  updateItemFieldByPath,
} from "./sitecore-graphql";
import {
  SITECORE_TEMPLATES,
  MODULES_PARENT_ID,
  SETTINGS_PATHS,
  LEGACY_SETTINGS_ITEM_PATH,
  MARKETPLACE_FOLDER_NAME,
  MODULE_FOLDER_NAME,
  SETTINGS_ITEM_NAME,
  DEFAULT_LANGUAGE,
  type Language,
} from "@/src/constants";
import type { EnvironmentConnection } from "@/src/types/transfer";

/**
 * Settings persisted in the content tree of the app's context environment:
 * the list of environment connections (host + automation client credentials)
 * the console can transfer between.
 */
export interface ConsoleSettings {
  version: number;
  connections: EnvironmentConnection[];
  updatedAt: string;
}

const DEFAULT_SETTINGS: ConsoleSettings = {
  version: 1,
  connections: [],
  updatedAt: "",
};

/** Reads and parses the settings item at `path`; null if absent/unparsable. */
async function readSettingsItem(
  client: ClientSDK,
  sitecoreContextId: string,
  path: string,
  language: Language,
): Promise<ConsoleSettings | null> {
  const settingsItem = await queryItemByPath(
    client,
    sitecoreContextId,
    path,
    language,
  );

  const valueField = settingsItem?.fields?.nodes?.find(
    (f) => f.name === "Value",
  );
  if (!valueField?.value) return null;

  try {
    // Merge with defaults so newly added fields always have a fallback value
    const parsed = JSON.parse(valueField.value) as Partial<ConsoleSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
    };
  } catch {
    return null;
  }
}

export async function loadConsoleSettings(
  client: ClientSDK,
  sitecoreContextId: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<ConsoleSettings> {
  try {
    // Settings moved under /sitecore/system/Modules/Marketplace; fall back to
    // the legacy location so existing installs keep their connections. The
    // next save writes to the new path.
    return (
      (await readSettingsItem(
        client,
        sitecoreContextId,
        SETTINGS_PATHS.SETTINGS_ITEM,
        language,
      )) ??
      (await readSettingsItem(
        client,
        sitecoreContextId,
        LEGACY_SETTINGS_ITEM_PATH,
        language,
      )) ?? { ...DEFAULT_SETTINGS }
    );
  } catch (error) {
    console.error("Error loading console settings:", error);
    return { ...DEFAULT_SETTINGS };
  }
}

/** Ensures a folder item exists, creating it under `parentId` if missing. */
async function ensureFolder(
  client: ClientSDK,
  sitecoreContextId: string,
  path: string,
  parentId: string,
  name: string,
  language: Language,
) {
  const existing = await queryItemByPath(
    client,
    sitecoreContextId,
    path,
    language,
  );
  if (existing) return existing;

  const created = await createItem(
    client,
    sitecoreContextId,
    parentId,
    SITECORE_TEMPLATES.MODULE_FOLDER,
    name,
    language,
  );
  if (!created) {
    throw new Error(`Failed to create ${name} folder`);
  }
  return created;
}

export async function saveConsoleSettings(
  client: ClientSDK,
  sitecoreContextId: string,
  connections: EnvironmentConnection[],
  language: Language = DEFAULT_LANGUAGE,
): Promise<ConsoleSettings> {
  // 1. Ensure /sitecore/system/Modules/Marketplace/ContentTransferConsole
  const marketplaceFolder = await ensureFolder(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.MARKETPLACE_FOLDER,
    MODULES_PARENT_ID,
    MARKETPLACE_FOLDER_NAME,
    language,
  );
  const moduleFolder = await ensureFolder(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.MODULE_FOLDER,
    marketplaceFolder.itemId,
    MODULE_FOLDER_NAME,
    language,
  );

  // 2. Ensure the Settings item exists
  let settingsItem = await queryItemByPath(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.SETTINGS_ITEM,
    language,
  );

  if (!settingsItem) {
    settingsItem = await createItem(
      client,
      sitecoreContextId,
      moduleFolder.itemId,
      SITECORE_TEMPLATES.SETTINGS_ITEM,
      SETTINGS_ITEM_NAME,
      language,
    );

    if (!settingsItem) {
      throw new Error("Failed to create Settings item");
    }
  }

  // 3. Update the Value field with the settings JSON
  const value: ConsoleSettings = {
    version: 1,
    connections,
    updatedAt: new Date().toISOString(),
  };

  await updateItemFieldByPath(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.SETTINGS_ITEM,
    "Value",
    JSON.stringify(value),
    language,
  );

  return value;
}
