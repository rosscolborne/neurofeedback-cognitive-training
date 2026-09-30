---
name: nfct-orchestration
description: Plan, coordinate and integrate multi-stream NFCT work across several cards or agents. Use when splitting an epic or set of cards into parallel streams, assigning implementation, review, testing, QA and security roles, or integrating completed branches.
---

# NFCT orchestration

The orchestrator plans and coordinates; it does not implement every stream
itself unless explicitly asked. Point each stream at the skill that owns its
procedure rather than restating it.

## Read first

- The Jira epic and cards, including acceptance criteria and links.
- The relevant parts of the canonical Stage 1 design and ADRs.
- [AGENTS.md](../../../AGENTS.md), including the Stage 1 test coverage table
  and the skills table, so each stream uses the skill that owns its role.
- Dependency state: which PRs are open, merged or blocked, and which
  worktrees already exist (see [nfct-worktrees](../nfct-worktrees/SKILL.md#diagnose)).

## Plan the streams

- Separate what is actually blocked from what can safely run in parallel. Do
  not maximize parallelism for its own sake.
- Run at most about 3–4 concurrent implementation streams, unless the tasks
  are genuinely isolated and low-conflict.
- Identify shared files and contracts (types, Firestore paths, rules,
  repository interfaces, shared UI). Avoid giving several writable streams the
  same surface; sequence them, or land the shared contract first.
- Give each writable stream its own worktree, created from the right base per
  [nfct-worktrees](../nfct-worktrees/SKILL.md#create).
- Keep each implementation stream scoped to its card. A stream that finds
  unrelated work hands back a Jira-ready follow-up instead of expanding scope.
- Write down the dependency order and the intended merge order.

## Roles and hand-offs

Give each responsibility one clear owner. The reviewer of a PR is never its
implementer.

| Role | Skill | Hand-off |
| --- | --- | --- |
| Implementation | [nfct-worktrees](../nfct-worktrees/SKILL.md), [testing](../neurasticity-development-testing/SKILL.md), plus [nfct-frontend-design](../nfct-frontend-design/SKILL.md) for user-facing work | PR with targeted tests and the AGENTS.md completion report |
| Deterministic testing | [testing](../neurasticity-development-testing/SKILL.md) | Tests in the PR, with commands and results. Usually the implementer; a separate stream for cross-card journeys such as NFCT-10 |
| Independent review | [nfct-pr-review](../nfct-pr-review/SKILL.md) | Classified findings and a verdict |
| Integration | This skill, [Integrate](#integrate) | Integrated branch or rebased PRs, full-suite results |
| Exploratory QA (user-facing work) | [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md) | Findings report, including what was not tested |
| Security review (trust, auth or data boundaries) | [nfct-security-review](../nfct-security-review/SKILL.md) | Classified findings and a verdict |

## Pipeline

For larger parallel work, the expected order is:

1. isolated worktrees;
2. targeted implementation tests;
3. independent review;
4. integration and rebase;
5. the full relevant CI and test suite;
6. exploratory browser QA where the work is user-facing;
7. security review where trust, auth or data boundaries are involved;
8. fixes, made by the implementer in the original worktree;
9. re-verification by the role that raised each finding.

Security review can start earlier, alongside independent review, when a
boundary change is clear from the design.

## Integrate

- Combine completed branches in dependency order: rebase each downstream
  branch onto its upstream (or onto `origin/main` once the upstream merges),
  or build a temporary integration branch in its own worktree to test the
  combination.
- Resolve conflicts by the architecture and contracts, not just by making Git
  happy. If a conflict reveals a contract disagreement, stop and report it.
- Check that no branch undid another: compare each branch's intended change
  with the combined diff (`git range-diff`, `git diff origin/main...HEAD`).
- Run the full relevant suite from [Checks](../../../AGENTS.md#checks) on the
  combined result, not only each branch's targeted tests.
- Verify the shared boundaries between features, such as a writer and reader
  of the same document, or rules and client transactions.
- Check [hand-off hygiene](../nfct-worktrees/SKILL.md#hand-off-hygiene) on
  every branch before final merge.
- Hand the integrated result to independent review, exploratory QA and
  security review as their triggers apply.

Merging to `main` is the owner's decision unless they delegate it.

## Reshape when contracts change

If an upstream contract changes (a type, path, rule or interface), pause the
downstream streams that depend on it. Reassess their plans, rebase them, or
stop them, rather than letting them finish against a stale contract.

## Report

Give the stream plan (cards, owners, worktrees, dependencies, merge order), the
current state of each stream, open findings by severity, follow-ups raised, and
what remains blocked. Once work is merged, have stale worktrees cleaned up per
[nfct-worktrees](../nfct-worktrees/SKILL.md#clean-up).
