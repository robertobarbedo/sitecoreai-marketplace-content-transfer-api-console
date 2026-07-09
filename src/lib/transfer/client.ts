import { getToken, evictToken, InvalidCredentialsError } from "./auth";

/** Base path of the Content Transfer API (v1) on an environment host. */
export const CONTENT_TRANSFER_BASE = "/sitecore/api/content/transfer/v1";

/** Base path of the Item Transfer API (v3) on an environment host. */
export const ITEM_TRANSFER_BASE = "/sitecore/shell/api/v3/ItemsTransfer";

/**
 * A resolved environment target: host name plus the automation client
 * credentials used to obtain a JWT for it.
 */
export interface TransferEnvironment {
  host: string;
  clientId: string;
  clientSecret: string;
}

export class TransferApiRequestError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`Transfer API error (${status}): ${detail}`);
    this.name = "TransferApiRequestError";
  }
}

export class UpstreamUnreachableError extends Error {
  constructor(cause?: unknown) {
    super("Could not reach the environment API");
    this.name = "UpstreamUnreachableError";
    this.cause = cause;
  }
}

export { InvalidCredentialsError };

/**
 * Environment host names look like "my-env.sitecorecloud.io" — reject
 * anything with a scheme, path, port, or userinfo so the proxy can only be
 * pointed at a hostname.
 */
export function isValidHost(host: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}$/i.test(host);
}

/**
 * Calls an environment API with a token obtained from the automation client
 * credentials. On a 401/403 (the Content Transfer docs state an expired JWT
 * surfaces as 403) the cached token is evicted and the request retried once.
 *
 * Callers that pass a request body must use a retry-safe body (e.g. an
 * ArrayBuffer), not a one-shot stream.
 */
export async function transferFetch(
  env: TransferEnvironment,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const attempt = async (): Promise<Response> => {
    const token = await getToken(env.clientId, env.clientSecret);
    try {
      return await fetch(`https://${env.host}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new UpstreamUnreachableError(error);
    }
  };

  let response = await attempt();

  if (response.status === 401 || response.status === 403) {
    evictToken(env.clientId, env.clientSecret);
    response = await attempt();
    if (response.status === 401 || response.status === 403) {
      const detail = await response.text().catch(() => "");
      throw new InvalidCredentialsError(detail);
    }
  }

  return response;
}

/**
 * Reads the upstream response and throws a typed error for non-2xx statuses.
 * Returns the parsed JSON body, or null for empty responses.
 */
export async function readTransferResponse<T>(
  response: Response,
): Promise<T | null> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TransferApiRequestError(response.status, detail);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
}
