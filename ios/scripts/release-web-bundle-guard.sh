#!/bin/sh
# Build phase of the App target: "Refuse a development web bundle in Release".
#
# A Release build, which every archive is, must never package the
# emulator-capable development web bundle that `npm run sync:ios:emulators`
# copies into App/public. Debug builds are not checked.
#
# This is the backstop for Release builds started from Xcode, where Node may
# not be on PATH. The full check is `npm run verify:ios-release`
# (scripts/verify-ios-release.mjs); keep the two in step.
set -eu

[ "${CONFIGURATION:-}" = "Release" ] || exit 0

# CAPACITOR_DEBUG makes the web view inspectable and forwards console output.
# Xcode resolves it from every xcconfig, include and SDK-conditional setting,
# so check the resolved value, not the files.
if [ -n "${CAPACITOR_DEBUG:-}" ]; then
  echo "error: CAPACITOR_DEBUG is set (${CAPACITOR_DEBUG}) in a Release build; only ios/debug.xcconfig may set it (docs/nfct/ios.md)." >&2
  exit 1
fi

public="${SRCROOT:?}/App/public"
fail() {
  echo "error: $1 Run npm run sync:ios before a Release build (docs/nfct/ios.md)." >&2
  exit 1
}

[ -f "$public/index.html" ] || fail "There is no web bundle in $public."
# vite.config.ts marks every build; a missing marker is not trusted.
grep -q '<meta name="nfct-build" content="production">' "$public/index.html" \
  || fail "The web bundle in $public is not a production build."
# Emulator hosts are compiled in only when VITE_E2E_EMULATORS=true.
if grep -rqsE --include='*.js' '127\.0\.0\.1|localhost:[0-9]' "$public"; then
  fail "The web bundle in $public contains local emulator or service hosts."
fi
