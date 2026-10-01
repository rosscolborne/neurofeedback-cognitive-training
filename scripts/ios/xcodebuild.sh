#!/usr/bin/env bash
# Builds the iOS app for the Simulator without signing, exactly as CI does
# (.github/workflows/ios.yml). Needs a Mac with Xcode. See docs/nfct/ios.md.
#
#   npm run sync:ios && npm run ios:build              # Release, any Simulator
#   npm run sync:ios:emulators && npm run ios:build -- Debug
#   npm run ios:build -- Debug 'platform=iOS Simulator,id=<udid>'
#   npm run ios:build -- resolve                       # Swift packages only
#
# IOS_DERIVED_DATA and IOS_SOURCE_PACKAGES override where the build and the
# resolved Swift packages go (CI caches the packages).
set -euo pipefail

configuration="${1:-Release}"
destination="${2:-generic/platform=iOS Simulator}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
derived="${IOS_DERIVED_DATA:-$root/ios/App/build/DerivedData}"
common=(
  -project "$root/ios/App/App.xcodeproj"
  -scheme App
  -derivedDataPath "$derived"
  -clonedSourcePackagesDirPath "${IOS_SOURCE_PACKAGES:-$derived/SourcePackages}"
)

xcodebuild -version
if [ "$configuration" = resolve ]; then
  # `npm run ios:build -- resolve` only resolves the Swift packages.
  exec xcodebuild "${common[@]}" -resolvePackageDependencies
fi
xcodebuild "${common[@]}" \
  -configuration "$configuration" \
  -destination "$destination" \
  CODE_SIGNING_ALLOWED=NO \
  build
