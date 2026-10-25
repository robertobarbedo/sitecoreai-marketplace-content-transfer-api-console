/**
 * Shared Sitecore Cloud Auth0 settings for the marketplace-auth kit.
 * NEXT_PUBLIC_* values are inlined at build time and safe to expose.
 */

export const AUTH0_DOMAIN =
  process.env.NEXT_PUBLIC_AUTH0_DOMAIN || "auth.sitecorecloud.io";

export const AUTH0_AUDIENCE =
  process.env.NEXT_PUBLIC_AUTH0_AUDIENCE || "https://api-webapp.sitecorecloud.io";

export const AUTH0_SCOPE =
  process.env.NEXT_PUBLIC_AUTH0_SCOPE || "openid profile email offline_access";

/** Client ID of this app's SPA client credentials (Cloud Portal). */
export const AUTH0_CLIENT_ID = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID || "";

/** Marketplace app ID, used for the `product_codes` login parameter. */
export const SITECORE_APP_ID = process.env.NEXT_PUBLIC_SITECORE_APP_ID || "";

/** Token issuer; Auth0 issuers end with a slash. */
export const AUTH0_ISSUER =
  process.env.AUTH0_ISSUER ||
  `https://${AUTH0_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
