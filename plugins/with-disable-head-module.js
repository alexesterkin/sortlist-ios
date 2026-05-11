/**
 * Strip the ExpoHead Swift module out of expo-router's autolinking config.
 *
 * Background
 * ----------
 * EAS pod install was failing with:
 *
 *   The Swift pod `ExpoHead` depends upon `RNScreens`, which does not
 *   define modules.
 *
 * ExpoHead is NOT a separate npm package; it's a Swift sub-module
 * bundled inside expo-router (see expo-router/ios/ExpoHead.podspec).
 * It powers expo-router's `<Head>` web/SEO + iOS Spotlight integration,
 * which we don't use anywhere in this app. expo-router's package
 * declares the module via:
 *
 *   {
 *     "apple": {
 *       "modules": ["ExpoHeadModule", "LinkPreviewNativeModule"],
 *       "appDelegateSubscribers": ["ExpoHeadAppDelegateSubscriber"]
 *     }
 *   }
 *
 * `use_expo_modules!` reads that JSON during pod install. Since the
 * Head module is a Swift pod that depends on RNScreens, and the RN
 * auto-linked pods aren't declared as modular by default, Swift can't
 * import the RNScreens header and pod install bails.
 *
 * Fix
 * ---
 * Run during prebuild. The plugin rewrites
 * `node_modules/expo-router/expo-module.config.json` and drops:
 *   - `ExpoHeadModule` from `apple.modules`
 *   - `ExpoHeadAppDelegateSubscriber` from `apple.appDelegateSubscribers`
 *
 * This is a belt-and-suspenders pair with scripts/patch-expo-router-no-head.js
 * which runs as `postinstall` after every `npm install`. Either alone is
 * enough; both together cover every prebuild ordering EAS might use.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const ROUTER_MODULE_CONFIG = 'node_modules/expo-router/expo-module.config.json';
const MODULES_TO_DROP = new Set(['ExpoHeadModule']);
const SUBSCRIBERS_TO_DROP = new Set(['ExpoHeadAppDelegateSubscriber']);

module.exports = function withDisableHeadModule(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const target = path.join(cfg.modRequest.projectRoot, ROUTER_MODULE_CONFIG);

      if (!fs.existsSync(target)) {
        console.warn(
          `[with-disable-head-module] ${ROUTER_MODULE_CONFIG} not found; ` +
            'is expo-router installed?',
        );
        return cfg;
      }

      let json;
      try {
        json = JSON.parse(fs.readFileSync(target, 'utf8'));
      } catch (e) {
        console.warn(
          `[with-disable-head-module] couldn't parse ${ROUTER_MODULE_CONFIG}: ${e.message}`,
        );
        return cfg;
      }

      const apple = json.apple ?? {};
      let modified = false;

      if (Array.isArray(apple.modules)) {
        const before = apple.modules.length;
        apple.modules = apple.modules.filter((m) => !MODULES_TO_DROP.has(m));
        if (apple.modules.length !== before) modified = true;
      }
      if (Array.isArray(apple.appDelegateSubscribers)) {
        const before = apple.appDelegateSubscribers.length;
        apple.appDelegateSubscribers = apple.appDelegateSubscribers.filter(
          (s) => !SUBSCRIBERS_TO_DROP.has(s),
        );
        if (apple.appDelegateSubscribers.length !== before) modified = true;
      }

      if (!modified) {
        return cfg; // already patched
      }

      json.apple = apple;
      fs.writeFileSync(target, JSON.stringify(json, null, 2) + '\n');
      console.info(
        '[with-disable-head-module] stripped ExpoHeadModule + ' +
          'ExpoHeadAppDelegateSubscriber from expo-router autolinking.',
      );
      return cfg;
    },
  ]);
};
