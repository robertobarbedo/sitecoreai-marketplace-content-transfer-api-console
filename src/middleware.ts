import { NextResponse } from "next/server";
import { requireSitecoreUser } from "@/src/lib/marketplace-auth/server";
import { ORG_ID_HEADER } from "@/src/lib/transfer/org";

/**
 * Every API route of this app handles automation client credentials (or the
 * encryption of them), so all of them require a signed-in Sitecore user of
 * this app. Checking here rather than per route means a new route can't
 * forget the check.
 *
 * Stored secrets are bound to the caller's Sitecore Cloud organization, so
 * the verified `org_id` claim is forwarded to the routes in ORG_ID_HEADER.
 * The header is always overwritten, never taken from the browser; a token
 * without an organization is refused.
 */
export async function middleware(request: Request) {
  const auth = await requireSitecoreUser(request);
  if (!auth.ok) return auth.response;

  const organizationId = auth.user.organizationId;
  if (!organizationId) {
    return NextResponse.json(
      { error: "Access token has no organization" },
      { status: 403 },
    );
  }

  const headers = new Headers(request.headers);
  headers.set(ORG_ID_HEADER, organizationId);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
