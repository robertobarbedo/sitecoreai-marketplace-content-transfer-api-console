"use client";

import type {
  ChunkCopyResult,
  EnvironmentConnection,
  TransferApiError,
} from "@/src/types/transfer";

/**
 * Error thrown by the client-side API wrapper. Carries the typed error code
 * returned by the app's own API routes so the UI can react (e.g. open the
 * connections modal on invalid_credentials).
 */
export class TransferApiClientError extends Error {
  constructor(
    public code: TransferApiError["error"],
    public status: number,
    public detail?: string,
  ) {
    super(detail || code);
    this.name = "TransferApiClientError";
  }
}

export function isInvalidCredentialsError(error: unknown): boolean {
  return (
    error instanceof TransferApiClientError &&
    error.code === "invalid_credentials"
  );
}

function environmentHeaders(
  connection: EnvironmentConnection,
  prefix: "" | "source" | "dest" = "",
): Record<string, string> {
  const p = prefix ? `x-ct-${prefix}-` : "x-ct-";
  return {
    [`${p}host`]: connection.host,
    [`${p}client-id`]: connection.clientId,
    [`${p}client-secret`]: connection.clientSecret,
  };
}

async function throwOnError(response: Response): Promise<void> {
  if (response.ok) return;
  let body: TransferApiError | null = null;
  try {
    body = (await response.json()) as TransferApiError;
  } catch {
    // Non-JSON error body
  }
  throw new TransferApiClientError(
    body?.error ?? "transfer_api_error",
    response.status,
    body?.detail,
  );
}

/**
 * Calls one of the app's own API routes against a single environment.
 * The connection is translated into headers; the server exchanges the
 * credentials for a token and proxies the call to the environment API.
 */
export async function callTransferApi<T>(
  connection: EnvironmentConnection,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...environmentHeaders(connection),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  await throwOnError(response);

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Copies one chunk from the source to the destination environment through
 * the app's server-side copy route (the binary payload never reaches the
 * browser).
 */
export async function copyChunk(
  source: EnvironmentConnection,
  destination: EnvironmentConnection,
  transferId: string,
  chunksetId: string,
  chunkId: number,
): Promise<ChunkCopyResult> {
  const response = await fetch(
    `/api/transfer/transfers/${encodeURIComponent(transferId)}/chunksets/${encodeURIComponent(chunksetId)}/chunks/${chunkId}/copy`,
    {
      method: "POST",
      headers: {
        ...environmentHeaders(source, "source"),
        ...environmentHeaders(destination, "dest"),
      },
    },
  );

  await throwOnError(response);
  return (await response.json()) as ChunkCopyResult;
}

/**
 * Validates a connection (host + credentials) against /api/transfer/validate
 * before it is committed to settings.
 */
export async function validateConnection(
  connection: EnvironmentConnection,
): Promise<
  { ok: true } | { ok: false; error: TransferApiError["error"]; detail?: string }
> {
  const response = await fetch("/api/transfer/validate", {
    method: "POST",
    headers: environmentHeaders(connection),
  });

  if (response.ok) {
    return { ok: true };
  }

  let body: TransferApiError | null = null;
  try {
    body = (await response.json()) as TransferApiError;
  } catch {
    // Non-JSON error body
  }

  return {
    ok: false,
    error: body?.error ?? "transfer_api_error",
    detail: body?.detail,
  };
}
