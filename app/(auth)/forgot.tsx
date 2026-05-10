import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Brand, Spacing } from '@/constants/theme';
import { trpc } from '@/lib/trpc';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestReset = trpc.auth.requestPasswordReset.useMutation();

  const submit = async () => {
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setError(null);
    try {
      const res = await requestReset.mutateAsync({ email: email.trim() });
      setSuccess(
        (res as { message?: string } | undefined)?.message ??
          'If that email is registered, a reset link has been sent.',
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not send reset email.');
    }
  };

  return (
    <Screen scroll>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: Brand.cream },
          headerShadowVisible: false,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text variant="display" style={{ fontSize: 36 }}>
            Reset password
          </Text>
          <Text variant="caption" style={{ marginTop: Spacing.sm }}>
            Enter the email tied to your account and we&apos;ll send you a reset link.
          </Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            placeholder="you@example.com"
          />

          {success ? (
            <Text variant="caption" color={Brand.success}>
              {success}
            </Text>
          ) : null}
          {error ? (
            <Text variant="caption" color={Brand.danger}>
              {error}
            </Text>
          ) : null}

          <Button
            title="Send reset link"
            onPress={submit}
            loading={requestReset.isPending}
          />
          <Button
            title="Back to sign in"
            variant="ghost"
            onPress={() => router.replace('/(auth)/login' as never)}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: Spacing.lg },
  form: { gap: Spacing.lg, paddingTop: Spacing.xl },
});
