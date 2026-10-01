#!/bin/sh
# Xcode Cloud post-clone hook for the NFCT app (docs/nfct/ios.md#xcode-cloud).
#
# Xcode Cloud runs ci_scripts/ci_post_clone.sh from the directory of the
# Xcode project it builds (ios/App), right after cloning. The web bundle and
# the synced Capacitor files are gitignored, so this hook builds and syncs
# them before Xcode resolves packages and archives. It is product-neutral
# infrastructure inherited from the forked project; keep it working.
#
# `npm run sync:ios` builds the production bundle, syncs it and runs the
# release check, so an archive can never package a development bundle.
#
# Optional workflow environment variable (Xcode Cloud > Workflow >
# Environment): NFCT_DEVELOPMENT_TEAM, the Apple team ID. When it is set, the
# hook writes the gitignored ios/signing.local.xcconfig, so the team never has
# to be committed. It is not a secret.

set -e

echo "========================================================"
echo " Xcode Cloud CI Post-Clone Script Starting"
echo "========================================================"

# Add Homebrew to PATH (both Apple Silicon and Intel locations)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$PATH"
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

# Resolve Repository Root Directory
if [ -n "$CI_PRIMARY_REPOSITORY_PATH" ]; then
    REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
elif [ -n "$CI_WORKSPACE" ]; then
    REPO_ROOT="$CI_WORKSPACE/repository"
    if [ ! -d "$REPO_ROOT" ]; then
        REPO_ROOT="$CI_WORKSPACE"
    fi
else
    REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
fi

echo "Repository Root: $REPO_ROOT"
cd "$REPO_ROOT"

# Ensure Node.js & npm are installed and available
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found in PATH. Installing via Homebrew..."
    if command -v brew >/dev/null 2>&1; then
        brew install node
    else
        echo "Error: Homebrew is not available to install Node.js."
        exit 1
    fi
fi

echo "Using Node.js: $(node -v) at $(which node)"
echo "Using npm: $(npm -v) at $(which npm)"

# Install exactly the locked dependencies at the repository root
echo "Installing project dependencies via npm ci..."
npm ci --legacy-peer-deps

# Signing team from the workflow environment, kept out of the repository
if [ -n "${NFCT_DEVELOPMENT_TEAM:-}" ]; then
    printf 'DEVELOPMENT_TEAM = %s\n' "$NFCT_DEVELOPMENT_TEAM" > "$REPO_ROOT/ios/signing.local.xcconfig"
    echo "Wrote ios/signing.local.xcconfig for team $NFCT_DEVELOPMENT_TEAM"
fi

# Build the production web bundle, sync Capacitor iOS, and run the release check
echo "Building web bundle, syncing Capacitor iOS and checking the release bundle..."
npm run sync:ios

# Verify that the required plugin package exists
if [ -d "$REPO_ROOT/node_modules/@capacitor-community/bluetooth-le" ]; then
    echo "SUCCESS: @capacitor-community/bluetooth-le is verified in node_modules."
else
    echo "WARNING: @capacitor-community/bluetooth-le directory check failed at $REPO_ROOT/node_modules"
fi

echo "========================================================"
echo " Xcode Cloud CI Post-Clone Script Finished Successfully"
echo "========================================================"
