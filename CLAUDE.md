# Content Transfer Console — notes for Claude Code

## Do NOT run or test this app standalone

SitecoreAI Marketplace apps **cannot run as standalone web apps**. The
Marketplace SDK (`ClientSDK.init({ target: window.parent })`) requires the app
to be embedded in an iframe inside SitecoreAI — outside of it, initialization
hangs/fails and every page is non-functional. The `/api/transfer/*` and
`/api/item-transfer/*` routes also require real automation client credentials
to return anything useful.

Therefore: **do not start the dev server, open the app in a browser, or
attempt runtime testing.** Verification is limited to:

- `npm run build` (type-check + lint + compile) must pass
- Manual testing happens only inside SitecoreAI after the app is registered
  in Developer Studio (**standalone** extension point → the root route `/`)

## Project facts

- Wraps two Sitecore APIs (docs are machine-readable at
  `https://api-docs.sitecore.com/sai/content-transfer-api.md` and
  `https://api-docs.sitecore.com/sai/item-transfer-api.md`):
  - **Content Transfer API** (v1): `https://{host}/sitecore/api/content/transfer/v1/...`
    — create/status/delete run on the SOURCE env; save-chunk/complete-set run
    on the DESTINATION env; get-chunk runs on the SOURCE.
  - **Item Transfer API** (v3): `https://{host}/sitecore/shell/api/v3/ItemsTransfer/...`
    — DESTINATION env only.
- Based on the marketplace starter kit; only the **standalone** extension
  point is used, served from the root route (`src/app/page.tsx`).
  Standalone apps are **global** (not per tenant): `getTenants()`
  (sitecore-graphql.ts) maps `application.context.resourceAccess` to a tenant
  list (max ~3). The tenant selection ("Save in Environment:" buttons in the
  connections modal; remembered in localStorage) only chooses WHERE settings
  are saved/edited — on startup the page loads the connections of EVERY
  tenant (`connectionsByTenant` in page.tsx) and the source/destination
  dropdowns always offer the merged list (`allConnections`, deduped by id).
- All sibling folders under `C:\Marketplace` are reference material only —
  never modify them. This app mirrors the architecture of
  `sitecoreai-marketplace-experience-edge-admin-console`.
- Settings are a **list of environment connections** (label, host, automation
  client ID/secret), stored in the Sitecore content tree at
  `/sitecore/system/Modules/Marketplace/ContentTransferConsole/Settings`,
  JSON in the `Value` field — in the content tree of the **selected settings
  tenant**. Loads fall back to the legacy pre-Marketplace path
  (`LEGACY_SETTINGS_ITEM_PATH` in constants.ts); saves always write the new
  path and ensure both the Marketplace and module folders exist.
- Browser → own Next.js API routes (env passed via `x-ct-*` headers) → OAuth
  token (`auth.sitecorecloud.io`, client_credentials, audience
  `https://api.sitecorecloud.io`, ~24 h expiry) → environment API at
  `https://{host}`. Tokens are cached server-side only; 401 **and** 403 (the
  documented expired-JWT status) evict + retry once.
- **Secrets at rest**: client secrets are AES-256-GCM encrypted
  (`enc:v1:<iv>:<tag>:<data>`, key = 32-byte base64 `CT_ENCRYPTION_KEY` env
  var) by `src/lib/transfer/crypto.ts`. Invariant: encryption is exposed via
  the encrypt-only route `/api/crypto/encrypt`; **never add a decrypt
  endpoint** — decryption happens only inside `transferFetch` (client.ts)
  right before the token exchange. Legacy plaintext secrets must keep
  passing through `decryptSecret()` unchanged. Missing key ⇒ plaintext
  fallback with a warning in the connections modal; decrypt failures map to
  the `encryption_error` typed error.
- The chunk copy route buffers each chunk in server memory and forwards the
  bytes untouched (media = compressed, content = encrypted; the Save endpoint
  requires the `isMedia` query param read from the GET response's
  Content-Disposition header). Never decompress/decrypt/re-encode chunk data.
- UI: Tailwind CSS v4 + Radix UI + CVA (Blok design language, NOT shadcn).
  UI primitives copied from the edge-admin-console reference app.
- Recent transfers (IDs + produced .raif names) are a localStorage
  convenience; authoritative state always comes from the APIs.
- The **Content Transfer** tab (automatic mode, `useAutoMigration` +
  `auto-migration-tab.tsx`; the step-by-step workspace is the **Advanced**
  tab) chains the same proxy routes client-side:
  hardcoded `master` database, list-based consumption monitoring (see quirk
  below), and full cleanup on success (deletes the source transfer op AND
  discards the consumed blobs). Its TabsContent is `forceMount`ed in
  `page.tsx` so switching tabs doesn't unmount a running pipeline — keep
  that. Failed runs stay in recent transfers for the Advanced tab to attach.
