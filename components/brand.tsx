import { StyleSheet, Text as RNText, View, type ViewStyle } from 'react-native';

import { Brand as Colors, Fonts } from '@/constants/theme';

// SortlistMark — the small square logo. Three coral horizontal lines of
// decreasing length on an ink-coloured rounded square, with a coral dot
// next to the shortest line.
//
// We render it with Views instead of pulling in react-native-svg —
// 4 absolutely-positioned shapes is plenty for a 28x28 mark, and no
// extra native dep means no extra pod-install risk.
//
// Proportions match the web app's 40x40 viewBox, scaled to 28.
export function SortlistMark({ size = 28 }: { size?: number }) {
  // Scale factor from the 40x40 design grid down to `size`.
  const s = size / 40;
  return (
    <View
      style={[
        markStyles.square,
        {
          width: size,
          height: size,
          borderRadius: 11 * s,
        },
      ]}>
      <View
        style={[
          markStyles.bar,
          {
            top: 13 * s,
            left: 11 * s,
            width: 18 * s,
            height: 2.6 * s,
            borderRadius: 1.3 * s,
          },
        ]}
      />
      <View
        style={[
          markStyles.bar,
          {
            top: 19 * s,
            left: 11 * s,
            width: 14 * s,
            height: 2.6 * s,
            borderRadius: 1.3 * s,
          },
        ]}
      />
      <View
        style={[
          markStyles.bar,
          {
            top: 25 * s,
            left: 11 * s,
            width: 9 * s,
            height: 2.6 * s,
            borderRadius: 1.3 * s,
          },
        ]}
      />
      <View
        style={[
          markStyles.dot,
          {
            // SVG center (29, 26.3), radius 2.4 → bbox (26.6, 23.9), 4.8x4.8
            top: 23.9 * s,
            left: 26.6 * s,
            width: 4.8 * s,
            height: 4.8 * s,
            borderRadius: 2.4 * s,
          },
        ]}
      />
    </View>
  );
}

const markStyles = StyleSheet.create({
  square: {
    backgroundColor: Colors.ink,
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    backgroundColor: Colors.coral,
  },
  dot: {
    position: 'absolute',
    backgroundColor: Colors.coral,
  },
});

// SortlistWordmark — "sortlist" set in Instrument Serif. The "sort" half
// is italic, the "list" half is roman, all in ink. Matches the web app's
// `<i>sort</i>list` styling.
export function SortlistWordmark({
  size = 22,
  color = Colors.ink,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <RNText
      style={[
        wordmarkStyles.line,
        { fontSize: size, lineHeight: size * 1.05, color },
      ]}
      allowFontScaling={false}>
      <RNText style={{ fontFamily: Fonts.serifItalic, color }}>sort</RNText>
      <RNText style={{ fontFamily: Fonts.serif, color }}>list</RNText>
    </RNText>
  );
}

const wordmarkStyles = StyleSheet.create({
  line: {
    letterSpacing: -0.5,
  },
});

// SortlistBrand — mark + wordmark side by side. Used in headers throughout
// the app. Defaults are sized for a 44pt nav-bar style row.
export function SortlistBrand({
  size = 28,
  wordmarkSize,
  gap = 8,
  style,
}: {
  size?: number;
  wordmarkSize?: number;
  gap?: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[brandStyles.row, { gap }, style]}>
      <SortlistMark size={size} />
      <SortlistWordmark size={wordmarkSize ?? Math.round(size * 0.86)} />
    </View>
  );
}

const brandStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
