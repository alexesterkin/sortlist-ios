import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { setPendingWebViewUrl } from './webview-bridge';

const ALLOWED_NAVIGATE_HOSTS = new Set(['sortlist.shop', 'www.sortlist.shop']);

/**
 * Sanity-check a URL we're about to load into the home-tab WebView. The
 * SE produces these from inside a sandboxed extension we don't 100%
 * control — so we lock the navigation target down to sortlist.shop
 * apex/www. Anything else falls back to the WebView's default home.
 */
function safeNavigateUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!ALLOWED_NAVIGATE_HOSTS.has(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function useDeepLinkHandler(isAuthed: boolean) {
  useEffect(() => {
    const handle = (incomingUrl: string | null) => {
      if (!incomingUrl) return;

      // Universal Link path: incoming URL is itself an https://sortlist.shop
      // URL, delivered by iOS via the associated-domains entitlement.
      // This is the primary "Go to sortlist" path from Build 15 onward —
      // the SE produces a Universal Link instead of a custom scheme URL
      // because extensionContext.open(sortlist://…) was returning false.
      //
      // We push the URL straight to the webview-bridge (unconditionally,
      // see auth-race note below) and trust that the bridge + the WebView
      // already know how to load sortlist.shop URLs safely. Only the
      // explicit router.replace home is gated on isAuthed, so an unauthed
      // open lands the user on the login screen with the URL queued and
      // ready to fire once they're authed.
      const directTarget = safeNavigateUrl(incomingUrl);
      if (directTarget) {
        setPendingWebViewUrl(directTarget);
        if (isAuthed) {
          router.replace('/(app)' as never);
        }
        return;
      }

      let parsed: ReturnType<typeof Linking.parse>;
      try {
        parsed = Linking.parse(incomingUrl);
      } catch {
        return;
      }
      const path = (parsed.path ?? '').replace(/^\/+/, '');

      // sortlist://navigate?url=<https://www.sortlist.shop/...>
      //
      // Legacy fallback path retained for builds older than 15 that
      // still ship the custom-scheme deep link. New builds use the
      // Universal Link branch above. Same auth-race rule applies —
      // stash the URL unconditionally, gate only the home redirect.
      if (path === 'navigate') {
        const target = safeNavigateUrl(
          (parsed.queryParams as Record<string, unknown> | null)?.url,
        );
        if (target) {
          setPendingWebViewUrl(target);
        }
        if (isAuthed) {
          router.replace('/(app)' as never);
        }
        return;
      }

      // The native "Add product" modal moved to the WebView. The sortlist://
      // add?url=... deep link still works to land the user in the app, but
      // we just drop them on the WebView tab — the web app handles add
      // flows now. The url= param is currently ignored; if/when we want to
      // pre-fill the web add flow, we can postMessage it into the WebView.
      if (path === 'add' && isAuthed) {
        router.replace('/(app)' as never);
      }
    };

    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    void Linking.getInitialURL().then(handle);
    return () => sub.remove();
  }, [isAuthed]);
}
