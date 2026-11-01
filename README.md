# Content Transfer Console

A SitecoreAI Marketplace app for administrators who move content and media
between SitecoreAI environments.

SitecoreAI (XM Cloud) exposes the
[Content Transfer API](https://api-docs.sitecore.com/sai/content-transfer-api)
(v1) and the
[Item Transfer API](https://api-docs.sitecore.com/sai/item-transfer-api) (v3)
for packaging content on one environment and importing it into another, but
using them means chaining several calls by hand: create a transfer, copy every
chunk, assemble a `.raif` file, consume it, monitor it and clean up.

This app wraps both APIs in a console. A one-click Quick Transfer runs the
whole pipeline with a live checklist; an Advanced tab exposes each step; and
saved transfers, backups to ZIP and post-transfer reconcile/publish cover the
repeat cases. It works between environments of your own organization without
any credentials, or between organizations with automation clients.

## Features

- **Quick Transfer** — pick a content tree path, scope and merge strategy; the
  app creates the transfer, copies the chunks, assembles and consumes the
  `.raif` into the destination `master` database and cleans up, with a live
  stage checklist and cancel support
- **Advanced** — the same pipeline as four manual steps (create, copy chunk
  sets, consume, clean up) with resume after failure and retry
- **Saved Transfers** — reusable transfer definitions (source, destination,
  paths) that can optionally reconcile and publish the destination at the end
- **Backup & Restore** — save content to a ZIP you keep and replay it later
  into the same or another environment (Organization mode)
- **Reconciliation** — preview and apply the field-value differences defined
  in the Content Reconciliation app, when that app is set up
- **Transfer Details History** and **Transfer Timeline** — paged lists of
  every consumption on the destination, per-item drill-down and state
  timelines (Cross-Organization mode)
- **Two transfer modes** — Organization (no credentials, over the Marketplace
  SDK) and Cross-Organization (stored automation clients)
- **Content tree picker** — browse the source environment to choose paths
- **Encrypted credentials** — automation client secrets are encrypted at rest
  and bound to their connection; they are never decrypted in the browser

## How it works

- **Extension point:** Standalone, served from the root route `/`.
- **APIs:** Content Transfer API (create / status / delete / get chunk on the
  source; save chunk / complete chunk set on the destination), Item Transfer
  API (consume, monitor, list, history, blobs — destination only), and
  Authoring and Management GraphQL (settings storage, tree picker, publish,
  reconciliation).

### Transfer modes

The mode switch lives in the settings dialog (gear icon). The last option of
every source/destination dropdown — **"Transfer from/to another
organization…"** or **"Manage environments…"** — opens it too.

| | **Organization** (default) | **Cross-Organization** |
|---|---|---|
| Environments | Every environment the app is installed on (`application.context.resourceAccess`), listed automatically | Connections you add: host + automation client ID/secret |
| Credentials | None | Required for every environment |
| Data flow | Browser → Marketplace SDK (`xmc.contentTransfer.*`, `xmc.authoring.graphql`) | Browser → this app's `/api` routes → environment |
| Chunk copy | In the browser: SDK `getChunk` → raw Blob → SDK `saveChunk` | Server-side copy route |
| Transfer Details History / Transfer Timeline / blob list and discard | Not available (the SDK doesn't expose those Item Transfer endpoints) | Available |
| Backup & Restore tab | Available | Not available |

A transfer never mixes the two: both environments come from the same mode.
Switching modes clears the source/destination selection, the mode can't
change while a transfer runs, and a Cross-Organization badge in the header
marks the non-default mode. Saved transfers remember their mode (entries saved
before modes existed are Cross-Organization).

Organization-mode notes:

- The SDK's `getChunk` doesn't expose the `IsMedia` response header, so media
  is derived from the paths: Quick Transfer and saved transfers run Media
  Library paths and other content as **separate sub-transfers**; the Advanced
  tab requires one kind per transfer.
- Consumption is monitored with `getBlobState`, and cleanup deletes the
  transfer operation only — consumed `.raif` blobs stay on the destination
  (the SDK can't discard them).
- The source database is always `master`.

### Cross-Organization data flow

```
browser ──authedFetch──▶ /api/* (Next.js) ──OAuth client_credentials──▶ auth.sitecorecloud.io
                              │
                              └──Bearer token──▶ https://{host}/sitecore/... (Content / Item Transfer, Authoring GraphQL)
```

- The browser never calls `auth.sitecorecloud.io` or the environment APIs
  directly (they are not CORS-enabled). The app's API routes read the target
  environment from `x-ct-host` / `x-ct-client-id` / `x-ct-client-secret`
  headers (the chunk copy route reads an `x-ct-source-*` and an `x-ct-dest-*`
  set), exchange the credentials for a token (audience
  `https://api.sitecorecloud.io`) and proxy the request.
- Tokens are cached in server memory until shortly before expiry and never
  returned to the browser. An expired JWT surfaces as `403 Forbidden`, so the
  proxy evicts its cached token and retries once on both 401 and 403.
- Chunk copying is server-side: the copy route GETs the chunk from the source
  and PUTs the identical bytes to the destination (media stays compressed,
  content stays encrypted). Each chunk is buffered in server memory during the
  copy; the payload never reaches the browser.
- Consumption state is read from the Item Transfer `GET /transfers` list; the
  per-transfer detail endpoint can return 404 for a blob-name ID and is used
  only for enrichment.

### API routes

All routes require a Sitecore Cloud sign-in token (see
[Security and privacy](#security-and-privacy)) and are called by the app's
UI; they are not intended as a public API.

| Route | Methods | Upstream | Purpose |
|---|---|---|---|
| `/api/crypto/encrypt` | GET, POST | — | Report whether a key is configured / encrypt a secret for a connection |
| `/api/transfer/validate` | POST | Content Transfer | Validate a connection (token + status probe) |
| `/api/transfer/transfers` | POST | Content Transfer | Create a transfer operation (source) |
| `/api/transfer/transfers/[transferId]` | DELETE | Content Transfer | Delete a transfer and its resources (source) |
| `/api/transfer/transfers/[transferId]/status` | GET | Content Transfer | Status + chunk sets (source) |
| `/api/transfer/transfers/[transferId]/chunksets/[chunksetId]/chunks/[chunkId]/copy` | POST | Content Transfer | Copy one chunk source → destination |
| `/api/transfer/transfers/[transferId]/chunksets/[chunksetId]/complete` | POST | Content Transfer | Complete a chunk set → `.raif` (destination) |
| `/api/item-transfer/transfers` | GET | Item Transfer | Paged list of consumptions (destination) |
| `/api/item-transfer/transfers/[transferId]` | GET | Item Transfer | Consumption details/metrics (destination) |
| `/api/item-transfer/databases/[databaseName]/sources` | POST | Item Transfer | Start consuming a blob/file source |
| `/api/item-transfer/databases/[databaseName]/sources/[sourceName]` | PUT | Item Transfer | Retry a failed consumption |
| `/api/item-transfer/databases/[databaseName]/sources/[sourceName]/items` | GET | Item Transfer | Paged transferred items |
| `/api/item-transfer/databases/[databaseName]/sources/[sourceName]/items/[itemId]` | GET | Item Transfer | Item detail |
| `/api/item-transfer/sources/blobs` | GET | Item Transfer | Paged blob sources |
| `/api/item-transfer/sources/blobs/[blobName]` | GET, DELETE | Item Transfer | Blob state / discard blob |
| `/api/item-transfer/sources/files` | GET | Item Transfer | File sources |
| `/api/item-transfer/history` | GET | Item Transfer | Consumption history timelines |
| `/api/authoring/item-children` | POST | Authoring GraphQL | Item + children for the content tree picker (source) |

Errors use a typed JSON shape:
`{ "error": "missing_credentials" | "invalid_credentials" | "validation" | "transfer_api_error" | "upstream_unreachable" | "encryption_error", ... }`.

### Backup & Restore (Organization mode)

The **Backup & Restore** tab saves content to a ZIP you keep and replays it
later — into the same environment (rollback) or into any other environment
where the app is installed, including one in another organization, without
credentials.

- **Backup** (from the selected *source*): name it, pick paths with scope and
  merge strategy (stored in the backup; it decides how the backup is applied
  on restore), start. The source packages the content, every chunk is
  downloaded into the ZIP, then the staged transfer on the source is deleted
  (also on failure). The browser offers a save dialog when allowed, otherwise
  the ZIP downloads normally.
- **Restore** (into the selected *destination*): choose a ZIP — the manifest
  is shown with the current state of each path on the destination, plus
  warnings for same-environment restores and "Override existing tree". After
  typing `RESTORE` the chunks are uploaded (verified by size and SHA-256;
  cancellable), assembled and consumed into `master` (no longer cancellable),
  and the import is monitored to the end.
- ZIP layout: `manifest.json` + `chunks/{media|content}/<chunkSetId>/<n>.raif`
  — the raw transfer chunks (an assembled `.raif` can't be downloaded from any
  API).
- Not available in Cross-Organization mode: chunk bytes there live on the
  server, and the ~4.5 MB request body limit of serverless hosts such as
  Vercel rules out moving 90–200 MB chunks to or from the browser.

### Saved transfers, reconcile and publish

- Saved transfer definitions are stored as one JSON list in a
  `SavedTransfers` item next to the settings item. Saves write to the first
  environment in the app's resource list; loads merge the item from every
  environment.
- **Reconcile at the end** applies the Content Reconciliation app's desired
  values to the destination. **Publish at the end** publishes the destination
  to Experience Edge (the entire `/sitecore` tree or only the transferred
  paths; Smart or Republish) with `publishItem`, in the destination's
  languages. A failed reconcile skips the publish. Both run over the
  Marketplace SDK against the destination environment, which must have the
  app installed and is matched to its connection by host name or label.
- The **Reconciliation** tab is read-only toward the Content Reconciliation
  app's storage under
  `/sitecore/system/Modules/Marketplace/ContentReconciliation`: if that app
  isn't installed and set up with exactly one Base environment, the tab shows
  a status screen instead.

## Requirements

- A SitecoreAI (XM Cloud) organization with at least two environments (or one
  environment for Backup & Restore rollbacks).
- Organization Admin or Owner to create and install the app in App Studio.
- Users need read access to the source content and write access to the
  destination; Transfer and Item Transfer operations run with the
  permissions of the SDK session (Organization mode) or of the automation
  client (Cross-Organization mode).
- Cross-Organization mode only: an **automation client** per environment,
  created in SitecoreAI Deploy (**Credentials → Environment → Create
  credentials → Automation**; requires Organization Admin or Owner), and the
  environment host name (**Projects → your project → Authoring environments →
  Details → Environment host name**).
- Reconciliation tab and "Reconcile at the end": the Content Reconciliation
  Marketplace app installed and set up.

## Install in SitecoreAI

1. In the Sitecore Cloud Portal, open **App Studio** and choose **Create
   App**.
2. Enter an app name (e.g. "Content Transfer Console") and choose type
   `Custom`.
3. Add the **Standalone** extension point with route `/`.
4. Under API access, enable **SitecoreAI APIs**.
5. Set the deployment URL to `https://<your-deployment>/`.
6. Upload the app logo from [`public/icon.svg`](public/icon.svg).
7. Enable custom authorization and create **client credentials** of type
   **Single-page app**. Register the deployment origin (e.g.
   `https://<your-deployment>/`) as the allowed callback URL (with trailing
   `/`), logout URL, web origin and CORS origin. Put the client ID in
   `NEXT_PUBLIC_AUTH0_CLIENT_ID` and the app ID in
   `NEXT_PUBLIC_SITECORE_APP_ID` on your deployment.
8. Install the app on every environment you want to transfer between, then
   open it from the apps menu.
9. Organization mode works immediately. For Cross-Organization mode, click
   the settings gear, choose **Cross-Organization**, add a connection per
   environment (label, host, client ID, client secret), click **Test
   connection**, then **Save connection**.

## Deploy your own instance

```bash
npm install
npm run build
npm start
```

Deploy to Vercel or any Node.js host and point the App Studio deployment URL
at it.

| Variable | Required | Description |
|---|---|---|
| `CT_ENCRYPTION_KEY` | Yes (Cross-Organization) | Server-only. 32-byte base64 key for encrypting automation client secrets (AES-256-GCM). Generate with `openssl rand -base64 32`. Without it connections can't be saved or used. |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Yes | Client ID of the app's Single-page app client credentials. Without it every `/api` route returns 500 and Cross-Organization mode is unusable. |
| `NEXT_PUBLIC_SITECORE_APP_ID` | Yes | Marketplace app ID (sent as `product_codes=mkp_<id>` at sign-in). |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | No | Default `auth.sitecorecloud.io`. |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | No | Default `https://api-webapp.sitecorecloud.io`. |
| `NEXT_PUBLIC_AUTH0_SCOPE` | No | Default `openid profile email offline_access`. |
| `AUTH0_ISSUER` | No | Server-only. Default `https://auth.sitecorecloud.io/`. |
| `CSP_FRAME_ANCESTORS` | No | Server-only. Space-separated CSP sources allowed to embed the app (`Content-Security-Policy: frame-ancestors`). Default `'self' https://*.sitecorecloud.io`. |

See [`.env.example`](.env.example). Rotating `CT_ENCRYPTION_KEY` orphans
existing ciphertexts — re-enter the client secrets afterwards.

The app only runs inside SitecoreAI: the Marketplace SDK needs the host
iframe, so opening the deployment directly in a browser shows a connection
error. For local development, expose `npm run dev` (port 5003) over HTTPS,
e.g. with ngrok, and register that URL in a separate development app.

## Configuration

- **Transfer mode** — Organization (default) or Cross-Organization, chosen in
  the settings dialog; remembered per browser in localStorage.
- **Connections** (Cross-Organization) — label, host, client ID and encrypted
  client secret, stored as JSON in the `Value` field of
  `/sitecore/system/Modules/Marketplace/ContentTransferConsole/Settings`.
  Standalone apps are installed once per organization, so the connections
  section starts with a **Save in Environment:** selector choosing which
  environment's content tree stores the list (remembered per browser); on
  startup the app loads and merges the connections of every environment.
  Settings at the legacy path
  `/sitecore/system/Modules/ContentTransferConsole/Settings` are still read
  as a fallback and move to the new path on the next save.
- **Saved transfers** — `/sitecore/system/Modules/Marketplace/ContentTransferConsole/SavedTransfers`.
- **Recent transfers and recent backups** — transfer IDs, `.raif` names and
  backup names kept in localStorage as a convenience; authoritative state
  always comes from the APIs.

## Security and privacy

- **Organization mode** uses the Marketplace SDK with the signed-in user's own
  session; no credentials are stored and the app's server is not involved.
- **Sign-in required for the API.** `src/middleware.ts` checks every `/api/*`
  request for a Sitecore Cloud access token issued to this app (signature,
  issuer, audience, expiry, `azp`). The UI signs in without blocking
  Organization mode. See
  [`src/lib/marketplace-auth/README.md`](src/lib/marketplace-auth/README.md).
- **Secrets.** Automation client secrets are encrypted with AES-256-GCM
  (`enc:v3:<iv>:<tag>:<data>`, key `CT_ENCRYPTION_KEY`) and stored in the
  content tree. Each is bound to the signed-in organization and its
  connection (`orgId|host|clientId` is the GCM additional authenticated
  data), so a ciphertext copied to another organization or connection won't
  decrypt; changing a connection's host or client ID requires entering the
  secret again. Encryption happens server-side through the
  encrypt-only `POST /api/crypto/encrypt`; there is no decrypt endpoint.
  Ciphertext is decrypted only inside the proxy right before the token
  exchange, so read access to the content tree never yields plaintext.
  Plaintext values are encrypted and re-saved when the app loads; the proxy
  accepts only `enc:v3:`, and older `enc:v1:`/`enc:v2:` values must be
  re-entered.
- **Host restrictions.** Hosts must be lowercase `*.sitecorecloud.io` names
  and upstream redirects are refused, so the automation token is never sent
  anywhere else.
- **Data leaving the browser.** In Organization mode, data goes only to
  SitecoreAI through the SDK. In Cross-Organization mode, requests (including
  the encrypted secret and, for chunk copies, the content bytes) pass through
  the app's own server to `auth.sitecorecloud.io` and the environments.
  Backups are written only to the user's own device. Chunks relayed in
  Cross-Organization mode are held in server memory for one request and
  never persisted.
- **No analytics or third-party fonts.** The app uses no analytics or
  tracking; fonts are self-hosted with the app.
- **Security headers.** Responses send HSTS, a `frame-ancestors` Content
  Security Policy (`CSP_FRAME_ANCESTORS`), `X-Content-Type-Options`,
  `Referrer-Policy` and `Permissions-Policy`; `/api` responses are
  `Cache-Control: no-store`.
- **Audit log.** Sign-in decisions and sensitive operations (secret
  encryption, connection tests, transfer create/delete, chunk copy, chunk set
  completion, consumption start/retry, blob discard) are written as JSON
  audit lines with UTC timestamps to the server log: event, outcome,
  organization, environment host and HTTP status. They never contain tokens,
  secrets or content.
- [Privacy policy](PRIVACY.md) · [Terms of service](TERMS.md) ·
  [Data usage disclosure](DATA-USAGE.md) · [Security policy](SECURITY.md)

## Limitations

- Ad hoc `.raif` upload (`POST /sources/blobs/{blobName}`, files < 100 MB) is
  not implemented.
- Organization mode can't list consumption history or discard consumed blobs
  (not exposed by the SDK); consumed `.raif` blobs stay on the destination.
- Organization mode can't combine Media Library and other content in one
  Advanced-tab transfer.
- Backup & Restore is not available in Cross-Organization mode.
- A restore can't be cancelled once the chunks are assembled and consumption
  has started.
- Publish progress is best-effort: publish jobs that can't be observed are
  shown as queued, not as failed.

## Development

- Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Radix UI,
  `class-variance-authority`, `@sitecore-marketplace-sdk/client` 0.4 and
  `@sitecore-marketplace-sdk/xmc` 0.4, `@auth0/auth0-react` + `jose`,
  `@zip.js/zip.js`. Based on the
  [Sitecore Marketplace starter kit](https://github.com/Sitecore/marketplace-starter).
- `npm run dev` serves on port 5003.
- Structure:
  - `src/app/` — the page and the `/api` routes
  - `src/lib/transfer/` — server-side proxy, OAuth token cache, encryption
  - `src/lib/marketplace-auth/` — Sitecore Cloud sign-in kit
  - `src/utils/` — SDK/REST environment client, hooks, backup archive,
    settings storage
  - `components/` — tab UIs and UI primitives
- Deeper docs: [`src/lib/marketplace-auth/README.md`](src/lib/marketplace-auth/README.md).

## Support

Report bugs and request features in
[GitHub Issues](https://github.com/robertobarbedo/sitecoreai-marketplace-content-transfer-api-console/issues).
Report vulnerabilities privately as described in the
[Security policy](SECURITY.md). Data requests: see the
[Privacy policy](PRIVACY.md). This is a community app and is not an official
Sitecore product.

## License

Licensed under the Apache License 2.0 — see [LICENSE](LICENSE).
