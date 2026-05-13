#!/bin/bash
# EAS Build post-install hook.
#
# Runs AFTER `expo prebuild` and AFTER `pod install` (which is the whole
# point — by this time, hermes-engine has already written its
# `[CP-User] [Hermes] Replace Hermes for the right configuration` shell
# script phase into the Pods project. Earlier attempts that touched
# Pods.xcodeproj from a Podfile `post_install` block ran TOO EARLY:
# CocoaPods adds script phases during "Generating Pods project", which
# happens after the post_install hook returns).
#
# We open the just-generated Pods.xcodeproj, walk every target, and
# dedupe build phases by display name. That collapses the duplicate
# Hermes Replace phase that triggers "Unexpected duplicate tasks" from
# xcbuild.
#
# This script is wired in via the `eas-build-post-install` npm script
# in package.json — EAS Build looks up that script name automatically.
# It runs for both iOS and Android builds, so we guard on the
# existence of the Pods project and exit cleanly on Android.

set -euo pipefail

PODS_PROJECT="./ios/Pods/Pods.xcodeproj"

if [ ! -d "$PODS_PROJECT" ]; then
  echo "[eas post-install] no Pods.xcodeproj at $PODS_PROJECT — Android build or pre-pod-install context; skipping."
  exit 0
fi

echo "[eas post-install] Removing duplicate build phases from Pods project..."

ruby -e "
require 'xcodeproj'
project_path = './ios/Pods/Pods.xcodeproj'
project = Xcodeproj::Project.open(project_path)
project.targets.each do |target|
  seen = {}
  target.build_phases.reject! do |phase|
    name = phase.display_name
    if seen[name]
      puts \"  Removing duplicate phase: #{name} from #{target.name}\"
      true
    else
      seen[name] = true
      false
    end
  end
end
project.save
puts '[eas post-install] Done deduplicating build phases'
"
