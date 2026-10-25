/**
 * Content Transfer Console constants
 */

/**
 * Sitecore database names
 */
export const SITECORE_DATABASES = {
  MASTER: "master",
} as const;

/**
 * Default language used for settings items
 */
export const DEFAULT_LANGUAGE = "en";

/**
 * Language type definition
 */
export type Language = string;

/**
 * Template and parent IDs (shared with the other marketplace modules)
 */
export const SITECORE_TEMPLATES = {
  MODULE_FOLDER: "{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}",
  SETTINGS_ITEM: "{D2923FEE-DA4E-49BE-830C-E27764DFA269}",
} as const;

export const MODULES_PARENT_ID = "{08477468-D438-43D4-9D6A-6D84A611971C}";

/**
 * Content tree paths where this app persists its settings
 */
export const SETTINGS_PATHS = {
  MARKETPLACE_FOLDER: "/sitecore/system/Modules/Marketplace",
  MODULE_FOLDER: "/sitecore/system/Modules/Marketplace/ContentTransferConsole",
  SETTINGS_ITEM:
    "/sitecore/system/Modules/Marketplace/ContentTransferConsole/Settings",
} as const;

/** Settings item location before the move under the Marketplace folder. */
export const LEGACY_SETTINGS_ITEM_PATH =
  "/sitecore/system/Modules/ContentTransferConsole/Settings";

export const MARKETPLACE_FOLDER_NAME = "Marketplace";
export const MODULE_FOLDER_NAME = "ContentTransferConsole";
export const SETTINGS_ITEM_NAME = "Settings";
