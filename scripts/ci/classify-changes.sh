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
# - native: true when a file the Xcode build or the Simulator scenarios
#   depend on changes (the macOS job; docs/nfct/ios.md).
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

# macOS minutes are expensive, so the native job runs only for a change to
# something the Xcode build or the Simulator scenarios depend on. Other
# web-only changes cannot break the native compile; the WebKit and emulator
# suites cover them. Unit tests next to the code cannot change what the
# Simulator runs, so __tests__/ paths never count.
native_paths='^(ios/|ci_scripts/|capacitor\.config\.|package(-lock)?\.json$|\.nvmrc$|vite\.config\.ts$|scripts/ios/|scripts/verify-ios-release\.mjs$|\.github/workflows/(ci|ios)\.yml$|src/main\.tsx$|src/App\.tsx$|src/contexts/AuthContext\.tsx$|src/services/firebase(Config)?\.ts$|src/pages/onboarding/|src/consumer/games/mentalMath/)'
# Every scenario when Mental Math or the driver changes; otherwise the smoke
# scenario (sign-up and relaunch) is enough. Dispatch the iOS workflow for
# anything else a scenario drives.
all_scenarios_paths='^(src/consumer/games/mentalMath/|scripts/ios/|\.github/workflows/ios\.yml$)'

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
  grep -v '/__tests__/' "$changed" > "$candidates"
  if [ "$?" -gt 1 ]; then run_everything; fi
  if any_line matches "$native_paths" "$candidates"; then
    native=true
    if any_line matches "$all_scenarios_paths" "$candidates"; then scenarios=; fi
  fi
fi
echo "code=$code"
echo "backend=$backend"
echo "native=$native"
echo "scenarios=$scenarios"
