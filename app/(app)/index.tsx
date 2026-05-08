import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import type { Collection, Product } from '@/lib/types';

export default function SortlistsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const collectionsQuery = trpc.collections.list.useQuery();
  const productsQuery = trpc.products.list.useQuery({ status: 'all' });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([collectionsQuery.refetch(), productsQuery.refetch()]);
    setRefreshing(false);
  };

  const collections = ((collectionsQuery.data ?? []) as Collection[]).slice();
  const products = (productsQuery.data ?? []) as Product[];

  const countsByCollection = new Map<number, number>();
  for (const p of products) {
    if (p.collectionId == null) continue;
    countsByCollection.set(
      p.collectionId,
      (countsByCollection.get(p.collectionId) ?? 0) + 1,
    );
  }
  const coversByCollection = new Map<number, string>();
  for (const p of products) {
    if (p.collectionId == null) continue;
    if (!coversByCollection.has(p.collectionId) && p.imageUrl) {
      coversByCollection.set(p.collectionId, p.imageUrl);
    }
  }

  const isLoading =
    (collectionsQuery.isLoading || productsQuery.isLoading) && !refreshing;

  const greeting = user?.name ? user.name.split(' ')[0] : 'there';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={collections}
        keyExtractor={(c) => String(c.id)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 96 },
        ]}
        ListHeaderComponent={
          <View>
            <View style={styles.topbar}>
              <View style={{ flex: 1 }}>
                <Text variant="caption">Hi {greeting},</Text>
                <Text variant="display" style={styles.h1}>
                  Sortlists
                </Text>
              </View>
              <Pressable
                hitSlop={12}
                onPress={() => signOut()}
                style={styles.iconBtn}
                accessibilityLabel="Sign out">
                <Ionicons name="log-out-outline" size={22} color={Brand.ink} />
              </Pressable>
            </View>
            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={Brand.coral} />
              </View>
            ) : null}
            {!isLoading && collections.length === 0 ? (
              <EmptyState />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <SortlistCard
            collection={item}
            count={countsByCollection.get(item.id) ?? item.productCount ?? 0}
            cover={coversByCollection.get(item.id) ?? item.coverImageUrl ?? null}
            onPress={() =>
              router.push(`/(app)/sortlist/${item.id}` as never)
            }
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Brand.coral}
          />
        }
      />

      <Pressable
        accessibilityLabel="Add product"
        onPress={() => router.push('/(app)/add')}
        style={[styles.fab, { bottom: insets.bottom + Spacing.xl }]}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

function SortlistCard({
  collection,
  count,
  cover,
  onPress,
}: {
  collection: Collection;
  count: number;
  cover: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.cover}>
        {cover ? (
          <Image
            source={{ uri: cover }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Ionicons name="bag-outline" size={28} color={Brand.inkMuted} />
          </View>
        )}
      </View>
      <View style={styles.cardMeta}>
        <Text variant="subtitle" numberOfLines={1}>
          {collection.name}
        </Text>
        <Text variant="caption">
          {count} {count === 1 ? 'item' : 'items'}
        </Text>
      </View>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text variant="title" style={{ textAlign: 'center' }}>
        No sortlists yet
      </Text>
      <Text variant="caption" style={{ textAlign: 'center', marginTop: 8 }}>
        Tap the + button to save your first product. We&apos;ll create a sortlist
        for it automatically.
      </Text>
    </View>
  );
}

const CARD_GAP = Spacing.md;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Brand.cream,
  },
  list: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  h1: {
    fontSize: 44,
    lineHeight: 48,
    marginTop: 4,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.line,
  },
  row: {
    gap: CARD_GAP,
  },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    marginBottom: CARD_GAP,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Brand.line,
  },
  cover: {
    aspectRatio: 1,
    backgroundColor: Brand.line,
    overflow: 'hidden',
  },
  coverPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: {
    padding: Spacing.md,
    gap: 4,
  },
  loading: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  empty: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl * 1.5,
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.coral,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Brand.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  },
});
