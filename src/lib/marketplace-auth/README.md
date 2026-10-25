# marketplace-auth kit

Lets API routes check that a request comes from a signed-in Sitecore user of this app, using Sitecore Cloud's Auth0 tenant ("custom authorization").

The folder has no project-specific imports. To add it to another Marketplace app, copy the folder.

## Files

| File | Side | Purpose |
| --- | --- | --- |
| `config.ts` | both | Auth0 domain, audience, scope, client ID, issuer (from env) |
| `AuthProvider.tsx` | client | `<MarketplaceAuthProvider appContext={...}>` signs the user in. By default children render only once a token is available; with `blocking={false}` they render immediately and only `authedFetch` waits |
| `authedFetch.ts` | client | `authedFetch(url, init)` is `fetch` with `Authorization: Bearer <token>`; waits for sign-in, rejects if it fails |
| `server.ts` | server | `requireSitecoreUser(request)` verifies the token (signature, issuer, audience, expiry, `azp` = this app's client ID) |

## Adding it to an app

1. `npm install @auth0/auth0-react jose`
2. Copy this folder to `src/lib/marketplace-auth/`.
3. Wrap the UI after `application.context` has loaded. It must only render in the browser, never during server prerendering:
   ```tsx
   <MarketplaceAuthProvider appContext={appContext}>…</MarketplaceAuthProvider>
   ```
   Wrap only the part that calls protected routes. If that part shares a component with UI that must not wait for sign-in, wrap the whole UI with `blocking={false}` instead.
4. Call protected routes with `authedFetch` instead of `fetch`.
5. In each protected route:
   ```ts
   const auth = await requireSitecoreUser(request);
   if (!auth.ok) return auth.response;
   ```
6. Set the env vars listed in `.env.example`.

If one deployment hosts several Marketplace apps, each app has its own client credentials. In that case, pass them explicitly instead of using the shared env vars: `<MarketplaceAuthProvider clientId={...} appId={...} redirectPath="/my-app">` and `requireSitecoreUser(request, { clientId })`. `redirectPath` must be the app's own route, and the registered callback URL must be origin + that path. Define the IDs as static `process.env.NEXT_PUBLIC_<APP>_…` references so Next.js inlines them.

## Cloud Portal setup (per app)

- Enable API access in the app configuration and create **client credentials** of type **Single-page app**.
- Register the deployed origin (e.g. `https://myapp.vercel.app`, no path) as the allowed callback URL (with a trailing `/`), logout URL, web origin and CORS origin.
- Put the client ID in `NEXT_PUBLIC_AUTH0_CLIENT_ID` and the app ID in `NEXT_PUBLIC_SITECORE_APP_ID`.

If the client ID is missing, the provider shows a "not configured" message and every protected route returns 500. This is deliberate: without the client ID, the server can't reject tokens that Sitecore issued to other apps.

## Unverified assumptions (check on the first live run)

These come from a community guide plus standard Auth0 behaviour. Decode a real token (e.g. at jwt.io) and adjust `config.ts` / `server.ts` if needed:

- Issuer is `https://auth.sitecorecloud.io/`, and the JWKS is at `<issuer>.well-known/jwks.json`.
- The audience is `https://api-webapp.sitecorecloud.io`.
- The `azp` claim equals this app's client ID.
- The organization is in the `org_id` claim.
- `application.context` exposes `organizationId` and `marketplaceAppTenantId`.