- **API quirk (observed in practice):** `GET /transfers/{transferId}` on the
  Item Transfer API can return 404 for a blob-name id even while/after the
  source is consumed. Consumption state must be derived from the
  `GET /transfers` list (matched by SourceName/Id, case-insensitive); the
  detail endpoint is best-effort enrichment only. Both the Step 3 monitor and
  the Item transfers details dialog follow this pattern — keep it when
  touching them.
- **API quirk (observed in practice):** `GET /history` can leave `ConsumeDate`
  unset, serialized as the .NET minimum date `0001-01-01T00:00:00`. The
  history tab falls back to the Finished event's timestamp, and the shared
  `formatDate` renders year-1 dates as "—".
- The **Saved Transfers** tab stores reusable transfer definitions
  (`SavedTransfer` in types/transfer.ts: name, source/destination connection
  ids + labels, DataTrees, reconcile flag) as one JSON list in a
  `SavedTransfers` settings item next to the connections Settings item.
  **Saves always write to the FIRST tenant in the resource list; loads merge
  the item from every tenant** (dedupe by id, earlier tenant wins) because a
  different tenant may have been first in the past. Executing reuses
  `useAutoMigration` (whose input is now `{ dataTrees: DataTree[] }` — the
  Content Transfer tab passes a single-tree array) and, when "Reconcile at
  the end" is set, chains a reconciliation apply against the **destination**
  environment via the shared engine in `src/utils/reconciliation-apply.ts`
  (plan → fetch current values → execute; also used by the Reconciliation
  tab's ApplyView). The destination connection is mapped to its SitecoreAI
  tenant at execution time by tenantName-substring-of-host, falling back to
  a label match — an unmatched destination fails the reconcile step with an
  explicit error (the transfer itself still completes).
  Its TabsContent is `forceMount`ed like the transfer tab so switching tabs
  doesn't kill a running execution. Tab labels: the automatic transfer tab is
  displayed as **Quick Transfer**, the "Item transfers" tab as **Transfer
  Details History** and the history tab as **Transfer Timeline** (values
  `transfer`/`item-transfers`/`history` unchanged).
- Saved transfers can also **publish at the end** (`SavedTransfer.publish`,
  optional — absent on older entries): after the transfer (and a clean
  reconcile, when both are set; a failed/partially-failed reconcile SKIPS the
  publish) the destination is published via `publishItem` authoring GraphQL
  (`src/utils/publish.ts`, adapted from the publishing-center sibling) — over
  the Marketplace SDK against the destination's resolved tenant (same
  `matchEnvironmentToConnection` mapping as reconcile), NOT the stored REST
  connections. Invariants: `publishSubItems: true`, `publishRelatedItems:
  false`, `targetDatabases: "experienceedge"`; target `EntireTree` publishes
  the hardcoded `/sitecore` root, `TransferredPaths` fires one publish per
  deduped DataTree path; mode `SMART` = Smart, `FULL` = Republish (UI label).
  Languages come from the destination's `languages` query, falling back to
  `en` with a visible warning. Progress is observed by diffing
  `jobs(input:{jobName:"Publish*"})` against a pre-publish baseline of job
  handles (best-effort: unobservable jobs resolve as "queued", never as
  failed).
- The **Reconciliation** tab is a read-only integration with the sibling
  `sitecoreai-marketplace-content-reconciliation` app: on open it checks every
  environment (Marketplace SDK authoring GraphQL, not the stored connections)
  for that app's `Base`/`Secondary` marker items under
  `/sitecore/system/Modules/Marketplace/ContentReconciliation`. Missing
  markers / no base / multiple bases ⇒ a status screen telling the user to
  install/set up the Content Reconciliation app; exactly one Base ⇒ it loads
  that app's `Data` blob and renders a port of its "Preview and apply
  changes" view (`components/reconciliation/apply-view.tsx`). Keep the port's
  invariants from the source app: desired values are keyed by **tenantName**
  (`storedKeyFor`), the GraphQL escaping includes `\n`/`\r`/`\t` (user-typed
  values), and Apply re-fetches the item and passes `max(versions)` right
  before each `updateItem` batch. This tab never creates/repairs the
  reconciliation storage items — that's the other app's job. Types/blob shape
  live in `src/types/reconciliation.ts` and must stay in sync with the
  sibling app.
