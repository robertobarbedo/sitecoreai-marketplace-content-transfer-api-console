"use client";

import { authedFetch } from "@/src/lib/marketplace-auth/authedFetch";
import type {
  ChunkCopyResult,
  EnvironmentConnection,
  TransferApiError,
} from "@/src/types/transfer";

/**
 * Error thrown by the client-side API wrapper. Carries the typed error code
 * returned by the app's own API routes so the UI can react (e.g. open the
 * settings dialog on invalid_credentials).
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
  const response = await authedFetch(path, {
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
  const response = await authedFetch(
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
  const response = await authedFetch("/api/transfer/validate", {
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

/** Reports whether the server has an encryption key (CT_ENCRYPTION_KEY). */
export async function getEncryptionStatus(): Promise<boolean> {
  try {
    const response = await authedFetch("/api/crypto/encrypt");
    if (!response.ok) return false;
    const body = (await response.json()) as { configured?: boolean };
    return body.configured === true;
  } catch {
    return false;
  }
}

/**
 * Encrypts a secret for one connection through the server's encrypt-only
 * route (there is no decrypt counterpart). Plaintext and older stored
 * formats come back in the current, connection-bound format; current values
 * come back unchanged. Throws (encryption_error) when the server has no key
 * — secrets are never stored unencrypted.
 */
export async function encryptSecretRemote(
  secret: string,
  host: string,
  clientId: string,
): Promise<string> {
  const response = await authedFetch("/api/crypto/encrypt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, host, clientId }),
  });
  await throwOnError(response);
  return ((await response.json()) as { value: string }).value;
}

/** Mirrors PREFIX in src/lib/transfer/crypto.ts. */
const ENCRYPTED_PREFIX = "enc:v2:";

/** True for values already in the current stored-ciphertext format. */
export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Returns the connections with every secret in the current encrypted format
 * (plaintext and older formats re-encrypted for their host + client ID).
 */
export async function sealConnections(
  connections: EnvironmentConnection[],
): Promise<EnvironmentConnection[]> {
  return Promise.all(
    connections.map(async (connection) =>
      isEncryptedSecret(connection.clientSecret)
        ? connection
        : {
            ...connection,
            clientSecret: await encryptSecretRemote(
              connection.clientSecret,
              connection.host,
              connection.clientId,
            ),
          },
    ),
  );
}
