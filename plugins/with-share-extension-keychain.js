/**
 * Patch the share extension target's entitlements so it shares a keychain
 * access group with the main app.
 *
 * Why
 * ---
 * AsyncStorage on iOS is sandboxed per target — the main app and the share
 * extension each have their own AsyncStorage file, so a JWT written by the
 * main app at sign-in is invisible to the share extension. Result: user
 * shares a product, share extension shows "Sign in to save".
 *
 * The iOS keychain CAN be shared across targets that opt into the same
 * `keychain-access-groups` entitlement. The main app already declares
 * `$(AppIdentifierPrefix)com.alexesterkin.sortlist` via
 * `ios.entitlements` in app.json. expo-share-extension's plugin writes the
 * share extension's `.entitlements` file separately and doesn't include
 * keychain-access-groups, so we patch the file here.
 *
 * Run AFTER `expo-share-extension` in the plugin chain — withDangerousMod
 * for iOS, reads the entitlements file the share extension target uses,
 * adds `keychain-access-groups`, writes back.
 *
 * Pair this with `expo-secure-store` reads/writes in lib/session.ts that
 * pass `{ accessGroup: 'com.alexesterkin.sortlist' }`. With both targets
 * signed by the same Team ID and both listing the same access group, they
 * read each other's keychain entries.
 */
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist');
const { withDangerousMod } = require('expo/config-plugins');

const KEY = 'keychain-access-groups';

function getShareExtensionName(config) {
  // Mirrors expo-share-extension's getShareExtensionName: PascalCase app
  // name + "ShareExtension".
  const sanitized = (config.name || 'App').replace(/[^A-Za-z0-9]/g, '');
  return `${sanitized}ShareExtension`;
}

module.exports = function withShareExtensionKeychain(config, props = {}) {
  const bundleId =
    config.ios && config.ios.bundleIdentifier
      ? config.ios.bundleIdentifier
      : null;
  if (!bundleId) {
    throw new Error(
      'with-share-extension-keychain: ios.bundleIdentifier is required',
    );
  }
  const accessGroup = props.accessGroup || bundleId;
  const entitlementValue = `$(AppIdentifierPrefix)${accessGroup}`;

  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const targetName = getShareExtensionName(cfg);
      const file = path.join(
        cfg.modRequest.platformProjectRoot,
        targetName,
        `${targetName}.entitlements`,
      );
      if (!fs.existsSync(file)) {
        // expo-share-extension's plugin hasn't run yet (or its file shape
        // changed). Skip rather than fail the prebuild.
        console.warn(
          `[with-share-extension-keychain] ${file} not found; ` +
            'is expo-share-extension registered earlier in the plugin chain?',
        );
        return cfg;
      }

      let raw;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch (e) {
        console.warn(
          `[with-share-extension-keychain] could not read ${file}: ${e.message}`,
        );
        return cfg;
      }

      let entitlements;
      try {
        entitlements = plist.parse(raw);
      } catch (e) {
        console.warn(
          `[with-share-extension-keychain] could not parse ${file}: ${e.message}`,
        );
        return cfg;
      }

      const current = Array.isArray(entitlements[KEY]) ? entitlements[KEY] : [];
      if (current.includes(entitlementValue)) {
        return cfg; // idempotent
      }
      entitlements[KEY] = [...current, entitlementValue];

      fs.writeFileSync(file, plist.build(entitlements));
      console.info(
        `[with-share-extension-keychain] added ${entitlementValue} to ` +
          `${targetName}.entitlements`,
      );
      return cfg;
    },
  ]);
};
