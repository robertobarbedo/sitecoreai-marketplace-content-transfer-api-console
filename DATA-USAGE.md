# Data Usage Disclosure

**Last updated: 2026-10-31**

The Content Transfer Console moves content between SitecoreAI environments
with the Sitecore Content Transfer and Item Transfer APIs. It has two modes:

- **Organization mode** (default): every call runs in the browser over the
  Sitecore Marketplace SDK with the user's own SitecoreAI session. Nothing is
  sent to or stored on the app's server.
- **Cross-Organization mode**: the browser calls the app's own API routes,
  which use an automation client the customer stores in their own content
  tree. The client secret is sealed (AES-256-GCM, `enc:v3:`, bound to the
  organization, host and client ID) and is decrypted only in server memory,
  right before the token exchange. Hosts are restricted to
  `*.sitecorecloud.io`.

The app has no database and persists nothing server-side except log lines.
Hosting is on Vercel; serverless functions run in the United States (Vercel
default region `iad1`, Washington, D.C.) unless the deployment sets another
region. In transit all traffic uses TLS 1.2+ with HSTS.

| Data type | Source | Purpose | Retention | Storage region | Access | Protection | Your rights (DSAR) | Deletion |
|---|---|---|---|---|---|---|---|---|
| Transfer packages (content and media chunks) | The source SitecoreAI environment (Content Transfer API) | Copy content to the destination environment | Organization mode: browser memory only, for the duration of the copy. Cross-Organization mode: app server memory for one copy request, never written to disk | Not stored by the app; in transit through the user's browser or the app's server (Vercel region) | The user's browser; the app's server process while relaying | TLS 1.2+ and HSTS; chunks stay compressed (media) or encrypted (content) as produced by Sitecore and are never decoded | Email roberto.barbedo@msqdx.com; the publisher keeps no copy | Nothing to delete on the app side; transfer operations and `.raif` blobs on the environments are removed by the app's cleanup or by Sitecore |
| Transfer metadata (item paths, transfer/chunk set IDs, item counts, consumption state and history) | SitecoreAI environments | Run, monitor and clean up transfers | Shown in the browser only; not stored server-side | Customer's SitecoreAI environment region | Users with access to the app and the environments | TLS 1.2+ and HSTS; SitecoreAI permissions | Email roberto.barbedo@msqdx.com; the publisher keeps no personal data beyond logs | Governed by the customer's Sitecore agreement |
| Automation client ID and sealed client secret (Cross-Organization mode) | Entered by an administrator in the settings dialog | Obtain an automation token for each environment | Until the connection or settings item is deleted | Customer's SitecoreAI environment region, item `/sitecore/system/Modules/Marketplace/ContentTransferConsole/Settings` | Content tree users with read access to the item (they see only ciphertext); the app's server decrypts in memory for the matching organization and connection only | AES-256-GCM (`enc:v3:`) with organization, host and client ID as authenticated data; key held only in the server environment; no decrypt endpoint; provider encryption at rest | Managed by the customer in their environment; questions to roberto.barbedo@msqdx.com | Delete the connection in the app, or delete the `/sitecore/system/Modules/Marketplace/ContentTransferConsole` folder (and the legacy `/sitecore/system/Modules/ContentTransferConsole` folder, if present) |
| Saved transfer definitions (names, environment labels/IDs, paths, options) | Created by users in the Saved Transfers tab | Re-run recurring transfers | Until deleted | Customer's SitecoreAI environment region, item `/sitecore/system/Modules/Marketplace/ContentTransferConsole/SavedTransfers` | Users with access to the app and the content tree | SitecoreAI permissions; provider encryption at rest | Managed by the customer in their environment | Delete the entry in the app, or delete the `SavedTransfers` item / module folder |
| Automation access tokens (Cross-Organization mode) | Sitecore Cloud (`auth.sitecorecloud.io`) token exchange | Authorize calls to the environment APIs | App server memory until shortly before expiry (about 24 hours) or until the server instance stops; never written to disk or returned to the browser | App server (Vercel region) | The app's server process only | Sent only to `*.sitecorecloud.io` hosts; upstream redirects refused | Not linked to a person; questions to roberto.barbedo@msqdx.com | Expire automatically |
| Audit and runtime logs (UTC time, API path, event such as `auth`, `secret.encrypt`, `transfer.create`, `transfer.chunk.copy`; outcome, user ID on sign-in lines, organization ID, environment host name, HTTP status) | The app's server | Security, abuse prevention and troubleshooting | 90 days | Publisher's log store (Vercel runtime logs, then the publisher's log store) | The app's maintainer and the hosting provider | No content, tokens or secrets are logged; provider encryption at rest | Email roberto.barbedo@msqdx.com; answered within 30 days | Deleted automatically after 90 days, or sooner on a verified request |
| Sign-in tokens (Sitecore Cloud access and refresh tokens) and current organization ID | Sitecore Cloud sign-in (Auth0) | Authenticate calls to the app's API | Until sign-out, session expiry, or clearing site data | The user's device (browser `localStorage`) | The user | Stays on the device; the access token is sent only to the app's server, the refresh token only to Sitecore | Under the user's control | Sign out or clear site data |
| Preferences and history (transfer mode, settings environment, recent transfer IDs and `.raif` names, recent backup names) | The user's actions in the app | Convenience | Until site data is cleared | The user's device (browser `localStorage`) | The user | Stays on the device | Under the user's control | Clear site data |
| Backup archives (raw content chunks plus a manifest with paths and the backup author's SitecoreAI user ID, name and email) | Organization mode Backup, from the source environment over the SDK | Restore content later | As long as the user keeps the file; a staging copy in the browser's private file storage is removed by the next backup | The user's device | The user | Created in the browser, never sent to the app's server; chunks stay compressed or encrypted as produced by Sitecore | Under the user's control | Delete the ZIP file; clear site data to remove any staging copy |

## AI usage

This app does not use AI or machine learning.
