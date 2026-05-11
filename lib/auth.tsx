import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { API_BASE_URL } from './config';
import {
  loadSessionToken,
  onSessionChange,
  setSessionToken,
} from './session';
import { trpc } from './trpc';
import type { User } from './types';

const NATIVE_REDIRECT_URI = 'sortlist://auth-callback';

// CORS note: React Native's fetch on iOS isn't bound by the browser CORS
// model — no preflight, no Origin enforcement. CORS can't be the cause
// of an auth failure here. The cookie problem is unrelated: it's that
// the fetch spec lists "set-cookie" as a forbidden response header, and
// RN's polyfill honors that, so `response.headers.get('set-cookie')`
// always returns null on iOS even though NSURLSession sees the header
// fine. The backend now also returns the JWT in the response body
// (`token` field on login / register) so we can attach it manually.

type AuthState = {
  user: User | null;
  isLoading: boolean;
  isAuthed: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Light wrappers around console so every auth-flow log line has the
// same prefix and shows up grouped in `xcrun simctl spawn booted log
// stream` filtered on the app process.
const log = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.log('[Sortlist Auth]', ...args);
};
const warn = (...args: unknown[]) => {
  // eslint-disable-next-line no-console
  console.warn('[Sortlist Auth]', ...args);
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  const me = trpc.auth.me.useQuery(undefined, {
    enabled: hydrated,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const loginMutation = trpc.auth.login.useMutation();
  const registerMutation = trpc.auth.register.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();

  useEffect(() => {
    log('hydrating: loading session token from AsyncStorage');
    void loadSessionToken().then((t) => {
      log('hydrated: token present?', !!t);
      setHydrated(true);
    });
    return onSessionChange((t) => {
      log('session token changed externally; token present?', !!t);
      void me.refetch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const storeTokenFromMutationResult = useCallback(
    async (result: unknown) => {
      // The backend now returns { success: true, token: "<jwt>" } on login
      // and register. Extract the token and store it as a cookie pair so
      // tRPC's cookieFetch attaches it on every subsequent request.
      const token =
        typeof result === 'object' &&
        result !== null &&
        'token' in result &&
        typeof (result as { token: unknown }).token === 'string'
          ? (result as { token: string }).token
          : null;
      if (!token) {
        warn(
          'response did not include a token field; falling back to ' +
            'NSURLSession auto-cookie (unreliable on iOS production builds)',
        );
        return;
      }
      log('storing JWT (length', token.length, ') as plain token');
      await setSessionToken(token);
    },
    [],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      log('signInWithEmail: calling auth.login for', maskEmail(email));
      try {
        const result = await loginMutation.mutateAsync({ email, password });
        log('signInWithEmail: auth.login success', summarizeResult(result));
        await storeTokenFromMutationResult(result);
      } catch (e) {
        warn('signInWithEmail: auth.login error', describeError(e));
        throw e;
      }

      log('signInWithEmail: refetching auth.me');
      const refreshed = await me.refetch();
      log(
        'signInWithEmail: auth.me result —',
        refreshed.error ? `error: ${describeError(refreshed.error)}` : 'no error',
        'data:',
        refreshed.data ? '(user)' : refreshed.data,
      );
      if (!refreshed.data) {
        throw new Error(
          buildLoadFailureMessage('signInWithEmail', refreshed),
        );
      }
    },
    [loginMutation, me, storeTokenFromMutationResult],
  );

  const registerWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      log('registerWithEmail: calling auth.register for', maskEmail(email));
      try {
        const result = await registerMutation.mutateAsync({ name, email, password });
        log('registerWithEmail: auth.register success', summarizeResult(result));
        await storeTokenFromMutationResult(result);
      } catch (e) {
        warn('registerWithEmail: auth.register error', describeError(e));
        throw e;
      }

      log('registerWithEmail: refetching auth.me');
      const refreshed = await me.refetch();
      if (!refreshed.data) {
        throw new Error(buildLoadFailureMessage('registerWithEmail', refreshed));
      }
    },
    [registerMutation, me, storeTokenFromMutationResult],
  );

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === 'web') {
      window.location.href = `${API_BASE_URL}/api/auth/google`;
      return;
    }

    const startUrl = new URL(`${API_BASE_URL}/api/auth/google`);
    startUrl.searchParams.set('redirect_uri', NATIVE_REDIRECT_URI);
    log('signInWithGoogle: opening', startUrl.toString());

    const result = await WebBrowser.openAuthSessionAsync(
      startUrl.toString(),
      NATIVE_REDIRECT_URI,
    );
    log('signInWithGoogle: auth session result type =', result.type);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return;
    }
    if (result.type !== 'success' || !result.url) {
      throw new Error('Google sign-in did not complete.');
    }

    const { token, error } = parseCallbackUrl(result.url);
    log('signInWithGoogle: parsed callback — token?', !!token, 'error?', error ?? null);
    if (error) {
      throw new Error(
        error === 'google_failed'
          ? 'Google sign-in failed. Try again.'
          : `Google sign-in error: ${error}`,
      );
    }
    if (!token) {
      throw new Error("Google sign-in didn't return a session.");
    }

    log('signInWithGoogle: storing JWT (length', token.length, ')');
    await setSessionToken(token);

    log('signInWithGoogle: refetching auth.me');
    const refreshed = await me.refetch();
    if (!refreshed.data) {
      throw new Error(buildLoadFailureMessage('signInWithGoogle', refreshed));
    }
    log('signInWithGoogle: success, user loaded');
  }, [me]);

  const signOut = useCallback(async () => {
    log('signOut: calling auth.logout + clearing local cookie');
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      warn('signOut: auth.logout failed (ignoring):', describeError(e));
    }
    await setSessionToken(null);
    await me.refetch();
  }, [logoutMutation, me]);

  const refresh = useCallback(async () => {
    await me.refetch();
  }, [me]);

  const user = (me.data ?? null) as User | null;

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthed: !!user,
      isLoading: !hydrated || me.isLoading,
      signInWithEmail,
      registerWithEmail,
      signInWithGoogle,
      signOut,
      refresh,
    }),
    [
      user,
      hydrated,
      me.isLoading,
      signInWithEmail,
      registerWithEmail,
      signInWithGoogle,
      signOut,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function parseCallbackUrl(raw: string): { token?: string; error?: string } {
  const out: { token?: string; error?: string } = {};
  const hashIdx = raw.indexOf('#');
  const queryIdx = raw.indexOf('?');
  const segments: string[] = [];
  if (hashIdx >= 0) segments.push(raw.slice(hashIdx + 1));
  if (queryIdx >= 0) {
    const end = hashIdx >= 0 ? hashIdx : raw.length;
    segments.push(raw.slice(queryIdx + 1, end));
  }
  for (const seg of segments) {
    for (const pair of seg.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k === 'token') out.token = decodeURIComponent(v);
      else if (k === 'error') out.error = decodeURIComponent(v);
    }
  }
  return out;
}

