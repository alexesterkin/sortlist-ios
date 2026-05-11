module.exports = {
  dependencies: {
    'react-native-screens': {
      platforms: {
        ios: {
          project: './ios/Sortlist.xcodeproj',
        },
      },
    },
    'react-native-gesture-handler': {
      platforms: {
        ios: null,
      },
    },
    'react-native-safe-area-context': {
      platforms: {
        ios: null,
      },
    },
  },
};
