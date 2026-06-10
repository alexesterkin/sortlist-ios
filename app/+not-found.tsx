import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';

import { setPendingWebViewUrl } from '@/lib/webview-bridge';

const WEB_BASE = 'https://www.sortlist.shop';

// Param keys expo-router injects for the not-found route itself — the
// unmatched path segments. Excluded from query reconstruction because
// usePathname() already carries them ('unmatched' is the legacy name
// from the [...unmatched] convention, kept defensively).
const ROUTER_INTERNAL_PARAMS = new Set(['not-found', 'unmatched']);

// Catch-all for every URL that doesn't match a native route. The big
// customer of this is Universal Links: iOS opens the app for ANY
// https://sortlist.shop/* link (associated domains), and Expo Router
// then tries to match the path against the native route table. Only a
// handful of web paths exist natively (/, /login, /settings) — anything
// else (/shared/{token} most importantly, but also future marketing or
// app routes) used to dead-end on Expo Router's "Unmatched Route"
// screen. Instead, rebuild the web URL and forward it to the WebView
// tab, which is where every sortlist.shop path can actually render.
//
// The stash happens during render, not in an effect, deliberately: on a
// cold start this route IS the initial route, and the WebView tab reads
// the pending URL synchronously in a useMemo when it mounts after the
// Redirect. Stashing at render time guarantees the URL is queued before
// any part of the (app) tree exists. setPendingWebViewUrl is idempotent
// (last-write-wins on the same URL), so re-renders are harmless.
export default function NotFoundForwarder() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string | string[]>>();

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (ROUTER_INTERNAL_PARAMS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, v);
    } else if (typeof value === 'string') {
      search.append(key, value);
    }
  }
  const qs = search.toString();
  const target = `${WEB_BASE}${pathname || '/'}${qs ? `?${qs}` : ''}`;

  setPendingWebViewUrl(target);

  // If the user is signed out, AppLayout's auth gate bounces this to the
  // login screen; the stashed URL survives and loads once they're in.
  return <Redirect href={'/(app)' as never} />;
}
