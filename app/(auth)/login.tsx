import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView } from 'react-native-gesture-handler';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signInWithEmail, registerWithEmail, signInWithGoogle } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (mode === 'register') {
      if (!name.trim()) {
        setError('Please enter your name.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
    }
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else {
        await registerWithEmail(name.trim(), email.trim(), password);
      }
      // On success, the root navigator picks up the new auth.me result and
      // pushes /(app). We leave `submitting` true so the button keeps
      // showing its spinner until the screen unmounts — feels less jumpy
      // than the button flashing back to "Sign in" right before navigating.
    } catch (e: unknown) {
      const message = friendlyAuthError(e, mode);
      setError(message);
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
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brand}>
            <View style={styles.logoMark}>
              <View style={styles.logoBar} />
              <View
                style={[styles.logoBar, { width: 18, opacity: 0.85 }]}
              />
              <View
                style={[styles.logoBar, { width: 12, opacity: 0.7 }]}
              />
            </View>
            <Text variant="display" style={styles.wordmark}>
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
              <View style={styles.errorBox}>
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={Brand.danger}
                />
                <Text variant="caption" color={Brand.danger} style={{ flex: 1 }}>
                  {error}
                </Text>
              </View>
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
              onPress={() => {
                setError(null);
                setMode((m) => (m === 'login' ? 'register' : 'login'));
              }}>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Map raw backend errors to language a user understands. The auth.login
// procedure throws TRPCClientError with `data.code === "UNAUTHORIZED"` and
// message "Invalid email or password" on bad creds; register throws
// `code === "CONFLICT"` with "An account with this email already exists".
// Everything else falls back to whatever message the server gave us, or a
// generic message if the request never reached the server.
function friendlyAuthError(e: unknown, mode: 'login' | 'register'): string {
  const err = e as
    | { message?: string; data?: { code?: string; httpStatus?: number } }
    | undefined;
  const code = err?.data?.code;
  if (code === 'UNAUTHORIZED') return 'Email or password is incorrect.';
  if (code === 'CONFLICT')
    return 'An account with this email already exists. Try signing in.';
  if (err?.message) return err.message;
  return mode === 'login'
    ? "Couldn't sign in. Check your connection and try again."
    : "Couldn't create your account. Check your connection and try again.";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.cream },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  brand: {
    alignItems: 'center',
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
    gap: 6,
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: Brand.coral,
    marginBottom: Spacing.sm,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 4,
  },
  logoBar: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: Brand.cream,
  },
  wordmark: {
    fontSize: 56,
    lineHeight: 60,
  },
  tagline: {
    color: Brand.inkMuted,
    textAlign: 'center',
  },
  form: {
    gap: Spacing.md,
    paddingTop: Spacing.lg,
  },
  h1: {
    marginBottom: Spacing.xs,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FBE3DC',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    marginTop: -Spacing.xs,
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
