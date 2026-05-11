import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// JWT session storage.
//
// Primary store: expo-secure-store with a shared keychain access group.
// Both the main app's entitlements (declared via `ios.entitlements` in
// app.json) and the share extension's entitlements (patched by
// plugins/with-share-extension-keychain.js) list the same access group,
// so the share extension can read the JWT the main app wrote at sign-in.
// This is the ONLY mechanism on iOS that survives cross-target without
// shipping a native module — AsyncStorage is sandboxed per target.
//
// Fallback store: AsyncStorage. Used when SecureStore throws (e.g. dev
// builds where the entitlement didn't get applied, simulators where the
// access group is unavailable). The main app keeps working either way;
// the share extension only sees the token via SecureStore.

const ACCESS_GROUP = 'com.alexesterkin.sortlist';
const TOKEN_KEY = 'sortlist.session_token';
const LEGACY_COOKIE_KEY = 'sortlist.session_cookie'; // pre-rename users
const COOKIE_NAME = 'app_session_id';

const secureOpts: SecureStore.SecureStoreOptions = {
  accessGroup: ACCESS_GROUP,
  // Read after first device unlock so the share extension can hit it
  // even when the device just rebooted and the user hasn't opened the
  // app yet — as long as the device is unlocked.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const SESSION_COOKIE_NAME = COOKIE_NAME;

let cachedToken: string | null = null;
let loaded = false;
const listeners = new Set<(token: string | null) => void>();

async function readSecure(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY, secureOpts);
  } catch {
    return null;
  }
}

async function writeSecure(token: string | null): Promise<void> {
  try {
    if (token) {
      await SecureStore.setItemAsync(TOKEN_KEY, token, secureOpts);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY, secureOpts);
    }
  } catch {
    // SecureStore unavailable (no entitlement, simulator quirk, etc).
    // Not fatal — AsyncStorage still has the value as a fallback.
  }
}

async function readAsync(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (raw) return raw;
    // Migrate the legacy `app_session_id=<jwt>`-blob entry if present.
    const legacy = await AsyncStorage.getItem(LEGACY_COOKIE_KEY);
    if (!legacy) return null;
    const eq = legacy.indexOf('=');
    const migrated =
      eq > 0 && legacy.slice(0, eq).trim() === COOKIE_NAME
        ? legacy.slice(eq + 1).trim()
        : legacy.trim();
    if (migrated) {
      await AsyncStorage.setItem(TOKEN_KEY, migrated);
      await AsyncStorage.removeItem(LEGACY_COOKIE_KEY);
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeAsync(token: string | null): Promise<void> {
  try {
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(LEGACY_COOKIE_KEY);
    }
  } catch {
    // ignore — the in-memory cache still holds the value
  }
}

export async function loadSessionToken(): Promise<string | null> {
  if (loaded) return cachedToken;

  // Try the shared keychain first. If it has a value, prefer it (the
  // share extension may have refreshed it since the main app last
  // wrote, or vice versa).
  const fromSecure = await readSecure();
  if (fromSecure) {
    cachedToken = fromSecure;
    // Mirror to AsyncStorage so the fallback path also has a fresh
    // value on next launch.
    await writeAsync(fromSecure);
  } else {
    // Otherwise fall back to AsyncStorage. If we find a value there,
    // push it into SecureStore so the share extension can see it too.
    const fromAsync = await readAsync();
    cachedToken = fromAsync;
    if (fromAsync) {
      await writeSecure(fromAsync);
    }
  }

  loaded = true;
  return cachedToken;
}

export function getSessionToken(): string | null {
  return cachedToken;
}

export async function setSessionToken(token: string | null): Promise<void> {
  cachedToken = token;
  loaded = true;
  // Write to BOTH stores. SecureStore is what makes the token visible
  // to the share extension; AsyncStorage is the always-works backup.
  await Promise.all([writeSecure(token), writeAsync(token)]);
  listeners.forEach((l) => l(token));
}

export function onSessionChange(cb: (token: string | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Compatibility shims (cookie-shaped API) ────────────────────────────────
// Older call sites referred to a "cookie" of the form `app_session_id=<jwt>`.
// We keep the cookie-named exports working so callers can migrate at their
// own pace — they route through the new plain-token store.

export const loadSessionCookie = loadSessionToken;

export function getSessionCookie(): string | null {
  const t = cachedToken;
  return t ? `${COOKIE_NAME}=${t}` : null;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  if (!cookie) {
    await setSessionToken(null);
    return;
  }
  const eq = cookie.indexOf('=');
  const token =
    eq > 0 && cookie.slice(0, eq).trim() === COOKIE_NAME
      ? cookie.slice(eq + 1).trim()
      : cookie.trim();
  await setSessionToken(token || null);
}

// Used by cookieFetch's Set-Cookie capture path on platforms / runtimes
// where the response header IS readable.
export function parseSetCookieToCookieHeader(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  const pairs: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const semi = trimmed.indexOf(';');
    const nameValue = semi === -1 ? trimmed : trimmed.slice(0, semi);
    const eq = nameValue.indexOf('=');
    if (eq <= 0) continue;
    const name = nameValue.slice(0, eq).trim();
    const value = nameValue.slice(eq + 1).trim();
    if (!name) continue;
    if (value === '' || value === 'deleted') continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.length ? pairs.join('; ') : null;
}
