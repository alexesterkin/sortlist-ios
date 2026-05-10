import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { Brand } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function AuthLayout() {
  const { isAuthed, isLoading } = useAuth();

  // While we're hydrating the keychain or refreshing auth.me, render nothing
  // rather than the login screen — otherwise a logged-in user opening the app
  // briefly sees the login flash before being redirected.
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

  if (isAuthed) {
    return <Redirect href={'/(app)' as never} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
