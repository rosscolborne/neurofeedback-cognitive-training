#!/usr/bin/env bash
# Classifies a branch's changes relative to development for the gated jobs of
# the Pre-merge validation workflow (.github/workflows/ci.yml).
#
#   scripts/ci/classify-changes.sh <file listing one changed path per line>
#
# Prints key=value lines for $GITHUB_OUTPUT:
# - code: true unless every file is documentation or agent instructions
#   (the emulator suites, and the WebKit and release-bundle iOS jobs).
# - backend: true unless every file clearly cannot change how this branch's
#   web app talks to the backend (the nfct-dev canary,
#   docs/nfct/nfct-dev-canary.md#when-it-runs).
# - native: true only for a native or iOS-sensitive change (the macOS job:
#   the Xcode build and the Simulator scenarios; docs/nfct/ios.md). Simulator
#   CI is optional for ordinary feature work, so web screens the scenarios
#   merely drive do not count.
# - scenarios: the Simulator scenarios to run; empty runs them all.
#
# All fail safe toward more testing: an unreadable or empty listing, or any
# path not on a skip list, runs the job.
set -u

run_everything() {
  echo "code=true"
  echo "backend=true"
  echo "native=true"
  echo "scenarios="
  exit 0
}

if [ "$#" -ne 1 ] || [ ! -r "$1" ] || [ ! -s "$1" ]; then
  run_everything
fi
changed=$1

docs_paths='^(docs/|\.agents/|\.claude/|[^/]+\.md$)|(^|/)README\.md$'

# Skipped by the canary: documentation; tests and test configuration; the
# native iOS project and its tooling; the inherited BrainFlow service; Cloud
# Functions, while none are deployed to nfct-dev (remove functions/ from this
# list when they are); the iOS, release and main-guard workflows; and media
# files.
non_backend_paths="${docs_paths}"'|^(e2e/|tests/|ios/|ci_scripts/|scripts/ios/|brainflow_service/|functions/)|(^|/)__tests__/|\.test\.(ts|tsx|js|mjs)$|^(playwright\.(config|protocol\.config|webkit\.config)\.ts|vitest\.[a-z]+\.config\.ts|tsconfig\.(e2e|rules|repositories|shared\.test)\.json|pyproject\.toml|uv\.lock|\.github/workflows/(ios|release|main-source-guard)\.yml)$|\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|wav|mp4)$'

# The canary's own spec and the e2e helpers it imports always run it, although
# e2e/ is otherwise test-only. A test keeps this in step with its imports.
canary_paths='^(e2e/canary/|e2e/fixtures\.ts$|e2e/helpers/(auth|journeys)\.ts$)'

# macOS minutes are expensive and the Simulator flakes (NFCT-50), so the
# native job runs only for a native or iOS-sensitive change:
# - the native build's own inputs: the iOS project, the Xcode Cloud hook,
#   the Capacitor config, the dependencies the Swift packages come from,
#   Node for the hook, Vite's build (the bundle's base path under
#   capacitor://), the iOS scripts and ios.yml;
# - app code that calls native APIs through Capacitor (native_api, checked in
#   the changed files themselves, so new native code counts too).
# Web code the scenarios merely drive (App, sign-in, onboarding, the games)
# does not: the WebKit and emulator suites cover it, and the iOS workflow
# can be run by hand for it. Documentation and tests never count.
native_paths='^(ios/|ci_scripts/|capacitor\.config\.|package(-lock)?\.json$|\.nvmrc$|vite\.config\.ts$|scripts/ios/|scripts/verify-ios-release\.mjs$|\.github/workflows/ios\.yml$)'
native_api='@capacitor/|@capacitor-community/|\bCapacitor\.'
app_code='^src/.*\.(ts|tsx|js|jsx|mjs)$'
not_native="${docs_paths}"'|(^|/)__tests__/|\.test\.(ts|tsx|js|mjs)$'
# Every scenario when the driver or the workflow changes; otherwise the
# smoke scenario (sign-up and relaunch) is enough. Run the iOS workflow by
# hand for anything else.
all_scenarios_paths='^(scripts/ios/|\.github/workflows/ios\.yml$)'

# any_line matches|differs <pattern> [file]: whether any line of the file
# (default: the listing) matches the pattern, or any line does not. A grep
# error (status 2) runs everything, like any other unexpected result.
any_line() {
  local invert=
  if [ "$1" = differs ]; then invert=-v; fi
  grep $invert -E "$2" "${3:-$changed}" > /dev/null
  local status=$?
  if [ "$status" -gt 1 ]; then run_everything; fi
  return "$status"
}

code=false
backend=false
native=false
scenarios=smoke
if any_line differs "$docs_paths"; then code=true; fi
if any_line matches "$canary_paths" || any_line differs "$non_backend_paths"; then backend=true; fi
if [ "$code" = true ]; then
  candidates=$(mktemp) || run_everything
  trap 'rm -f "$candidates"' EXIT
  grep -vE "$not_native" "$changed" > "$candidates"
  if [ "$?" -gt 1 ]; then run_everything; fi
  if any_line matches "$native_paths" "$candidates"; then native=true; fi
  if [ "$native" = false ]; then
    while IFS= read -r path; do
      if [[ "$path" =~ $app_code ]] && [ -f "$path" ] && grep -qE "$native_api" -- "$path"; then
        native=true
        break
      fi
    done < "$candidates"
  fi
  if [ "$native" = true ] && any_line matches "$all_scenarios_paths" "$candidates"; then scenarios=; fi
fi
echo "code=$code"
echo "backend=$backend"
echo "native=$native"
echo "scenarios=$scenarios"
