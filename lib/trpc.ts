import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import { TRPC_URL } from './config';
import {
  getSessionCookie,
  parseSetCookieToCookieHeader,
  setSessionCookie,
} from './session';

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

// Toggle off when we're confident the auth flow is solid in production.
// In a preview build this prints one line per tRPC request, which is
// invaluable for tracing "auth.me returned null" type failures via
// xcrun simctl spawn booted log stream or the Devices and Simulators
// log viewer.
const DEBUG_TRPC = true;

function logRequest(url: string, hasCookie: boolean) {
  if (!DEBUG_TRPC) return;
  // eslint-disable-next-line no-console
  console.log(
    `[Sortlist tRPC] -> ${shortenUrl(url)} | cookie attached: ${hasCookie}`,
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
  // /api/trpc/auth.me?batch=1&input=...  -> auth.me
  const m = url.match(/\/api\/trpc\/([^?]+)/);
  return m ? m[1] : url;
}

const cookieFetch: typeof fetch = async (input, init) => {
  const cookie = getSessionCookie();
  const headers = new Headers(init?.headers);
  if (cookie) headers.set('Cookie', cookie);

  const reqUrl =
    typeof input === 'string' ? input : (input as Request).url ?? String(input);
  logRequest(reqUrl, !!cookie);

  const res = await fetch(input as RequestInfo, {
    ...init,
    headers,
    credentials: 'include',
  });

  // iOS RN fetch can't read Set-Cookie response headers (it's listed as a
  // forbidden response header in the fetch spec, and the polyfill honors
  // that). NSURLSession does stash the cookie internally, but auto-
  // attachment to follow-up requests has proven unreliable. The auth
  // mutations now also return the token in the response body, so we
  // capture it from there — see lib/auth.tsx. This block stays as a
  // best-effort second path: on platforms / runtimes where Set-Cookie
  // *is* readable, we still grab it.
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
      const merged = mergeCookies(getSessionCookie(), parsed);
      void setSessionCookie(merged);
    }
  }

  // Snapshot the body for the diagnostic log without consuming the
  // stream the caller will read. clone() is cheap.
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
  // First 200 chars, single line.
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? oneLine.slice(0, 200) + '…' : oneLine;
}

function mergeCookies(existing: string | null, incoming: string): string {
  const map = new Map<string, string>();
  for (const piece of [existing ?? '', incoming]) {
    for (const part of piece.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
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
