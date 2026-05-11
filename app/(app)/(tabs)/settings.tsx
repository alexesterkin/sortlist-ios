import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SortlistBrand } from '@/components/brand';
import { Text } from '@/components/ui/text';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: Brand.cream }}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + Spacing.md },
      ]}>
      <View style={styles.topbar}>
        <SortlistBrand size={28} />
      </View>
      <Text variant="display" style={styles.h1}>
        Settings
      </Text>

      {user ? (
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText} allowFontScaling={false}>
              {initial(user.name ?? user.email)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {user.name ?? 'Sortlist user'}
            </Text>
            <Text variant="caption" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text variant="caption" style={styles.sectionLabel}>
          About
        </Text>
        <Row label="Version" value={`${version}`} />
        <Row
          label="Backend"
          value="sortlist.shop"
          icon="link-outline"
        />
      </View>

      <Pressable
        onPress={confirmSignOut}
        disabled={signingOut}
        style={({ pressed }) => [
          styles.signOut,
          pressed && { opacity: 0.85 },
          signingOut && { opacity: 0.5 },
        ]}>
        <Ionicons name="log-out-outline" size={18} color={Brand.danger} />
        <Text
          style={styles.signOutLabel}
          color={Brand.danger}
          allowFontScaling={false}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.row}>
      <Text variant="body" style={styles.rowLabel}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        <Text variant="caption" style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
        {icon ? (
          <Ionicons name={icon} size={14} color={Brand.inkMuted} />
        ) : null}
      </View>
    </View>
  );
}

function initial(s: string): string {
  const t = s.trim();
  if (!t) return '·';
  return t.charAt(0).toUpperCase();
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl * 2,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  h1: {
    fontFamily: Fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: Brand.ink,
    marginBottom: Spacing.lg,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: Spacing.xl,
    shadowColor: Brand.ink,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Brand.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts.serif,
    fontSize: 22,
    color: '#fff',
  },
  userName: {
    fontFamily: Fonts.serif,
    fontSize: 22,
    color: Brand.ink,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xl,
    shadowColor: Brand.ink,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: Brand.inkMuted,
    fontSize: 11,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  rowLabel: {
    fontSize: 15,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '60%',
  },
  rowValue: {
    color: Brand.inkMuted,
    fontSize: 13,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: Spacing.md,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  signOutLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
