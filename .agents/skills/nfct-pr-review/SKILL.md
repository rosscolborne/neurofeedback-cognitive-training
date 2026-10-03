---
name: nfct-pr-review
description: Independently review an NFCT pull request, including an integration PR, for correctness against its Jira cards and the Stage 1 design, with labelled findings and a bounded verification pass. Read-only by default; use when asked to review a PR or branch you did not write or integrate, or to verify fixes to your earlier findings. The orchestrator, or a solo agent acting as one, arranges this review for every PR routed for review.
---

# NFCT PR review

You are the reviewer, not the implementer or integrator. Stay read-only: do not
edit, commit, push, merge, comment on the PR or change Jira unless you are
explicitly asked to switch roles. Start no other agents, reviewers included,
and return your findings to whoever asked for the review
([agent topology](../../../AGENTS.md#agent-topology)). Whoever routed the PR
([which PRs get review](../../../AGENTS.md#which-prs-get-review)) starts you;
you never review your own change.

## Before reading the diff

1. Read the Jira card's acceptance criteria and any linked cards.
2. Read the parts of the canonical Stage 1 design, ADRs, [AGENTS.md](../../../AGENTS.md)
   and existing code contracts that the card touches. Know what the change is
   supposed to guarantee before judging how it does it.
3. Identify the intended base (normally `origin/development`, or the PR it stacks on)
   and fetch it. Review the complete diff against that base
   (`git diff <base>...<head>`), not only the latest commit.

## Integration PRs

An [integration PR](../nfct-integration/SKILL.md) merges several stream
branches. Never review one you integrated.

- Read its integration report first: the streams and the SHAs merged, the
  conflict resolutions and the semantic decisions.
- Inspect the integrator's own work. `git log --first-parent --oneline
  origin/development..<head>` lists the stream merges and integration commits, and
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
security review. When the change's security tier is LIGHT, also work through
the [LIGHT checklist](../nfct-security-review/SKILL.md#light) in this pass. If
the change touches a boundary above its tier, such as Firebase Auth, Firestore
rules, Cloud Functions, account deletion, trusted scoring or progression, EEG
data, secrets or user ownership under a LIGHT routing, say so in your findings
with the reason; do not start a security review yourself.

Check coverage with the
[testing skill](../neurasticity-development-testing/SKILL.md): the right layer,
not the most tests.

## Scope and stopping point

- Your scope is the change: the diff, its acceptance criteria, and the
  unchanged code it now relies on.
- A defect is in scope when the change introduces it, makes it worse or
  leaves an acceptance criterion broken. Technical debt the change does not
  touch or worsen is FOLLOW-UP, however large; mark a serious one urgent.
- Stop when you have read every changed file and acceptance criterion and
  applied [what to look for](#what-to-look-for) to them. Do not then go
  looking for lower-priority work; note minor ideas briefly as FOLLOW-UP, or
  drop them.

## Probing

Run targeted tests, or write temporary probes and tests, where they would
confirm or rule out a finding. Use local emulators only.

Never write probes into the implementer's worktree or the primary checkout. Put
them, and any test runs that write output, in a detached
[review worktree](../nfct-worktrees/SKILL.md#review-worktrees) at the PR head,
and remove it when the review ends. Never commit or push probes unless you are
explicitly switched into an implementation role.

## Findings

Label each finding with the [severities](../../../AGENTS.md#finding-severity)
every reviewer uses:

- **BLOCKER**: wrong behavior, a regression, a security or data-integrity
  problem, or a broken acceptance criterion.
- **SHOULD-FIX**: a real defect or gap that is small enough to fix in this PR.
- **FOLLOW-UP**: worth doing, but belongs in another card: hardening, polish,
  or debt the change does not worsen.

For each, give the file and line, the concrete failure scenario, and the
evidence (a command, probe result or code path). Say which concerns you checked
and ruled out, and what you could not verify.

End with an explicit verdict: either **ready to merge once CI is green**, or
the BLOCKER and SHOULD-FIX items to fix first. After a verification pass, only
an open BLOCKER keeps the verdict at not ready; list any SHOULD-FIX still open
so it can get its one repair or be carded.

## Verification pass

When asked to verify fixes to your findings, check those fixes rather than
reviewing the PR again. For each finding, read its fix and run its targeted
check, then read the fix diff for regressions it introduced, which are in
scope. When the tier is LIGHT, apply the LIGHT checklist to the fix diff
too. Do not re-audit the PR unless you are explicitly asked to. Report any
BLOCKER you happen to see outside the fixes; label anything else new
FOLLOW-UP. End with each prior finding's status and the verdict.
