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
import {
  Brand,
  Radius,
  Spacing,
  coverColorFor,
} from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import type { Collection, Product } from '@/lib/types';

export default function SortlistsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const collectionsQuery = trpc.collections.list.useQuery(undefined, {
    retry: 1,
  });
  const productsQuery = trpc.products.list.useQuery(
    { status: 'all' },
    { retry: 1 },
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([collectionsQuery.refetch(), productsQuery.refetch()]);
    setRefreshing(false);
  };

  const collections = ((collectionsQuery.data ?? []) as Collection[]).slice();
  const products = (productsQuery.data ?? []) as Product[];

  // The backend already sends `itemCount` per collection. We still derive a
  // cover image client-side from the latest product whose imageUrl we know.
  const coversByCollection = new Map<number, string>();
  for (const p of products) {
    if (p.collectionId == null) continue;
    if (!coversByCollection.has(p.collectionId) && p.imageUrl) {
      coversByCollection.set(p.collectionId, p.imageUrl);
    }
  }

  const isLoading =
    (collectionsQuery.isLoading || productsQuery.isLoading) && !refreshing;
  const fetchError = collectionsQuery.error ?? productsQuery.error;

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
            {!isLoading && fetchError ? (
              <ErrorState
                message={
                  fetchError.message?.includes('Network')
                    ? "Couldn't reach Sortlist. Check your connection and pull to refresh."
                    : (fetchError.message ?? 'Something went wrong.')
                }
              />
            ) : null}
            {!isLoading && !fetchError && collections.length === 0 ? (
              <EmptyState />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <SortlistCard
            collection={item}
            count={item.itemCount ?? 0}
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
        style={({ pressed }) => [
          styles.fab,
          { bottom: insets.bottom + Spacing.xl },
          pressed && { backgroundColor: Brand.coralDark },
        ]}>
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
  const tint = coverColorFor(collection.id);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={[styles.cover, { backgroundColor: tint }]}>
        {cover ? (
          <Image
            source={{ uri: cover }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <Text
            variant="display"
            style={styles.coverInitial}
            color={Brand.ink}
            numberOfLines={1}>
            {initial(collection.name)}
          </Text>
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

function initial(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  return trimmed.charAt(0).toUpperCase();
}

function EmptyState() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="bag-handle-outline" size={28} color={Brand.ink} />
      </View>
      <Text variant="title" style={{ textAlign: 'center' }}>
        No sortlists yet
      </Text>
      <Text variant="caption" style={styles.emptyText}>
        Tap the + button to save your first product. We&apos;ll create a
        sortlist for it automatically.
      </Text>
    </View>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: '#FBE3DC' }]}>
        <Ionicons name="cloud-offline-outline" size={26} color={Brand.danger} />
      </View>
      <Text variant="subtitle" style={{ textAlign: 'center' }}>
        {message}
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  row: {
    gap: CARD_GAP,
  },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: CARD_GAP,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  cover: {
    aspectRatio: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    fontSize: 72,
    lineHeight: 80,
  },
  cardMeta: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: 2,
  },
  loading: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  empty: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl * 1.5,
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
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Brand.coral,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF5B3A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
});
