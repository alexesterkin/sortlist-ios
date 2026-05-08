import { forwardRef } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Brand, Radius } from '@/constants/theme';
import { Text } from './text';

type Props = TextInputProps & {
  label?: string;
  error?: string | null;
  containerStyle?: ViewStyle;
};

export const Input = forwardRef<TextInput, Props>(function Input(
  { label, error, containerStyle, style, ...rest },
  ref,
) {
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <Text variant="caption" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={Brand.inkMuted}
        {...rest}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <Text variant="caption" color={Brand.danger} style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: {
    color: Brand.inkSoft,
    marginLeft: 4,
  },
  input: {
    height: 52,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    fontSize: 16,
    color: Brand.ink,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Brand.line,
  },
  inputError: {
    borderColor: Brand.danger,
  },
});
