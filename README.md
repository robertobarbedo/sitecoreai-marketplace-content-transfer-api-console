# Content Transfer Console

A Sitecore Marketplace app that transfers content and media between two
SitecoreAI environments, wrapping the
[Content Transfer API](https://api-docs.sitecore.com/sai/content-transfer-api)
(v1) and the companion
[Item Transfer API](https://api-docs.sitecore.com/sai/item-transfer-api) (v3)
in a step-by-step console:

- **Content Transfer (automatic)** — pick one content tree path, scope, and
  merge strategy; the whole pipeline (create → copy chunks → generate `.raif`
  → consume into the destination `master` database → full cleanup) runs
  automatically with a live stage checklist and cancel support
- **Advanced** — the step-by-step workspace:
  - **Step 1 — Create** a content transfer on the *source* environment
    (transfer ID, database, data trees with scope and merge strategy)
  - **Step 2 — Copy chunk sets**: stream every chunk from the source to the
    destination (bytes forwarded untouched, bounded parallelism, resume on
    failure) and complete each set into a `.raif` file
  - **Step 3 — Consume** the `.raif` blob sources into the destination
    database via the Item Transfer API, with live monitoring and retry
  - **Step 4 — Clean up** the transfer operation and discard consumed blobs
- **Item transfers** and **History** tabs for inspecting all consumptions on
  the destination (paged lists, per-item drill-down, state timelines)

Built on the [Sitecore Marketplace starter kit](https://github.com/Sitecore/marketplace-starter)
(Next.js 15 + React 19 + `@sitecore-marketplace-sdk`), using the
**standalone extension point** and the Blok design language (Tailwind CSS v4 +
Radix UI), following the same architecture as the sibling
`sitecoreai-marketplace-experience-edge-admin-console`.

Standalone apps are **global** (installed once per organization, not per
tenant), so the settings dialog starts with a **Save in Environment:**
selector — up to three tenant buttons (e.g. dev / QA / prod) choosing which
tenant's content tree stores the connection list. Each tenant keeps its own
connections; the last choice is remembered per browser.

## How authentication works

Marketplace apps have **no default access** to the Content/Item Transfer
APIs. Users must supply, per environment, the **environment host name** and
the **Client ID / Client Secret** of an *automation client* created in
SitecoreAI Deploy (**Credentials → Environment → Create credentials →
Automation** — requires Organization Admin or Owner).

- Connections are entered in the app's settings dialog and persisted in the
  content tree of the **selected settings tenant** at
  `/sitecore/system/Modules/Marketplace/ContentTransferConsole/Settings`
  (JSON in the `Value` field), via the Marketplace SDK's authoring GraphQL.
  Settings previously stored at the legacy path
  (`/sitecore/system/Modules/ContentTransferConsole/Settings`) are still
  read as a fallback and move to the new path on the next save.
- **Client secrets are encrypted at rest** (AES-256-GCM, stored as
  `enc:v1:<iv>:<tag>:<data>`) using a key from the `CT_ENCRYPTION_KEY`
  environment variable — set it in Vercel (and `.env.local` for dev):

  ```bash
  # generate a key
  openssl rand -base64 32
  ```

  - Encryption happens server-side at save time via the **encrypt-only**
    route `POST /api/crypto/encrypt`. There is deliberately **no decrypt
    endpoint**: ciphertext is decrypted exclusively inside the proxy right
    before the OAuth token exchange, so tree read-access never yields
    plaintext.
  - If the key is not set, saving falls back to **plaintext with a visible
    warning** in the settings dialog; re-saving after configuring the key
    encrypts every connection in the list (legacy plaintext values keep
    working either way).
  - Rotating/changing the key orphans existing ciphertexts — re-enter the
    secrets after a rotation.
- The browser never calls `auth.sitecorecloud.io` or the environment APIs
  directly (they are not CORS-enabled). All calls go through this app's own
  Next.js API routes, which exchange the credentials for an OAuth token
  (`client_credentials` grant, audience `https://api.sitecorecloud.io`) and
  proxy the request. Tokens are cached in server memory until shortly before
  expiry and are never returned to the browser.
- Chunk copying happens **server-side**: the copy route GETs the chunk binary
  from the source and PUTs the identical bytes to the destination (media
  stays compressed, content stays encrypted). Each chunk is buffered in
  server memory during the copy; the payload never reaches the browser.

## Getting started

```bash
npm install
npm run dev
```

The app is served at the root route (`/`) but cannot be used directly in a
browser — the Marketplace SDK requires the app to run inside SitecoreAI.

### Register the app in SitecoreAI

1. Expose your dev server over HTTPS (e.g. `ngrok http 5002`) or deploy
   (e.g. Vercel).
2. In the Sitecore Cloud Portal, open the **Developer Studio** and register a
   new Marketplace app with the **Standalone** extension point pointing to
   `https://<your-host>/`.
3. Install the app for your organization and open it from the apps menu.

### Create automation credentials

1. In SitecoreAI **Deploy**, open **Credentials → Environment → Create
   credentials → Automation** for each environment you want to transfer
   between (you must be an Organization Admin or Owner).
2. Find each environment's host name under **Projects → your project →
   Authoring environments → Details → Environment host name**.
3. Open the console, click the settings gear, add a connection per
   environment (label, host, Client ID, Client Secret), click **Test
   connection**, then **Save connection**.

## API routes

All routes read the target environment from the `x-ct-host` /
`x-ct-client-id` / `x-ct-client-secret` request headers (the chunk copy route
reads an `x-ct-source-*` and `x-ct-dest-*` pair instead) and proxy to
`https://{host}`:

| Route | Methods | Upstream | Purpose |
|---|---|---|---|
| `/api/transfer/validate` | POST | Content Transfer | Validate a connection (token + status probe) |
| `/api/transfer/transfers` | POST | Content Transfer | Create a transfer operation (source) |
| `/api/transfer/transfers/[transferId]` | DELETE | Content Transfer | Delete a transfer + resources (source) |
| `/api/transfer/transfers/[transferId]/status` | GET | Content Transfer | Status + chunk sets (source) |
| `/api/transfer/transfers/[transferId]/chunksets/[chunksetId]/chunks/[chunkId]/copy` | POST | Content Transfer | Copy one chunk source → destination |
| `/api/transfer/transfers/[transferId]/chunksets/[chunksetId]/complete` | POST | Content Transfer | Complete a chunk set → `.raif` (destination) |
| `/api/item-transfer/transfers` | GET | Item Transfer | Paged list of consumptions (destination) |
| `/api/item-transfer/transfers/[transferId]` | GET | Item Transfer | Consumption details/metrics (destination) |
| `/api/item-transfer/databases/[db]/sources` | POST | Item Transfer | Start consuming a blob/file source |
| `/api/item-transfer/databases/[db]/sources/[sourceName]` | PUT | Item Transfer | Retry a failed consumption |
| `/api/item-transfer/databases/[db]/sources/[sourceName]/items` | GET | Item Transfer | Paged transferred items |
| `/api/item-transfer/databases/[db]/sources/[sourceName]/items/[itemId]` | GET | Item Transfer | Item detail |
| `/api/item-transfer/sources/blobs` | GET | Item Transfer | Paged blob sources |
| `/api/item-transfer/sources/blobs/[blobName]` | GET, DELETE | Item Transfer | Blob state / discard blob |
| `/api/item-transfer/sources/files` | GET | Item Transfer | File sources |
| `/api/item-transfer/history` | GET | Item Transfer | Consumption history timelines |
| `/api/authoring/item-children` | POST | Authoring GraphQL | Item + children for the content tree picker (source) |

Error responses use a typed JSON shape:
`{ "error": "invalid_credentials" | "validation" | "transfer_api_error" | "upstream_unreachable" | "missing_credentials", ... }`.
The Content Transfer docs note an expired JWT surfaces as `403 Forbidden`, so
the proxy evicts its cached token and retries once on both 401 and 403.

The routes have no Marketplace SDK dependency, so you can exercise them
locally with `curl` using a real automation client:

```bash
curl -H "x-ct-host: my-env.sitecorecloud.io" \
  -H "x-ct-client-id: <id>" -H "x-ct-client-secret: <secret>" \
  "http://localhost:5003/api/item-transfer/sources/blobs"
```

## Not yet implemented

- Ad hoc `.raif` upload (`POST /sources/blobs/{blobName}`, files < 100 MB) —
  planned as a follow-up
