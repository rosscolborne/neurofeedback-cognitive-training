#!/bin/bash
# ==============================================================================
# Brainwell Universal iOS / iPadOS / macOS Build & Packaging Automation Script
# Supports: iPhone, iPad, and Mac (Designed for iPad on Apple Silicon & macOS)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:---app-store}" # Options: --app-store, --local

echo "========================================================"
echo " Starting Brainwell Universal Build Pipeline (Mode: $MODE)"
echo " Supported Destinations: iPhone, iPad, and Mac (Apple Silicon)"
echo " Repository Root: $REPO_ROOT"
echo "========================================================"

cd "$REPO_ROOT"

# Step 1: Build the Web Distribution Bundle
echo "==> Step 1: Building production web bundle with Vite..."
npm run build

# Step 2: Sync Capacitor iOS / Mac Target
echo "==> Step 2: Syncing Capacitor assets and plugins..."
npx cap sync ios

# Step 3: Clean & Prepare Build Directory
mkdir -p "$REPO_ROOT/build/output"
ARCHIVE_PATH="$REPO_ROOT/build/Brainwell.xcarchive"
EXPORT_PATH="$REPO_ROOT/build/output"

rm -rf "$ARCHIVE_PATH"
rm -rf "$EXPORT_PATH"/*

# Step 4: Archive Universal Target via Xcodebuild
echo "==> Step 3: Archiving Universal Target (iPhone, iPad & Mac)..."
xcodebuild archive \
  -project "$REPO_ROOT/ios/App/App.xcodeproj" \
  -scheme "App" \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -configuration Release \
  DEVELOPMENT_TEAM="XY542W88W6" \
  CODE_SIGN_STYLE="Automatic"

echo "==> SUCCESS: Universal Archive created at $ARCHIVE_PATH"

# Step 5: Export based on selected mode
case "$MODE" in
  --app-store)
    echo "==> Step 4: Exporting for App Store Connect & TestFlight (iOS + iPadOS + macOS)..."
    xcodebuild -exportArchive \
      -archivePath "$ARCHIVE_PATH" \
      -exportOptionsPlist "$REPO_ROOT/build/ExportOptions.plist" \
      -exportPath "$EXPORT_PATH"
    echo "==> SUCCESS: Uploaded / Exported to App Store Connect for iPhone, iPad, and Mac users!"
    ;;

  *)
    echo "==> Step 4: Export completed. Archive ready for manual distribution or inspection in Xcode Organizer."
    echo "    Archive Path: $ARCHIVE_PATH"
    ;;
esac

echo "========================================================"
echo " Brainwell Universal Build Completed Successfully!"
echo "========================================================"
