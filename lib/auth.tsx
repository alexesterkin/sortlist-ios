import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { API_BASE_URL } from './config';
import {
  loadSessionCookie,
  onSessionChange,
  setSessionCookie,
} from './session';
import { trpc } from './trpc';
import type { User } from './types';

const NATIVE_REDIRECT_URI = 'sortlist://auth-callback';
const SESSION_COOKIE_NAME = 'app_session_id';

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
    void loadSessionCookie().then(() => setHydrated(true));
    return onSessionChange(() => {
      // Cookie changed (e.g. after Google sign-in writes the JWT). Re-run
      // auth.me so isAuthed flips and the route guard redirects.
      void me.refetch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      // Just call the mutation. tRPC throws TRPCClientError on non-2xx;
      // the caller renders the message. On success, NSURLSession captures
      // the Set-Cookie automatically (iOS) and we explicitly refetch
      // auth.me so isAuthed flips immediately.
      await loginMutation.mutateAsync({ email, password });
      const result = await me.refetch();
      if (!result.data) {
        throw new Error("Couldn't load your account after sign-in.");
      }
    },
    [loginMutation, me],
  );

  const registerWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      await registerMutation.mutateAsync({ name, email, password });
      const result = await me.refetch();
      if (!result.data) {
        throw new Error("Couldn't load your account after sign-up.");
      }
    },
    [registerMutation, me],
  );

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === 'web') {
      // No-op fallback on web — the iOS app is what we ship.
      window.location.href = `${API_BASE_URL}/api/auth/google`;
      return;
    }

    const startUrl = new URL(`${API_BASE_URL}/api/auth/google`);
    startUrl.searchParams.set('redirect_uri', NATIVE_REDIRECT_URI);

    const result = await WebBrowser.openAuthSessionAsync(
      startUrl.toString(),
      NATIVE_REDIRECT_URI,
    );

    if (result.type === 'cancel' || result.type === 'dismiss') {
      // User closed the sheet without completing — silently bail. No error
      // to the caller, no state change.
      return;
    }
    if (result.type !== 'success' || !result.url) {
      throw new Error('Google sign-in did not complete.');
    }

    // The backend redirects to sortlist://auth-callback#token=<JWT> on success
    // or sortlist://auth-callback#error=<reason> on failure. The token rides
    // in the URL fragment so it isn't logged anywhere on the way.
    const { token, error } = parseCallbackUrl(result.url);
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

    // Save the JWT as our cookie value. tRPC's cookieFetch attaches this on
    // every subsequent request as `Cookie: app_session_id=<jwt>`. Goes into
    // the shared keychain access group so the share extension sees it too.
    await setSessionCookie(`${SESSION_COOKIE_NAME}=${token}`);

    const refreshed = await me.refetch();
    if (!refreshed.data) {
      throw new Error("Couldn't load your account after Google sign-in.");
    }
  }, [me]);

  const signOut = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Even if the network call fails, clear the local cookie so the route
      // guard redirects to /(auth)/login.
    }
    await setSessionCookie(null);
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
      // The `(auth)` and `(app)` layouts use isLoading to show a spinner
      // instead of flashing the wrong screen during cold start.
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

// Parse `sortlist://auth-callback#token=<jwt>` or `?token=<jwt>`. We accept
// both because the OS may rewrite the fragment in some flows.
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
