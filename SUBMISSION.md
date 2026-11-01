# Marketplace submission: Content Transfer Console

Copy-paste text for Sitecore's public-app submission form, in form order.
Replace `{{APP_URL}}` with the production deployment URL before submitting.

## 1. App name

Content Transfer Console

## 2. Headline

<!-- 343 chars -->

Move content and media between SitecoreAI environments without chaining API calls by hand. Run a one-click Quick Transfer with a live checklist, step through the Content Transfer and Item Transfer APIs in an Advanced view, save reusable transfers that reconcile and publish at the end, and back up content trees to a ZIP you can restore later.

## 3. Description

SitecoreAI exposes the Content Transfer API and the Item Transfer API for packaging content on one environment and importing it into another, but using them means chaining several calls by hand: create a transfer, copy every chunk, assemble the .raif file, consume it, monitor it and clean up. Content Transfer Console wraps both APIs in one console for administrators.

Key features:
- Quick Transfer: pick a content tree path, scope and merge strategy; the app creates the transfer, copies the chunks, consumes the result into the destination master database and cleans up, with a live stage checklist and cancel support
- Advanced: the same pipeline as four manual steps, with resume after failure and retry
- Saved Transfers: reusable definitions that can reconcile and publish the destination at the end
- Backup and Restore: save content to a ZIP you keep and replay it into the same or another environment
- Reconciliation: preview and apply the field-value differences defined in the Content Reconciliation app
- Transfer history and timeline with per-item drill-down (Cross-Organization mode)
- Content tree picker to browse the source environment

Two transfer modes:
- Organization (default): moves content between environments where the app is installed, through the Marketplace SDK, with no credentials
- Cross-Organization: uses automation clients you add; client secrets are encrypted at rest and never decrypted in the browser

Use cases:
- Promote content from a staging environment to production
- Copy a site's content or media into a new environment
- Take a rollback backup before a large content change
- Re-run the same transfer for every release with one click

## 4. Financial model

Free

## 5. Categories

