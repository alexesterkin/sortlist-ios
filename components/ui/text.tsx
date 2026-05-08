import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { Brand, Fonts } from '@/constants/theme';

type Variant = 'display' | 'title' | 'subtitle' | 'body' | 'caption' | 'mono';

export function Text({
  variant = 'body',
  style,
  color,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  return (
    <RNText
      {...rest}
      style={[styles[variant], color ? { color } : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  display: {
    fontFamily: Fonts.serif,
    fontSize: 44,
    lineHeight: 48,
    color: Brand.ink,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    lineHeight: 32,
    color: Brand.ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: Fonts.serif,
    fontSize: 20,
    lineHeight: 24,
    color: Brand.ink,
  },
  body: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    lineHeight: 22,
    color: Brand.ink,
  },
  caption: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: Brand.inkSoft,
  },
  mono: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    lineHeight: 20,
    color: Brand.ink,
  },
});
