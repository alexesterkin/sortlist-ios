const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Last-line-of-defence sweep: walks the generated Xcode project and
 * removes duplicate build-phase references and duplicate shell-script
 * phases produced by other plugins / pod post-install hooks.
 *
 * The known culprit on this project was
 * `[CP-User] [Hermes] Replace Hermes for the right configuration, if needed`
 * which was being injected into BOTH the main app and the share
 * extension by CocoaPods user-script phases, so xcbuild saw two tasks
 * producing the same output and aborted with "Unexpected duplicate
 * tasks". Generalises the fix: anything that ends up listed twice in a
 * target's buildPhases array, or any two shell-script phases sharing a
 * name, gets collapsed to a single entry.
 *
 * Must be the LAST plugin in app.json's plugins array so it runs after
 * every other plugin (and after `prepare_react_native_project!` /
 * Cocoapods generation, since withXcodeProject mutates the post-prebuild
 * pbxproj).
 */
module.exports = function withDeduplicateBuildPhases(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;

    // Deduplicate build phases in all native targets
    const targets = project.pbxNativeTargetSection();
    for (const key in targets) {
      const target = targets[key];
      if (!target.buildPhases) continue;
      const seen = new Set();
      target.buildPhases = target.buildPhases.filter((phase) => {
        const id = phase.value || phase;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    // Deduplicate shell script build phases by name
    const scripts = project.pbxShellScriptBuildPhaseSection();
    const seenNames = new Set();
    for (const key in scripts) {
      if (typeof scripts[key] === 'object' && scripts[key].name) {
        const name = scripts[key].name;
        if (seenNames.has(name)) {
          delete scripts[key];
          delete scripts[key + '_comment'];
        } else {
          seenNames.add(name);
        }
      }
    }

    return config;
  });
};
