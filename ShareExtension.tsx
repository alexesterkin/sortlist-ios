import { close, openHostApp, Text, TextInput, type InitialProps } from 'expo-share-extension';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

const Brand = {
  coral: '#FF5B3A',
  cream: '#FAF8F3',
  ink: '#1A1A1A',
  inkSoft: '#4A4A4A',
  inkMuted: '#8A8A8A',
  line: '#EAE6DD',
};

export default function ShareExtension({ url, text }: InitialProps) {
  const incoming = pickUrl(url, text);
  const [pending, setPending] = useState(false);
  const [editedUrl, setEditedUrl] = useState(incoming ?? '');

  useEffect(() => {
    setEditedUrl(incoming ?? '');
  }, [incoming]);

  const display = useMemo(() => editedUrl.trim() || 'No link found', [editedUrl]);

  const handleSave = async () => {
    if (!editedUrl.trim()) return;
    setPending(true);
    try {
      const target = `add?url=${encodeURIComponent(editedUrl.trim())}`;
      await openHostApp(target);
    } finally {
      setPending(false);
      close();
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.handle} />
      <Text style={styles.brand} allowFontScaling={false}>
        Sortlist
      </Text>
      <Text style={styles.title} allowFontScaling={false}>
        Save to a sortlist?
      </Text>
      <View style={styles.urlBox}>
        <TextInput
          value={editedUrl}
          onChangeText={setEditedUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://…"
          placeholderTextColor={Brand.inkMuted}
          style={styles.urlText}
          allowFontScaling={false}
          numberOfLines={2}
        />
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={close}
          style={[styles.btn, styles.btnGhost]}
          accessibilityRole="button">
          <Text style={[styles.btnText, { color: Brand.ink }]} allowFontScaling={false}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={pending || !editedUrl.trim()}
          style={[
            styles.btn,
            styles.btnPrimary,
            (!editedUrl.trim() || pending) && { opacity: 0.6 },
          ]}
          accessibilityRole="button">
          <Text style={[styles.btnText, { color: '#fff' }]} allowFontScaling={false}>
            {pending ? 'Opening…' : 'Open Sortlist'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint} allowFontScaling={false}>
        {display}
      </Text>
    </View>
  );
}

function pickUrl(url?: string, text?: string): string | null {
  if (url) return url;
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Brand.cream,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Brand.line,
    alignSelf: 'center',
  },
  brand: {
    fontSize: 14,
    color: Brand.coral,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 24,
    color: Brand.ink,
    fontWeight: '600',
  },
  urlBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  urlText: {
    fontSize: 14,
    color: Brand.ink,
    minHeight: 40,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: Brand.coral },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Brand.ink,
  },
  btnText: { fontSize: 16, fontWeight: '600' },
  hint: {
    fontSize: 12,
    color: Brand.inkMuted,
  },
});
