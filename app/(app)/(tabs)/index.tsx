import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL } from '@/lib/config';
import { getSessionToken, SESSION_COOKIE_NAME } from '@/lib/session';
import {
  consumePendingWebViewUrl,
  registerWebViewNavigator,
} from '@/lib/webview-bridge';

const INTERNAL_HOSTS = new Set(['sortlist.shop', 'www.sortlist.shop']);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function looksLikeLoginUrl(url: string): boolean {
  const path = pathnameOf(url);
  if (!path) return false;
  // Conservative match — only treat these exact paths as "the web app
  // bounced us to its sign-in page", which is our signal that the JWT
  // cookie we injected wasn't accepted.
  return (
    path === '/login' ||
    path === '/sign-in' ||
    path === '/signin' ||
    path === '/auth/login' ||
    path === '/auth/signin'
  );
}

export default function WebTabScreen() {
  const { signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggedOut, setLoggedOut] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  // Snapshot the token at mount so the injection script can be a stable
  // string. If the user signs out, AuthGate (app/(app)/_layout.tsx)
  // redirects to the login screen, so this component unmounts before the
  // token can change.
  const token = getSessionToken();

  // Pick up any URL the iOS Share Extension queued via the
  // `sortlist://navigate?url=…` deep link. Consumed once on mount; the
  // bridge clears itself. Hot-path navigation is wired in a useEffect
  // below so the WebView can jump while it's already mounted.
  //
  // Falls back to /sortlists (the user's collections grid) rather than
  // the root, because the root URL renders the marketing landing page
  // ("Close the tabs. Keep the products.") which is pointless once
  // you're signed in inside the iOS app.
  const initialSourceUrl = useMemo(
    () => consumePendingWebViewUrl() ?? `${API_BASE_URL}/sortlists`,
    [],
  );

  useEffect(() => {
    registerWebViewNavigator((url) => {
      // injectJavaScript runs in the WebView's main world. Using
      // window.location.href triggers a normal navigation, so the
      // same cookie/auth setup that worked for the initial load
      // continues to apply.
      webRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(url)}; true;`,
      );
    });
    return () => registerWebViewNavigator(null);
  }, []);

  const injectedJavaScriptBeforeContentLoaded = useMemo(() => {
    // window.__SORTLIST_IOS_APP__ is a signal to the web app that it's
    // running inside our native WebView, not in a real browser. The web
    // app uses it to suppress UI that doesn't make sense in-app — e.g.
    // the "Install the Chrome extension" onboarding modal. Set
    // unconditionally (even when there's no auth token) because the
    // suppression should hold for every WebView load.
    //
    // The web app ALSO has a UA-based fallback that detects stock
    // WKWebView (the iOS WebView strips the Safari/ token from its UA,
    // which distinguishes it from Mobile Safari and from iOS Chrome /
    // Firefox / Edge). So even iOS builds shipped before this flag
    // existed are protected. This flag is the robust long-term signal.
    if (!token) {
      return `(function () {
        try { window.__SORTLIST_IOS_APP__ = true; } catch (e) {}
      })();
      true;`;
    }
    // 1-year max-age so the cookie survives across cold starts; the page
    // is the same origin so document.cookie writes apply to sortlist.shop.
    // We set domain=.sortlist.shop so both apex and www subdomain see it.
    const oneYearSec = 60 * 60 * 24 * 365;
    return `(function () {
      try {
        window.__SORTLIST_IOS_APP__ = true;
        document.cookie =
          '${SESSION_COOKIE_NAME}=${token}' +
          '; path=/; domain=.sortlist.shop' +
          '; max-age=${oneYearSec}; secure; samesite=lax';
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'cookie_set' })
          );
      } catch (e) {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'cookie_error', message: String(e && e.message || e) })
          );
      }
    })();
    true;`;
  }, [token]);

  const onShouldStartLoadWithRequest = (request: WebViewNavigation): boolean => {
    const host = hostnameOf(request.url);
    if (host && INTERNAL_HOSTS.has(host)) {
      return true;
    }
    // External link — pop a SFSafariViewController and tell the WebView
    // not to navigate. The user gets a "Done" button back to the app.
    WebBrowser.openBrowserAsync(request.url).catch(() => {});
    return false;
  };

  const onNavigationStateChange = (nav: WebViewNavigation) => {
    if (looksLikeLoginUrl(nav.url)) {
      setLoggedOut(true);
    }
  };

  const handleRefresh = () => {
    setLoggedOut(false);
    setNetworkError(false);
    webRef.current?.reload();
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      // signOut already swallows errors; AuthGate will redirect.
    }
  };

  const showOverlay = loggedOut || networkError;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <WebView
        ref={webRef}
        source={{ uri: initialSourceUrl }}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => {
          setLoading(true);
          setNetworkError(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setNetworkError(true);
        }}
        onHttpError={(e) => {
          // 4xx/5xx on the main document. 401/403 likely means the cookie
          // was rejected — treat it as logged-out so the user has a way out.
          const status = e.nativeEvent?.statusCode;
          if (status === 401 || status === 403) setLoggedOut(true);
        }}
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        decelerationRate="normal"
        style={styles.webview}
        startInLoadingState
      />

      {loading && !showOverlay ? (
        <View style={styles.loader} pointerEvents="none">
          <ActivityIndicator color={Brand.coral} />
        </View>
      ) : null}

      {showOverlay ? (
        <View
          style={[
            styles.fallback,
            { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.xl },
          ]}>
          <Text variant="title" style={styles.fallbackTitle}>
            {loggedOut ? 'Signed out' : 'Connection problem'}
          </Text>
          <Text variant="caption" style={styles.fallbackBody}>
            {loggedOut
              ? "Looks like you got signed out of Sortlist. Tap Refresh to try again, or sign out and back in."
              : "Couldn't load sortlist.shop. Check your connection and try again."}
          </Text>
          <View style={styles.fallbackActions}>
            <Button title="Refresh" onPress={handleRefresh} />
            <Button title="Sign out" variant="outline" onPress={handleSignOut} />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.cream },
  webview: { flex: 1, backgroundColor: Brand.cream },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Brand.cream,
  },
  fallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Brand.cream,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  fallbackTitle: { marginBottom: Spacing.xs },
  fallbackBody: { color: Brand.inkMuted, marginBottom: Spacing.lg },
  fallbackActions: { gap: Spacing.sm },
});
