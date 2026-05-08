import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
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
  const [hasCookie, setHasCookie] = useState(false);

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
    void loadSessionCookie().then((c) => {
      setHasCookie(!!c);
      setHydrated(true);
    });
    return onSessionChange((c) => setHasCookie(!!c));
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      await loginMutation.mutateAsync({ email, password });
      await me.refetch();
    },
    [loginMutation, me],
  );

  const registerWithEmail = useCallback(
    async (name: string, email: string, password: string) => {
      await registerMutation.mutateAsync({ name, email, password });
      await me.refetch();
    },
    [registerMutation, me],
  );

  const signInWithGoogle = useCallback(async () => {
    // Open the backend's Google OAuth flow in an in-app browser session.
    // The backend redirects to a final URL on success; we close the browser
    // when it returns to the app and then re-fetch the session cookie.
    const startUrl = `${API_BASE_URL}/api/auth/google`;
    if (Platform.OS === 'web') {
      // No-op fallback for web preview; real auth happens on device.
      window.location.href = startUrl;
      return;
    }
    const returnUrl = Linking.createURL('auth-callback');
    const result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
    if (result.type !== 'success' && result.type !== 'dismiss') return;
    // Whether or not the deep link returned, the backend may have set a
    // cookie inside the in-app browser session. We rely on the
    // platform's shared cookie store; tRPC requests will pick it up via
    // credentials: 'include'. We also kick a /auth.me refetch.
    await me.refetch();
  }, [me]);

  const signOut = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Even if the network call fails, clear local cookie.
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
      isLoading: !hydrated || me.isLoading || me.isFetching,
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
      me.isFetching,
      signInWithEmail,
      registerWithEmail,
      signInWithGoogle,
      signOut,
      refresh,
    ],
  );

  // Side-effect: keep `hasCookie` referenced so unused-var lints stay quiet.
  void hasCookie;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
