#!/usr/bin/env bash
# Interactive browser QA at phone sizes: runs the pinned Playwright CLI
# (`playwright-cli`, real Google Chrome) inside a QA lane, from the repository
# root so .playwright/cli.config.json applies. See the nfct-exploratory-qa skill.
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
# --offline: a lane has no internet, and npm would otherwise retry the registry
# for about 70 s before using its cache.
exec "$root/scripts/qa-lane.sh" exec "$lane" -- \
  env NO_UPDATE_NOTIFIER=1 npx --yes --offline "@playwright/cli@$version" "$@"
