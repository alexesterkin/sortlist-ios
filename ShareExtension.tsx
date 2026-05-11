/**
 * Sortlist share extension — minimal, self-contained.
 *
 * Strict primitive budget:
 *   - From react-native: View, Text*, Image, TouchableOpacity, ActivityIndicator
 *     (no Modal, no Pressable, no ScrollView, no nav libs)
 *   - From expo-share-extension: close, openHostApp, Text, TextInput
 *   - Storage: AsyncStorage (via lib/session indirectly through share-extension/api)
 *   - HTTP: fetch (via share-extension/api)
 *
 * *We use expo-share-extension's Text + TextInput rather than RN core's,
 *  because the upstream RN versions have a font-scaling bug inside
 *  extensions. Same API surface, no nav deps.
 *
 * Layout uses two top-level states:
 *   - picker closed: header / product preview / dropdown trigger / save
 *   - picker open:   header / list of sort options (overrides the above)
 *
 * This avoids needing Modal or ScrollView while still feeling like a
 * native two-step sheet.
 */
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
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  api,
  APIError,
  type AddProductInput,
  type Collection,
  type MetaFetchResult,
} from './share-extension/api';

// Brand tokens are inlined so this component depends on nothing in the
// main app's import graph.
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

// Cap the visible sortlists in the picker so we never overflow the sheet
// height (we have no ScrollView). Power users with more sortlists can
// open the host app to see the rest.
const MAX_VISIBLE_SORTLISTS = 6;

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

      const [metaRes, listRes] = await Promise.allSettled([
        api.metaFetch(incomingUrl),
        api.collectionsList(),
      ]);
      if (cancelled) return;

      if (metaRes.status === 'fulfilled') {
        setMeta(metaRes.value);
      } else {
        const err = metaRes.reason;
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
      // Done — dismiss the sheet. User returns to Safari (or wherever they shared from).
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
    // openHostApp(path) opens sortlist://<path>. Pass 'login' so the
    // host app's auth-gated route guard lands directly on the sign-in
    // screen instead of flashing some other route first. Once the user
    // signs in there, the JWT gets written to the shared keychain
    // (lib/session.ts via SecureStore + plugins/with-share-extension-
    // keychain.js) and a subsequent share will see it without any deep
    // link plumbing.
    void openHostApp('login');
    close();
  };

  return (
    <View style={styles.root}>
      <Header onCancel={close} />

      {status.kind === 'loading' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Brand.coral} />
          <Text style={styles.dimText} allowFontScaling={false}>
            Reading product…
          </Text>
        </View>
      ) : null}

      {status.kind === 'unauthed' ? (
        <UnauthedState onOpenApp={goToApp} />
      ) : null}

      {(status.kind === 'ready' ||
        status.kind === 'saving' ||
        status.kind === 'error') && meta ? (
        pickerOpen ? (
          // Picker open: full list of sort options replaces the preview.
          <PickerList
            collections={collections}
            selected={choice}
            onSelect={(c) => {
              setChoice(c);
              setPickerOpen(false);
            }}
            onOpenApp={goToApp}
          />
        ) : (
          // Picker closed: product preview + dropdown trigger + save.
          <View style={styles.body}>
            <ProductPreview meta={meta} />

            <View style={styles.section}>
              <Text style={styles.label} allowFontScaling={false}>
                Sort to
              </Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setPickerOpen(true)}
                style={styles.dropdown}>
                <Text style={styles.dropdownText} allowFontScaling={false}>
                  {labelFor(choice, collections)}
                </Text>
                <Text style={styles.dropdownChevron} allowFontScaling={false}>
                  ▾
                </Text>
              </TouchableOpacity>
              {choice === NEW_OPTION ? (
                <TextInput
                  value={newSortlistName}
                  onChangeText={setNewSortlistName}
                  placeholder="New sortlist name"
                  placeholderTextColor={Brand.inkMuted}
                  style={styles.input}
                  allowFontScaling={false}
                  autoCapitalize="sentences"
                />
              ) : null}
            </View>

            {meta.blocked_message ? (
              <Text style={styles.warn} allowFontScaling={false}>
                {meta.blocked_message}
              </Text>
            ) : null}
            {status.kind === 'error' ? (
              <Text style={styles.errorText} allowFontScaling={false}>
                {status.message}
              </Text>
            ) : null}

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onSave}
              disabled={status.kind === 'saving'}
              style={[
                styles.saveBtn,
                status.kind === 'saving' && { opacity: 0.7 },
              ]}>
              {status.kind === 'saving' ? (
                <ActivityIndicator color={Brand.white} />
              ) : (
                <Text style={styles.saveBtnText} allowFontScaling={false}>
                  Add to Sortlist
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )
      ) : null}
    </View>
  );
}

