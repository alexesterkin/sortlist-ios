import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import superjson from 'superjson';
import { TRPC_URL } from './config';
import {
  getSessionCookie,
  parseSetCookieToCookieHeader,
  setSessionCookie,
} from './session';

// We don't import a generated AppRouter type from the backend repo, so we
// expose tRPC's React hooks as `any`. This keeps call sites concise (e.g.
// `trpc.auth.login.useMutation(...)`) without fighting tRPC v11's strict
// router-shape inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcReact = createTRPCReact<any>();

// Cast to a permissive type so deeply-nested proxy access type-checks.
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

const cookieFetch: typeof fetch = async (input, init) => {
  const cookie = getSessionCookie();
  const headers = new Headers(init?.headers);
  if (cookie) headers.set('Cookie', cookie);
  const res = await fetch(input as RequestInfo, {
    ...init,
    headers,
    credentials: 'include',
  });

  // Capture Set-Cookie from the response and persist it so subsequent
  // requests carry the JWT cookie. React Native's fetch joins multiple
  // Set-Cookie values with commas; newer runtimes expose getSetCookie().
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
  return res;
};

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
