#!/usr/bin/env node
/**
 * Strips the ExpoHead Swift module out of expo-router's autolinking config.
 *
 * Runs as a `postinstall` hook in package.json, immediately after `npm
 * install` finishes. On EAS Build the sequence is:
 *
 *   1. checkout
 *   2. npm install    <- we patch here
 *   3. expo prebuild
 *   4. pod install     <- reads the patched config, never declares ExpoHead
 *
 * Why this is needed
 * ------------------
 *   The ExpoHead Swift pod is bundled inside expo-router
 *   (node_modules/expo-router/ios/ExpoHead.podspec). expo-router's
 *   expo-module.config.json declares the Head module under apple.modules,
 *   so `use_expo_modules!` auto-links the pod. ExpoHead depends on
 *   RNScreens being a clang module, but the autogen Podfile doesn't make
 *   RNScreens modular. Result: pod install bails with
 *
 *     The Swift pod `ExpoHead` depends upon `RNScreens`, which does not
 *     define modules.
 *
 * The Head module is not a separate npm package, so `npm uninstall`
 * doesn't help. The surgical fix is to remove it from expo-router's
 * module list before autolinking runs.
 *
 * Idempotent: re-running on already-patched content is a no-op.
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(
  __dirname,
  '..',
  'node_modules',
  'expo-router',
  'expo-module.config.json',
);

const MODULES_TO_DROP = new Set(['ExpoHeadModule']);
const SUBSCRIBERS_TO_DROP = new Set(['ExpoHeadAppDelegateSubscriber']);

function main() {
  if (!fs.existsSync(TARGET)) {
    // expo-router isn't installed yet (or got reshaped) - silently bail.
    return;
  }

  let json;
  try {
    json = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
  } catch (e) {
    console.warn(
      `[patch-expo-router-no-head] couldn't parse ${TARGET}: ${e.message}`,
    );
    return;
  }

  const apple = json.apple ?? {};
  let modified = false;

  if (Array.isArray(apple.modules)) {
    const before = apple.modules.length;
    apple.modules = apple.modules.filter((m) => !MODULES_TO_DROP.has(m));
    if (apple.modules.length !== before) modified = true;
  }
  if (Array.isArray(apple.appDelegateSubscribers)) {
    const before = apple.appDelegateSubscribers.length;
    apple.appDelegateSubscribers = apple.appDelegateSubscribers.filter(
      (s) => !SUBSCRIBERS_TO_DROP.has(s),
    );
    if (apple.appDelegateSubscribers.length !== before) modified = true;
  }

  if (!modified) {
    return; // already patched
  }

  json.apple = apple;
  fs.writeFileSync(TARGET, JSON.stringify(json, null, 2) + '\n');
  console.info(
    '[patch-expo-router-no-head] stripped ExpoHeadModule + ' +
      'ExpoHeadAppDelegateSubscriber from expo-router autolinking.',
  );
}

main();
