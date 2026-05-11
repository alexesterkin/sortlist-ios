import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Brand, Fonts } from '@/constants/theme';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 84 : 64;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Brand.coral,
        tabBarInactiveTintColor: Brand.inkMuted,
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: Fonts.sans,
          fontWeight: '500',
        },
        tabBarStyle: {
          backgroundColor: Brand.cream,
          borderTopColor: Brand.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: TAB_BAR_HEIGHT,
          paddingTop: 8,
        },
        sceneStyle: { backgroundColor: Brand.cream },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Sortlists',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'grid' : 'grid-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'Products',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'apps' : 'apps-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          // Custom button replaces the default tab. The tabPress listener
          // below preempts default navigation and opens the Add modal
          // instead — so the file at `(tabs)/add.tsx` is just a stub.
          tabBarButton: (props) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add product"
              onPress={() => router.push('/(app)/add')}
              hitSlop={6}
              style={styles.addButtonHit}>
              <View style={styles.addButton}>
                <Ionicons name="add" size={28} color="#fff" />
              </View>
            </Pressable>
          ),
        }}
        listeners={() => ({
          tabPress: (e) => {
            e.preventDefault();
            router.push('/(app)/add');
          },
        })}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addButtonHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Brand.coral,
    alignItems: 'center',
    justifyContent: 'center',
    // Lift the button a touch so it visually sits above the tab bar line
    marginBottom: 4,
    shadowColor: Brand.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
});
