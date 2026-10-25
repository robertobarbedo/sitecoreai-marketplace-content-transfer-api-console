/**
 * fetch() wrapper that attaches the Sitecore user's Auth0 access token.
 * The token getter is registered by <MarketplaceAuthProvider>, so this can be
 * called from any component, callback or utility below it. Calls made before
 * sign-in has finished wait for it; they reject if sign-in fails.
 */

type TokenGetter = () => Promise<string>;

let tokenGetter: TokenGetter | null = null;
let failure: Error | null = null;
let waiters: Array<() => void> = [];

function notifyWaiters() {
  const pending = waiters;
  waiters = [];
  pending.forEach((wake) => wake());
}

export function setTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
  if (getter) failure = null;
  notifyWaiters();
}

export function setAuthFailure(error: Error) {
  failure = error;
  notifyWaiters();
}

function waitForTokenGetter(): Promise<TokenGetter> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (tokenGetter) resolve(tokenGetter);
      else if (failure) reject(failure);
      else waiters.push(check);
    };
    check();
  });
}

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const getToken = await waitForTokenGetter();
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
