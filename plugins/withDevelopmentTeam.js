/**
 * Sets DEVELOPMENT_TEAM on every XCBuildConfiguration in the generated
 * Xcode project — main app, share extension, and every CocoaPods target
 * including resource bundles.
 *
 * Xcode 14+ signs resource bundles by default. The autogen Podfile's
 * post-install hook normally handles this by reading
 * `expo.ios.appleTeamId` from app.json, but in our setup that hook
 * hasn't been reliably propagating to every config — so the build dies
 * with "Resource bundles require development team". This plugin is a
 * belt-and-suspenders sweep: after every other plugin has finished
 * adding targets, we walk every XCBuildConfiguration and inject the
 * Team ID.
 *
 * Source of truth for the Team ID: app.json `expo.ios.appleTeamId`.
 * If it's missing or still the placeholder, the plugin logs a warning
 * and exits cleanly — it never overrides with a stale value baked into
 * the plugin file itself.
 *
 * Run AFTER any plugin that adds Xcode targets (e.g.
 * with-native-share-extension.js), so its target gets the team too.
 */
const { withXcodeProject } = require('expo/config-plugins');

const PLACEHOLDER = 'REPLACE_WITH_APPLE_TEAM_ID';

module.exports = function withDevelopmentTeam(config) {
  return withXcodeProject(config, (cfg) => {
    const teamId =
      cfg.ios && typeof cfg.ios.appleTeamId === 'string'
        ? cfg.ios.appleTeamId.trim()
        : '';

    if (!teamId || teamId === PLACEHOLDER) {
      console.warn(
        '[withDevelopmentTeam] expo.ios.appleTeamId is missing or still ' +
          'the placeholder — DEVELOPMENT_TEAM not set on any target. The ' +
          'build will fail to sign resource bundles until you fill in the ' +
          'real 10-character Apple Team ID at app.json -> expo.ios.appleTeamId.',
      );
      return cfg;
    }

    const project = cfg.modResults;

    // 1. Sweep every XCBuildConfiguration in the project. This includes:
    //    - The main app target (Debug + Release)
    //    - The share extension target (added by with-native-share-extension)
    //    - Every Pod target (CocoaPods generates these in the Pods.xcodeproj
    //      but they also get DEVELOPMENT_TEAM via Podfile post_install;
    //      this catches anything that escapes that hook)
    //    - Resource bundle targets — the ones Xcode 14+ insists on signing
    const configurations = project.pbxXCBuildConfigurationSection();
    let touched = 0;
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      // The section is { uuid: {...}, uuid_comment: 'Release' } — skip comments.
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.buildSettings) continue;
      entry.buildSettings.DEVELOPMENT_TEAM = teamId;
      touched += 1;
    }

    // 2. Set TargetAttributes.DevelopmentTeam on the main project too —
    //    this is what shows up under "Signing & Capabilities" in Xcode,
    //    and some build phases read it from here instead of the per-config
    //    buildSettings.
    if (typeof project.addTargetAttribute === 'function') {
      project.addTargetAttribute('DevelopmentTeam', teamId);
    }

    console.info(
      `[withDevelopmentTeam] set DEVELOPMENT_TEAM=${teamId} on ${touched} build configurations`,
    );

    return cfg;
  });
};
