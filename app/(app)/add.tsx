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

export default function AddProductScreen() {
  const params = useLocalSearchParams<{ url?: string; collectionId?: string }>();

  const [url, setUrl] = useState(params.url ?? '');
  const [meta, setMeta] = useState<MetaFetchResult | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedSortlist, setSelectedSortlist] = useState<string>(
    params.collectionId ?? 'none',
  );
  const [newSortlistName, setNewSortlistName] = useState('');
  const [error, setError] = useState<string | null>(null);
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
        setPrice(result.price ?? '');
        setImageUrl(result.imageUrl ?? '');
      }
    } catch (e: unknown) {
      setScrapeError(
        e instanceof Error
          ? e.message
          : 'Could not fetch metadata. You can fill in details manually.',
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
    } else if (selectedSortlist !== 'none') {
      payload.collectionId = parseInt(selectedSortlist, 10);
    }

    try {
      await addProduct.mutateAsync(payload);
      router.back();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save product.';
      setError(message);
      Alert.alert('Save failed', message);
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
          headerLeft: () => (
            <Pressable hitSlop={12} onPress={() => router.back()}>
              <Text variant="body" color={Brand.ink}>
                Cancel
              </Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <Text variant="caption">Product URL</Text>
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
            <Button
              title={fetchMeta.isPending ? 'Fetching…' : 'Fetch details'}
              onPress={onFetch}
              loading={fetchMeta.isPending}
              variant="outline"
            />
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
            <Text variant="caption">Sortlist</Text>
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

          {error ? (
            <Text variant="caption" color={Brand.danger}>
              {error}
            </Text>
          ) : null}

          <Button
            title="Save"
            onPress={onSave}
            loading={addProduct.isPending}
            disabled={!canSave}
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
    { id: 'none', label: 'No sortlist' },
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.cream },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.xl,
  },
  section: { gap: Spacing.md },
  urlRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  pasteBtn: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCard: {
    aspectRatio: 1,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.line,
  },
  preview: { ...StyleSheet.absoluteFillObject },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.line,
  },
});
