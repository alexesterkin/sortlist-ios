import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Brand } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { isAuthed, isLoading } = useAuth();

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
