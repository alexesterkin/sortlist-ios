import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
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

import { Text } from '@/components/ui/text';
import { Brand, Spacing, coverColorFor } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import type { Collection, Product } from '@/lib/types';

export default function SortlistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const collectionId = Number(id);
  const [refreshing, setRefreshing] = useState(false);

  const collectionsQuery = trpc.collections.list.useQuery();
  const productsQuery = trpc.products.list.useQuery({
    collectionId,
    status: 'all',
  });

  const collection = useMemo(() => {
    const list = (collectionsQuery.data ?? []) as Collection[];
    return list.find((c) => c.id === collectionId) ?? null;
  }, [collectionsQuery.data, collectionId]);

  const products = (productsQuery.data ?? []) as Product[];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([collectionsQuery.refetch(), productsQuery.refetch()]);
    setRefreshing(false);
  };

  const isLoading = productsQuery.isLoading && !refreshing;
  const tint = coverColorFor(collectionId);

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: Brand.cream },
          headerShadowVisible: false,
          headerTintColor: Brand.ink,
          headerRight: () => (
            <Pressable
              hitSlop={10}
              onPress={() =>
                router.push({
                  pathname: '/(app)/add',
                  params: { collectionId: String(collectionId) },
                })
              }
              accessibilityLabel="Add product to sortlist">
              <Ionicons name="add" size={26} color={Brand.ink} />
            </Pressable>
          ),
        }}
      />
      <FlatList
        data={products}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={[styles.headerBadge, { backgroundColor: tint }]}>
              <Text variant="display" style={styles.headerInitial}>
                {(collection?.name ?? 'S').charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text variant="display" style={styles.h1}>
              {collection?.name ?? 'Sortlist'}
            </Text>
            <Text variant="caption">
              {products.length} {products.length === 1 ? 'item' : 'items'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={Brand.coral} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Text variant="subtitle" style={{ textAlign: 'center' }}>
                No products yet
              </Text>
              <Text
                variant="caption"
                style={{ textAlign: 'center', marginTop: 6 }}>
                Tap + to add one.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <ProductRow product={item} />}
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

function ProductRow({ product }: { product: Product }) {
  const open = async () => {
    if (!product.url) return;
    await WebBrowser.openBrowserAsync(product.url, {
      controlsColor: Brand.coral,
      toolbarColor: Brand.cream,
      dismissButtonStyle: 'done',
      readerMode: false,
    });
  };

  const brand = product.siteName ?? 'Product';

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
      <View style={styles.thumb}>
        {product.imageUrl ? (
          <>
            <Image
              source={{ uri: product.imageUrl }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={150}
            />
            {/* Subtle hairline so product photos with white backgrounds
                don't bleed into the white card. */}
            <View pointerEvents="none" style={styles.thumbBorder} />
          </>
        ) : (
          <Ionicons name="bag-outline" size={24} color={Brand.inkMuted} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text
          variant="caption"
          numberOfLines={1}
          style={styles.brandLabel}>
          {brand}
        </Text>
        <Text variant="subtitle" numberOfLines={2} style={{ marginTop: 2 }}>
          {product.title ?? 'Untitled'}
        </Text>
        <View style={styles.cardFoot}>
          {product.price ? (
            <Text variant="body" style={styles.price}>
              {product.price}
            </Text>
          ) : (
            <Text variant="caption">No price</Text>
          )}
          <View style={styles.openHint}>
            <Ionicons name="open-outline" size={14} color={Brand.inkMuted} />
            <Text variant="caption" style={{ fontSize: 12 }}>
              Open
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.cream },
  list: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  header: {
    paddingTop: 0,
    paddingBottom: Spacing.lg,
    gap: 4,
  },
  headerBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  headerInitial: {
    fontSize: 36,
    lineHeight: 40,
  },
  h1: {
    fontSize: 40,
    lineHeight: 44,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    overflow: 'hidden',
    padding: Spacing.md,
    gap: Spacing.md,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: 14,
    backgroundColor: Brand.creamSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  cardBody: { flex: 1, justifyContent: 'space-between' },
  brandLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
    color: Brand.inkMuted,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  price: { fontWeight: '600' },
  openHint: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  empty: {
    paddingTop: Spacing.xxl,
    alignItems: 'center',
  },
});
