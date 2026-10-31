# Privacy Policy

**Last updated: 2026-10-31**

## Overview

This policy explains what data the Content Transfer Console ("the app")
handles, where it goes, what is stored, and how you can exercise your
rights. It applies to the hosted app listed in the Sitecore Marketplace.

## Summary

- The app has no database. Its server stores no Sitecore content, transfer
  packages, credentials or tokens on disk.
- The app uses no analytics, tracking or advertising services.
- The app has two transfer modes. In **Organization mode** (the default)
  everything runs in your browser over the Sitecore Marketplace SDK and the
  app's server is not involved. In **Cross-Organization mode** the app's
  server relays requests, using automation client credentials you store in
  your own SitecoreAI content tree.
- The only data kept on the publisher's side are short audit and runtime log
  lines (who called the API, the outcome, the environment host name and the
  HTTP status), retained for 90 days.

## How the app works

The app runs inside SitecoreAI and moves content between your environments
with the Sitecore Content Transfer API and Item Transfer API. It also uses
the Sitecore Authoring and Management GraphQL API to store its settings,
browse the content tree, publish and apply reconciliation values.

- **Organization mode.** Every call goes from your browser through the
  Marketplace SDK to the environments the app is installed on, with your own
  SitecoreAI session and permissions. Transfer chunks are copied in your
  browser. No credentials are needed or stored.
- **Cross-Organization mode.** You add a connection per environment (label,
  host name, automation client ID and client secret). The browser calls the
  app's own `/api` routes, which exchange the automation client credentials
  for a token at Sitecore Cloud (`auth.sitecorecloud.io`) and call the
  environment API. Hosts are limited to `*.sitecorecloud.io` names.

## What data the app handles

- **Sitecore content and metadata** (item paths, names, IDs, transfer IDs,
  chunk set IDs, item counts, consumption state and history): read from and
  written to your environments; shown in your browser.
- **Transfer packages** (content chunks; media chunks are compressed and
  content chunks are encrypted by Sitecore): in Organization mode they pass
  through your browser only; in Cross-Organization mode each chunk passes
  through the app's server, held in memory for the duration of one copy
  request and never written to disk.
- **Automation client credentials** (Cross-Organization mode): host name,
  client ID and client secret. The secret is encrypted by the app's server
  and the encrypted value is stored in your own content tree.
