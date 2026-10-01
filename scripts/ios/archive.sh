#!/usr/bin/env bash
# Archives the iOS app for App Store Connect and, with --upload, uploads it
# for TestFlight. Owner-run only, on a Mac signed in to the Apple account;
# NFCT's Xcode Cloud workflow is the usual path (docs/nfct/ios.md#releases).
# Generalized from the inherited build/package-mac.sh: same steps, with no
# product name or team in the repository.
#
#   npm run ios:archive                # archive to build/NFCT.xcarchive
#   npm run ios:archive -- --upload    # archive, then upload to App Store Connect
#
# The team comes from ios/signing.local.xcconfig, or DEVELOPMENT_TEAM in the
# environment.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
archive="$root/build/NFCT.xcarchive"
export_dir="$root/build/output"
# Bash 3.2 (macOS /bin/bash) treats an empty array as unbound under set -u,
# so it is expanded below as ${team[@]+"${team[@]}"}.
team=()
if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  team=(DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM")
elif ! grep -qsE '^DEVELOPMENT_TEAM *= *[A-Z0-9]{10} *$' "$root/ios/signing.local.xcconfig"; then
  echo "error: no Apple team. Set DEVELOPMENT_TEAM, or create ios/signing.local.xcconfig (docs/nfct/ios.md#signing-on-your-mac)." >&2
  exit 1
fi

cd "$root"
# Production web bundle, cap sync and the release check. Archives are Release
# builds, so the Xcode guard build phase also refuses a development bundle.
npm run sync:ios

rm -rf "$archive" "$export_dir"
xcodebuild -version
xcodebuild archive \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$archive" \
  -allowProvisioningUpdates \
  ${team[@]+"${team[@]}"}
echo "Archive: $archive"

if [ "${1:-}" = --upload ]; then
  xcodebuild -exportArchive \
    -archivePath "$archive" \
    -exportOptionsPlist ios/ExportOptions-AppStoreConnect.plist \
    -exportPath "$export_dir" \
    -allowProvisioningUpdates
  echo "Uploaded to App Store Connect; the build appears in TestFlight after processing."
fi
