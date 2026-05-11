import AsyncStorage from '@react-native-async-storage/async-storage';

// We persist the JWT itself, as a plain string, rather than a
// `app_session_id=<jwt>` cookie blob like we did in earlier iterations.
// The cookieFetch in lib/trpc.ts formats both the Cookie and the
// Authorization header from this raw value on every request.
//
// Why AsyncStorage and not SecureStore: SecureStore needs the
// keychain-access-groups entitlement properly applied to the build,
// which has been flaky in development. AsyncStorage works in every
// build with no entitlement plumbing. iOS file protection still
// guards the JWT while the device is locked.
const TOKEN_KEY = 'sortlist.session_token';

// Legacy key from earlier iterations where we stored
// `app_session_id=<jwt>`. We migrate-on-read so users who already
// installed an older preview build don't have to sign in again.
const LEGACY_COOKIE_KEY = 'sortlist.session_cookie';
const COOKIE_NAME = 'app_session_id';

let cachedToken: string | null = null;
let loaded = false;

const listeners = new Set<(token: string | null) => void>();

export const SESSION_COOKIE_NAME = COOKIE_NAME;

export async function loadSessionToken(): Promise<string | null> {
  if (loaded) return cachedToken;

  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (raw) {
      cachedToken = raw;
    } else {
      // Try to migrate the legacy key.
      const legacy = await AsyncStorage.getItem(LEGACY_COOKIE_KEY);
      if (legacy) {
        cachedToken = stripCookiePrefix(legacy);
        if (cachedToken) {
          await AsyncStorage.setItem(TOKEN_KEY, cachedToken);
          await AsyncStorage.removeItem(LEGACY_COOKIE_KEY);
        }
      }
    }
  } catch {
    cachedToken = null;
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
  try {
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(LEGACY_COOKIE_KEY);
    }
  } catch {
    // If the disk write fails the in-memory value is still set, so the
    // current session keeps working — we'll just lose it on next launch.
  }
  listeners.forEach((l) => l(token));
}

export function onSessionChange(cb: (token: string | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ─── Compatibility shims ─────────────────────────────────────────────────────
// Older callers used `getSessionCookie` / `setSessionCookie` / `loadSessionCookie`
// and passed an `app_session_id=<jwt>` blob. We keep those exports working so
// nothing else in the tree has to change in lockstep — they just route through
// the new plain-token store.

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
  const token = stripCookiePrefix(cookie) ?? cookie;
  await setSessionToken(token);
}

function stripCookiePrefix(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept either a bare JWT or a Cookie-style "name=value" blob.
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return trimmed;
  const name = trimmed.slice(0, eqIdx).trim();
  if (name === COOKIE_NAME) {
    return trimmed.slice(eqIdx + 1).trim() || null;
  }
  // Otherwise return as-is and let the caller deal with it.
  return trimmed;
}

// Kept for the trpc.ts cookieFetch's Set-Cookie capture path on
// platforms / runtimes where the response header IS readable. We
// rarely hit this on iOS but it costs nothing to leave intact.
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
