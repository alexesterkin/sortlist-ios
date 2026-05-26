import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

const HOME_ROUTE = '/(app)';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signInWithEmail, registerWithEmail, signInWithGoogle, signInWithApple } =
    useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hide the Apple button entirely if the device can't support it (iPad
  // running iOS < 13, simulator without an Apple ID, etc.). On Android it's
  // never available; we never reach this branch since the app is iOS-only.
  useEffect(() => {
    let cancelled = false;
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (!cancelled) setAppleAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setAppleAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Navigate to the sortlists home directly. Never call router.back() — on
  // a fresh launch there's nothing to go back to, and expo-router would
  // throw GO_BACK.
  const goHome = () => {
    router.replace(HOME_ROUTE as never);
  };

  const onApple = async () => {
    setError(null);
    try {
      await signInWithApple();
      // signInWithApple resolves with no return value on user cancel too.
      // Calling goHome on cancel bounces through AuthGate back to /login —
      // same edge-case behavior as the Google flow, so we don't special-case.
      goHome();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Sign in with Apple failed.';
      setError(message);
      Alert.alert('Sign in', message);
    }
  };

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
      goHome();
    } catch (e: unknown) {
      setError(friendlyAuthError(e, mode));
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    if (googleLoading) return;
    setError(null);
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      goHome();
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Google sign-in failed.';
      setError(message);
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
              <View style={[styles.logoBar, { width: 18, opacity: 0.85 }]} />
              <View style={[styles.logoBar, { width: 12, opacity: 0.7 }]} />
            </View>
            <Text variant="display" style={styles.wordmark}>
              Sortlist
            </Text>
            <Text variant="caption" style={styles.tagline}>
              Save & organize your shopping finds.
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
              <Link href={'/(auth)/forgot' as never} asChild>
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

            {/* Apple Sign-In above Google to satisfy App Store HIG: the Apple
                button must be at least as prominent as third-party social
                buttons. The native AppleAuthenticationButton enforces Apple's
                exact spec (corner radius, font, logo padding) — using a
                custom button here would risk rejection. */}
            {appleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                }
                buttonStyle={
                  AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={12}
                style={styles.appleButton}
                onPress={onApple}
              />
            ) : null}

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
  appleButton: {
    // Match the other auth-button heights so the Apple and Google buttons
    // line up vertically. Apple's HIG specifies a minimum height of 30, but
    // matching our other buttons at 48 reads cleanly within the form.
    width: '100%',
    height: 48,
  },
});
