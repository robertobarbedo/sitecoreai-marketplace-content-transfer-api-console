"use client";

import type { DataTree } from "@/src/types/transfer";

/**
 * A content transfer operation created (or attached) through this console.
 * Kept in localStorage so users can return to an in-flight migration; the
 * authoritative state always comes from the APIs.
 */
export interface RecentTransfer {
  transferId: string;
  createdAt: string;
  database: string;
  sourceConnectionId: string;
  destinationConnectionId: string;
  sourceLabel: string;
  destinationLabel: string;
  dataTrees: DataTree[];
  /** .raif file names returned by completed chunk sets, keyed by ChunkSetId. */
  raifFiles?: Record<string, string>;
}

const STORAGE_KEY = "content-transfer-console.recent-transfers";
const MAX_ENTRIES = 20;

export function loadRecentTransfers(): RecentTransfer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentTransfer[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(transfers: RecentTransfer[]): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(transfers.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Quota / privacy-mode failures are non-fatal: the list is a convenience.
  }
}

export function upsertRecentTransfer(entry: RecentTransfer): RecentTransfer[] {
  const transfers = loadRecentTransfers().filter(
    (t) => t.transferId !== entry.transferId,
  );
  transfers.unshift(entry);
  persist(transfers);
  return transfers;
}

export function recordRaifFile(
  transferId: string,
  chunksetId: string,
  fileName: string,
): RecentTransfer[] {
  const transfers = loadRecentTransfers();
  const entry = transfers.find((t) => t.transferId === transferId);
  if (entry) {
    entry.raifFiles = { ...entry.raifFiles, [chunksetId]: fileName };
    persist(transfers);
  }
  return transfers;
}

export function removeRecentTransfer(transferId: string): RecentTransfer[] {
  const transfers = loadRecentTransfers().filter(
    (t) => t.transferId !== transferId,
  );
  persist(transfers);
  return transfers;
}
