// Per-target autolinking control isn't really a thing in
// react-native-community/cli — `platforms.ios: null` disables a pod
// across BOTH the main app and the share extension. The main app
// imports react-native-gesture-handler and react-native-safe-area-context
// directly (GestureHandlerRootView in app/_layout.tsx, SafeAreaProvider /
// useSafeAreaInsets in several screens, plus expo-router lists
// safe-area-context as a REQUIRED peer dep). Disabling them globally
// builds fine but silently crashes the app at first render when the
// native modules aren't found — which is what happened on the last
// preview build.
//
// So this file is intentionally minimal: don't touch autolinking for
// the nav libs here. The share extension's pod-level filtering happens
// in plugins/with-share-extension-exclude-pods.js, which rewrites the
// share-extension target's `use_native_modules!(config_command)` call
// to drop these packages from JUST that target's autolinking JSON.
// That's the only way to express "exclude from the share extension
// target only" — react-native.config.js can't do per-target.
module.exports = {};
