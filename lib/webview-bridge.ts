// Singleton bridge that lets non-React surfaces (the deep-link handler,
// in our case — and indirectly the iOS Share Extension after a save) ask
// the home-tab WebView to navigate to a specific URL.
//
// Two cases to handle, both come up in practice:
//
//   Cold start: SE saves a product → calls extensionContext.open(
//       "sortlist://navigate?url=https://www.sortlist.shop/sortlist/123")
//     → iOS launches the app from scratch → AuthProvider hydrates →
//     useDeepLinkHandler fires → the WebView mounts AFTER the deep link
//     handler stored its URL. The WebView reads the pending URL on
//     mount and uses it as the initial source.
//
//   Warm start: app is already in memory. WebView is mounted. SE opens
//     the same URL → deep-link handler fires → the registered navigator
//     callback runs window.location.href via injectJavaScript so the
//     WebView jumps to the right page without remounting.
//
// One tricky ordering case: deep-link handler runs AFTER the WebView's
// useMemo (which consumed an empty pending URL) but BEFORE the WebView's
// useEffect (which registers the navigator). registerWebViewNavigator
// handles this by replaying any pending URL the moment the navigator
// callback is registered.

let pendingUrl: string | null = null;
let webViewNavigator: ((url: string) => void) | null = null;

/**
 * Called by the deep-link handler when a `sortlist://navigate?url=…`
 * link comes in. If a WebView is already mounted and has registered its
 * navigator, the URL is dispatched immediately; otherwise it's queued
 * for the next WebView mount to consume.
 */
export function setPendingWebViewUrl(url: string | null): void {
  pendingUrl = url;
  if (url && webViewNavigator) {
    webViewNavigator(url);
    pendingUrl = null;
  }
}

/**
 * Called by the WebView during its initial render (useMemo) to grab
 * any URL the deep-link handler queued before mount. Returns null if
 * no URL is pending. The pending URL is cleared as a side effect — it
 * should only ever be consumed once.
 */
export function consumePendingWebViewUrl(): string | null {
  const u = pendingUrl;
  pendingUrl = null;
  return u;
}

/**
 * Called by the WebView in a useEffect after mount. Pass null on
 * unmount to clear the registration. If a URL was queued before this
 * registration, the callback is invoked synchronously with it.
 */
export function registerWebViewNavigator(
  fn: ((url: string) => void) | null,
): void {
  webViewNavigator = fn;
  if (fn && pendingUrl) {
    fn(pendingUrl);
    pendingUrl = null;
  }
}
