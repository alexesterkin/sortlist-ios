import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
  useFonts,
} from '@expo-google-fonts/instrument-serif';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/error-boundary';
import { Brand } from '@/constants/theme';
import { AppProviders } from '@/lib/providers';

// Diagnostic log at module-eval time so iOS Console / `log stream`
// captures *something* even if a downstream import throws synchronously.
// eslint-disable-next-line no-console
console.log('[Sortlist] boot: _layout.tsx evaluated');

SplashScreen.preventAutoHideAsync().catch((e) => {
  // eslint-disable-next-line no-console
  console.warn('[Sortlist] preventAutoHideAsync failed:', e?.message ?? e);
});

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

export default function RootLayout() {
  // Load Instrument Serif via @expo-google-fonts. The two font family names
  // we'll reference in styles (constants/theme.ts -> Fonts.serif and
  // Fonts.serifItalic) match exactly what this package registers:
  //   InstrumentSerif_400Regular
  //   InstrumentSerif_400Regular_Italic
  // We hold the splash screen until both have hydrated so the first paint
  // already has the right typography — no FOUT into the brand wordmark.
  const [loaded, error] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  useEffect(() => {
    if (loaded) {
      // eslint-disable-next-line no-console
      console.log('[Sortlist] boot: fonts loaded, hiding splash');
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [loaded]);

  useEffect(() => {
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[Sortlist] boot: font load error', error);
      // If fonts fail, hide the splash anyway so the user sees the error UI
      // instead of an indefinite splash screen.
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [error]);

  // If fonts haven't loaded AND there's no error, keep the splash up.
  // If there's an error, render the tree anyway — system fonts will be used
  // as a fallback and the user can see the app instead of a frozen splash.
  if (!loaded && !error) return null;

  return (
    <ErrorBoundary>
      {/* This used to be GestureHandlerRootView from
          react-native-gesture-handler; gesture-handler was removed
          because its New Arch codegen on SDK 55 was failing pod
          install. The app uses TouchableOpacity / Pressable from RN
          core for taps and doesn't register any gesture handlers, so
          a plain View is a functionally identical replacement. */}
      <View style={{ flex: 1, backgroundColor: Brand.cream }}>
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
      </View>
    </ErrorBoundary>
  );
}
