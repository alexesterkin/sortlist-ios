/**
 * Adds a pure-native Swift share extension target to the Xcode project.
 *
 * The extension lives entirely outside the React Native bundle: a single
 * Swift file (ShareViewController) presents a UIKit bottom sheet, reads
 * the JWT from the shared keychain access group (the main app writes it
 * there via expo-secure-store on login), and POSTs the shared URL
 * straight to /api/trpc/products.add over HTTPS. No JS, no RN
 * autolinking, no expo-share-extension — which is the architecture this
 * project arrived at after a long string of pod-install failures.
 *
 * What this plugin does, in order:
 *
 *   1. Copies the source files in native-modules/SortlistShareExtension/
 *      into ios/SortlistShareExtension/. Done in a withDangerousMod ios
 *      hook so it happens after the iOS project is generated but before
 *      pod install runs.
 *   2. Registers a new PBXNativeTarget for the share extension via
 *      withXcodeProject, with all the file references, build phases,
 *      and build configurations it needs:
 *        - PBXSourcesBuildPhase containing ShareViewController.swift
 *        - PBXResourcesBuildPhase (empty — Info.plist lives in INFOPLIST_FILE)
 *        - PBXFrameworksBuildPhase containing UIKit, Foundation, Security
 *        - Two XCBuildConfiguration entries (Debug, Release)
 *      Also sets every per-target build setting (deployment target,
 *      Swift version, entitlements path, codesigning, etc.).
 *   3. Adds a PBXCopyFilesBuildPhase to the main app target that embeds
 *      the built .appex into PlugIns/ of the app bundle so iOS treats
 *      it as a share extension at runtime.
 *
 * The plugin runs once per prebuild and is idempotent — if the target
 * already exists it bails out without re-adding.
 */
const fs = require('fs');
const path = require('path');
const xcode = require('xcode');
const {
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require('expo/config-plugins');

const EXTENSION_NAME = 'SortlistShareExtension';
const SOURCE_DIR = 'native-modules/SortlistShareExtension';
const SOURCE_FILES = [
  'ShareViewController.swift',
  'Info.plist',
  'SortlistShareExtension.entitlements',
];
const PRODUCT_BUNDLE_SUFFIX = '.ShareExtension';
// Match the main app's iOS deployment target so the extension links the
// same SDK build of UIKit. Expo SDK 55 defaults to 15.1.
const DEPLOYMENT_TARGET = '15.1';
const SWIFT_VERSION = '5.0';

/**
 * Copy our native source files into the generated iOS project tree.
 */
function withCopyExtensionSources(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const srcDir = path.join(cfg.modRequest.projectRoot, SOURCE_DIR);
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        EXTENSION_NAME,
      );
      if (!fs.existsSync(srcDir)) {
        throw new Error(
          `[with-native-share-extension] source directory missing: ${srcDir}`,
        );
      }
      fs.mkdirSync(destDir, { recursive: true });
      for (const name of SOURCE_FILES) {
        const from = path.join(srcDir, name);
        const to = path.join(destDir, name);
        if (!fs.existsSync(from)) {
          throw new Error(
            `[with-native-share-extension] missing source file: ${from}`,
          );
        }
        fs.copyFileSync(from, to);
      }
      console.info(
        `[with-native-share-extension] copied source files to ${destDir}`,
      );
      return cfg;
    },
  ]);
}

/**
 * Add the PBXNativeTarget for the share extension and wire it into the
 * main app target as an embedded extension.
 */
function withExtensionXcodeTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const mainBundleId =
      cfg.ios && cfg.ios.bundleIdentifier ? cfg.ios.bundleIdentifier : null;
    if (!mainBundleId) {
      throw new Error(
        '[with-native-share-extension] ios.bundleIdentifier is required',
      );
    }
    const extensionBundleId = `${mainBundleId}${PRODUCT_BUNDLE_SUFFIX}`;

    // Idempotent: bail if the target already exists. Looking up by name
    // through the targets section is the cleanest way to detect prior runs.
    const existingTargets = project.pbxNativeTargetSection();
    for (const key of Object.keys(existingTargets)) {
      const t = existingTargets[key];
      if (t && t.name === EXTENSION_NAME) {
        console.info(
          `[with-native-share-extension] target "${EXTENSION_NAME}" already present, skipping`,
        );
        return cfg;
      }
    }

    // Sources phase — only Swift file.
    const sourcesFileEntries = ['ShareViewController.swift'];

    // Frameworks the extension needs. UIKit / Foundation / Security come
    // with iOS — no pod work.
    const frameworkNames = ['UIKit.framework', 'Foundation.framework', 'Security.framework'];

    // Use xcode's addTarget high-level helper. It creates the PBXNativeTarget,
    // a build configuration list with Debug + Release, and a default product
    // file reference. We then attach build phases and tweak build settings.
    const target = project.addTarget(
      EXTENSION_NAME,
      'app_extension',
      EXTENSION_NAME,
      extensionBundleId,
    );

    // Create a PBXGroup for our source files so they show up under the
    // right folder in Xcode's navigator (not strictly required for the
    // build, but it's cleaner and pbxBuildPhase wants a group to add
    // files to).
    const pbxGroup = project.addPbxGroup(
      [...sourcesFileEntries, 'Info.plist', `${EXTENSION_NAME}.entitlements`],
      EXTENSION_NAME,
      EXTENSION_NAME,
    );
    // Place the new group under the project's main "CustomTemplate" / root
    // group. project.getFirstProject().firstProject.mainGroup gives us the
    // root group's UUID.
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(pbxGroup.uuid, mainGroupKey);

    // Sources build phase.
    project.addBuildPhase(
      sourcesFileEntries,
      'PBXSourcesBuildPhase',
      'Sources',
      target.uuid,
    );

    // Frameworks build phase. Create it EMPTY here — never pass framework
    // names directly to addBuildPhase. The `addFramework(name, { target })`
    // calls below add each framework to both the Frameworks PBXGroup and
    // the target's Frameworks build phase in one step. Passing names to
    // addBuildPhase *and* then calling addFramework adds the same
    // framework twice, which surfaces as "Unexpected duplicate tasks"
    // when xcbuild sees two link operations producing the same output.
    project.addBuildPhase(
      [],
      'PBXFrameworksBuildPhase',
      'Frameworks',
      target.uuid,
    );
    for (const f of frameworkNames) {
      project.addFramework(f, { target: target.uuid });
    }

    // Empty resources phase — Info.plist isn't bundled as a resource;
    // it's referenced via INFOPLIST_FILE.
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);

    // Patch the target's build settings. xcode lib gives us the
    // configuration list UUID via `target.pbxNativeTarget.buildConfigurationList`.
    const configurations = project.pbxXCBuildConfigurationSection();
    const buildConfigListId = target.pbxNativeTarget.buildConfigurationList;
    const buildConfigList =
      project.pbxXCConfigurationList()[buildConfigListId];
    for (const configRef of buildConfigList.buildConfigurations) {
      const conf = configurations[configRef.value];
      if (!conf || !conf.buildSettings) continue;
      conf.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = `"${extensionBundleId}"`;
      conf.buildSettings.PRODUCT_NAME = `"$(TARGET_NAME)"`;
      conf.buildSettings.INFOPLIST_FILE = `"${EXTENSION_NAME}/Info.plist"`;
      conf.buildSettings.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_NAME}/${EXTENSION_NAME}.entitlements"`;
      conf.buildSettings.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      conf.buildSettings.SWIFT_VERSION = SWIFT_VERSION;
      conf.buildSettings.TARGETED_DEVICE_FAMILY = `"1,2"`;
      conf.buildSettings.SKIP_INSTALL = 'YES';
      conf.buildSettings.LD_RUNPATH_SEARCH_PATHS = `"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"`;
      conf.buildSettings.CODE_SIGN_STYLE = 'Automatic';
      conf.buildSettings.SWIFT_OPTIMIZATION_LEVEL =
        conf.name === 'Debug' ? `"-Onone"` : `"-O"`;
      conf.buildSettings.SWIFT_COMPILATION_MODE =
        conf.name === 'Debug' ? 'singlefile' : 'wholemodule';
    }

    // Embed the .appex into the main app's PlugIns/ folder. Without this
    // the extension builds but isn't packaged with the app and iOS
    // doesn't register it.
    const mainAppTarget = findMainAppTarget(project, cfg.modRequest.projectName);
    if (mainAppTarget) {
      addEmbedExtensionPhase(project, mainAppTarget, target);
    } else {
      console.warn(
        '[with-native-share-extension] could not find main app target; ' +
          'embed phase NOT added — share extension will build but won\'t ' +
          'be installed with the app.',
      );
    }

    console.info(
      `[with-native-share-extension] registered target ${EXTENSION_NAME} ` +
        `(${extensionBundleId})`,
    );
    return cfg;
  });
}

function findMainAppTarget(project, projectName) {
  const targets = project.pbxNativeTargetSection();
  // Look for a target whose name matches the project name (Expo names the
  // main app target after the slug in app.json) and whose productType is
  // an iOS application.
  for (const key of Object.keys(targets)) {
    const t = targets[key];
    if (!t || typeof t !== 'object') continue;
    if (
      t.productType &&
      t.productType.includes('com.apple.product-type.application')
    ) {
      return { uuid: key, target: t };
    }
  }
  return null;
}

