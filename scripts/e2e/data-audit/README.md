# Read-only development data audit

This guarded Firestore/Auth audit inspects existing data in the shared
`brainwell-327dc` development project to inform a later data review, reset, or
migration decision. It is independent of the WB-44 E2E fixture reset and the
WB-53 deployed-rules browser probe. Repository integration does not imply that
this audit has run against the shared project.

Run from the repository root after installing dependencies. Use separately
approved, keyless, read-only Application Default Credentials with Firestore and
Firebase Auth viewer access. Review the target and keep the generated JSON
outside the repository; it includes document paths and counts. Do not treat the
WB-44 E2E service account, which has fixture write permissions, as the audit's
least-privilege identity.

```bash
AUDIT_READ_ONLY=true AUDIT_PROJECT_ID=brainwell-327dc \
  AUDIT_CONFIRM_PROJECT=brainwell-327dc \
  node scripts/e2e/data-audit/audit-firestore-readonly.mjs \
  > /path/to/private/audit-report.json
```

The script refuses an unexpected project and structurally disables Admin SDK
write methods. Check `truncated` in its output before using the findings. Its
emulator smoke check seeds only a `demo-*` project:

```bash
npx firebase emulators:exec --only firestore,auth --project demo-track-d \
  "bash scripts/e2e/data-audit/smoke.sh"
```

The smoke check writes reports under `${TMPDIR:-/tmp}`. Review the associated
Jira issue for current audit status and decisions; the removed import backlog
is not a status source.
