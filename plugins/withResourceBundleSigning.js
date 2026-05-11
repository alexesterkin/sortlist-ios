const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Tell Xcode not to code-sign CocoaPods resource bundles.
 *
 * Xcode 14+ signs resource bundles by default and asks for a
 * DEVELOPMENT_TEAM on each one, which breaks EAS Build with
 * "Resource bundles require development team". Resource bundles are
 * just collections of assets shipped inside the parent app target —
 * they don't need their own signature. The official react-native /
 * Expo fix is to add a post-install hook that sets
 * CODE_SIGNING_ALLOWED = NO on every pod's resource bundle.
 *
 * This plugin patches the autogen Podfile to inject that hook
 * immediately after `react_native_post_install(installer)`. Idempotent:
 * the entire block is skipped if `CODE_SIGNING_ALLOWED` is already
 * present in the Podfile.
 */
module.exports = function withResourceBundleSigning(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile',
      );
      let podfile = fs.readFileSync(podfilePath, 'utf8');

      const signingFix = `
    # Fix for Xcode 14+ resource bundle signing
    installer.target_installation_results.pod_target_installation_results
      .each do |pod_name, target_installation_result|
      target_installation_result.resource_bundle_targets.each do |resource_bundle_target|
        resource_bundle_target.build_configurations.each do |config|
          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end`;

      if (!podfile.includes('CODE_SIGNING_ALLOWED')) {
        podfile = podfile.replace(
          'react_native_post_install(installer)',
          `react_native_post_install(installer)${signingFix}`,
        );
        fs.writeFileSync(podfilePath, podfile);
      }
      return config;
    },
  ]);
};
