"use client";

/**
 * Backups made in this browser — a localStorage convenience only (the ZIP the
 * user saved is the backup; nothing is stored server-side).
 */
export interface RecentBackup {
  fileName: string;
  label: string;
  createdAt: string;
  sourceLabel: string;
  paths: string[];
  sizeBytes: number;
  items: number;
}

const STORAGE_KEY = "content-transfer-console.recent-backups";
const MAX_ENTRIES = 10;

export function loadRecentBackups(): RecentBackup[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as RecentBackup[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordRecentBackup(entry: RecentBackup): RecentBackup[] {
  const next = [
    entry,
    ...loadRecentBackups().filter((b) => b.fileName !== entry.fileName),
  ].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / privacy mode — the list is a convenience.
  }
  return next;
}
