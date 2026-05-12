const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Inject a dedup-and-save Ruby block into the Podfile's post_install
 * hook to remove duplicate build phases in BOTH:
 *
 *   1. The Pods project (`ios/Pods/Pods.xcodeproj/project.pbxproj`),
 *      which CocoaPods regenerates from scratch on every install.
 *   2. The aggregate targets' user_project — i.e. the main app's
 *      Xcode project file as seen by CocoaPods through the aggregate
 *      target. This is the file CocoaPods writes back when it
 *      finishes pod install, so a withXcodeProject-only fix gets
 *      overwritten.
 *
 * The crucial bit vs. the previous attempt: we explicitly `.save` the
 * projects after dedup. Without that, CocoaPods' own internal writes
 * later in pod install clobber our in-memory changes and the duplicate
 * phases come back.
 *
 * Patch is anchored on `react_native_post_install(installer)`, a line
 * that's stable across SDK 55 autogen Podfiles. Idempotent — keyed on a
 * marker comment.
 *
 * Must be the very last plugin in app.json so it runs after every other
 * plugin has finished generating / patching the Podfile.
 */
const MARKER = '# withPodfilePatch: dedupe Pods+user-project build phases';

module.exports = function withPodfilePatch(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile',
      );
      if (!fs.existsSync(podfilePath)) {
        console.warn(
          '[withPodfilePatch] Podfile not found at ' + podfilePath + '; skipping.',
        );
        return config;
      }

      let podfile = fs.readFileSync(podfilePath, 'utf8');
      if (podfile.includes(MARKER)) {
        return config; // already patched on a previous prebuild
      }

      // Ruby that runs inside CocoaPods' post_install installer
      // context. The two block style mirrors what the user specified —
      // aggregate_targets covers the main app's user_project, then a
      // separate pass cleans the Pods project itself. Each pass uses
      // `uniq!(&:display_name)` (idiomatic Ruby symbol-to-proc) and is
      // followed by an explicit `.save` so the change survives whatever
      // CocoaPods writes next.
      const dedupBlock = `
    ${MARKER}
    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_project.targets.each do |target|
        target.build_phases.uniq!(&:display_name)
        target.project.save
      end
    end

    installer.pods_project.targets.each do |target|
      target.build_phases.uniq!(&:display_name)
    end
    installer.pods_project.save`;

      const anchor = 'react_native_post_install(installer)';
      if (!podfile.includes(anchor)) {
        console.warn(
          '[withPodfilePatch] anchor "' + anchor + '" not found in Podfile; ' +
            "Podfile shape has changed and the patch wasn't applied.",
        );
        return config;
      }

      podfile = podfile.replace(anchor, `${anchor}${dedupBlock}`);
      fs.writeFileSync(podfilePath, podfile);
      console.info(
        '[withPodfilePatch] injected aggregate_targets + pods_project ' +
          'dedup-and-save into Podfile post_install',
      );
      return config;
    },
  ]);
};
