#!/bin/sh

# Fail this script if any subcommand fails
set -e

echo "=== Xcode Cloud: Starting Post-Clone Setup ==="

# Navigate to the repository root directory in Xcode Cloud environment
if [ -n "$CI_WORKSPACE" ]; then
    cd "$CI_WORKSPACE"
elif [ -n "$CI_PRIMARY_REPOSITORY_PATH" ]; then
    cd "$CI_PRIMARY_REPOSITORY_PATH"
else
    cd "$(dirname "$0")/../.."
fi

echo "Working directory: $(pwd)"

# Install Node.js if missing on the runner
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v node &> /dev/null; then
    echo "Installing Node.js via Homebrew..."
    brew install node
fi

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

# Install project dependencies
echo "Installing project dependencies..."
npm install

# Build web assets and sync Capacitor iOS plugins
echo "Building web bundle and syncing Capacitor iOS..."
npm run build
npx cap sync ios

echo "=== Xcode Cloud: Post-Clone Setup Complete! ==="
