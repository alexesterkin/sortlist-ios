import { Platform } from 'react-native';

export const Brand = {
  coral: '#FF5B3A',
  coralDark: '#E8472A',
  cream: '#FAF8F3',
  ink: '#1A1A1A',
  inkSoft: '#4A4A4A',
  inkMuted: '#8A8A8A',
  line: '#EAE6DD',
  card: '#FFFFFF',
  danger: '#D43F26',
  success: '#3F8A4F',
};

const tintColorLight = Brand.coral;
const tintColorDark = Brand.cream;

export const Colors = {
  light: {
    text: Brand.ink,
    background: Brand.cream,
    tint: tintColorLight,
    icon: Brand.inkSoft,
    tabIconDefault: Brand.inkMuted,
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: Brand.cream,
    background: Brand.ink,
    tint: tintColorDark,
    icon: Brand.cream,
    tabIconDefault: Brand.inkMuted,
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'InstrumentSerif',
    serifItalic: 'InstrumentSerif-Italic',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'InstrumentSerif',
    serifItalic: 'InstrumentSerif-Italic',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
    serifItalic: "'Instrument Serif', Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
})!;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};
