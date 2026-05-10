import AsyncStorage from '@react-native-async-storage/async-storage';

// Where we persist the JWT session cookie between app launches.
//
// We use AsyncStorage rather than expo-secure-store for now. SecureStore needs
// the `keychain-access-groups` entitlement to be applied to the iOS build, and
// in development that entitlement isn't always reliably plumbed through —
// SecureStore then throws errSecMissingEntitlement on every call and breaks
// auth entirely. AsyncStorage is a plain file-backed store in the app
// sandbox; it works in every build with no entitlement plumbing.
//
// Trade-off: AsyncStorage isn't encrypted at rest. iOS app data on disk is
// already protected by file protection while the device is locked, so a JWT
// here is roughly as exposed as a cookie in a Safari cookie jar. The
// production release build should switch back to SecureStore with the shared
// keychain group so the share extension can read the same cookie.
const COOKIE_KEY = 'sortlist.session_cookie';

let cachedCookie: string | null = null;
let loaded = false;

const listeners = new Set<(cookie: string | null) => void>();

export async function loadSessionCookie(): Promise<string | null> {
  if (loaded) return cachedCookie;
  try {
    cachedCookie = await AsyncStorage.getItem(COOKIE_KEY);
  } catch {
    cachedCookie = null;
  }
  loaded = true;
  return cachedCookie;
}

export function getSessionCookie(): string | null {
  return cachedCookie;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  cachedCookie = cookie;
  loaded = true;
  try {
    if (cookie) {
      await AsyncStorage.setItem(COOKIE_KEY, cookie);
    } else {
      await AsyncStorage.removeItem(COOKIE_KEY);
    }
  } catch {
    // If the disk write fails the in-memory value is still set, so the
    // current session keeps working — we'll just lose it on the next launch.
  }
  listeners.forEach((l) => l(cookie));
}

export function onSessionChange(cb: (cookie: string | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Parse a Set-Cookie header (or a string of cookies) and return only the
// name=value pairs in a single Cookie header value.
export function parseSetCookieToCookieHeader(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // Multiple Set-Cookie values can come comma-separated. Split carefully —
  // expires=Wed, 21 Oct 2025 contains a comma. Standard fetch on RN
  // concatenates cookies with commas; we split on cookie boundaries by
  // looking for ", <name>=".
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
