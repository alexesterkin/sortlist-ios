/**
 * Adds a shared keychain-access-group to both the main iOS app and the
 * expo-share-extension target so they can read each other's
 * SecureStore entries (specifically: the JWT session cookie).
 *
 * Without this the share extension cannot see the user's sign-in.
 *
 * Place AFTER `expo-share-extension` in the plugin chain.
 */
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist');
const { withEntitlementsPlist, withDangerousMod } = require('expo/config-plugins');

const KEYCHAIN_KEY = 'keychain-access-groups';

function getMainBundleId(config) {
  const id = config.ios && config.ios.bundleIdentifier;
  if (!id) throw new Error('ios.bundleIdentifier is required');
  return id;
}

function getShareExtensionName(config) {
  // Mirror expo-share-extension's getShareExtensionName: PascalCase app name + "ShareExtension".
  const sanitized = (config.name || 'App').replace(/[^A-Za-z0-9]/g, '');
  return `${sanitized}ShareExtension`;
}

function withMainAppKeychain(config, { accessGroup }) {
  return withEntitlementsPlist(config, (cfg) => {
    const ent = `$(AppIdentifierPrefix)${accessGroup}`;
    const existing = cfg.modResults[KEYCHAIN_KEY] || [];
    if (!existing.includes(ent)) {
      cfg.modResults[KEYCHAIN_KEY] = [...existing, ent];
    }
    return cfg;
  });
}

function withShareExtensionKeychain(config, { accessGroup }) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const targetName = getShareExtensionName(cfg);
      const targetDir = path.join(
        cfg.modRequest.platformProjectRoot,
        targetName,
      );
      const file = path.join(targetDir, `${targetName}.entitlements`);
      if (!fs.existsSync(file)) {
        // expo-share-extension hasn't run yet; nothing to patch.
        return cfg;
      }
      const raw = fs.readFileSync(file, 'utf8');
      const existing = plist.parse(raw);
      const ent = `$(AppIdentifierPrefix)${accessGroup}`;
      const current = Array.isArray(existing[KEYCHAIN_KEY])
        ? existing[KEYCHAIN_KEY]
        : [];
      if (!current.includes(ent)) {
        existing[KEYCHAIN_KEY] = [...current, ent];
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, plist.build(existing));
      return cfg;
    },
  ]);
}

const withSharedKeychain = (config, props = {}) => {
  const accessGroup = props.accessGroup || `${getMainBundleId(config)}.shared`;
  config = withMainAppKeychain(config, { accessGroup });
  config = withShareExtensionKeychain(config, { accessGroup });
  return config;
};

module.exports = withSharedKeychain;
