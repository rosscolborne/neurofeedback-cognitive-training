set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
# Run inside: npx firebase emulators:exec --only firestore,auth --project demo-track-d "bash <this file>"
cd "$HERE/../../.."
node "$HERE"/seed-emulator.mjs || exit 1
echo "--- refusal: no flag"; AUDIT_PROJECT_ID=demo-track-d node "$HERE"/audit-firestore-readonly.mjs; echo "exit=$?"
echo "--- refusal: prod id on emulator"; AUDIT_READ_ONLY=true AUDIT_PROJECT_ID=brainwell-327dc node "$HERE"/audit-firestore-readonly.mjs; echo "exit=$?"
echo "--- full run page=10"; AUDIT_READ_ONLY=true AUDIT_PROJECT_ID=demo-track-d AUDIT_PAGE_SIZE=10 AUDIT_OUT_FILE=${TMPDIR:-/tmp}/audit-smoke-report.json node "$HERE"/audit-firestore-readonly.mjs; echo "exit=$?"
echo "--- truncation run max=15"; AUDIT_READ_ONLY=true AUDIT_PROJECT_ID=demo-track-d AUDIT_PAGE_SIZE=5 AUDIT_MAX_DOCS_PER_COLLECTION=15 AUDIT_OUT_FILE=${TMPDIR:-/tmp}/audit-smoke-report-trunc.json node "$HERE"/audit-firestore-readonly.mjs; echo "exit=$?"
