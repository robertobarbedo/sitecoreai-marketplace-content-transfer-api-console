import { NextResponse } from "next/server";
import { auditLog } from "@/src/lib/marketplace-auth/audit-log";
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
import { SecretDecryptionError } from "./crypto";
import { readOrganizationId } from "./org";

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
  const organizationId = readOrganizationId(request);
  const host = request.headers.get(headers.host)?.trim().toLowerCase();
  const clientId = request.headers.get(headers.clientId);
  const clientSecret = request.headers.get(headers.clientSecret);

  if (
    !organizationId ||
    !host ||
    !clientId ||
    !clientSecret ||
    !isValidHost(host)
  ) {
    return null;
  }

  return { organizationId, host, clientId, clientSecret };
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

/** A browser-safe description of an upstream HTTP status. */
function describeUpstreamStatus(status: number): string {
  if (status === 400) return "The environment API rejected the request (400).";
  if (status === 404) return "The environment API could not find the requested resource (404).";
  if (status === 409) return "The environment API reported a conflict (409).";
  if (status === 413) return "The request was too large for the environment API (413).";
  if (status === 429) return "The environment API is rate limiting requests (429). Try again shortly.";
  if (status >= 500) return `The environment API failed (${status}). Try again later.`;
  return `The environment API returned an error (${status}).`;
}

/**
 * Maps errors thrown by transferFetch/readTransferResponse to a JSON error
 * response. Upstream bodies (token endpoint and environment APIs) are logged
 * server-side only; the browser gets a fixed message per error type, so
 * nothing the upstream echoes back (internals, request data) leaks out.
 */
export function transferErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvalidCredentialsError) {
    console.error("Credentials rejected upstream:", error.detail);
    return jsonError("invalid_credentials", 401, {
      detail: "The environment rejected the automation client credentials.",
    });
  }
  if (error instanceof UpstreamUnreachableError) {
    return jsonError("upstream_unreachable", 502);
  }
  if (error instanceof SecretDecryptionError) {
    return jsonError("encryption_error", 500, { detail: error.message });
  }
  if (error instanceof TransferApiRequestError) {
    console.error(`Transfer API error (${error.status}):`, error.detail);
    return jsonError("transfer_api_error", error.status, {
      status: error.status,
      detail: describeUpstreamStatus(error.status),
    });
  }

  console.error("Unexpected Transfer API error:", error);
  return jsonError("transfer_api_error", 500, {
    detail: "Unexpected server error",
  });
}

/** The typed error name (and upstream status, when known) of a failure. */
function describeFailure(error: unknown): {
  reason: TransferApiError["error"] | "unexpected_error";
  upstreamStatus?: number;
} {
  if (error instanceof InvalidCredentialsError) {
    return { reason: "invalid_credentials" };
  }
  if (error instanceof UpstreamUnreachableError) {
    return { reason: "upstream_unreachable" };
  }
  if (error instanceof SecretDecryptionError) {
    return { reason: "encryption_error" };
  }
  if (error instanceof TransferApiRequestError) {
    return { reason: "transfer_api_error", upstreamStatus: error.status };
  }
  return { reason: "unexpected_error" };
}

/**
 * Writes an audit line for a sensitive call made with a stored
 * Cross-Organization secret (token exchange + environment API). Logs the
 * event, outcome, upstream status, target host and the caller's verified
 * organization only — never secrets, tokens, payloads or content. Pass the
 * upstream response status (`ok` overrides the default "status < 400"
 * outcome), or the thrown error on failure.
 */
export function auditUpstream(
  request: Request,
  event: string,
  host: string,
  result: { upstreamStatus: number; ok?: boolean } | { error: unknown },
  extra: Record<string, string | number | boolean> = {},
): void {
  const org = readOrganizationId(request);
  if ("error" in result) {
    const { reason, upstreamStatus } = describeFailure(result.error);
    auditLog(request, {
      event,
      outcome: reason === "invalid_credentials" ? "deny" : "error",
      org,
      host,
      upstreamStatus,
      reason,
      ...extra,
    });
    return;
  }
  auditLog(request, {
    event,
    outcome: (result.ok ?? result.upstreamStatus < 400) ? "allow" : "error",
    org,
    host,
    upstreamStatus: result.upstreamStatus,
    ...extra,
  });
}

/**
 * Shared shape of most routes: read the environment headers, proxy a JSON
 * request to the environment API, and map errors to the typed JSON shape.
 * Pass `auditEvent` for state-changing calls to audit-log them.
 */
export async function proxyJsonRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
  auditEvent?: string,
): Promise<NextResponse> {
  const env = readEnvironment(request);
  if (!env) {
    return missingCredentialsResponse();
  }

  let response: Response | undefined;
  try {
    response = await transferFetch(env, path, init);
    if (auditEvent) {
      auditUpstream(request, auditEvent, env.host, {
        upstreamStatus: response.status,
      });
    }
    const data = await readTransferResponse<unknown>(response);
    return NextResponse.json(data ?? null, {
      status: response.status === 204 ? 200 : response.status,
    });
  } catch (error) {
    // A failure after the upstream answered was already logged with its status.
    if (auditEvent && !response) {
      auditUpstream(request, auditEvent, env.host, { error });
    }
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
