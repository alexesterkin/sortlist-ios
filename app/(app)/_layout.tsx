import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Onboarding } from '@/components/onboarding';
import { Brand } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { isAuthed, isLoading, user, markOnboardingSeen } = useAuth();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: Brand.cream,
        }}>
        <ActivityIndicator color={Brand.coral} />
      </View>
    );
  }

  if (!isAuthed) {
    return <Redirect href={'/(auth)/login' as never} />;
  }

  // First-login onboarding tutorial. Rendered in place of the main tabs
  // until the user dismisses it (Skip or Get started) — at which point
  // markOnboardingSeen flips the server-side flag, refetches auth.me, and
  // AppLayout re-renders with the Stack below.
  //
  // Explicit `=== false` (not `!user.hasSeenOnboarding`) so undefined
  // (older server without the column) is treated as already-seen rather
  // than trapping users in a tutorial whose markSeen endpoint doesn't
  // exist yet.
  if (user && user.hasSeenOnboarding === false) {
    return <Onboarding onDone={markOnboardingSeen} />;
  }

  // Outer Stack just hosts the (tabs) group now. The (tabs) group itself
  // renders the bottom tab bar with two tabs: the sortlist.shop WebView
  // and the native Settings screen. Native product / sortlist-detail /
  // add-modal screens live under app/_archive/ for reference but are no
  // longer routable.
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Brand.cream },
        headerTitleStyle: { color: Brand.ink },
        headerTintColor: Brand.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Brand.cream },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
