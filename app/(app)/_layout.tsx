import { Stack } from 'expo-router';

import { Brand } from '@/constants/theme';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Brand.cream },
        headerTitleStyle: { color: Brand.ink },
        headerTintColor: Brand.ink,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Brand.cream },
      }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sortlist/[id]" options={{ headerShown: false }} />
      <Stack.Screen
        name="add"
        options={{
          presentation: 'modal',
          headerShown: false,
          contentStyle: { backgroundColor: Brand.cream },
        }}
      />
    </Stack>
  );
}
