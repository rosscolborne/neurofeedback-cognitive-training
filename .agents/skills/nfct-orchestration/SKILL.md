---
name: nfct-orchestration
description: Plan, coordinate and track multi-stream NFCT work across several cards or agents through to one merge-ready result. Use when splitting an epic, objective or set of cards into parallel streams, assigning implementation, integration, testing, QA, review and security roles, or tracking parallel work to completion.
---

# NFCT orchestration

The orchestrator decomposes the objective, assigns streams and roles, tracks
dependencies and completion, and routes findings to their owners. It does not
implement streams itself unless explicitly asked. It may act as the
integrator under [nfct-integration](../nfct-integration/SKILL.md), but then it
never reviews the integrated result. Point each stream at the skill that owns
its procedure rather than restating it.

## Read first

- The Jira epic and cards, including acceptance criteria and links.
- The relevant parts of the canonical Stage 1 design and ADRs.
- [AGENTS.md](../../../AGENTS.md), including the Stage 1 test coverage table
  and the skills table, so each stream uses the skill that owns its role.
- Dependency state: which PRs are open, merged or blocked, and which
  worktrees already exist (see [nfct-worktrees](../nfct-worktrees/SKILL.md#diagnose)).

## Plan the streams

- Decide the deliverable before starting. Streams that serve one objective
  converge into one integration PR; plan independent PRs only when the user
  explicitly asks for them. Record the choice in the plan.
- Separate what is actually blocked from what can safely run in parallel. Do
  not maximize parallelism for its own sake.
- Run at most about 3–4 concurrent implementation streams, unless the tasks
  are genuinely isolated and low-conflict.
- Identify shared files and contracts (types, Firestore paths, rules,
  repository interfaces, shared UI). Avoid giving several writable streams the
  same surface; sequence them, or land the shared contract first.
- Give each writable stream its own worktree, created from the right base per
  [nfct-worktrees](../nfct-worktrees/SKILL.md#create).
- The emulator and Vite ports are fixed per machine. Schedule emulator-backed
  runs (the rules, Functions and Playwright suites, and browser QA) one at a
  time across streams.
- Keep each implementation stream scoped to its card. A stream that finds
  unrelated work hands it back as
  [out-of-scope work](../../../AGENTS.md#out-of-scope-work) instead of
  expanding scope.
- Name the integrator, and write down the dependency order and the intended
  merge order.

## Roles and hand-offs

Give each responsibility one clear owner. The reviewer of a PR is never its
implementer or integrator.

| Role | Skill | Hand-off |
| --- | --- | --- |
| Orchestration | This skill | The stream plan, each stream's state, and findings routed to their owners |
| Implementation | [nfct-worktrees](../nfct-worktrees/SKILL.md), [testing](../neurasticity-development-testing/SKILL.md), plus [nfct-frontend-design](../nfct-frontend-design/SKILL.md) for user-facing work | A pushed branch or PR with targeted tests and the AGENTS.md completion report |
| Integration | [nfct-integration](../nfct-integration/SKILL.md) | One integration PR and its integration report |
| Deterministic testing | [testing](../neurasticity-development-testing/SKILL.md) | Tests in the PR, with commands and results. Usually the implementer or integrator; a separate stream for cross-card journeys such as NFCT-10 |
| Exploratory QA (user-facing work) | [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md) | QA report: scenario results, evidence, and the remaining human checks |
| Independent review | [nfct-pr-review](../nfct-pr-review/SKILL.md) | Classified findings and a verdict |
| Security review (trust, auth or data boundaries) | [nfct-security-review](../nfct-security-review/SKILL.md) | Classified findings and a verdict |
| Follow-up cards | [Out-of-scope work](../../../AGENTS.md#out-of-scope-work) | Cards filed by the orchestrator |
| Human checks and merge | The owner | The merge decision |

## Phases

When streams serve one objective, every applicable phase happens. The order
changes only where dependencies require it.

| Phase | Owner |
| --- | --- |
| 1. Decompose into streams and assign roles | Orchestrator (this skill) |
| 2. Implement each stream in its own worktree, with targeted tests and, for UI, self-QA | Implementers |
| 3. Integrate the finished streams into one branch | Integrator ([nfct-integration](../nfct-integration/SKILL.md)) |
| 4. Run the combined deterministic suite | Integrator, per the [testing skill](../neurasticity-development-testing/SKILL.md) |
| 5. Exploratory QA, where the work is user-facing | [nfct-exploratory-qa](../nfct-exploratory-qa/SKILL.md) |
| 6. Independent review, and security review where triggered | [nfct-pr-review](../nfct-pr-review/SKILL.md), [nfct-security-review](../nfct-security-review/SKILL.md) |
| 7. CI green on the integration PR's final head | Integrator |
| 8. Targeted human visual and hardware checks | Owner, from the QA report's HUMAN CHECK items |
| 9. Merge | Owner |

- Review of a single stream before integration is optional, for risky
  streams. Security review can start as soon as a boundary change is clear
  from the design. Neither replaces review of the integrated result.
- A fix goes to the owner of the branch where the defect lives: a stream's
  implementer, or the integrator for integration defects (see
  [nfct-integration](../nfct-integration/SKILL.md#fix-what-belongs-here)). The
  role that raised the finding re-verifies it.
- Work moves back to an earlier phase only as a fix and its re-verification.

## Completion

Every stream returning successfully does not complete the objective. Report
the objective complete only when:

- the integration report says merge-ready or, for independent PRs, the
  combined check has passed at the heads that will merge and each PR is
  merge-ready;
- every applicable phase above has passed on the final head;
- the remaining human checks and follow-up cards are listed.

Until then, report it as in progress, naming the current phase and what
blocks it. Merging to `main` is the owner's decision. The orchestrator merges
only when explicitly delegated, and never a PR it implemented or integrated.

## Reshape when contracts change

If an upstream contract changes (a type, path, rule or interface), pause the
downstream streams that depend on it. Reassess their plans, have their owners
rebase them, or stop them, rather than letting them finish against a stale
contract. Once integration has merged a stream, its owner adds fixes as new
commits instead of rebasing (see
[nfct-integration](../nfct-integration/SKILL.md#inventory-the-streams)).

## Report

Give the stream plan (cards, owners, worktrees, dependencies, merge order),
the state of each stream and the current phase, the integration report or a
link to it, open findings by severity, follow-up cards, the remaining human
checks, and what remains blocked. Once work is merged, have stale worktrees
cleaned up per [nfct-worktrees](../nfct-worktrees/SKILL.md#clean-up-a-task-worktree).
