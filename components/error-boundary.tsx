import { Component, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode };
type State = { error: Error | null; info: string | null };

/**
 * Top-level error boundary so unexpected JS crashes (which on iOS preview
 * builds otherwise just close the app silently with the splash still up)
 * render a visible fallback with the message + stack instead. Catches:
 *
 *   - Render-phase exceptions in any child component
 *   - Errors thrown inside lifecycle methods / hooks during render
 *
 * Doesn't catch:
 *
 *   - Async errors (unhandled promise rejections, network handlers)
 *   - Errors in event handlers (those become unhandled by React, but the
 *     LogBox / RedBox in dev or Sentry/Crashlytics in prod can pick them up)
 *
 * Wrap as close to the root as possible.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface the failure to console.error so iOS device logs (Console.app /
    // `xcrun simctl spawn booted log stream`) capture something instead of a
    // silent crash.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info.componentStack ?? '');
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>Sortlist crashed</Text>
          <Text style={styles.subtitle}>
            Quit and reopen the app. If this keeps happening, share the
            details below with support.
          </Text>
          <Text style={styles.heading}>Error</Text>
          <Text style={styles.mono}>
            {error.name}: {error.message}
          </Text>
          {error.stack ? (
            <>
              <Text style={styles.heading}>Stack</Text>
              <Text style={styles.mono}>{error.stack}</Text>
            </>
          ) : null}
          {info ? (
            <>
              <Text style={styles.heading}>Component stack</Text>
              <Text style={styles.mono}>{info}</Text>
            </>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAF8F3',
  },
  scroll: {
    padding: 24,
    paddingTop: 64,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(26,26,26,0.7)',
    marginBottom: 16,
  },
  heading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A1A1A',
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  mono: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: '#1A1A1A',
    lineHeight: 18,
  },
});
