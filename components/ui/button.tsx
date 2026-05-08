import {
  ActivityIndicator,
  Pressable,
  PressableProps,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Brand, Radius } from '@/constants/theme';
import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline';

type Props = Omit<PressableProps, 'children'> & {
  title: string;
  loading?: boolean;
  variant?: Variant;
  leftIcon?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
};

export function Button({
  title,
  loading,
  variant = 'primary',
  leftIcon,
  fullWidth = true,
  disabled,
  style,
  ...rest
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant].container,
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && { opacity: 0.85 },
        isDisabled && { opacity: 0.5 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variantStyles[variant].label.color as string} />
      ) : (
        <View style={styles.row}>
          {leftIcon ? <View style={styles.icon}>{leftIcon}</View> : null}
          <Text style={[styles.label, variantStyles[variant].label]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: Radius.lg,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: { marginRight: 4 },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});

const variantStyles = {
  primary: {
    container: { backgroundColor: Brand.coral },
    label: { color: '#fff' },
  },
  secondary: {
    container: { backgroundColor: Brand.ink },
    label: { color: Brand.cream },
  },
  outline: {
    container: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: Brand.ink,
    },
    label: { color: Brand.ink },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    label: { color: Brand.ink },
  },
} as const;
