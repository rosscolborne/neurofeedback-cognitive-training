# Draft rules tests (not part of `npm run test:rules`)

Investigation drafts for proposals in `docs/codex/security-backlog/proposals/`.
They are named `*.draft.ts`, so the main rules suite does not collect them. Some
assert the current behavior and some assert proposed behavior; read each file's
header before relying on it.

Run a track against a rules file (the fixture honours `RULES_FILE`):

```bash
JAVA_HOME=~/.local/share/temurin-jre-21 PATH=$JAVA_HOME/bin:$PATH \
  RULES_FILE=docs/codex/security-backlog/proposals/track-a-identity/firestore.rules.proposed \
  npx firebase emulators:exec --only firestore --project demo-drafts \
  "npx vitest run --config tests/firestore-rules/drafts/track-A/vitest.config.ts"
```

- `track-A/`: identity hardening (verified email, clinician grants, revocation).
  Needs `proposals/track-a-identity/trackA-fixture.patch` applied to the fixture.
- `track-B/`: care-plan field ownership; use `proposals/track-b-care-plan/proposed.rules`.
- `track-C/`: relationship lifecycle; set `TRACK_C_PROPOSED=1` with the rules from
  applying `proposals/track-c-lifecycle/C-01-rules-lifecycle.patch`.
- `track-E/`: low-severity items; `TRACK_E_OPTIONAL=1` exercises the optional patch.
