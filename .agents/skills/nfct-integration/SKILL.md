---
name: nfct-integration
description: Converge completed NFCT streams (parallel branches, worktrees or PRs serving one objective) into one validated, merge-ready integration PR. Use when parallel implementation has finished, when related branches or PRs must become one coherent result, when asked to combine or integrate related work, or when parallel work is done but has not been validated together.
---

# NFCT integration

Finishing every stream does not finish the objective. The objective is done
only when its streams have been combined, validated together and reported
merge-ready by this skill, unless the user explicitly asked for independent
PRs (see [Independent PRs](#independent-prs)).

The integrator owns the combined result: the merge order, the integration
branch and PR, conflict and semantic resolutions, defects that exist only in
the combination, the combined validation, CI on the integration PR, and the
integration report. Everything else keeps its owner:

| Responsibility | Owner |
| --- | --- |
| Decomposition, stream assignment and tracking | [nfct-orchestration](../nfct-orchestration/SKILL.md) |
| A stream's own change, and defects that reproduce on its branch alone | That stream's implementer |
| Choosing and writing deterministic tests | [neurasticity-development-testing](../neurasticity-development-testing/SKILL.md) |
| Browser-driven investigation | [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md) |
| Review of the integration PR | [nfct-pr-review](../nfct-pr-review/SKILL.md) and, where triggered, [nfct-security-review](../nfct-security-review/SKILL.md), by agents that did not integrate it |
| Out-of-scope discoveries | [Out-of-scope work](../../../AGENTS.md#out-of-scope-work) |
| Human checks and the merge | The owner |

## Inventory the streams

Read the parent objective: the epic or cards, their acceptance criteria, and
the parts of the Stage 1 design and ADRs they touch. Then, for every stream:

```bash
gh pr view <n> --json number,title,url,baseRefName,headRefName,headRefOid,reviewDecision,statusCheckRollup
git log --oneline origin/main..origin/<branch>
git diff --stat origin/main...origin/<branch>
```

Also read its PR description, its review findings and how they were resolved,
and the tests it reports. A stream is ready when it is pushed and clean, its
targeted tests pass, and it has no open blockers. Report a stream that is not
ready to the orchestrator instead of integrating a moving target.

From here, stream branches are frozen inputs: their owners push only fixes
routed back from integration, so you know what to merge again.

## Order the merges

Merge in dependency order: a stacked PR after its base (`baseRefName`), shared
contracts (`shared/`, rules, types, repository interfaces) before their
consumers, and user-facing streams last. Predict textual conflicts without
touching any worktree:

```bash
git merge-tree --write-tree --name-only --no-messages origin/<a> origin/<b>
```

Write down the order and the predicted conflicts.

## Build the integration branch

Create the integration branch and worktree from `origin/main` per
[nfct-worktrees](../nfct-worktrees/SKILL.md#integration-worktrees), then merge
each stream in order with `git merge --no-ff origin/<branch>`.

- Merge every stream, even when an earlier merge already brought in some of
  its commits, so that each merge commit names one stream.
- Keep stream commits as they are. Do not rebase, squash or cherry-pick them
  unless a stream carries commits that must not ship; then cherry-pick the
  rest and record why, because that stream's PR no longer matches what ships.
- Never rewrite, rebase or push to a stream branch.
- To pick up a newer `origin/main`, merge it into the integration branch
  rather than rebasing, so stream commits keep their SHAs.
- When a stream owner pushes a routed fix, see what changed with
  `git range-diff <old-head>...origin/<branch>`, then merge the branch again.

## Resolve conflicts by intent

- Read what each side was for (both cards, both diffs) and resolve so that
  both sets of acceptance criteria still hold. Never take one side wholesale
  just to finish the merge.
- Where streams each added to a list (the AGENTS.md checks, the testing
  skill's layer table, CI jobs, `package.json` scripts, `firebase.json`
  emulators, Playwright `testMatch`), keep the union.
- Record each resolution: the file, what each side intended, what you kept.
- If a conflict is a disagreement about a contract, the Stage 1 design or an
  ADR, stop and report it to the orchestrator or owner. Do not invent a new
  architecture to reconcile the streams.

## Find semantic conflicts

A clean merge can still be wrong. Check the combined result for:

- **Duplicated implementations**: two helpers, types, schemas, seams or
  components doing the same job. Compare the exports each stream added.
- **Inconsistent data models**: a writer and a reader of the same Firestore
  document disagreeing on fields, versions or paths; rules, client
  transactions and Functions disagreeing on what is allowed.
- **Contradictory assumptions**: for example, one stream presenting a
  client-computed score as final while another makes the server
  authoritative, or one letting EEG affect something another keeps EEG-free.
- **Competing UI or state behavior**: two streams changing the same route,
  navigation entry, catalogue, store or component contract.
- **Silent reverts**: for each stream, every difference this prints must be
  explained by another stream or a recorded decision:

  ```bash
  git diff origin/<branch> HEAD -- $(git diff --name-only origin/main...origin/<branch>)
  ```

- **Stale tests**: tests pinned to behavior another stream changed, tests that
  now pass without exercising anything, and suites a stream added that the
  combined CI or Playwright `testMatch` does not run.
- **Overlapping refactors**: code one stream renamed or moved that another
  still uses the old way.
- **Stale docs and config**: the AGENTS.md checks and Running locally, the
  testing skill, CI, README and ADRs must describe the combined result, not
  one stream's.

Record each decision and its reason; the reviewer checks them.

## Fix what belongs here

- **Integration defects** exist only in the combination: a conflict
  resolution, a semantic conflict, a broken seam, a stale test, a missing
  union. They are yours. Fix them on the integration branch in their own
  commits, scoped to the card whose behavior they restore (for example
  `fix(NFCT-21): ...`), or `fix(integration): ...` when no single card owns
  the fix.
- **A defect that reproduces on a stream's branch alone** belongs to that
  stream. The orchestrator routes it to the stream's owner, who fixes and
  pushes it, and you merge the branch again. If that owner is no longer
  active, the orchestrator or user may reassign it to you; fix it on the
  integration branch and record it.
- **Out-of-scope discoveries** become
  [follow-up cards](../../../AGENTS.md#out-of-scope-work).
- A contract conflict stops the integration (see
  [Resolve conflicts by intent](#resolve-conflicts-by-intent)).

## Validate the combined result

Run every gate that applies, in this order. After any fix, repeat the gates
the fix could affect.

1. **Deterministic suite.** Following the
   [testing skill](../neurasticity-development-testing/SKILL.md), run in the
   integration worktree every command in the *merged* AGENTS.md
   [Checks](../../../AGENTS.md#checks) and every job in the merged
   `.github/workflows/ci.yml`, with the installs each needs. Confirm CI
   discovers every new Playwright spec (the `--list` check in
   [Stage 1 test coverage](../../../AGENTS.md#stage-1-test-coverage)). Where
   behavior crosses streams and no stream's tests cover it, add a
   deterministic test at the lowest layer that observes it.
2. **Exploratory QA**, when any stream changes what users see or do. Hand the
   integration head to [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md)
   with the streams, cards, SHAs, your semantic decisions and the risk areas
   you found. It returns in-scope defects to you as the branch owner; fix them
   and have QA re-run the affected scenarios.
3. **Independent review.** With the integration PR open (see
   [Open the integration PR](#open-the-integration-pr)), request
   [nfct-pr-review](../nfct-pr-review/SKILL.md), plus
   [nfct-security-review](../nfct-security-review/SKILL.md) when any stream
   touches its triggers. Name the stream PRs already reviewed at the SHAs you
   merged, so review can concentrate on merge resolutions, integration commits
   and cross-stream boundaries while its verdict covers the whole PR. Fix the
   findings; the reviewer re-verifies them.
4. **CI.** Wait for GitHub CI on the final head (`gh pr checks <n> --watch`).
   Investigate a failure rather than re-running until green; a flaky test is
   a finding.

Start QA and the reviewers as separate agents where your tooling allows;
otherwise ask the orchestrator or user to start them, with the brief above.
Reviewers must never be the integrator. If you run QA yourself, say so in the
report.

## Open the integration PR

Once the deterministic suite passes, push the integration branch
(`git push -u origin HEAD`) and open one draft PR against `main`. Title it
with the objective and its cards, list the stream PRs it supersedes, and keep
the [report](#report) in its body current. Mark it ready for review once every
gate has passed.

## Hand off and clean up

- Do not merge the integration PR: you implemented it. The owner does the
  remaining human checks and merges. Recommend a merge commit rather than a
  squash; it keeps each stream's commits and SHAs, so the stream branches pass
  the merged check in
  [nfct-worktrees](../nfct-worktrees/SKILL.md#clean-up-a-task-worktree).
- A stream PR that GitHub does not mark merged, such as one based on another
  stream's branch, is closed as superseded with a link to the integration PR,
  by the owner, or by you when delegated.
- Remove the review, QA and probe worktrees you created, stop the emulators
  and dev servers you started, and delete scratch files. Keep the integration
  worktree while its PR is open. After the merge, clean it and the stream
  worktrees up per
  [nfct-worktrees](../nfct-worktrees/SKILL.md#clean-up-a-task-worktree).

## Independent PRs

Only when the user explicitly asks for separate PRs:

- Test the combination in a disposable
  [integration check](../nfct-worktrees/SKILL.md#integration-worktrees),
  merging the streams in their intended merge order, and run the same
  validation gates. Never push it.
- Conflicts and defects go back to each stream's owner as findings. They fix
  and push their own branches, and you re-check in a fresh integration check.
- Each PR is reviewed and merged on its own, in the recorded order. The
  objective is complete only when the combined check has passed at the heads
  that will merge.

## Report

Give one concise report, in the PR body and in your final message:

- **Streams integrated**: card, PR, head SHA merged, and the merge order.
- **Result**: the integration branch, PR URL and final head SHA.
- **Conflicts**: the file, what each side intended, and the resolution.
- **Semantic decisions**: what you found, what you decided and why.
- **Tests**: commands run and results, and coverage added.
- **Reviewer findings**: by severity, with resolutions and the verdict.
- **Exploratory QA**: the QA summary, and its FAIL and BLOCKED rows.
- **Human verification**: the HUMAN CHECK items left for the owner.
- **Follow-ups**: cards filed or proposed, and anything unresolved.
- **Merge readiness**: *merge-ready* (every gate passed at `<sha>` and CI is
  green; only the listed human checks remain) or *not ready*, with what
  blocks it.
