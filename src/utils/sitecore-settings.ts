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

export async function loadConsoleSettings(
  client: ClientSDK,
  sitecoreContextId: string,
  language: Language = DEFAULT_LANGUAGE,
): Promise<ConsoleSettings> {
  try {
    const settingsItem = await queryItemByPath(
      client,
      sitecoreContextId,
      SETTINGS_PATHS.SETTINGS_ITEM,
      language,
    );

    if (settingsItem?.fields?.nodes) {
      const valueField = settingsItem.fields.nodes.find(
        (f) => f.name === "Value",
      );
      if (valueField?.value) {
        try {
          // Merge with defaults so newly added fields always have a fallback value
          const parsed = JSON.parse(valueField.value) as Partial<ConsoleSettings>;
          return {
            ...DEFAULT_SETTINGS,
            ...parsed,
            connections: Array.isArray(parsed.connections)
              ? parsed.connections
              : [],
          };
        } catch {
          return { ...DEFAULT_SETTINGS };
        }
      }
    }

    return { ...DEFAULT_SETTINGS };
  } catch (error) {
    console.error("Error loading console settings:", error);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveConsoleSettings(
  client: ClientSDK,
  sitecoreContextId: string,
  connections: EnvironmentConnection[],
  language: Language = DEFAULT_LANGUAGE,
): Promise<ConsoleSettings> {
  // 1. Ensure the module folder exists
  let moduleFolder = await queryItemByPath(
    client,
    sitecoreContextId,
    SETTINGS_PATHS.MODULE_FOLDER,
    language,
  );

  if (!moduleFolder) {
    moduleFolder = await createItem(
      client,
      sitecoreContextId,
      MODULES_PARENT_ID,
      SITECORE_TEMPLATES.MODULE_FOLDER,
      MODULE_FOLDER_NAME,
      language,
    );

    if (!moduleFolder) {
      throw new Error(`Failed to create ${MODULE_FOLDER_NAME} folder`);
    }
  }

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
