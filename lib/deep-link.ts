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
      let parsed: ReturnType<typeof Linking.parse>;
      try {
        parsed = Linking.parse(incomingUrl);
      } catch {
        return;
      }
      const path = (parsed.path ?? '').replace(/^\/+/, '');

      // sortlist://navigate?url=<https://www.sortlist.shop/...>
      //
      // Fired by the iOS Share Extension's "Go to sortlist" button after
      // a successful save. We hand the URL to the webview-bridge
      // singleton; the home-tab WebView either consumes it on mount
      // (cold start) or navigates to it via injectJavaScript (warm).
      //
      // IMPORTANT: the URL push to the bridge must NOT be gated on
      // isAuthed. On a cold start the deep-link's first handle() runs
      // with isAuthed=false (AuthProvider hasn't hydrated yet); if we
      // dropped the URL here it'd be lost forever. Stash it
      // unconditionally — the bridge just stores until the WebView
      // mounts and consumes it. Only the explicit router.replace is
      // gated on isAuthed, because routing while unauthed would land
      // the user on the login screen with the URL still pending.
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
