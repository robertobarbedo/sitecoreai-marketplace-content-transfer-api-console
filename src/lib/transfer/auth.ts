import { createHash } from "crypto";

const TOKEN_URL = "https://auth.sitecorecloud.io/oauth/token";
const AUDIENCE = "https://api.sitecorecloud.io";

/** Safety margin subtracted from the token lifetime (seconds). */
const EXPIRY_MARGIN_SECONDS = 60;

export class InvalidCredentialsError extends Error {
  constructor(detail?: string) {
    super(detail ?? "Invalid client credentials");
    this.name = "InvalidCredentialsError";
  }
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// In-memory, per-server-instance token cache. Tokens are highly privileged,
// so they never leave the server; a cold start just costs one token request.
const tokenCache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

function cacheKey(clientId: string, clientSecret: string): string {
  return createHash("sha256").update(`${clientId}:${clientSecret}`).digest("hex");
}

async function requestToken(
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiresIn: number }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      audience: AUDIENCE,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new InvalidCredentialsError(detail);
    }
    throw new Error(`Token request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  return { token: data.access_token, expiresIn: data.expires_in ?? 86400 };
}

export async function getToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const key = cacheKey(clientId, clientSecret);

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    try {
      const { token, expiresIn } = await requestToken(clientId, clientSecret);
      tokenCache.set(key, {
        token,
        expiresAt: Date.now() + (expiresIn - EXPIRY_MARGIN_SECONDS) * 1000,
      });
      return token;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

export function evictToken(clientId: string, clientSecret: string): void {
  tokenCache.delete(cacheKey(clientId, clientSecret));
}