Suggested (match to the portal's category list before submitting):
- Content management
- Developer tools
- Integration

## 6. Screenshots to capture

PNG, shown as 600×900 thumbnails. Capture during live QA.

1. Quick Transfer during a run, with the live stage checklist part-way through.
2. The Advanced tab showing the four steps (create, copy chunk sets, consume, clean up) after a completed transfer.
3. Saved Transfers list with the edit dialog open (source, destination, paths, reconcile/publish options).
4. Backup & Restore: the restore view with a ZIP manifest and the destination state of each path.
5. Settings dialog in Cross-Organization mode with a tested connection (client secret masked).
6. Transfer Details History with a consumption's item drill-down (Cross-Organization mode).

## 7. Links

- Website: https://github.com/robertobarbedo/sitecoreai-marketplace-content-transfer-api-console
- Support: https://github.com/robertobarbedo/sitecoreai-marketplace-content-transfer-api-console/issues
- Privacy policy: https://github.com/robertobarbedo/sitecoreai-marketplace-content-transfer-api-console/blob/main/PRIVACY.md
- Terms of service: https://github.com/robertobarbedo/sitecoreai-marketplace-content-transfer-api-console/blob/main/TERMS.md

## 8. Data usage disclosure

Paste from `DATA-USAGE.md`.

Summary: in Organization mode every call runs in the browser through the Marketplace SDK with the user's own session, and nothing reaches the app's server. In Cross-Organization mode the browser calls the app's own signed-in API routes, which exchange a customer-stored automation client (secret sealed with AES-256-GCM, bound to organization, host and client ID) for a token and relay requests and chunk bytes to `*.sitecorecloud.io` hosts without persisting them. Settings and saved transfers live in the customer's own content tree, backups only on the user's device, and audit logs (no content, tokens or secrets) are kept for 90 days.

## 9. AI usage disclosure switch

Off. The app does not use AI or machine learning.

## 10. Configuration tab

- Extension point: **Standalone**, route `/`.
- API access: **SitecoreAI APIs** (the app calls `xmc.contentTransfer.*` — create/status/delete/getChunk/saveChunk/completeChunkSetTransfer/consumeFile/getBlobState — and `xmc.authoring.graphql` through the Marketplace SDK, plus `application.context` and `host.user`).
- Permissions: **File downloads** (Backup writes a ZIP to the user's device via `showSaveFilePicker` or a Blob download link). No clipboard and no `window.open`. Note: help links to SitecoreAI Deploy open with `target="_blank"`; if they don't open in the portal iframe during QA, enable **Pop-ups**.
- Deployment URL: `{{APP_URL}}`
- Client credentials (custom authorization): **Yes**. Every `/api/*` route requires a Sitecore Cloud token issued to this app. Create Single-page app credentials and register:
  - Allowed callback URL: `{{APP_URL}}/` (with trailing slash)
  - Logout URL, web origin, CORS origin: `{{APP_URL}}`
- Environment variables on the host:
  - `NEXT_PUBLIC_AUTH0_CLIENT_ID` (required)
  - `NEXT_PUBLIC_SITECORE_APP_ID` (required)
  - `CT_ENCRYPTION_KEY` (required for Cross-Organization mode; server-only, 32-byte base64, `openssl rand -base64 32`)
  - Optional: `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_AUDIENCE`, `NEXT_PUBLIC_AUTH0_SCOPE`, `AUTH0_ISSUER`, `CSP_FRAME_ANCESTORS`
- App logo: `public/arrow-square-in-duotone.svg`

## 11. Submission details (visible only to Sitecore)

- Contact name: `Roberto Barbedo`
- Contact email: `rb205@proton.me`

**App functionality**

Content Transfer Console is a Next.js 15 full-stack app on the Standalone extension point. In Organization mode (default) it is effectively client-side: the browser drives the Content Transfer and Item Transfer pipeline through the Marketplace SDK (`xmc.contentTransfer.*`), copying chunks from source to destination as raw Blobs, and uses `xmc.authoring.graphql` for the tree picker, settings, reconciliation and `publishItem`. In Cross-Organization mode the browser calls the app's own `/api` routes with a Sitecore Cloud token from custom authorization (Auth0 SPA client credentials); the routes exchange the stored automation client credentials for a token (OAuth client_credentials against `auth.sitecorecloud.io`), cache it in server memory, and proxy the Content Transfer, Item Transfer and Authoring GraphQL calls; chunks are copied server-side and held in memory for one request only. Connections (with sealed secrets) and saved transfer definitions are stored as JSON in items under `/sitecore/system/Modules/Marketplace/ContentTransferConsole` in the customer's own environment; mode and recent-transfer conveniences are kept in localStorage; backups are ZIP files on the user's device. There is no database.

**Business value / alignment with Sitecore standards**

The app turns the multi-step Content Transfer and Item Transfer APIs into a guided, repeatable workflow, which lowers the risk of manual mistakes when promoting content between environments. It uses only supported Marketplace SDK APIs and the documented Sitecore REST APIs, and in Organization mode every operation runs with the signed-in user's own SitecoreAI session. The UI follows the Blok design language (Tailwind CSS v4, Radix UI). Security measures: middleware that verifies a Sitecore Cloud token on every `/api/*` request (signature, issuer, audience, expiry and `azp` bound to this app's client ID); automation client secrets sealed with AES-256-GCM (`enc:v3:`) bound to organization, host and client ID, encrypted through an encrypt-only route and decrypted only inside the proxy, never in the browser; hosts restricted to lowercase `*.sitecorecloud.io` names with upstream redirects refused; security headers on every response (HSTS, CSP frame-ancestors limited to SitecoreAI, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) and `Cache-Control: no-store` on API routes; and JSON audit logging of sign-in decisions and sensitive operations without tokens, secrets or content. Fonts are self-hosted at build time; no analytics.

**Licensing note**

Next.js lists sharp (LGPL-3.0 libvips) as an optional dependency for image optimization; this app doesn't use next/image and sets images.unoptimized, so sharp is never loaded. lightningcss (MPL-2.0) is a build-time-only dependency of Tailwind CSS and is not shipped.

## 12. Pre-submit checklist

- [ ] Live QA, Organization mode: Quick Transfer of content and of a Media Library path, Advanced steps, cleanup
- [ ] Live QA: chunk get/save after the SDK 0.4.4 bump (CLAUDE.md asks to re-QA after SDK bumps)
- [ ] Live QA: Backup to ZIP and Restore (same environment and another environment)
- [ ] Live QA, Cross-Organization mode: Test connection, transfer, history/timeline, blob discard
- [ ] Live QA: saved transfer with Reconcile and Publish at the end
- [ ] `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_SITECORE_APP_ID` and `CT_ENCRYPTION_KEY` set on the production host; app rebuilt
- [ ] Production client credentials registered with `{{APP_URL}}` callback, logout, web origin and CORS URLs
- [ ] Screenshots captured (PNG)
- [ ] `{{APP_URL}}` replaced with the production deployment URL in this form
