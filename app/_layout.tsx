import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { Brand } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useDeepLinkHandler } from '@/lib/deep-link';
import { AppProviders } from '@/lib/providers';

SplashScreen.preventAutoHideAsync().catch(() => {});

const SortlistTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Brand.cream,
    card: Brand.cream,
    text: Brand.ink,
    primary: Brand.coral,
    border: Brand.line,
    notification: Brand.coral,
  },
  fonts: DefaultTheme.fonts,
};

export const unstable_settings = {
  initialRouteName: '(app)',
};

function RootNavigator() {
  const { isAuthed, isLoading } = useAuth();
  const segments = useSegments();
  useDeepLinkHandler(isAuthed);

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthed && !inAuthGroup) {
      router.replace('/(auth)/login' as never);
    } else if (isAuthed && inAuthGroup) {
      router.replace('/(app)' as never);
    }
  }, [isAuthed, isLoading, segments]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Brand.cream },
        headerTitleStyle: { color: Brand.ink },
        headerTintColor: Brand.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Brand.cream },
      }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    InstrumentSerif: require('../assets/fonts/InstrumentSerif-Regular.ttf'),
    'InstrumentSerif-Italic': require('../assets/fonts/InstrumentSerif-Italic.ttf'),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Brand.cream }}>
      <SafeAreaProvider>
        <AppProviders>
          <ThemeProvider value={SortlistTheme}>
            <RootNavigator />
            <StatusBar style="dark" />
          </ThemeProvider>
        </AppProviders>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