function Header({ onCancel }: { onCancel: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSlot}>
        <TouchableOpacity onPress={onCancel} activeOpacity={0.6}>
          <Text style={styles.headerCancel} allowFontScaling={false}>
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.headerCenter}>
        <View style={styles.brandDot} />
        <Text style={styles.brandLabel} allowFontScaling={false}>
          Sortlist
        </Text>
      </View>
      <View style={styles.headerSlot} />
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
          <Text
            style={styles.previewBrand}
            allowFontScaling={false}
            numberOfLines={1}>
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

function PickerList({
  collections,
  selected,
  onSelect,
  onOpenApp,
}: {
  collections: Collection[];
  selected: SortChoice;
  onSelect: (c: SortChoice) => void;
  onOpenApp: () => void;
}) {
  // Show the first MAX_VISIBLE_SORTLISTS — beyond that, the user has to
  // either pick AI / Create new, or open the full app. No ScrollView in
  // the share extension by design.
  const visible = collections.slice(0, MAX_VISIBLE_SORTLISTS);
  const hidden = Math.max(0, collections.length - visible.length);

  return (
    <View style={styles.body}>
      <Text style={styles.label} allowFontScaling={false}>
        Sort to
      </Text>

      <PickerRow
        label="✦  AI will sort this"
        active={selected === AI_OPTION}
        onPress={() => onSelect(AI_OPTION)}
      />

      {visible.map((c) => (
        <PickerRow
          key={c.id}
          label={c.name}
          active={selected === c.id}
          onPress={() => onSelect(c.id)}
        />
      ))}

      {hidden > 0 ? (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onOpenApp}
          style={styles.pickerOverflowRow}>
          <Text style={styles.pickerOverflowText} allowFontScaling={false}>
            + {hidden} more sortlists — open Sortlist to see all
          </Text>
        </TouchableOpacity>
      ) : null}

      <PickerRow
        label="+  Create new sortlist"
        active={selected === NEW_OPTION}
        onPress={() => onSelect(NEW_OPTION)}
      />
    </View>
  );
}

function PickerRow({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.pickerRow, active && styles.pickerRowActive]}>
      <Text
        style={[styles.pickerRowText, active && styles.pickerRowTextActive]}
        allowFontScaling={false}
        numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function UnauthedState({ onOpenApp }: { onOpenApp: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.title} allowFontScaling={false}>
        Sign in to save
      </Text>
      <Text style={styles.dimText} allowFontScaling={false}>
        Open Sortlist on this device to sign in. We&apos;ll remember it after
        that.
      </Text>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onOpenApp}
        style={[styles.saveBtn, { marginTop: 16, alignSelf: 'stretch' }]}>
        <Text style={styles.saveBtnText} allowFontScaling={false}>
          Open Sortlist
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function labelFor(choice: SortChoice, collections: Collection[]): string {
  if (choice === AI_OPTION) return '✦  AI will sort this';
  if (choice === NEW_OPTION) return '+  New sortlist';
  const found = collections.find((c) => c.id === choice);
  return found ? found.name : '✦  AI will sort this';
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
  headerSlot: { width: 56 },
  headerCancel: { fontSize: 16, color: Brand.ink },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 14,
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
  dimText: { fontSize: 14, color: Brand.inkMuted, textAlign: 'center' },

  section: { gap: 8 },

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
    width: 84,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Brand.creamSoft,
  },
  previewImage: { width: '100%', height: '100%' },
  previewImageEmpty: { alignItems: 'center', justifyContent: 'center' },
  previewEmptyText: { fontSize: 11, color: Brand.inkMuted },
  previewBody: { flex: 1, justifyContent: 'space-between' },
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
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    backgroundColor: Brand.white,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    paddingHorizontal: 16,
  },
  dropdownText: { flex: 1, fontSize: 16, color: Brand.ink },
  dropdownChevron: { fontSize: 14, color: Brand.inkMuted, marginLeft: 8 },

  input: {
    height: 48,
    backgroundColor: Brand.white,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Brand.line,
    paddingHorizontal: 16,
    fontSize: 16,
    color: Brand.ink,
  },

  pickerRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  pickerRowActive: { backgroundColor: Brand.creamSoft },
  pickerRowText: { fontSize: 16, color: Brand.ink },
  pickerRowTextActive: { color: Brand.coral, fontWeight: '600' },
  pickerOverflowRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pickerOverflowText: { fontSize: 13, color: Brand.inkMuted },

  warn: {
    fontSize: 13,
    color: Brand.inkSoft,
    backgroundColor: Brand.creamSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  errorText: { fontSize: 13, color: Brand.danger },

  saveBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Brand.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
  },
  saveBtnText: { color: Brand.white, fontSize: 16, fontWeight: '600' },
});
