// Tiny self-contained tRPC HTTP client for the iOS share extension.
//
// We deliberately don't import @trpc/* or @tanstack/react-query here so the
// share extension bundle stays small — extensions are memory-constrained.
// Wire format: tRPC v11 + superjson on the backend.
//
// Auth: the backend accepts either `Cookie: app_session_id=<jwt>` or
// `Authorization: Bearer <jwt>`. We attach both on every request — Cookie
// matches the web app's path; Bearer is what the iOS app actually relies
// on because RN's fetch can't read Set-Cookie response headers.

import {
  getSessionToken,
  loadSessionToken,
  parseSetCookieToCookieHeader,
  SESSION_COOKIE_NAME,
  setSessionToken,
} from '@/lib/session';

const TRPC_BASE = 'https://www.sortlist.shop/api/trpc';

export class APIError extends Error {
  code?: string;
  httpStatus?: number;
  constructor(message: string, opts?: { code?: string; httpStatus?: number }) {
    super(message);
    this.code = opts?.code;
    this.httpStatus = opts?.httpStatus;
  }
}

async function call(
  procedure: string,
  input: unknown,
  method: 'GET' | 'POST',
): Promise<unknown> {
  await loadSessionToken();
  const token = getSessionToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) {
    headers['Cookie'] = `${SESSION_COOKIE_NAME}=${token}`;
    headers['Authorization'] = `Bearer ${token}`;
  }

  let url = `${TRPC_BASE}/${procedure}`;
  let body: string | undefined;

  // tRPC + superjson wire format for input. `undefined` becomes null + meta.
  const wireInput =
    input === undefined
      ? { json: null, meta: { values: ['undefined'] } }
      : { json: input };

  if (method === 'GET') {
    url += `?input=${encodeURIComponent(JSON.stringify(wireInput))}`;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(wireInput);
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    credentials: 'include',
  });

  // Capture any Set-Cookie so a refreshed session token from the API persists
  // back into the shared keychain.
  const headersAny = res.headers as unknown as {
    getSetCookie?: () => string[];
    get(name: string): string | null;
  };
  // Best-effort Set-Cookie capture — no-op on iOS RN (forbidden response
  // header) but harmless elsewhere. We extract just the app_session_id
  // value and store it as a plain token.
  const setCookie = headersAny.getSetCookie
    ? headersAny.getSetCookie().join(', ')
    : headersAny.get('set-cookie');
  if (setCookie) {
    const parsed = parseSetCookieToCookieHeader(setCookie);
    if (parsed) {
      const match = parsed
        .split(';')
        .map((s) => s.trim())
        .find((p) => p.startsWith(`${SESSION_COOKIE_NAME}=`));
      if (match) {
        const jwt = match.slice(SESSION_COOKIE_NAME.length + 1);
        if (jwt) await setSessionToken(jwt);
      }
    }
  }

  let payload: { result?: { data?: { json?: unknown } }; error?: { json?: { message?: string; data?: { code?: string; httpStatus?: number } } } };
  try {
    payload = await res.json();
  } catch {
    throw new APIError(`Network error (${res.status})`, { httpStatus: res.status });
  }

  if (payload.error) {
    const err = payload.error.json ?? {};
    throw new APIError(err.message ?? 'Request failed', {
      code: err.data?.code,
      httpStatus: err.data?.httpStatus ?? res.status,
    });
  }

  return payload.result?.data?.json;
}

export type AuthMeResult = {
  id: number;
  name: string | null;
  email: string;
} | null;

export type Collection = {
  id: number;
  name: string;
  itemCount?: number;
};

export type MetaFetchResult = {
  title: string;
  brand?: string;
  price?: string;
  currency?: string;
  imageUrl?: string;
  siteName?: string;
  blocked_message?: string | null;
};

export type AddProductInput = {
  url: string;
  title?: string;
  imageUrl?: string;
  price?: string;
  siteName?: string;
  collectionId?: number;
  newCollectionName?: string;
  notes?: string;
};

export type AddProductResult = {
  product: {
    id: number;
    collectionId: number | null;
    title: string | null;
    url: string;
  };
  aiSuggestion?: {
    assignedSortlistId?: number | null;
    newSortlistName?: string | null;
  } | null;
};

export const api = {
  authMe: () => call('auth.me', undefined, 'GET') as Promise<AuthMeResult>,
  collectionsList: () =>
    call('collections.list', undefined, 'GET') as Promise<Collection[]>,
  metaFetch: (url: string) =>
    call('meta.fetch', { url }, 'POST') as Promise<MetaFetchResult>,
  productsAdd: (input: AddProductInput) =>
    call('products.add', input, 'POST') as Promise<AddProductResult>,
};
