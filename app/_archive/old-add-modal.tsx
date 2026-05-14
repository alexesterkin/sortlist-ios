import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Brand, Radius, Spacing } from '@/constants/theme';
import { trpc } from '@/lib/trpc';
import type { Collection, MetaFetchResult } from '@/lib/types';

const NEW_SORTLIST = '__new__';
const NO_SORTLIST = 'none';

export default function AddProductScreen() {
  const params = useLocalSearchParams<{ url?: string; collectionId?: string }>();

  const [url, setUrl] = useState(params.url ?? '');
  const [meta, setMeta] = useState<MetaFetchResult | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedSortlist, setSelectedSortlist] = useState<string>(
    params.collectionId ?? NO_SORTLIST,
  );
  const [newSortlistName, setNewSortlistName] = useState('');
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [didAutoFetch, setDidAutoFetch] = useState(false);

  const utils = trpc.useUtils();
  const collectionsQuery = trpc.collections.list.useQuery();
  const collections = (collectionsQuery.data ?? []) as Collection[];

  const fetchMeta = trpc.meta.fetch.useMutation();
  const addProduct = trpc.products.add.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.collections.list.invalidate(),
        utils.products.list.invalidate(),
      ]);
    },
  });

  const isNewSortlist = selectedSortlist === NEW_SORTLIST;
  const hasMeta = meta !== null;

  const canSave = useMemo(() => {
    if (!url.trim() || !title.trim()) return false;
    if (isNewSortlist && !newSortlistName.trim()) return false;
    return true;
  }, [url, title, isNewSortlist, newSortlistName]);

  // Auto-fetch metadata if a URL was passed in (e.g. from the share extension).
  useEffect(() => {
    if (didAutoFetch) return;
    if (!params.url) return;
    setDidAutoFetch(true);
    void onFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url]);

  const onPaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setUrl(text);
  };

  const onFetch = async () => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    setUrl(target);
    setScrapeError(null);
    try {
      const result = (await fetchMeta.mutateAsync({ url: target })) as MetaFetchResult;
      setMeta(result);
      if (result.blocked_message) {
        setScrapeError(result.blocked_message);
      } else {
        setTitle(result.title ?? '');
        setPrice(formatPrice(result.price, result.currency) ?? '');
        setImageUrl(result.imageUrl ?? '');
      }
    } catch (e: unknown) {
      setScrapeError(
        e instanceof Error
          ? e.message
          : "Couldn't fetch page details. You can still fill them in manually.",
      );
    }
  };

  const onSave = async () => {
    if (!canSave) return;
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;

    const payload: Record<string, unknown> = {
      url: target,
      title: title.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      price: price.trim() || undefined,
      siteName: meta?.siteName,
      notes: notes.trim() || undefined,
    };

    if (isNewSortlist) {
      payload.newCollectionName = newSortlistName.trim();
    } else if (selectedSortlist !== NO_SORTLIST) {
      payload.collectionId = parseInt(selectedSortlist, 10);
    }

    try {
      await addProduct.mutateAsync(payload);
      // Always replace to the sortlists home after a successful save —
      // router.back() throws GO_BACK if this screen was the entry point
      // (e.g. share-extension deep link, cold-start to this modal).
      router.replace('/(app)' as never);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not save product.';
      Alert.alert("Couldn't save", message);
    }
  };

  // Cancel: dismiss if there's something to dismiss, otherwise replace to
  // home. Guards against GO_BACK if /add was the entry point.
  const dismissOrHome = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)' as never);
    }
  };

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Add product',
          headerStyle: { backgroundColor: Brand.cream },
          headerShadowVisible: false,
          headerTitleStyle: { color: Brand.ink, fontSize: 17 },
          headerLeft: () => (
            <Pressable hitSlop={12} onPress={dismissOrHome}>
              <Text variant="body" color={Brand.ink}>
                Cancel
              </Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={styles.section}>
            <Text variant="caption" style={styles.sectionLabel}>
              Paste a link
            </Text>
            <View style={styles.urlRow}>
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="https://…"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={onFetch}
                containerStyle={{ flex: 1 }}
              />
              <Pressable
                onPress={onPaste}
                style={styles.pasteBtn}
                hitSlop={6}
                accessibilityLabel="Paste URL">
                <Ionicons name="clipboard-outline" size={18} color={Brand.ink} />
              </Pressable>
            </View>
            {!hasMeta ? (
              <Pressable
                onPress={onFetch}
                disabled={!url.trim() || fetchMeta.isPending}
                style={({ pressed }) => [
                  styles.fetchHint,
                  pressed && { opacity: 0.7 },
                ]}>
                {fetchMeta.isPending ? (
                  <ActivityIndicator color={Brand.coral} size="small" />
                ) : (
                  <Ionicons
                    name="sparkles-outline"
                    size={16}
                    color={Brand.coral}
                  />
                )}
                <Text variant="caption" color={Brand.coral}>
                  {fetchMeta.isPending
                    ? 'Reading the page…'
                    : 'Fetch product details'}
                </Text>
              </Pressable>
            ) : null}
            {scrapeError ? (
              <Text variant="caption" color={Brand.danger}>
                {scrapeError}
              </Text>
            ) : null}
          </View>

          {imageUrl ? (
            <View style={styles.previewCard}>
              <Image
                source={{ uri: imageUrl }}
                style={styles.preview}
                contentFit="cover"
                transition={200}
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <Input
              label="Title"
              value={title}
              onChangeText={setTitle}
              placeholder="What is it?"
            />
            <Input
              label="Price"
              value={price}
              onChangeText={setPrice}
              placeholder="£0.00"
            />
            {meta?.brand ? (
              <View style={styles.brandPill}>
                <Text variant="caption" color={Brand.inkSoft}>
                  Brand:{' '}
                </Text>
                <Text variant="caption" color={Brand.ink}>
                  {meta.brand}
                </Text>
                {meta.siteName && meta.siteName !== meta.brand ? (
                  <Text variant="caption" color={Brand.inkMuted}>
                    {' '}
                    · {meta.siteName}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Input
              label="Image URL"
              value={imageUrl}
              onChangeText={setImageUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://…"
            />
            <Input
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Why you saved it"
              multiline
              numberOfLines={3}
              style={{ height: 88, paddingTop: 12, textAlignVertical: 'top' }}
            />
          </View>

          <View style={styles.section}>
            <Text variant="caption" style={styles.sectionLabel}>
              Sortlist
            </Text>
            {collectionsQuery.isLoading ? (
              <ActivityIndicator color={Brand.coral} />
            ) : (
              <SortlistPicker
                collections={collections}
                selected={selectedSortlist}
                onChange={setSelectedSortlist}
              />
            )}
            {isNewSortlist ? (
              <Input
                label="New sortlist name"
                value={newSortlistName}
                onChangeText={setNewSortlistName}
                placeholder="e.g. Living room"
              />
            ) : null}
          </View>

          <Button
            title="Add to Sortlist"
            onPress={onSave}
            loading={addProduct.isPending}
            disabled={!canSave}
            style={{ marginTop: Spacing.sm }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function SortlistPicker({
  collections,
  selected,
  onChange,
}: {
  collections: Collection[];
  selected: string;
  onChange: (v: string) => void;
}) {
  const items: { id: string; label: string }[] = [
    { id: NO_SORTLIST, label: 'No sortlist' },
    ...collections.map((c) => ({ id: String(c.id), label: c.name })),
    { id: NEW_SORTLIST, label: '+ New sortlist' },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            style={[
              styles.chip,
              active && {
                backgroundColor: Brand.ink,
                borderColor: Brand.ink,
              },
            ]}>
            <Text
              variant="caption"
              color={active ? Brand.cream : Brand.ink}
              style={{ fontSize: 14 }}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function formatPrice(value: string | undefined, currency: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!currency) return trimmed;
  // If the price already has a currency symbol, leave it alone.
  if (/[£$€¥₩₹]/.test(trimmed)) return trimmed;
  const symbol: Record<string, string> = {
    GBP: '£',
    USD: '$',
    EUR: '€',
    JPY: '¥',
    KRW: '₩',
    INR: '₹',
  };
  const sym = symbol[currency.toUpperCase()];
  return sym ? `${sym}${trimmed}` : `${currency} ${trimmed}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.cream },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl * 1.5,
    gap: Spacing.xl,
  },
  section: { gap: Spacing.md },
  sectionLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: Brand.inkMuted,
    fontSize: 11,
  },
  urlRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  pasteBtn: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fetchHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.xs,
  },
  previewCard: {
    aspectRatio: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
  preview: { ...StyleSheet.absoluteFillObject },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Brand.creamSoft,
    borderRadius: 12,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
  },
});
