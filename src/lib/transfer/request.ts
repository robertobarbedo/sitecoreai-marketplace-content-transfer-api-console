import { NextResponse } from "next/server";
import type { TransferApiError } from "@/src/types/transfer";
import {
  InvalidCredentialsError,
  TransferApiRequestError,
  UpstreamUnreachableError,
  isValidHost,
  readTransferResponse,
  transferFetch,
  type TransferEnvironment,
} from "./client";

/**
 * Header names carrying the target environment for a proxied call. Routes
 * that operate on a single environment read the unprefixed set; the chunk
 * copy route reads both the source and destination sets.
 */
export const ENV_HEADERS = {
  host: "x-ct-host",
  clientId: "x-ct-client-id",
  clientSecret: "x-ct-client-secret",
} as const;

export const SOURCE_ENV_HEADERS = {
  host: "x-ct-source-host",
  clientId: "x-ct-source-client-id",
  clientSecret: "x-ct-source-client-secret",
} as const;

export const DEST_ENV_HEADERS = {
  host: "x-ct-dest-host",
  clientId: "x-ct-dest-client-id",
  clientSecret: "x-ct-dest-client-secret",
} as const;

type HeaderSet = { host: string; clientId: string; clientSecret: string };

function readEnvironmentFromHeaders(
  request: Request,
  headers: HeaderSet,
): TransferEnvironment | null {
  const host = request.headers.get(headers.host);
  const clientId = request.headers.get(headers.clientId);
  const clientSecret = request.headers.get(headers.clientSecret);

  if (!host || !clientId || !clientSecret || !isValidHost(host)) {
    return null;
  }

  return { host, clientId, clientSecret };
}

export function readEnvironment(request: Request): TransferEnvironment | null {
  return readEnvironmentFromHeaders(request, ENV_HEADERS);
}

export function readSourceEnvironment(
  request: Request,
): TransferEnvironment | null {
  return readEnvironmentFromHeaders(request, SOURCE_ENV_HEADERS);
}

export function readDestinationEnvironment(
  request: Request,
): TransferEnvironment | null {
  return readEnvironmentFromHeaders(request, DEST_ENV_HEADERS);
}

export function jsonError(
  error: TransferApiError["error"],
  status: number,
  extra: Partial<TransferApiError> = {},
): NextResponse {
  return NextResponse.json({ error, ...extra } satisfies TransferApiError, {
    status,
  });
}

export function missingCredentialsResponse(which?: string): NextResponse {
  return jsonError("missing_credentials", 400, {
    detail: which
      ? `Missing or invalid ${which} environment headers`
      : "Missing or invalid environment headers (host / client id / client secret)",
  });
}

/**
 * Maps errors thrown by transferFetch/readTransferResponse to a JSON error
 * response.
 */
export function transferErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvalidCredentialsError) {
    return jsonError("invalid_credentials", 401, { detail: error.message });
  }
  if (error instanceof UpstreamUnreachableError) {
    return jsonError("upstream_unreachable", 502);
  }
  if (error instanceof TransferApiRequestError) {
    return jsonError("transfer_api_error", error.status, {
      status: error.status,
      detail: error.detail,
    });
  }

  console.error("Unexpected Transfer API error:", error);
  return jsonError("transfer_api_error", 500, {
    detail: error instanceof Error ? error.message : "Unknown error",
  });
}

/**
 * Shared shape of most routes: read the environment headers, proxy a JSON
 * request to the environment API, and map errors to the typed JSON shape.
 */
export async function proxyJsonRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<NextResponse> {
  const env = readEnvironment(request);
  if (!env) {
    return missingCredentialsResponse();
  }

  try {
    const response = await transferFetch(env, path, init);
    const data = await readTransferResponse<unknown>(response);
    return NextResponse.json(data ?? null, {
      status: response.status === 204 ? 200 : response.status,
    });
  } catch (error) {
    return transferErrorResponse(error);
  }
}

/**
 * Forwards the optional page / pageSize query parameters of the incoming
 * request to the upstream call.
 */
export function pagingQuery(request: Request): string {
  const incoming = new URL(request.url).searchParams;
  const outgoing = new URLSearchParams();
  const page = incoming.get("page");
  const pageSize = incoming.get("pageSize");
  if (page) outgoing.set("page", page);
  if (pageSize) outgoing.set("pageSize", pageSize);
  const query = outgoing.toString();
  return query ? `?${query}` : "";
}
