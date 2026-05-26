import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Brand, Fonts, Radius, Spacing } from '@/constants/theme';

// First-login onboarding tutorial. Rendered by app/(app)/_layout.tsx in place
// of the main tabs Stack while the signed-in user's hasSeenOnboarding flag is
// false. Calling `onDone` flips the server flag (via lib/auth.tsx →
// markOnboardingSeen) and triggers an auth.me refetch — AppLayout re-renders
// with the Stack on the next pass.
//
// Persistence is intentionally backend-only: `hasSeenOnboarding` lives on the
// user row, not in AsyncStorage / SecureStore. That way the tutorial doesn't
// reappear after reinstall and doesn't re-show on a second device for the
// same account.

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type CardSpec = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  heading: string;
  body: string;
};

const CARDS: CardSpec[] = [
  {
    key: 'welcome',
    icon: 'sparkles-outline',
    heading: 'Welcome to Sortlist',
    body:
      'Save products from anywhere — we’ll organize them automatically into ' +
      'tidy collections.',
  },
  {
    key: 'share',
    icon: 'share-outline',
    heading: 'Save with one tap',
    body:
      'From Safari or any shopping app, tap the Share button and pick ' +
      'Sortlist to save what you’re looking at.',
  },
  {
    key: 'paste',
    icon: 'link-outline',
    heading: 'Or paste a link',
    body:
      'Already copied a product URL? Paste it straight into the app and we’ll ' +
      'pull the price and image automatically.',
  },
  {
    key: 'collab',
    icon: 'people-outline',
    heading: 'Better together',
    body:
      'Share a Sortlist with a partner, friends, or family — everyone can add ' +
      'products and decide together.',
  },
];

type Props = {
  onDone: () => void | Promise<void>;
};

export function Onboarding({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<CardSpec>>(null);
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await onDone();
    } finally {
      // Leave finishing=true on success so the buttons stay disabled while
      // AppLayout re-renders. The component is about to unmount anyway.
      // On failure (network blip), re-enable so the user can retry.
      setFinishing(false);
    }
  }, [finishing, onDone]);

  const goNext = useCallback(() => {
    if (index >= CARDS.length - 1) {
      void finish();
      return;
    }
    const next = index + 1;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  }, [index, finish]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / SCREEN_WIDTH);
      if (i !== index) setIndex(i);
    },
    [index],
  );

  const isLast = index === CARDS.length - 1;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Skip — always visible, top-right. Hit-slop expands the tap target. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip onboarding"
        onPress={finish}
        disabled={finishing}
        hitSlop={12}
        style={({ pressed }) => [
          styles.skip,
          { top: insets.top + Spacing.md },
          pressed && { opacity: 0.6 },
          finishing && { opacity: 0.4 },
        ]}>
        <Text variant="caption" style={styles.skipLabel}>
          Skip
        </Text>
      </Pressable>

      <FlatList
        ref={listRef}
        data={CARDS}
        keyExtractor={(c) => c.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        // getItemLayout lets scrollToIndex jump without measuring — required
        // since each item is a fixed-width screen.
        getItemLayout={(_, i) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * i,
          index: i,
        })}
        renderItem={({ item }) => <Card spec={item} />}
      />

      <View style={styles.footer}>
        {/* Pagination dots — coral when active, ink-muted otherwise. */}
        <View style={styles.dots} accessibilityRole="progressbar">
          {CARDS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === index ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        <Button
          title={isLast ? 'Get started' : 'Next'}
          onPress={goNext}
          loading={finishing && isLast}
          disabled={finishing}
        />
      </View>
    </SafeAreaView>
  );
}

function Card({ spec }: { spec: CardSpec }) {
  return (
    <View style={cardStyles.outer}>
      <View style={cardStyles.iconWrap}>
        <Ionicons name={spec.icon} size={56} color={Brand.coral} />
      </View>
      <Text variant="display" style={cardStyles.heading} allowFontScaling={false}>
        {spec.heading}
      </Text>
      <Text variant="body" style={cardStyles.body}>
        {spec.body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Brand.cream,
  },
  skip: {
    position: 'absolute',
    right: Spacing.xl,
    zIndex: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  skipLabel: {
    color: Brand.inkMuted,
    fontFamily: Fonts.sansMedium ?? Fonts.sans,
    fontSize: 15,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    gap: Spacing.lg,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: Brand.coral,
    width: 24,
  },
  dotInactive: {
    backgroundColor: Brand.line,
  },
});

const cardStyles = StyleSheet.create({
  outer: {
    width: SCREEN_WIDTH,
    flex: 1,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  iconWrap: {
    width: 112,
    height: 112,
    borderRadius: Radius.xl,
    backgroundColor: Brand.creamSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  heading: {
    fontFamily: Fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: Brand.ink,
    textAlign: 'center',
  },
  body: {
    color: Brand.inkSoft,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
  },
});
