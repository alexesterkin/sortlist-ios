import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SortlistBrand } from '@/components/brand';
import { Text } from '@/components/ui/text';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import type { Product } from '@/lib/types';

export default function AllProductsScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const productsQuery = trpc.products.list.useQuery(
    { status: 'all' },
    { retry: 1 },
  );

  const products = useMemo<Product[]>(
    () => (productsQuery.data ?? []) as Product[],
    [productsQuery.data],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await productsQuery.refetch();
    setRefreshing(false);
  };

  const open = async (product: Product) => {
    if (!product.url) return;
    await WebBrowser.openBrowserAsync(product.url, {
      controlsColor: Brand.coral,
      toolbarColor: Brand.cream,
      dismissButtonStyle: 'done',
    });
  };

  const isLoading = productsQuery.isLoading && !refreshing;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.topbar}>
              <SortlistBrand size={28} />
              <Pressable
                hitSlop={10}
                onPress={() => router.push('/(app)/add')}
                style={styles.headerPill}
                accessibilityLabel="Save a product">
                <Ionicons name="add" size={16} color={Brand.coral} />
                <Text variant="caption" color={Brand.coral} style={styles.headerPillLabel}>
                  Save
                </Text>
              </Pressable>
            </View>
            <Text variant="display" style={styles.h1}>
              All Products
            </Text>
            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={Brand.coral} />
              </View>
            ) : null}
            {!isLoading && products.length === 0 ? (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="bag-outline" size={26} color={Brand.ink} />
                </View>
                <Text variant="title" style={{ textAlign: 'center' }}>
                  Nothing saved yet
                </Text>
                <Text variant="caption" style={styles.emptyText}>
                  Tap the + tab to save your first product.
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <ProductTile product={item} onPress={() => open(item)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Brand.coral}
          />
        }
      />
    </View>
  );
}

function ProductTile({
  product,
  onPress,
}: {
  product: Product;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
      <View style={styles.image}>
        {product.imageUrl ? (
          <>
            <Image
              source={{ uri: product.imageUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={150}
            />
            <View pointerEvents="none" style={styles.imageBorder} />
          </>
        ) : (
          <Ionicons name="bag-outline" size={28} color={Brand.inkMuted} />
        )}
      </View>
      <View style={styles.cardMeta}>
        {product.siteName ? (
          <Text variant="caption" style={styles.brandLabel} numberOfLines={1}>
            {product.siteName.toUpperCase()}
          </Text>
        ) : null}
        <Text
          style={styles.cardTitle}
          numberOfLines={2}
          allowFontScaling={false}>
          {product.title ?? 'Untitled'}
        </Text>
        {product.price ? (
          <Text style={styles.cardPrice} allowFontScaling={false}>
            {product.price}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const CARD_GAP = Spacing.md;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.cream },
  list: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  h1: {
    fontFamily: Fonts.serif,
    fontSize: 40,
    lineHeight: 44,
    color: Brand.ink,
    marginBottom: Spacing.lg,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.coral,
  },
  headerPillLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  row: { gap: CARD_GAP },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: CARD_GAP,
    overflow: 'hidden',
    shadowColor: Brand.ink,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  image: {
    aspectRatio: 1,
    backgroundColor: Brand.creamSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  cardMeta: {
    padding: Spacing.md,
    gap: 4,
  },
  brandLabel: {
    fontSize: 10,
    letterSpacing: 0.7,
    color: Brand.inkMuted,
  },
  cardTitle: {
    fontSize: 14,
    color: Brand.ink,
    lineHeight: 18,
    fontWeight: '500',
  },
  cardPrice: {
    fontSize: 14,
    color: Brand.ink,
    fontWeight: '600',
    marginTop: 2,
  },
  loading: { paddingVertical: Spacing.xl, alignItems: 'center' },
  empty: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 260,
  },
});
