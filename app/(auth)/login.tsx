import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const { signInWithEmail, registerWithEmail, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else {
        await registerWithEmail(name.trim(), email.trim(), password);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not sign in.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Google sign-in failed.';
      Alert.alert('Sign in', message);
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <Screen scroll bg={Brand.cream}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <View style={styles.brand}>
          <View style={styles.logoDot} />
          <Text variant="display" style={styles.brandTitle}>
            Sortlist
          </Text>
          <Text variant="caption" style={styles.tagline}>
            Save & organise your shopping finds.
          </Text>
        </View>

        <View style={styles.form}>
          <Text variant="title" style={styles.h1}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </Text>

          {mode === 'register' ? (
            <Input
              label="Name"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              value={name}
              onChangeText={setName}
              placeholder="Your name"
            />
          ) : null}

          <Input
            label="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
          />

          <Input
            label="Password"
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
          />

          {error ? (
            <Text variant="caption" color={Brand.danger}>
              {error}
            </Text>
          ) : null}

          {mode === 'login' ? (
            <Link href="/(auth)/forgot" asChild>
              <Pressable style={styles.forgotLink} hitSlop={8}>
                <Text variant="caption" color={Brand.coral}>
                  Forgot password?
                </Text>
              </Pressable>
            </Link>
          ) : null}

          <Button
            title={mode === 'login' ? 'Sign in' : 'Create account'}
            onPress={submit}
            loading={submitting}
          />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text variant="caption" style={styles.dividerText}>
              or
            </Text>
            <View style={styles.line} />
          </View>

          <Button
            title="Continue with Google"
            variant="outline"
            loading={googleLoading}
            leftIcon={<Ionicons name="logo-google" size={18} color={Brand.ink} />}
            onPress={onGoogle}
          />

          <Pressable
            style={styles.switchMode}
            onPress={() => setMode((m) => (m === 'login' ? 'register' : 'login'))}>
            <Text variant="caption" style={{ textAlign: 'center' }}>
              {mode === 'login'
                ? "Don't have an account? "
                : 'Already have an account? '}
              <Text variant="caption" color={Brand.coral}>
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    marginTop: Spacing.xxl,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  logoDot: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Brand.coral,
    marginBottom: Spacing.sm,
  },
  brandTitle: {
    fontSize: 48,
    lineHeight: 52,
  },
  tagline: {
    color: Brand.inkSoft,
    textAlign: 'center',
  },
  form: {
    gap: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  h1: {
    marginBottom: Spacing.sm,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: -Spacing.sm,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginVertical: Spacing.xs,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: Brand.line,
  },
  dividerText: {
    color: Brand.inkMuted,
  },
  switchMode: {
    paddingVertical: Spacing.sm,
  },
});
