import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';

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