function addEmbedExtensionPhase(project, mainAppTarget, extensionTarget) {
  const phaseName = 'Embed App Extensions';
  // Idempotency: walk the main app target's buildPhases and see if any of
  // them already references an "Embed App Extensions" PBXCopyFilesBuildPhase.
  // The old check looked at project.pbxCopyfilesBuildPhaseObj which isn't a
  // property xcode's pbxProject exposes, so the guard never fired — meaning
  // a second prebuild on the same project would add a duplicate copy phase,
  // and `xcbuild` would emit "Unexpected duplicate tasks" because two
  // separate copy operations would write the same .appex into PlugIns/.
  const copyFilesSection =
    project.hash.project.objects.PBXCopyFilesBuildPhase || {};
  const existingMatchingPhaseUuid = Object.keys(copyFilesSection).find((key) => {
    if (key.endsWith('_comment')) return false;
    const phase = copyFilesSection[key];
    if (!phase || typeof phase !== 'object') return false;
    // dstSubfolderSpec 13 = PlugIns; that's where app extensions go.
    return Number(phase.dstSubfolderSpec) === 13 && phase.name && phase.name.includes(phaseName);
  });
  if (existingMatchingPhaseUuid) return;

  const phaseUuid = project.generateUuid();
  const buildFileUuid = project.generateUuid();

  // PBXBuildFile linking the extension's product to the embed phase.
  const fileSection = project.pbxBuildFileSection();
  fileSection[buildFileUuid] = {
    isa: 'PBXBuildFile',
    fileRef: extensionTarget.pbxNativeTarget.productReference,
    settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
  };
  fileSection[`${buildFileUuid}_comment`] =
    `${EXTENSION_NAME}.appex in ${phaseName}`;

  // The actual PBXCopyFilesBuildPhase entry.
  const copyPhase = {
    isa: 'PBXCopyFilesBuildPhase',
    buildActionMask: 2147483647,
    dstPath: '""',
    dstSubfolderSpec: 13, // 13 = PlugIns
    files: [
      {
        value: buildFileUuid,
        comment: `${EXTENSION_NAME}.appex in ${phaseName}`,
      },
    ],
    name: `"${phaseName}"`,
    runOnlyForDeploymentPostprocessing: 0,
  };

  if (!project.hash.project.objects.PBXCopyFilesBuildPhase) {
    project.hash.project.objects.PBXCopyFilesBuildPhase = {};
  }
  project.hash.project.objects.PBXCopyFilesBuildPhase[phaseUuid] = copyPhase;
  project.hash.project.objects.PBXCopyFilesBuildPhase[`${phaseUuid}_comment`] =
    phaseName;

  // Add the copy phase to the main app target's buildPhases.
  if (!mainAppTarget.target.buildPhases) mainAppTarget.target.buildPhases = [];
  mainAppTarget.target.buildPhases.push({
    value: phaseUuid,
    comment: phaseName,
  });

  // Make sure the main app target depends on the extension target so the
  // extension builds first.
  const dependencyUuid = project.generateUuid();
  const proxyUuid = project.generateUuid();
  const containerPortalId = project.getFirstProject().uuid;

  if (!project.hash.project.objects.PBXContainerItemProxy) {
    project.hash.project.objects.PBXContainerItemProxy = {};
  }
  project.hash.project.objects.PBXContainerItemProxy[proxyUuid] = {
    isa: 'PBXContainerItemProxy',
    containerPortal: containerPortalId,
    proxyType: 1,
    remoteGlobalIDString: extensionTarget.uuid,
    remoteInfo: `"${EXTENSION_NAME}"`,
  };
  project.hash.project.objects.PBXContainerItemProxy[`${proxyUuid}_comment`] =
    'PBXContainerItemProxy';

  if (!project.hash.project.objects.PBXTargetDependency) {
    project.hash.project.objects.PBXTargetDependency = {};
  }
  project.hash.project.objects.PBXTargetDependency[dependencyUuid] = {
    isa: 'PBXTargetDependency',
    target: extensionTarget.uuid,
    targetProxy: proxyUuid,
  };
  project.hash.project.objects.PBXTargetDependency[`${dependencyUuid}_comment`] =
    'PBXTargetDependency';

  if (!mainAppTarget.target.dependencies) mainAppTarget.target.dependencies = [];
  mainAppTarget.target.dependencies.push({
    value: dependencyUuid,
    comment: 'PBXTargetDependency',
  });
}

module.exports = function withNativeShareExtension(config) {
  config = withCopyExtensionSources(config);
  config = withExtensionXcodeTarget(config);
  return config;
};
