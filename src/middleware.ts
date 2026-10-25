import { NextResponse } from "next/server";
import { requireSitecoreUser } from "@/src/lib/marketplace-auth/server";

/**
 * Every API route of this app handles automation client credentials (or the
 * encryption of them), so all of them require a signed-in Sitecore user of
 * this app. Checking here rather than per route means a new route can't
 * forget the check.
 */
export async function middleware(request: Request) {
  const auth = await requireSitecoreUser(request);
  if (!auth.ok) return auth.response;
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
