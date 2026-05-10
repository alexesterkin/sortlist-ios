/**
 * Filter heavy community native modules out of the share extension's
 * autolinking step.
 *
 * Background
 * ----------
 * `expo-share-extension`'s withPodfile patcher appends a target block for
 * the share extension that runs `use_native_modules!`. That call
 * auto-links EVERY community RN module into the share extension target
 * — including navigation libs we never use there. The main app's
 * auto-generated Podfile declares some of those pods with
 * `:modular_headers => true`; the share extension's auto-link declares
 * them without. CocoaPods then can't reconcile the modular-header
 * setting across the two targets and pod install fails with:
 *
 *   Unable to determine whether to build RNScreens as a module due to a
 *   conflict between Pods-Sortlist and Pods-SortlistShareExtension
 *
 * Fix
 * ---
 * Run AFTER expo-share-extension in the plugin chain. We rewrite the
 * `config = use_native_modules!(config_command)` line inside the share
 * extension target so it pre-runs the config command, strips the listed
 * packages out of the dependencies map, writes the filtered config to a
 * temp file, and then hands `cat <tmp>` to `use_native_modules!`. The
 * share extension never sees the filtered pods, which means no second
 * declaration, which means no conflict.
 *
 * Keep the exclusion list narrow — only packages the share extension
 * doesn't actually import. Audit ShareExtension.tsx and
 * share-extension/api.ts before adding anything new.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const SHARE_EXTENSION_EXCLUDED = [
  'react-native-screens',
  'react-native-gesture-handler',
  'react-native-safe-area-context',
];

const MARKER = '# share-extension-exclude-pods patched';

// Matches the auto-link line inside the share extension target. The main
// app's target uses bare `use_native_modules!` (no args), so it won't
// collide with this pattern.
const SHARE_AUTOLINK_LINE = /\n  config = use_native_modules!\(config_command\)/;

function buildReplacement() {
  const list = SHARE_EXTENSION_EXCLUDED.map((n) => `'${n}'`).join(', ');
  return `
  ${MARKER}
  # Strip nav / safe-area pods from the share-extension autolink so they
  # don't conflict with the main app's :modular_headers declaration.
  require 'json'
  require 'tempfile'
  _excluded_for_share = [${list}]
  _config_json = \`#{config_command.join(' ')}\`
  _parsed = JSON.parse(_config_json)
  if _parsed['dependencies']
    _excluded_for_share.each { |name| _parsed['dependencies'].delete(name) }
  end
  _tmp = Tempfile.new(['share_ext_config', '.json'])
  _tmp.write(_parsed.to_json)
  _tmp.close
  config = use_native_modules!(['cat', _tmp.path])`;
}

module.exports = function withShareExtensionExcludePods(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'Podfile',
      );
      if (!fs.existsSync(podfilePath)) {
        console.warn(
          '[with-share-extension-exclude-pods] Podfile not found; ' +
            'expo-share-extension may not have run yet.',
        );
        return cfg;
      }

      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(MARKER)) {
        return cfg; // idempotent — don't double-patch
      }

      const match = contents.match(SHARE_AUTOLINK_LINE);
      if (!match) {
        console.warn(
          '[with-share-extension-exclude-pods] share extension autolink ' +
            "line not found in Podfile; the share extension target's pods " +
            "won't be filtered. Did expo-share-extension's Podfile shape change?",
        );
        return cfg;
      }

      contents = contents.replace(SHARE_AUTOLINK_LINE, buildReplacement());
      fs.writeFileSync(podfilePath, contents);
      console.info(
        '[with-share-extension-exclude-pods] excluded from share extension: ' +
          SHARE_EXTENSION_EXCLUDED.join(', '),
      );
      return cfg;
    },
  ]);
};
