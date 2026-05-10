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
