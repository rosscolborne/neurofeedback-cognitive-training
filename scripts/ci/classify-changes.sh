#!/usr/bin/env bash
# Classifies a pull request's changed files for ci.yml's gated jobs.
#
#   scripts/ci/classify-changes.sh <file listing one changed path per line>
#
# Prints key=value lines for $GITHUB_OUTPUT:
# - code: true unless every file is documentation or agent instructions
#   (the emulators job). Keep docs_paths in step with ios.yml.
# - backend: true unless every file clearly cannot change how this branch's
#   web app talks to the backend (the nfct-dev canary,
#   docs/nfct/nfct-dev-canary.md#when-it-runs).
#
# Both fail safe toward more testing: an unreadable or empty listing, or any
# path not on a skip list, sets them to true.
set -u

if [ "$#" -ne 1 ] || [ ! -r "$1" ] || [ ! -s "$1" ]; then
  echo "code=true"
  echo "backend=true"
  exit 0
fi
changed=$1

docs_paths='^(docs/|\.agents/|\.claude/|[^/]+\.md$)|(^|/)README\.md$'

# Skipped by the canary: documentation; tests and test configuration; the
# native iOS project and its tooling; the inherited BrainFlow service; Cloud
# Functions, while none are deployed to nfct-dev (remove functions/ from this
# list when they are); the iOS and main-guard workflows; and media files.
non_backend_paths="${docs_paths}"'|^(e2e/|tests/|ios/|ci_scripts/|scripts/ios/|brainflow_service/|functions/)|(^|/)__tests__/|\.test\.(ts|tsx|js|mjs)$|^(playwright\.(config|protocol\.config|webkit\.config)\.ts|vitest\.[a-z]+\.config\.ts|tsconfig\.(e2e|rules|repositories|shared\.test)\.json|pyproject\.toml|uv\.lock|\.github/workflows/(ios|main-source-guard)\.yml)$|\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|wav|mp4)$'

# The canary's own spec and the e2e helpers it imports always run it, although
# e2e/ is otherwise test-only. A test keeps this in step with its imports.
canary_paths='^(e2e/canary/|e2e/fixtures\.ts$|e2e/helpers/(auth|journeys)\.ts$)'

# any_line matches|differs <pattern>: whether any line matches the pattern,
# or any line does not. A grep error (status 2) runs everything, like any
# other unexpected result.
any_line() {
  local invert=
  if [ "$1" = differs ]; then invert=-v; fi
  grep $invert -E "$2" "$changed" > /dev/null
  local status=$?
  if [ "$status" -gt 1 ]; then
    echo "code=true"
    echo "backend=true"
    exit 0
  fi
  return "$status"
}

code=false
backend=false
if any_line differs "$docs_paths"; then code=true; fi
if any_line matches "$canary_paths" || any_line differs "$non_backend_paths"; then backend=true; fi
echo "code=$code"
echo "backend=$backend"
