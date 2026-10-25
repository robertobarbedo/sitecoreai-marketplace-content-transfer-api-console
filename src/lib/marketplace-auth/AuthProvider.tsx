"use client";

/**
 * Signs the current Sitecore user in through Sitecore Cloud's Auth0 tenant
 * ("custom authorization") and registers the token getter used by
 * authedFetch().
 *
 * Mount it below the Marketplace SDK and pass application.context once loaded:
 *   <MarketplaceAuthProvider appContext={appContext}>...</MarketplaceAuthProvider>
 *
 * clientId / appId default to NEXT_PUBLIC_AUTH0_CLIENT_ID / NEXT_PUBLIC_SITECORE_APP_ID;
 * pass them when one deployment hosts several Marketplace apps.
 * redirectPath (default "/") is where Auth0 returns after login; it must be a
 * route that renders this provider and be registered as a callback URL.
 *
 * blocking (default true): children render only once a token is available.
 * blocking={false}: children render immediately (appContext may still be
 * undefined); only authedFetch() calls wait for sign-in.
 */

import { Auth0Provider, useAuth0, type AppState } from "@auth0/auth0-react";
import type { ApplicationContext } from "@sitecore-marketplace-sdk/client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { setAuthFailure, setTokenGetter } from "./authedFetch";
import {
  AUTH0_AUDIENCE,
  AUTH0_CLIENT_ID,
  AUTH0_DOMAIN,
  AUTH0_SCOPE,
  SITECORE_APP_ID,
} from "./config";

const ORG_STORAGE_KEY = "marketplace-auth:organization";

// Errors that mean the user has to go through the login page again
const RELOGIN_ERRORS = new Set([
  "login_required",
  "consent_required",
  "interaction_required",
  "missing_refresh_token",
  "invalid_grant",
]);

const errorStyle = { color: "red", padding: "8px 12px", margin: 0 };

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeOrg(org: string) {
  try {
    localStorage.setItem(ORG_STORAGE_KEY, org);
  } catch {
    // storage unavailable — org switches just won't be detected
  }
}

function buildAuthParams(appContext: ApplicationContext, appId: string) {
  const params: Record<string, string> = {
    audience: AUTH0_AUDIENCE,
    scope: AUTH0_SCOPE,
  };
  if (appContext.organizationId) params.organization_id = appContext.organizationId;
  if (appContext.marketplaceAppTenantId) params.tenant_id = appContext.marketplaceAppTenantId;
  if (appId) params.product_codes = `mkp_${appId}`;
  return params;
}

function AuthGate({
  appContext,
  appId,
  blocking,
  children,
}: {
  appContext?: ApplicationContext;
  appId: string;
  blocking: boolean;
  children: ReactNode;
}) {
  const { isLoading, isAuthenticated, error, loginWithRedirect, logout, getAccessTokenSilently } =
    useAuth0();
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const authParams = useMemo(
    () => (appContext ? buildAuthParams(appContext, appId) : null),
    [appContext, appId],
  );
  const organizationId: string = appContext?.organizationId ?? "";

  useEffect(() => {
    if (isLoading || !authParams) return;

    const fail = (message: string) => {
      setFailure(message);
      setAuthFailure(new Error(`Sign-in failed: ${message}`));
    };

    if (error) {
      fail(error.message);
      return;
    }

    const login = () =>
      loginWithRedirect({
        authorizationParams: authParams,
        appState: { returnTo: window.location.pathname + window.location.search },
      });

    if (!isAuthenticated) {
      login();
      return;
    }

    // Cached tokens belong to the org they were issued for; start over on a switch
    const storedOrg = readStoredOrg();
    if (organizationId && storedOrg && storedOrg !== organizationId) {
      storeOrg(organizationId);
      logout({ openUrl: false }).then(login);
      return;
    }

    const getToken = async () => {
      const token = await getAccessTokenSilently({ authorizationParams: authParams });
      if (!token) throw new Error("No access token returned");
      return token;
    };

    let cancelled = false;
    getToken()
      .then(() => {
        if (cancelled) return;
        if (organizationId) storeOrg(organizationId);
        setTokenGetter(getToken);
        setReady(true);
      })
      .catch((err: { error?: string; message?: string }) => {
        if (cancelled) return;
        if (err.error && RELOGIN_ERRORS.has(err.error)) {
          login();
        } else {
          fail(err.message ?? String(err));
        }
      });

    return () => {
      cancelled = true;
      setTokenGetter(null);
    };
  }, [
    isLoading,
    isAuthenticated,
    error,
    authParams,
    organizationId,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
  ]);

  if (!blocking) return <>{children}</>;
  if (failure) return <p style={errorStyle}>Sign-in failed: {failure}</p>;
  if (!ready) return <p style={{ padding: "8px 12px", margin: 0 }}>Signing in…</p>;
  return <>{children}</>;
}

export function MarketplaceAuthProvider({
  appContext,
  clientId = AUTH0_CLIENT_ID,
  appId = SITECORE_APP_ID,
  redirectPath = "/",
  blocking = true,
  children,
}: {
  appContext?: ApplicationContext;
  clientId?: string;
  appId?: string;
  redirectPath?: string;
  blocking?: boolean;
  children: ReactNode;
}) {
  const configured = Boolean(clientId);

  useEffect(() => {
    if (!configured) {
      setAuthFailure(new Error("Sign-in is not configured: Auth0 client ID is missing"));
    }
  }, [configured]);

  if (!configured) {
    return blocking ? (
      <p style={errorStyle}>Sign-in is not configured: Auth0 client ID is missing.</p>
    ) : (
      <>{children}</>
    );
  }

  const onRedirectCallback = (appState?: AppState) => {
    window.history.replaceState({}, document.title, appState?.returnTo || "/");
  };

  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={clientId}
      authorizationParams={{
        audience: AUTH0_AUDIENCE,
        scope: AUTH0_SCOPE,
        redirect_uri: `${window.location.origin}${redirectPath}`,
      }}
      // Third-party cookies are blocked in the Marketplace iframe, so silent
      // auth relies on refresh tokens kept in localStorage
      useRefreshTokens
      cacheLocation="localstorage"
      onRedirectCallback={onRedirectCallback}
    >
      <AuthGate appContext={appContext} appId={appId} blocking={blocking}>
        {children}
      </AuthGate>
    </Auth0Provider>
  );
}
