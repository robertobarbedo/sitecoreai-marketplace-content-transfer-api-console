/**
 * Request header carrying the caller's verified Sitecore Cloud organization.
 * Set only by src/middleware.ts from the access token's `org_id` claim (any
 * value sent by the browser is overwritten), so routes can trust it.
 */
export const ORG_ID_HEADER = "x-ct-verified-org-id";

/** The verified organization of the caller, or null outside the middleware. */
export function readOrganizationId(request: Request): string | null {
  return request.headers.get(ORG_ID_HEADER) || null;
}
