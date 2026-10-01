---
name: nfct-pr-review
description: Independently review an NFCT pull request, including an integration PR, for correctness against its Jira cards and the Stage 1 design. Read-only by default; use when asked to review a PR or branch you did not write or integrate.
---

# NFCT PR review

You are the reviewer, not the implementer or integrator. Stay read-only: do not
edit, commit, push, merge, comment on the PR or change Jira unless you are
explicitly asked to switch roles.

## Before reading the diff

1. Read the Jira card's acceptance criteria and any linked cards.
2. Read the parts of the canonical Stage 1 design, ADRs, [AGENTS.md](../../../AGENTS.md)
   and existing code contracts that the card touches. Know what the change is
   supposed to guarantee before judging how it does it.
3. Identify the intended base (normally `origin/main`, or the PR it stacks on)
   and fetch it. Review the complete diff against that base
   (`git diff <base>...<head>`), not only the latest commit.

## Integration PRs

An [integration PR](../nfct-integration/SKILL.md) merges several stream
branches. Never review one you integrated.

- Read its integration report first: the streams and the SHAs merged, the
  conflict resolutions and the semantic decisions.
- Inspect the integrator's own work. `git log --first-parent --oneline
  origin/main..<head>` lists the stream merges and integration commits, and
  `git show --remerge-diff <merge>` shows how a merge resolved its conflicts.
- Streams already reviewed at the SHAs merged need not be re-read line by
  line. Concentrate on the resolutions, the integration commits and the
  boundaries between streams, and check each semantic decision against the
  cards and the design. Your verdict still covers the whole PR.

## What to look for

Review behavior and invariants, not formatting or style. Look adversarially
for:

- incorrect trust boundaries: client-supplied values trusted by rules,
  Functions or scoring;
- security and authorization mistakes, including cross-account reads and
  writes;
- concurrency, retry and idempotency problems: double submits, replayed
  writes, partial failures, transactions that read stale state;
- backward and forward compatibility with existing documents, clients and
  in-flight sessions;
- schema and versioning traps: missing or unchecked version fields, required
  fields old data lacks, enum values a newer client could send;
- hidden coupling between modules, and stale assumptions left over from the
  clinical fork;
- error and recovery paths: what the user sees and what is persisted when a
  step fails;
- tests that pass without enforcing the intended contract: assertions that
  cannot fail, mocks that replace the behavior under test, missing negative
  cases;
- NFCT hard rules: clinical isolation, emulator-only tests, EEG never driving
  scores or progression, and the Stage 1 Playwright policy.

Flag the trust-boundary and authorization issues you find, but this is not a
security review. When the PR touches Firebase Auth, Firestore rules, Cloud
Functions, account deletion, trusted scoring or progression, EEG data, secrets
or user ownership, say that it needs
[nfct-security-review](../nfct-security-review/SKILL.md), or run that skill if
asked.

Check coverage with the
[testing skill](../neurasticity-development-testing/SKILL.md): the right layer,
not the most tests.

## Probing

Run targeted tests, or write temporary probes and tests, where they would
confirm or rule out a finding. Use local emulators only.

Never write probes into the implementer's worktree or the primary checkout. Put
them, and any test runs that write output, in a detached
[review worktree](../nfct-worktrees/SKILL.md#review-worktrees) at the PR head,
and remove it when the review ends. Never commit or push probes unless you are
explicitly switched into an implementation role.

## Findings

Classify each finding:

- **Blocker**: wrong behavior, a security or data-integrity problem, or a
  broken acceptance criterion.
- **Should fix before merge**: a real defect or gap that is small enough to fix
  in this PR.
- **Follow-up / non-blocking**: worth doing, but belongs in another card.

For each, give the file and line, the concrete failure scenario, and the
evidence (a command, probe result or code path). Say which concerns you checked
and ruled out, and what you could not verify.

End with an explicit verdict: either **ready to merge once CI is green**, or
the blockers and should-fix items that must be resolved first.
