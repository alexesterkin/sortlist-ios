import {
  close,
  openHostApp,
  Text,
  TextInput,
  type InitialProps,
} from 'expo-share-extension';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  api,
  APIError,
  type AddProductInput,
  type Collection,
  type MetaFetchResult,
} from './share-extension/api';

// Inlined brand tokens — we don't import from @/constants to keep the share
// extension bundle independent of the rest of the app.
const Brand = {
  coral: '#FF5B3A',
  coralDark: '#E04A2A',
  cream: '#FAF8F3',
  creamSoft: '#F2EDE0',
  ink: '#1A1A1A',
  inkSoft: 'rgba(26,26,26,0.72)',
  inkMuted: 'rgba(26,26,26,0.55)',
  line: 'rgba(26,26,26,0.12)',
  danger: '#D43F26',
  white: '#FFFFFF',
};

const AI_OPTION = '__ai__' as const;
const NEW_OPTION = '__new__' as const;
type SortChoice = typeof AI_OPTION | typeof NEW_OPTION | number;

type Status =
  | { kind: 'loading' }
  | { kind: 'unauthed' }
  | { kind: 'ready' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

export default function ShareExtension(props: InitialProps) {
  const incomingUrl = useMemo(
    () => extractUrl(props.url, props.text, props.preprocessingResults),
    [props.url, props.text, props.preprocessingResults],
  );

  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [meta, setMeta] = useState<MetaFetchResult | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [choice, setChoice] = useState<SortChoice>(AI_OPTION);
  const [newSortlistName, setNewSortlistName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!incomingUrl) {
        if (!cancelled) {
          setStatus({
            kind: 'error',
            message:
              'No link found in what you shared. Try sharing a product page from Safari.',
          });
        }
        return;
      }

      try {
        const me = await api.authMe();
        if (cancelled) return;
        if (!me) {
          setStatus({ kind: 'unauthed' });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof APIError && e.httpStatus === 401) {
          setStatus({ kind: 'unauthed' });
          return;
        }
        setStatus({
          kind: 'error',
          message:
            e instanceof Error
              ? e.message
              : 'Could not reach Sortlist. Check your connection.',
        });
        return;
      }

      // Auth OK — fetch preview + sortlists in parallel.
      const [metaRes, listRes] = await Promise.allSettled([
        api.metaFetch(incomingUrl),
        api.collectionsList(),
      ]);
      if (cancelled) return;

      if (metaRes.status === 'fulfilled') {
        setMeta(metaRes.value);
      } else {
        const err = metaRes.reason;
        // Fall back to a stub so the user can still save with just the URL.
        setMeta({
          title: '',
          imageUrl: '',
          price: '',
          siteName: hostnameOf(incomingUrl),
          blocked_message:
            err instanceof Error
              ? err.message
              : 'Could not read this page automatically.',
        });
      }
      if (listRes.status === 'fulfilled') {
        setCollections(listRes.value);
      }
      setStatus({ kind: 'ready' });
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [incomingUrl]);

  const onSave = async () => {
    if (!incomingUrl || !meta) return;
    setStatus({ kind: 'saving' });

    const payload: AddProductInput = {
      url: incomingUrl,
      title: meta.title || undefined,
      imageUrl: meta.imageUrl || undefined,
      price: formatPrice(meta.price, meta.currency),
      siteName: meta.siteName || undefined,
    };
    if (choice === NEW_OPTION) {
      const name = newSortlistName.trim();
      if (!name) {
        setStatus({
          kind: 'error',
          message: 'Give your new sortlist a name.',
        });
        return;
      }
      payload.newCollectionName = name;
    } else if (choice !== AI_OPTION) {
      payload.collectionId = choice;
    }
    // For AI_OPTION we send neither — the backend's AI auto-assigns.

    try {
      await api.productsAdd(payload);
      // Brief success blip then dismiss back to the source app.
      setStatus({ kind: 'ready' });
      close();
    } catch (e) {
      const message =
        e instanceof APIError && e.code === 'UNAUTHORIZED'
          ? 'Your Sortlist session has expired. Open the app to sign in again.'
          : e instanceof Error
            ? e.message
            : 'Could not save. Try again in a moment.';
      setStatus({ kind: 'error', message });
    }
  };

  const goToApp = () => {
    void openHostApp('');
    close();
  };

  return (
    <View style={styles.root}>
      <Header onCancel={close} />

      {status.kind === 'loading' ? (
        <Centered>
          <ActivityIndicator color={Brand.coral} />
          <Text style={styles.dimText} allowFontScaling={false}>
            Reading product…
          </Text>
        </Centered>
      ) : status.kind === 'unauthed' ? (
        <UnauthedState onOpenApp={goToApp} />
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}>
              {meta ? (
                <ProductPreview meta={meta} />
              ) : null}
              <SortChoiceRow
                choice={choice}
                collections={collections}
                onPress={() => setPickerOpen(true)}
              />
              {choice === NEW_OPTION ? (
                <View>
                  <Text style={styles.label} allowFontScaling={false}>
                    Sortlist name
                  </Text>
                  <TextInput
                    value={newSortlistName}
                    onChangeText={setNewSortlistName}
                    placeholder="e.g. Living room"
                    placeholderTextColor={Brand.inkMuted}
                    style={styles.input}
                    allowFontScaling={false}
                    autoCapitalize="sentences"
                  />
                </View>
              ) : null}
              {meta?.blocked_message ? (
                <Text style={styles.warn} allowFontScaling={false}>
                  {meta.blocked_message}
                </Text>
              ) : null}
              {status.kind === 'error' ? (
                <Text style={styles.error} allowFontScaling={false}>
                  {status.message}
                </Text>
              ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onSave}
              disabled={status.kind === 'saving'}
              style={({ pressed }) => [
                styles.saveBtn,
                pressed && { backgroundColor: Brand.coralDark },
                status.kind === 'saving' && { opacity: 0.7 },
              ]}>
              {status.kind === 'saving' ? (
                <ActivityIndicator color={Brand.white} />
              ) : (
                <Text style={styles.saveBtnText} allowFontScaling={false}>
                  Save to Sortlist
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      )}

      <SortChoicePicker
        visible={pickerOpen}
        collections={collections}
        selected={choice}
        onSelect={(c) => {
          setChoice(c);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

function Header({ onCancel }: { onCancel: () => void }) {
  return (
    <View style={styles.header}>
      <View style={{ width: 56 }}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={styles.headerCancel} allowFontScaling={false}>
            Cancel
          </Text>
        </Pressable>
      </View>
      <View style={styles.headerCenter}>
        <View style={styles.brandDot} />
        <Text style={styles.brandLabel} allowFontScaling={false}>
          Sortlist
        </Text>
      </View>
      <View style={{ width: 56 }} />
    </View>
  );
}

function ProductPreview({ meta }: { meta: MetaFetchResult }) {
  return (
    <View style={styles.previewCard}>
      <View style={styles.previewImageBox}>
        {meta.imageUrl ? (
          <Image
            source={{ uri: meta.imageUrl }}
            style={styles.previewImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.previewImage, styles.previewImageEmpty]}>
            <Text style={styles.previewEmptyText} allowFontScaling={false}>
              No preview
            </Text>
          </View>
        )}
      </View>
      <View style={styles.previewBody}>
        {meta.brand || meta.siteName ? (
          <Text style={styles.previewBrand} allowFontScaling={false} numberOfLines={1}>
            {(meta.brand || meta.siteName || '').toUpperCase()}
          </Text>
        ) : null}
        <Text
          style={styles.previewTitle}
          allowFontScaling={false}
          numberOfLines={2}>
          {meta.title || 'Untitled'}
        </Text>
        {meta.price ? (
          <Text style={styles.previewPrice} allowFontScaling={false}>
            {formatPrice(meta.price, meta.currency)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SortChoiceRow({
  choice,
  collections,
  onPress,
}: {
  choice: SortChoice;
  collections: Collection[];
  onPress: () => void;
}) {
  const label = labelFor(choice, collections);
  return (
    <View>
      <Text style={styles.label} allowFontScaling={false}>
        Sort to
      </Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.dropdown,
          pressed && { backgroundColor: Brand.creamSoft },
        ]}>
        <Text style={styles.dropdownText} allowFontScaling={false} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.dropdownChevron} allowFontScaling={false}>
          ▾
        </Text>
      </Pressable>
    </View>
  );
}

function SortChoicePicker({
  visible,
  collections,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  collections: Collection[];
  selected: SortChoice;
  onSelect: (c: SortChoice) => void;
  onClose: () => void;
}) {
  const items: { key: string; label: string; value: SortChoice }[] = [
    { key: 'ai', label: '✦  AI will sort this', value: AI_OPTION },
    ...collections.map((c) => ({
      key: `c${c.id}`,
      label: c.name,
      value: c.id as SortChoice,
    })),
    { key: 'new', label: '+  Create new sortlist', value: NEW_OPTION },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <Text style={styles.modalTitle} allowFontScaling={false}>
            Sort to
          </Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {items.map((item) => {
              const active =
                (item.value === AI_OPTION && selected === AI_OPTION) ||
                (item.value === NEW_OPTION && selected === NEW_OPTION) ||
                (typeof item.value === 'number' && item.value === selected);
              return (
                <Pressable
                  key={item.key}
                  onPress={() => onSelect(item.value)}
                  style={({ pressed }) => [
                    styles.modalRow,
                    pressed && { backgroundColor: Brand.creamSoft },
                    active && { backgroundColor: Brand.creamSoft },
                  ]}>
                  <Text
                    style={[
                      styles.modalRowText,
                      active && { color: Brand.coral, fontWeight: '600' },
                    ]}
                    allowFontScaling={false}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function UnauthedState({ onOpenApp }: { onOpenApp: () => void }) {
  return (
    <Centered>
      <Text style={styles.title} allowFontScaling={false}>
        Sign in to save
      </Text>
      <Text style={styles.dimText} allowFontScaling={false}>
        Open Sortlist on this device to sign in. We&apos;ll remember it after
        that.
      </Text>
      <Pressable
        onPress={onOpenApp}
        style={({ pressed }) => [
          styles.saveBtn,
          { marginTop: 16, alignSelf: 'stretch' },
          pressed && { backgroundColor: Brand.coralDark },
        ]}>
        <Text style={styles.saveBtnText} allowFontScaling={false}>
          Open Sortlist
        </Text>
      </Pressable>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function labelFor(choice: SortChoice, collections: Collection[]): string {
  if (choice === AI_OPTION) return '✦  AI will sort this';
  if (choice === NEW_OPTION) return '+  New sortlist';
  const found = collections.find((c) => c.id === choice);
  return found ? found.name : 'AI will sort this';
}

function extractUrl(
  url?: string,
  text?: string,
  preprocessing?: unknown,
): string | null {
  if (url) return url;
  if (preprocessing && typeof preprocessing === 'object') {
    const pp = preprocessing as { URL?: string; url?: string };
    if (typeof pp.URL === 'string') return pp.URL;
    if (typeof pp.url === 'string') return pp.url;
  }
  if (text) {
    const m = text.match(/https?:\/\/\S+/i);
    if (m) return m[0];
  }
  return null;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatPrice(
  value: string | undefined,
  currency: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[£$€¥₩₹]/.test(trimmed)) return trimmed;
  if (!currency) return trimmed;
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
  root: {
    flex: 1,
    backgroundColor: Brand.cream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  headerCancel: {
    fontSize: 16,
    color: Brand.ink,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Brand.coral,
  },
  brandLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Brand.ink,
    letterSpacing: 0.4,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: Brand.ink,
    textAlign: 'center',
  },
  dimText: {
    fontSize: 14,
    color: Brand.inkMuted,
    textAlign: 'center',
  },
  previewCard: {
    flexDirection: 'row',
    backgroundColor: Brand.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    padding: 12,
    gap: 12,
  },
  previewImageBox: {
    width: 88,
    height: 88,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Brand.creamSoft,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewImageEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEmptyText: {
    fontSize: 11,
    color: Brand.inkMuted,
  },
  previewBody: {
    flex: 1,
    justifyContent: 'space-between',
  },
  previewBrand: {
    fontSize: 11,
    color: Brand.inkMuted,
    letterSpacing: 0.6,
  },
  previewTitle: {
    fontSize: 16,
    color: Brand.ink,
    fontWeight: '600',
    marginTop: 2,
  },
  previewPrice: {
    fontSize: 15,
    color: Brand.ink,
    marginTop: 6,
    fontWeight: '600',
  },
  label: {
    fontSize: 11,
    letterSpacing: 1,
    color: Brand.inkMuted,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    backgroundColor: Brand.white,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    paddingHorizontal: 16,
  },
  dropdownText: {
    flex: 1,
    fontSize: 16,
    color: Brand.ink,
  },
  dropdownChevron: {
    fontSize: 14,
    color: Brand.inkMuted,
    marginLeft: 8,
  },
  input: {
    height: 52,
    backgroundColor: Brand.white,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    paddingHorizontal: 16,
    fontSize: 16,
    color: Brand.ink,
  },
  warn: {
    fontSize: 13,
    color: Brand.inkSoft,
    backgroundColor: Brand.creamSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  error: {
    fontSize: 13,
    color: Brand.danger,
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    backgroundColor: Brand.cream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Brand.line,
  },
  saveBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Brand.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: Brand.white,
    fontSize: 16,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: Brand.cream,
    borderRadius: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 11,
    letterSpacing: 1,
    color: Brand.inkMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  modalRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalRowText: {
    fontSize: 16,
    color: Brand.ink,
  },
});