function maskEmail(email: string): string {
  const [name = '', domain = ''] = email.split('@');
  if (!name || !domain) return '<bad-email>';
  return `${name.slice(0, 2)}***@${domain}`;
}

function summarizeResult(result: unknown): string {
  if (typeof result !== 'object' || result === null) return String(result);
  const r = result as Record<string, unknown>;
  const hasToken = typeof r.token === 'string' && (r.token as string).length > 0;
  return `keys=${Object.keys(r).join(',')} token=${hasToken ? 'present' : 'MISSING'}`;
}

function describeError(e: unknown): string {
  if (!e) return 'null';
  const err = e as {
    message?: string;
    data?: { code?: string; httpStatus?: number };
    shape?: { message?: string };
  };
  const code = err?.data?.code ?? '';
  const status = err?.data?.httpStatus ?? '';
  const msg = err?.message ?? err?.shape?.message ?? String(e);
  return [code, status, msg].filter(Boolean).join(' / ');
}

function buildLoadFailureMessage(
  source: string,
  refetched: { data?: unknown; error?: unknown },
): string {
  const hint = refetched.error
    ? ` (server: ${describeError(refetched.error)})`
    : ' (auth.me returned null — JWT cookie not attached?)';
  warn(`${source}: load failure${hint}`);
  return `Couldn't load your account after sign-in.${hint}`;
}
