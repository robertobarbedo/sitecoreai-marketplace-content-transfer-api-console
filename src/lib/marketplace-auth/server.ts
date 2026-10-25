/**
 * Server-side check for API routes: verifies the Sitecore Cloud Auth0 access
 * token sent by authedFetch() and returns who is calling.
 *
 *   const auth = await requireSitecoreUser(request);
 *   if (!auth.ok) return auth.response;
 *   // auth.user.sub, auth.user.organizationId ...
 *
 * Pass { clientId } when one deployment hosts several Marketplace apps;
 * it defaults to NEXT_PUBLIC_AUTH0_CLIENT_ID.
 */

import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";
import { NextResponse } from "next/server";
import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_ISSUER } from "./config";

export interface SitecoreUser {
  /** Auth0 subject — stable per user */
  sub: string;
  /** Sitecore Cloud organization the token was issued for */
  organizationId: string | null;
  claims: JWTPayload;
}

export type AuthResult =
  | { ok: true; user: SitecoreUser }
  | { ok: false; response: NextResponse };

// Cached per server instance; jose refreshes keys when it sees an unknown kid
const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", AUTH0_ISSUER));

function deny(status: number, error: string): AuthResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** Says which check failed; claim values are not secret, so they're included. */
function describeVerifyError(err: unknown): string {
  if (err instanceof errors.JWTExpired) return "Access token has expired";
  if (err instanceof errors.JWTClaimValidationFailed) {
    const actual = JSON.stringify(err.payload[err.claim]);
    const expected = err.claim === "iss" ? AUTH0_ISSUER : err.claim === "aud" ? AUTH0_AUDIENCE : "";
    return `Token claim "${err.claim}" ${err.reason}: got ${actual}${expected ? `, expected ${expected}` : ""}`;
  }
  if (err instanceof errors.JWKSNoMatchingKey) return "Token is not signed by the expected issuer's keys";
  if (err instanceof errors.JOSEError) return `Invalid access token (${err.code})`;
  return "Could not verify access token";
}

export async function requireSitecoreUser(
  request: Request,
  { clientId = AUTH0_CLIENT_ID }: { clientId?: string } = {},
): Promise<AuthResult> {
  if (!clientId) {
    // Fail closed: without the client ID we can't tell our tokens from other apps'
    return deny(500, "Sign-in is not configured on the server");
  }

  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return deny(401, "Missing access token");

  // Opaque or encrypted tokens mean the audience wasn't applied at login
  if (match[1].split(".").length !== 3) return deny(401, "Access token is not a signed JWT");

  try {
    const { payload } = await jwtVerify(match[1], jwks, {
      issuer: AUTH0_ISSUER,
      audience: AUTH0_AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });

    // The audience is shared by every Sitecore Cloud app, so also require
    // that the token was issued to this app's client credentials
    const authorizedParty = payload.azp ?? payload.client_id;
    if (authorizedParty !== clientId) {
      return deny(403, "Token was not issued to this app");
    }
    if (!payload.sub) return deny(401, "Token has no subject");

    return {
      ok: true,
      user: {
        sub: payload.sub,
        organizationId: typeof payload.org_id === "string" ? payload.org_id : null,
        claims: payload,
      },
    };
  } catch (err) {
    return deny(401, describeVerifyError(err));
  }
}
