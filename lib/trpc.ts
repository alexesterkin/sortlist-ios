import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import { TRPC_URL } from './config';
import {
  getSessionToken,
  parseSetCookieToCookieHeader,
  SESSION_COOKIE_NAME,
  setSessionToken,
} from './session';

// Auth transport: Bearer ONLY.
//
// Test matrix (run from the iOS dev client against sortlist.shop):
//   A. Bearer + Cookie  → auth.me returned null
//   B. Cookie only      → auth.me returned null
//   C. Bearer only      → auth.me returned the full user object
//
// The server's authenticateRequest accepts Cookie when it's the only
// transport, but when both are sent it seems to short-circuit on the
// Cookie path and then fail (most likely a session-format mismatch
// between the web app's session cookie value and the JWT we'd put
// behind the same cookie name). Sending only Authorization: Bearer
// sidesteps the whole thing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcReact = createTRPCReact<any>();

export const trpc = trpcReact as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Provider: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createClient: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useUtils: () => any;
};

const DEBUG_TRPC = true;

function logRequest(url: string, sentBearer: boolean) {
  if (!DEBUG_TRPC) return;
  // eslint-disable-next-line no-console
  console.log(
    `[Sortlist tRPC] -> ${shortenUrl(url)} | Bearer: ${sentBearer ? 'yes' : 'no'}`,
  );
}

function logResponse(url: string, status: number, snippet: string) {
  if (!DEBUG_TRPC) return;
  // eslint-disable-next-line no-console
  console.log(
    `[Sortlist tRPC] <- ${shortenUrl(url)} | ${status} | ${snippet}`,
  );
}

function shortenUrl(url: string): string {
  const m = url.match(/\/api\/trpc\/([^?]+)/);
  return m ? m[1] : url;
}

const cookieFetch: typeof fetch = async (input, init) => {
  const token = getSessionToken();
  const headers = new Headers(init?.headers);

  // Bearer ONLY. Explicitly do NOT set a Cookie header — empirically the
  // server's auth path is poisoned when a cookie is also present
  // (see test matrix at the top of this file).
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // And belt-and-braces: don't let the iOS URL session pull cookies
  // out of NSHTTPCookieStorage either. `credentials: 'omit'` keeps
  // every request strictly Authorization-only.
  const reqUrl =
    typeof input === 'string' ? input : (input as Request).url ?? String(input);
  logRequest(reqUrl, !!token);

  const res = await fetch(input as RequestInfo, {
    ...init,
    headers,
    credentials: 'omit',
  });

  // Best-effort Set-Cookie capture for platforms where the response
  // header IS readable. On iOS RN this is a no-op (Set-Cookie is in
  // the fetch spec's forbidden response header list), but we keep the
  // path for robustness. The actual JWT capture for iOS happens in
  // lib/auth.tsx by reading the `token` field from the login/register
  // response body.
  const headersAny = res.headers as unknown as {
    getSetCookie?: () => string[];
    get(name: string): string | null;
  };
  const setCookie = headersAny.getSetCookie
    ? headersAny.getSetCookie().join(', ')
    : headersAny.get('set-cookie');
  if (setCookie) {
    const parsed = parseSetCookieToCookieHeader(setCookie);
    if (parsed) {
      // Extract just our cookie's value from the parsed name=value;... string
      const match = parsed
        .split(';')
        .map((s) => s.trim())
        .find((p) => p.startsWith(`${SESSION_COOKIE_NAME}=`));
      if (match) {
        const jwt = match.slice(SESSION_COOKIE_NAME.length + 1);
        if (jwt) void setSessionToken(jwt);
      }
    }
  }

  if (DEBUG_TRPC) {
    try {
      const clone = res.clone();
      const text = await clone.text();
      logResponse(reqUrl, res.status, snippet(text));
    } catch {
      logResponse(reqUrl, res.status, '<could not read body>');
    }
  }

  return res;
};

function snippet(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) + '…' : oneLine;
}

export function makeTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: TRPC_URL,
        fetch: cookieFetch,
        transformer: superjson,
      }),
    ],
  });
}
