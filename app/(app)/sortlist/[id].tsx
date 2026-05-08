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
import { Brand, Radius, Spacing } from '@/constants/theme';
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

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: Brand.cream },
          headerShadowVisible: false,
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
    });
  };

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <View style={styles.thumb}>
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={150}
          />
        ) : (
          <Ionicons name="bag-outline" size={24} color={Brand.inkMuted} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text variant="caption" numberOfLines={1}>
          {product.brand ?? product.siteName ?? 'Product'}
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
          <Ionicons
            name="open-outline"
            size={16}
            color={Brand.inkMuted}
            style={{ marginLeft: 'auto' }}
          />
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
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    gap: 4,
  },
  h1: {
    fontSize: 40,
    lineHeight: 44,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Brand.line,
    overflow: 'hidden',
    padding: Spacing.md,
    gap: Spacing.md,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: Radius.md,
    backgroundColor: Brand.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardBody: { flex: 1, justifyContent: 'space-between' },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  price: { fontWeight: '600' },
  empty: {
    paddingTop: Spacing.xxl,
    alignItems: 'center',
  },
});
