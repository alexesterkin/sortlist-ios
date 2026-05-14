import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SortlistBrand } from '@/components/brand';
import { Text } from '@/components/ui/text';
import { Brand, Fonts, Spacing, coverColorFor } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import type { Collection, Product } from '@/lib/types';

export default function SortlistsScreen() {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const utils = trpc.useUtils();
  const collectionsQuery = trpc.collections.list.useQuery(undefined, {
    retry: 1,
  });
  const productsQuery = trpc.products.list.useQuery(
    { status: 'all' },
    { retry: 1 },
  );
  const createCollection = trpc.collections.create.useMutation({
    onSuccess: () => utils.collections.list.invalidate(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([collectionsQuery.refetch(), productsQuery.refetch()]);
    setRefreshing(false);
  };

  const collections = useMemo<Collection[]>(
    () => ((collectionsQuery.data ?? []) as Collection[]).slice(),
    [collectionsQuery.data],
  );
  const products = (productsQuery.data ?? []) as Product[];

  // Up to four product images per sortlist, in insertion order (most recent
  // first if the backend already sorts that way). The card renders them as
  // a 2x2 mosaic; fewer than four are padded with tinted blanks.
  const coversByCollection = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const p of products) {
      if (p.collectionId == null || !p.imageUrl) continue;
      const arr = map.get(p.collectionId) ?? [];
      if (arr.length < 4) {
        arr.push(p.imageUrl);
        map.set(p.collectionId, arr);
      }
    }
    return map;
  }, [products]);

  const isLoading =
    (collectionsQuery.isLoading || productsQuery.isLoading) && !refreshing;
  const fetchError = collectionsQuery.error ?? productsQuery.error;

  const promptCreate = () => {
    Alert.prompt(
      'New Sortlist',
      'Name your sortlist',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: (name?: string) => {
            const trimmed = (name ?? '').trim();
            if (!trimmed) return;
            createCollection.mutate({ name: trimmed });
          },
        },
      ],
      'plain-text',
      '',
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={collections}
        keyExtractor={(c) => String(c.id)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.topbar}>
              <SortlistBrand size={28} />
              <Pressable
                hitSlop={10}
                onPress={promptCreate}
                style={styles.headerPill}
                accessibilityLabel="Create a new sortlist">
                <Ionicons name="add" size={16} color={Brand.coral} />
                <Text variant="caption" color={Brand.coral} style={styles.headerPillLabel}>
                  New
                </Text>
              </Pressable>
            </View>
            <Text variant="display" style={styles.h1}>
              Sortlists
            </Text>
            {isLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={Brand.coral} />
              </View>
            ) : null}
            {!isLoading && fetchError ? (
              <ErrorState
                message={
                  fetchError.message?.includes('Network')
                    ? "Couldn't reach Sortlist. Pull to refresh."
                    : (fetchError.message ?? 'Something went wrong.')
                }
              />
            ) : null}
            {!isLoading && !fetchError && collections.length === 0 ? (
              <EmptyState onCreate={promptCreate} />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <SortlistCard
            collection={item}
            covers={coversByCollection.get(item.id) ?? []}
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
    </View>
  );
}

function SortlistCard({
  collection,
  covers,
  onPress,
}: {
  collection: Collection;
  covers: string[];
  onPress: () => void;
}) {
  const itemCount = collection.itemCount ?? 0;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
      <Mosaic covers={covers} collectionId={collection.id} name={collection.name} />
      <View style={styles.cardMeta}>
        <Text
          numberOfLines={1}
          style={styles.cardTitle}
          allowFontScaling={false}>
          {collection.name}
        </Text>
        <Text variant="caption" style={styles.cardCount}>
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>
    </Pressable>
  );
}

// 2x2 image mosaic. Renders 0, 1, 2, 3, or 4 images cleanly. If we have
// fewer than four product images, the empty cells get a tinted fill (the
// sortlist's deterministic accent colour) so the grid still reads as a
// square block rather than a half-empty rectangle.
function Mosaic({
  covers,
  collectionId,
  name,
}: {
  covers: string[];
  collectionId: number;
  name: string;
}) {
  const tint = coverColorFor(collectionId);

  if (covers.length === 0) {
    // Empty sortlist — show the initial on a tinted square.
    return (
      <View style={[mosaicStyles.cover, { backgroundColor: tint }]}>
        <Text
          style={mosaicStyles.initial}
          allowFontScaling={false}
          numberOfLines={1}>
          {(name.trim().charAt(0) || 'S').toUpperCase()}
        </Text>
      </View>
    );
  }

  // Always render exactly four cells so the geometry is stable. Real
  // images fill the first N; the rest are tinted blanks.
  const cells: (string | null)[] = [
    covers[0] ?? null,
    covers[1] ?? null,
    covers[2] ?? null,
    covers[3] ?? null,
  ];

  return (
    <View style={mosaicStyles.cover}>
      <View style={mosaicStyles.row}>
        <Cell uri={cells[0]} tint={tint} />
        <View style={mosaicStyles.cellGap} />
        <Cell uri={cells[1]} tint={tint} />
      </View>
      <View style={mosaicStyles.rowGap} />
      <View style={mosaicStyles.row}>
        <Cell uri={cells[2]} tint={tint} />
        <View style={mosaicStyles.cellGap} />
        <Cell uri={cells[3]} tint={tint} />
      </View>
    </View>
  );
}

function Cell({ uri, tint }: { uri: string | null; tint: string }) {
  return (
    <View style={[mosaicStyles.cell, { backgroundColor: tint }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          transition={150}
        />
      ) : null}
    </View>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="bag-handle-outline" size={28} color={Brand.ink} />
      </View>
      <Text variant="title" style={{ textAlign: 'center' }}>
        No sortlists yet
      </Text>
      <Text variant="caption" style={styles.emptyText}>
        Group your saved products — like Trainers, Birthday gifts, or Home
        decor.
      </Text>
      <Pressable
        onPress={onCreate}
        style={({ pressed }) => [
          styles.emptyCta,
          pressed && { backgroundColor: Brand.coralDark },
        ]}>
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.emptyCtaLabel} allowFontScaling={false}>
          New Sortlist
        </Text>
      </Pressable>
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
    // Subtle shadow — the user explicitly asked for it.
    shadowColor: Brand.ink,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardMeta: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: 2,
  },
  cardTitle: {
    fontFamily: Fonts.serif,
    fontSize: 20,
    lineHeight: 24,
    color: Brand.ink,
    letterSpacing: -0.2,
  },
  cardCount: {
    color: Brand.inkMuted,
    fontSize: 12,
  },
  loading: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
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
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    height: 44,
    borderRadius: 22,
    backgroundColor: Brand.coral,
    marginTop: Spacing.sm,
  },
  emptyCtaLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});

const mosaicStyles = StyleSheet.create({
  cover: {
    aspectRatio: 1,
    overflow: 'hidden',
    backgroundColor: Brand.creamSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: Fonts.serif,
    fontSize: 72,
    lineHeight: 80,
    color: Brand.ink,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    overflow: 'hidden',
  },
  cellGap: { width: 1.5, backgroundColor: '#fff' },
  rowGap: { height: 1.5, backgroundColor: '#fff' },
});