- **Account identifiers**: your Sitecore Cloud user ID (the token's `sub`)
  and organization ID, taken from the access token when the browser calls
  the app's API.
- **Backup author** (Backup & Restore): your SitecoreAI user ID, name and
  email are written into the backup ZIP's manifest, which is saved on your
  own device.
- **Sign-in tokens**: your Sitecore Cloud access and refresh tokens, kept in
  your browser.
- **Preferences and history**: transfer mode, settings environment, recent
  transfer IDs and recent backup names, kept in your browser.

## Where data goes

1. **Sitecore.** All Content Transfer, Item Transfer and GraphQL calls go to
   your SitecoreAI environments, either through the Marketplace SDK
   (Organization mode) or from the app's server (Cross-Organization mode),
   and sign-in requests go to Sitecore Cloud (see [Sign-in](#sign-in)).
2. **The app's own server (Cross-Organization mode only).** The browser sends
   the environment host name, client ID and encrypted client secret in
   request headers, together with your Sitecore Cloud access token, which
   proves you are signed in. To save a connection, the browser sends the
   plain client secret once to `POST /api/crypto/encrypt`, which returns
   only the encrypted value. The server decrypts the secret only in memory,
   right before requesting a token from `auth.sitecorecloud.io`, and caches
   the resulting token in memory until shortly before it expires. Tokens are
   never returned to the browser.
3. **Your device.** Backups are written to a ZIP file on your device (a save
   dialog, or a normal download staged in the browser's private file
   storage).

The app does not sell or share data with anyone else.

## What is stored and where

| Data | Where | Retention |
| --- | --- | --- |
| Connections: label, host, client ID and the encrypted client secret (Cross-Organization mode) | Your SitecoreAI content tree, `/sitecore/system/Modules/Marketplace/ContentTransferConsole/Settings` | Until you delete the connection or the item |
| Saved transfer definitions (names, environment labels/IDs, paths, options) | Your SitecoreAI content tree, `/sitecore/system/Modules/Marketplace/ContentTransferConsole/SavedTransfers` | Until you delete them or the item |
| Transfer operations and `.raif` blobs | Your SitecoreAI environments (created by the Sitecore APIs; the app deletes them on cleanup) | Until cleanup, or as Sitecore retains them |
| Audit log lines: time (UTC), API path, event (for example `auth`, `secret.encrypt`, `transfer.create`, `transfer.chunk.copy`), outcome, Sitecore user ID (sign-in lines), organization ID, environment host name, HTTP status, denial reason | The publisher's server logs (Vercel runtime logs and the publisher's log store) | 90 days |
| Standard request metadata recorded by the hosting provider (IP address, time, path, user agent) | Vercel | 90 days at most |
| Automation tokens (Cross-Organization mode) | Server memory only | Until shortly before expiry (about 24 hours) or the server instance stops |
| Sign-in tokens and current organization ID | Your browser's `localStorage` | Until you sign out, the session expires, or you clear site data |
| Preferences, recent transfers, recent backups | Your browser's `localStorage` | Until you clear site data |
| Backup ZIPs (content chunks and a manifest with the backup author) | Your device | As long as you keep the file |

Log lines never contain tokens, client secrets, Sitecore content or transfer
data.

## Who can access it

- **Server logs:** only the app's maintainer, for operating, securing and
  troubleshooting the app, and the hosting provider as a sub-processor.
- **Content tree items:** users of your SitecoreAI environment with read
  access to the module folder. Read access never yields a usable secret: the
  stored value is encrypted and only decrypts on the app's server, for your
  organization and that connection.
- **Browser storage and backups:** only you, on your own device.
- **Sitecore data:** governed by your SitecoreAI permissions (Organization
  mode) or the automation client's permissions (Cross-Organization mode) and
  your agreement with Sitecore.

## How data is protected

- All traffic uses HTTPS (TLS 1.2 or later) with HSTS.
- The API verifies every Sitecore Cloud access token (signature, issuer,
  audience, expiry and that it was issued to this app) before acting.
- Client secrets are encrypted with AES-256-GCM and bound to your
  organization, the host and the client ID; there is no decrypt endpoint.
- The server only sends tokens to `*.sitecorecloud.io` hosts and refuses
  upstream redirects.
- Security headers restrict which sites may embed the app.
- Logs are stored with the hosting provider's encryption at rest.

## Sign-in

The app's API requires you to sign in with your Sitecore Cloud account
(Sitecore's Auth0 tenant at `auth.sitecorecloud.io`). The sign-in is handled
by Sitecore and does not block Organization mode. The app only receives the
resulting access and refresh tokens; the browser sends the refresh token
back to Sitecore's sign-in service to renew your session.

## Local storage

The app uses your browser's local storage for:

- the transfer mode and the environment that stores settings
- recent transfer IDs, `.raif` names and recent backup names
- sign-in tokens (access and refresh tokens) and the current organization
  ID, so you stay signed in. The organization ID is kept so that switching
  organization forces a new sign-in.

During a backup the ZIP may be staged in the browser's private file storage
before it is downloaded; the next backup removes it. This data stays on your
device. You can clear all of it by clearing your browser data for the app.

## Sub-processors and third parties

- **Vercel Inc.** (hosting). Serverless functions run in the United States
  (region `iad1`, Washington, D.C.) unless a deployment sets another region.
  See https://vercel.com/legal/privacy-policy.
- **Sitecore** (sign-in, token exchange and the SitecoreAI APIs), under your
  own agreement with Sitecore.

No analytics, tracking or advertising services are used.

## Your rights

Depending on where you live (for example under the GDPR or CCPA), you may
have the right to access, correct, delete, restrict or object to the
processing of your personal data, and to receive a copy of it.

To make a request, email rb205@proton.me with the subject "Data request".
Include your Sitecore Cloud organization ID and, if you know it, your user
ID, so we can find the matching log lines. We answer within 30 days. The
only personal data the publisher holds is in the server logs described
above; data in your SitecoreAI environment is under your control. You can
also complain to your local data protection authority.

## Deletion

- **Server logs** are deleted automatically after 90 days. On a verified
  request we delete matching log lines sooner where the log store allows it.
- **Connections and saved transfers** are deleted by removing them in the
  app, or by deleting the
  `/sitecore/system/Modules/Marketplace/ContentTransferConsole` folder
  (and the legacy `/sitecore/system/Modules/ContentTransferConsole` folder,
  if present) in your environment.
- **Browser data** is deleted when you sign out or clear site data for the
  app. Backup ZIPs are deleted by deleting the files.

## Changes to this policy

We may update this policy from time to time. Changes are published in this
file and reflected in the "Last updated" date at the top.

## Contact

Questions about this policy: email rb205@proton.me or open an issue at
https://github.com/robertobarbedo/sitecoreai-marketplace-content-transfer-api-console/issues.
