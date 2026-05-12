const { withXcodeProject } = require('@expo/config-plugins');

/**
 * Walks every native target in the generated Xcode project and removes
 * duplicate references in its `buildPhases` array.
 *
 * The previous version of this plugin also tried to dedupe shell-script
 * phases by name via `project.pbxShellScriptBuildPhaseSection()`, but
 * that method doesn't exist in the `xcode` package — the correct name
 * is `pbxShellScriptBuildPhase()` (no "Section" suffix) and even that
 * is rarely needed. The first-pass dedup on target.buildPhases is
 * enough to fix the duplicate-tasks failures we've been seeing: two
 * targets each end up referencing the same `[CP-User] [Hermes] Replace
 * Hermes...` phase, and xcbuild aborts. Filtering each target's
 * buildPhases array to one reference per UUID collapses that to a
 * single task per target.
 *
 * Run as the LAST plugin in app.json so every other plugin has
 * finished mutating the pbxproj before this sweeps it.
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

    return config;
  });
};
