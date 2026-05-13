#!/bin/bash
# EAS Build post-install hook.
#
# Lifecycle slot: AFTER `pod install`, BEFORE `xcodebuild archive`.
# This is the only window where the Pods project AND the main app
# pbxproj both exist on disk with their final pod-install-time state,
# and the only window from which we can mutate them and have xcbuild
# see our changes.
#
# We open BOTH Xcode projects and walk every target, deduping build
# phases by display_name:
#
#   1. ios/Pods/Pods.xcodeproj
#      Catches duplicates on the `hermes-engine` pod target (e.g. two
#      "Replace Hermes for the right configuration" PBXShellScriptBuildPhases).
#
#   2. ios/*.xcodeproj  (main app project)
#      Catches duplicates on the main app target. CocoaPods aggregates
#      `[CP-User]` script phases into user targets via the
#      xcconfig_aggregate_targets step, so any duplicate Hermes Replace
#      phase that ends up wired into the app target lives HERE, not in
#      Pods.xcodeproj. Easy to miss if you only scan the Pods project.
#
# Wired in via the `eas-build-post-install` npm script in package.json —
# EAS Build looks that name up automatically. Guarded on the existence
# of an ios/ directory so it's a no-op on Android builds.

set -euo pipefail

if [ ! -d "./ios" ]; then
  echo "[eas post-install] no ios/ directory — Android build; skipping."
  exit 0
fi

# Collect every xcodeproj path we care about: Pods plus any main app
# project at the top level of ios/. Globs are quoted so the shell
# doesn't eagerly expand them when they match nothing.
PODS_PROJECT="./ios/Pods/Pods.xcodeproj"
MAIN_PROJECTS=()
for proj in ./ios/*.xcodeproj; do
  [ -d "$proj" ] && MAIN_PROJECTS+=("$proj")
done

if [ ! -d "$PODS_PROJECT" ] && [ "${#MAIN_PROJECTS[@]}" -eq 0 ]; then
  echo "[eas post-install] no Xcode projects found under ios/; skipping."
  exit 0
fi

echo "[eas post-install] Pods project:    ${PODS_PROJECT}"
echo "[eas post-install] Main project(s): ${MAIN_PROJECTS[*]:-<none>}"
echo "[eas post-install] Deduplicating build phases by display_name..."

# Pass the project paths to Ruby via env vars to avoid shell-quoting
# nightmares around the embedded ruby heredoc.
export EAS_PODS_PROJECT="$PODS_PROJECT"
export EAS_MAIN_PROJECTS="${MAIN_PROJECTS[*]:-}"

ruby <<'RUBY'
require 'xcodeproj'

paths = []
pods = ENV['EAS_PODS_PROJECT'].to_s
paths << pods if !pods.empty? && File.exist?(pods)
ENV['EAS_MAIN_PROJECTS'].to_s.split(/\s+/).each do |p|
  paths << p if !p.empty? && File.exist?(p)
end

removed_total = 0
paths.each do |path|
  puts "[eas post-install] opening #{path}"
  project = Xcodeproj::Project.open(path)
  removed_in_project = 0
  project.targets.each do |target|
    seen = {}
    target.build_phases.reject! do |phase|
      name = phase.display_name
      if seen[name]
        puts "  Removing duplicate phase: #{name.inspect} from target #{target.name.inspect} in #{File.basename(path)}"
        removed_in_project += 1
        true
      else
        seen[name] = true
        false
      end
    end
  end
  project.save
  puts "[eas post-install] saved #{path} (removed #{removed_in_project} duplicate phase(s))"
  removed_total += removed_in_project
end

puts "[eas post-install] Done. Removed #{removed_total} duplicate phase(s) across #{paths.length} project(s)."
RUBY
