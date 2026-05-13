#!/bin/bash
# EAS Build pre-build hook, wired via eas.json `prebuildCommand`.
#
# IMPORTANT: `prebuildCommand` REPLACES the default `npx expo prebuild`
# call rather than running alongside it. So this script must:
#   1. Run `expo prebuild` itself, otherwise no iOS / Android project
#      gets generated and the rest of the build can't proceed.
#   2. THEN do any pre-build work we want before `pod install` runs.
#
# Lifecycle reminder for iOS builds:
#   pre-install → npm install → prebuildCommand (this script)
#   → pod install → post-install hook (.eas/build/post-install.sh)
#   → xcodebuild archive
#
# So this hook runs BEFORE pod install. Pods.xcodeproj does not yet
# exist when we hit the Ruby block below — the dedup is a no-op at this
# stage by design. The real Pods-level dedup lives in the post-install
# hook, which runs after pod install. We keep this script's dedup pass
# anyway, as a defensive belt-and-braces in case CocoaPods reuses a
# cached Pods.xcodeproj from a prior failed build.

set -euo pipefail

PLATFORM="${EAS_BUILD_PLATFORM:-ios}"

echo "[eas pre-build] Platform: $PLATFORM"
echo "[eas pre-build] Running expo prebuild (prebuildCommand replaces the default, so we must invoke it ourselves)..."
npx expo prebuild --no-install --platform "$PLATFORM" --non-interactive

if [ "$PLATFORM" != "ios" ]; then
  echo "[eas pre-build] Not an iOS build; skipping Xcode dedup."
  exit 0
fi

echo "[eas pre-build] Deduplicating Xcode build phases before archive..."
ruby -e "
require 'xcodeproj'
['./ios/Pods/Pods.xcodeproj'].each do |path|
  next unless File.exist?(path)
  project = Xcodeproj::Project.open(path)
  project.targets.each do |target|
    seen = {}
    target.build_phases.reject! do |phase|
      name = phase.display_name
      if seen[name]
        puts \"Removing duplicate: #{name} from #{target.name}\"
        true
      else
        seen[name] = true
        false
      end
    end
  end
  project.save
  puts \"Saved #{path}\"
end
"
