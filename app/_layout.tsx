import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { Brand } from '@/constants/theme';
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

// Note: we deliberately don't set `unstable_settings.initialRouteName` here.
// An anchor route can cause expo-router to fall back to a synthetic GO_BACK
// when `router.replace()` is called between route groups (auth → app).
// Auth-gated navigation lives in each group's _layout via <Redirect> guards.

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
            <StatusBar style="dark" />
          </ThemeProvider>
        </AppProviders>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
