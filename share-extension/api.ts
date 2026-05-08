// Tiny self-contained tRPC HTTP client for the iOS share extension.
//
// We deliberately don't import @trpc/* or @tanstack/react-query here so the
// share extension bundle stays small — extensions are memory-constrained.
// Wire format: tRPC v11 + superjson on the backend.
//
// Query  (GET):  /api/trpc/<proc>?input={"json": <input>}
// Mutation (POST): /api/trpc/<proc>  body: {"json": <input>}
//
// The response envelope is one of:
//   { result: { data: { json: <output>, meta?: ... } } }
//   { error:  { json:  { message, code, data: { code, httpStatus } } } }
//
// We rely on the iOS keychain (shared via keychain-access-groups) to give us
// the same JWT cookie the main app stored at sign-in. We always send it as
// a Cookie header and refresh it from any Set-Cookie response.

import {
  getSessionCookie,
  loadSessionCookie,
  parseSetCookieToCookieHeader,
  setSessionCookie,
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
  await loadSessionCookie();
  const cookie = getSessionCookie();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (cookie) headers['Cookie'] = cookie;

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
  const setCookie = headersAny.getSetCookie
    ? headersAny.getSetCookie().join(', ')
    : headersAny.get('set-cookie');
  if (setCookie) {
    const parsed = parseSetCookieToCookieHeader(setCookie);
    if (parsed) await setSessionCookie(parsed);
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
