import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Brand, Spacing } from '@/constants/theme';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: ViewStyle;
  bg?: string;
  edges?: ReadonlyArray<'top' | 'bottom' | 'left' | 'right'>;
};

export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  bg = Brand.cream,
  edges = ['top', 'bottom', 'left', 'right'],
}: Props) {
  const insets = useSafeAreaInsets();
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: bg }]}>
      <Container
        style={[styles.flex]}
        contentContainerStyle={
          scroll
            ? [
                padded && styles.padded,
                { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
                style,
              ]
            : undefined
        }>
        {scroll ? (
          children
        ) : (
          <View style={[styles.flex, padded && styles.padded, style]}>
            {children}
          </View>
        )}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
});
