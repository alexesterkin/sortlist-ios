const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Three Podfile patches, all keyed by sentinel comments so each is
 * idempotent and re-runnable:
 *
 *   1. Declare a top-level `target 'SortlistShareExtension' do … end`
 *      block with `platform :ios, '15.1'` (Option 4). The block has no
 *      pod declarations, so CocoaPods doesn't install any pods for the
 *      share extension target — including hermes-engine.
 *
 *   2. Inside the post_install block, walk every aggregate target's
 *      user_project AND the Pods project and dedupe build phases by
 *      display_name. Saves each project afterward so the changes survive
 *      whatever CocoaPods writes next.
 *
 *   3. Inside the post_install block, find the hermes-engine pod's
 *      `[CP-User] [Hermes] Replace Hermes for the right configuration`
 *      shell-script phase(s) and assign each one an `output_paths` of
 *      `$(DERIVED_FILE_DIR)/hermes-dedupe-stamp` (Option 3). Each target
 *      resolves `$(DERIVED_FILE_DIR)` to its own scope, so two phases
 *      from two targets produce two distinct outputs and xcbuild can't
 *      flag them as "Unexpected duplicate tasks".
 *
 * Plugin must be the very last entry in app.json's plugins array.
 */
const MARKER_TARGET = '# withPodfilePatch: share extension target stub';
const MARKER_DEDUP = '# withPodfilePatch: dedupe Pods+user-project build phases';
const MARKER_HERMES = '# withPodfilePatch: hermes output_paths';

const EXTENSION_TARGET_NAME = 'SortlistShareExtension';
const EXTENSION_PLATFORM = "'15.1'";
const POST_INSTALL_ANCHOR = 'react_native_post_install(installer)';

/**
 * Pure string transformation. Exported so tests can drive it without
 * needing to mock withDangerousMod / the entire prebuild pipeline.
 * Returns { contents, changed, warnings }.
 */
function applyPatches(podfile) {
  const warnings = [];
  let contents = podfile;
  let changed = false;

  // ─── Patch 1: top-level share-extension target block ─────────────────
  if (!contents.includes(MARKER_TARGET)) {
    const shareTargetBlock =
      `${MARKER_TARGET}\n` +
      `target '${EXTENSION_TARGET_NAME}' do\n` +
      `  platform :ios, ${EXTENSION_PLATFORM}\n` +
      `end\n\n`;

    const postInstallTopLevel = /^post_install do \|installer\|/m;
    if (postInstallTopLevel.test(contents)) {
      contents = contents.replace(
        postInstallTopLevel,
        shareTargetBlock + 'post_install do |installer|',
      );
      changed = true;
    } else {
      warnings.push(
        'could not find a top-level post_install block; ' +
          'share extension target block NOT inserted',
      );
    }
  }

  // ─── Patches 2 + 3: dedup pass + hermes output_paths inside post_install ─
  if (!contents.includes(MARKER_DEDUP)) {
    const postInstallExtension =
      `\n` +
      `    ${MARKER_DEDUP}\n` +
      `    puts "======= SORTLIST PODFILE PATCH RUNNING ======="\n` +
      `    puts "======= SORTLIST PODFILE CONTENT BEGIN ======="\n` +
      `    puts File.read('/Users/expo/workingdir/build/ios/Podfile')\n` +
      `    puts "======= SORTLIST PODFILE CONTENT END ======="\n` +
      `    installer.aggregate_targets.each do |aggregate_target|\n` +
      `      aggregate_target.user_project.targets.each do |target|\n` +
      `        target.build_phases.uniq!(&:display_name)\n` +
      `        target.project.save\n` +
      `      end\n` +
      `    end\n` +
      `\n` +
      `    installer.pods_project.targets.each do |target|\n` +
      `      target.build_phases.uniq!(&:display_name)\n` +
      `    end\n` +
      `\n` +
      `    ${MARKER_HERMES}\n` +
      `    installer.pods_project.targets.each do |target|\n` +
      `      next unless target.name == 'hermes-engine'\n` +
      `      target.build_phases.each do |phase|\n` +
      `        next unless phase.is_a?(Xcodeproj::Project::Object::PBXShellScriptBuildPhase)\n` +
      `        next unless phase.name&.include?('Replace Hermes')\n` +
      `        phase.output_paths = ['$(DERIVED_FILE_DIR)/hermes-dedupe-stamp']\n` +
      `      end\n` +
      `    end\n` +
      `\n` +
      `    installer.pods_project.save`;

    if (contents.includes(POST_INSTALL_ANCHOR)) {
      contents = contents.replace(
        POST_INSTALL_ANCHOR,
        `${POST_INSTALL_ANCHOR}${postInstallExtension}`,
      );
      changed = true;
    } else {
      warnings.push(
        `anchor "${POST_INSTALL_ANCHOR}" not found; ` +
          'dedup + Hermes patches NOT applied',
      );
    }
  }

  return { contents, changed, warnings };
}

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

      const original = fs.readFileSync(podfilePath, 'utf8');
      const { contents, changed, warnings } = applyPatches(original);

      for (const w of warnings) {
        console.warn('[withPodfilePatch] ' + w);
      }
      if (changed) {
        fs.writeFileSync(podfilePath, contents);
        console.info(
          '[withPodfilePatch] applied patches: share-ext target block + ' +
            'aggregate/pods dedup-and-save + hermes-engine output_paths',
        );
      } else {
        console.info(
          '[withPodfilePatch] all patches already present; nothing to do',
        );
      }
      return config;
    },
  ]);
};

// Export the pure transform for testing (no side effects).
module.exports.applyPatches = applyPatches;
module.exports.MARKERS = { MARKER_TARGET, MARKER_DEDUP, MARKER_HERMES };
