import { Platform } from 'react-native';

export const Brand = {
  coral: '#FF5B3A',
  coralDark: '#E04A2A',
  cream: '#FAF8F3',
  creamSoft: '#F2EDE0',
  ink: '#1A1A1A',
  inkSoft: 'rgba(26,26,26,0.72)',
  inkMuted: 'rgba(26,26,26,0.55)',
  line: 'rgba(26,26,26,0.12)',
  lineSoft: 'rgba(26,26,26,0.08)',
  card: '#FFFFFF',
  danger: '#D43F26',
  success: '#3F8A4F',
};

// Tinted backgrounds used as fallback covers for sortlist cards. These mirror
// the muted pastel palette the web app picks per collection.
export const CoverColors = [
  '#F2EDE0', // cream
  '#E8DCC9', // sand
  '#DCD6D2', // warm grey
  '#E0AA86', // peach
  '#F2C8B7', // pink-clay
  '#C3F2D7', // mint
  '#9BB59B', // sage
  '#C9B8E8', // lilac
  '#B8C7E8', // sky
  '#F2D7C3', // apricot
];

export function coverColorFor(seed: string | number): string {
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return CoverColors[hash % CoverColors.length];
}

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
