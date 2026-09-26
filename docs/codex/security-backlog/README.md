# Security, data-lifecycle and E2E backlog (2026-09-25)

Deferred work from the E2E/Firestore security session on branch
`codex/mockdata-e2e-regression`. This directory is the durable record until the
backlog is loaded into Jira (Waveable project).

- `BACKLOG.md`: the backlog, organized into 10 epics, 13 decision issues and
  their blocking links. Each issue lists its gate (blocks merge, blocks real
  users, or safe to defer), evidence, scope, acceptance criteria and tests.
- `jira-import.csv`: the same backlog for Jira's CSV importer. Map `Issue ID`,
  `Parent ID` (parent/epic), `Issue Type`, `Summary`, `Priority`, `Labels`,
  `Description`, and each `Inward issue link (Blocks)` column (the row is blocked
  by the referenced ID). Decisions import as Tasks labelled `decision`.
- `make_backlog.py`: regenerates both files; edit the issue definitions there.
- `proposals/`: design artifacts produced by the investigation tracks, not yet
  applied (proposed rules, client patches, the read-only data-audit script,
  the Playwright coverage matrix and the testing-skill patch). Patches were
  written against the worktree as of 2026-09-25; rebase before applying.
- Draft emulator tests for the proposals live in `tests/firestore-rules/drafts/`
  (see the README there).

Recovery: the Codex state before this session is preserved at
`refs/backups/codex-e2e-2026-09-25`.
