#!/bin/sh

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
    REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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

# Install npm dependencies at repository root
echo "Installing project dependencies via npm install..."
npm install --legacy-peer-deps

# Build the production web bundle and sync Capacitor iOS plugins
echo "Building web bundle and syncing Capacitor iOS plugins..."
npm run build
npx cap sync ios

# Verify that the required plugin package exists
if [ -d "$REPO_ROOT/node_modules/@capacitor-community/bluetooth-le" ]; then
    echo "SUCCESS: @capacitor-community/bluetooth-le is verified in node_modules."
else
    echo "WARNING: @capacitor-community/bluetooth-le directory check failed at $REPO_ROOT/node_modules"
fi

echo "========================================================"
echo " Xcode Cloud CI Post-Clone Script Finished Successfully"
echo "========================================================"
