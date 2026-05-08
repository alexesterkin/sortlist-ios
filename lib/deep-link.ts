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
      const params = parsed.queryParams ?? {};
      if (path === 'add' && isAuthed) {
        const url = typeof params.url === 'string' ? params.url : undefined;
        router.push({
          pathname: '/(app)/add',
          params: url ? { url } : {},
        });
      }
    };

    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    void Linking.getInitialURL().then(handle);
    return () => sub.remove();
  }, [isAuthed]);
}
