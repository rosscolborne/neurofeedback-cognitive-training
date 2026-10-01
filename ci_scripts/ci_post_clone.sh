#!/bin/sh
# Inherited duplicate location of the Xcode Cloud post-clone hook. Xcode Cloud
# reads ci_scripts/ next to the Xcode project it builds, which is
# ios/App/ci_scripts/ for ios/App/App.xcodeproj. This copy only delegates, so
# both locations run the same hook and cannot drift.
set -e
exec "$(cd "$(dirname "$0")/.." && pwd)/ios/App/ci_scripts/ci_post_clone.sh" "$@"
