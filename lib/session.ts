import * as SecureStore from 'expo-secure-store';

const COOKIE_KEY = 'sortlist.session_cookie';

let cachedCookie: string | null = null;
let loaded = false;

const listeners = new Set<(cookie: string | null) => void>();

export async function loadSessionCookie(): Promise<string | null> {
  if (loaded) return cachedCookie;
  try {
    cachedCookie = await SecureStore.getItemAsync(COOKIE_KEY);
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
  if (cookie) {
    await SecureStore.setItemAsync(COOKIE_KEY, cookie);
  } else {
    await SecureStore.deleteItemAsync(COOKIE_KEY);
  }
  listeners.forEach((l) => l(cookie));
}

export function onSessionChange(cb: (cookie: string | null) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Parse a Set-Cookie header (or a string of cookies) and return only
// the name=value pairs in a single Cookie header value.
export function parseSetCookieToCookieHeader(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  // Multiple Set-Cookie values can come comma-separated. Split carefully —
  // expires=Wed, 21 Oct 2025 contains a comma. Standard fetch on RN concatenates
  // cookies with commas; we split on cookie boundaries by looking for ", <name>=".
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
    // Skip cookies that are being deleted (Max-Age=0 or empty value).
    if (value === '' || value === 'deleted') continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.length ? pairs.join('; ') : null;
}
