#!/usr/bin/env bash
# Interactive browser QA at phone sizes: runs the pinned Playwright CLI
# (`playwright-cli`, driving the installed Google Chrome) inside a QA lane, with
# scripts/qa/playwright-cli.json (Chrome's sandbox off, which a lane needs).
# See the nfct-exploratory-qa skill.
#
#   scripts/qa-browser.sh --fetch                 once, outside any lane (needs internet)
#   scripts/qa-browser.sh <lane> -s=se open http://127.0.0.1:5193/ --device "iPhone SE (3rd gen)"
#   scripts/qa-browser.sh <lane> -s=se snapshot   then click <ref>, fill <ref> <text>, ...
set -euo pipefail

version=0.1.22
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

case "${1:-}" in
--fetch) exec npx --yes "@playwright/cli@$version" --version ;;
'' | -*)
  echo "usage: scripts/qa-browser.sh --fetch | <lane> <playwright-cli args...>" >&2
  exit 2
  ;;
esac

lane=$1
shift
# An empty .playwright/ makes this worktree the CLI's workspace, so session
# names (-s=se) are per worktree. The config is passed explicitly rather than
# auto-discovered, so a plain playwright-cli run outside a lane keeps the sandbox.
mkdir -p "$root/.playwright"
# --offline: a lane has no internet, and npm would otherwise retry the registry
# for about 70 s before using its cache.
exec "$root/scripts/qa-lane.sh" exec "$lane" -- \
  env NO_UPDATE_NOTIFIER=1 PLAYWRIGHT_MCP_CONFIG="$root/scripts/qa/playwright-cli.json" \
  npx --yes --offline "@playwright/cli@$version" "$@"
