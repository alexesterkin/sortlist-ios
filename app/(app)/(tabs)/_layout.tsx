import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

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
          fontFamily: Fonts.sansMedium ?? Fonts.sans,
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
          title: 'Sortlist',
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
