import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { Brand, Fonts } from '@/constants/theme';
import { API_BASE_URL } from '@/lib/config';
import { setPendingWebViewUrl } from '@/lib/webview-bridge';

const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 84 : 64;

// Tapping the Sortlist tab icon always jumps the WebView to the
// "all sortlists" view — both when switching tabs and when re-tapping
// while already on the Sortlist tab. setPendingWebViewUrl invokes the
// registered navigator immediately if the WebView is mounted, otherwise
// queues for the WebView's next mount to consume as its initial URL.
const SORTLISTS_URL = `${API_BASE_URL}/sortlists`;

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
        listeners={{
          tabPress: () => {
            setPendingWebViewUrl(SORTLISTS_URL);
          },
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
