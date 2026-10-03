---
name: nfct-orchestration
description: Plan, coordinate and track multi-stream NFCT work across several cards or agents through integration into one validated PR, owning agent topology, review and security-tier routing, and bounded convergence. Use when splitting an epic, objective or set of cards into parallel streams, assigning implementation, integration, testing, QA, review and security roles, choosing review depth, or tracking parallel work to completion or a checkpoint. Also use as a solo agent with no separate orchestrator whose task ends in a PR that needs review or security routing, including cleanup or removal PRs: you route that PR and start its reviewers.
---

# NFCT orchestration

The orchestrator decomposes the objective, assigns streams and roles, tracks
dependencies and completion, and routes findings to their owners. It owns
agent topology and review routing, and it keeps review within the
[bounded review](../../../AGENTS.md#bounded-review) budget. In multi-stream
work it does not implement streams itself unless explicitly asked. It may act
as the integrator under [nfct-integration](../nfct-integration/SKILL.md), but
then it never reviews the integrated result. Point each stream at the skill that owns
its procedure rather than restating it.

A solo agent whose task ends in a PR holds this role for that PR
([bounded review](../../../AGENTS.md#bounded-review)): apply
[review routing](#review-routing), the [security tier](#security-tier) and
[agent topology](#agent-topology) to it, and skip stream planning and
integration. You implemented the change, so start a separate reviewer; never
review it yourself. Exploratory QA may be your own recorded pass. Your
completion is the AGENTS.md
[ready checkpoint](../../../AGENTS.md#ready-checkpoint), not
[Completion](#completion) below.

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
- The emulator and Vite ports are fixed, so each environment needs its own
  network. On Linux, give each stream and each QA agent its own
  [QA lane](../../../AGENTS.md#parallel-agents-qa-lanes), named after it, and
  tell it to `down` the lane when it finishes. Emulator-backed runs (the
  rules, repository, Functions and Playwright suites, and browser QA) then run
  in parallel across lanes, one at a time within a lane. Without lanes,
  schedule them one at a time across streams.
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
| Independent review | [nfct-pr-review](../nfct-pr-review/SKILL.md) | Labelled findings and a verdict |
| Security review, at the [routed tier](#security-tier) | [nfct-security-review](../nfct-security-review/SKILL.md); LIGHT is part of the independent review | The tier, labelled findings and a verdict |
| Follow-up cards | [Out-of-scope work](../../../AGENTS.md#out-of-scope-work) | Cards filed by the orchestrator |
| Human checks and merge | The owner | The merge decision |

## Review routing

You choose the review gates and their depth; reviewers do not. Each gate runs
within the [review budget](../../../AGENTS.md#review-budget).

- The integration PR, each independent PR, or a solo task's PR is routed per
  [which PRs get review](../../../AGENTS.md#which-prs-get-review): one
  independent review and one security review at its tier, or a recorded
  reason to skip.
- A single stream gets its own review before integration only when it is
  risky on its own.
- User-facing work gets exploratory QA.

### Security tier

Route each reviewed PR to LIGHT, STANDARD or DEEP using the
[tier table](../nfct-security-review/SKILL.md#review-tiers):

- Judge what the change does, not which files it touches: a comment in
  `firestore.rules` is LIGHT, a new `allow` is DEEP.
- Between adjacent tiers, choose the lower unless a missed defect would be
  materially harmful: cross-user exposure, an auth or rules bypass, secret
  leakage, irreversible deletion, or exposure of EEG or health data.
- For an integration PR, route by what integration adds: merge resolutions,
  integration commits and cross-stream boundaries. Streams already
  security-reviewed at the merged SHAs keep their result.
- Use the tier the user asks for. If it is lower than this routing would
  choose, say so in the report.
- If a reviewer reports that the tier is too low, decide whether to run the
  higher tier. That review then becomes the gate's one security review.

Record the choice in the plan and the PR body as two short lines:

```text
Security review: STANDARD
Reason: repository writes + offline persistent cache; no auth or rules changes.
```

A PR that skips review records that instead, for example
`Review: skipped (docs-only)`.

## Agent topology

You decide which agents exist, what each does and when each stops
([agent topology](../../../AGENTS.md#agent-topology)).

- Plan the agents with the streams: the implementers (see
  [Plan the streams](#plan-the-streams)) and one integrator, then, for each
  reviewed PR, one independent reviewer, one security reviewer for STANDARD
  or DEEP, and one QA agent for user-facing work.
- Brief every agent with its role, scope and, for reviewers, its tier, and
  tell it to start no agents and to return its findings to you.
- Give a verification pass to the agent that raised the findings, resuming it
  where your tooling allows; otherwise brief a fresh agent with only the
  findings and the fix commits.
- Delegate starting agents only explicitly, naming which ones, for example
  letting the integrator start its QA and reviewers.
- More reviewers is not more safety. Add an agent only for a distinct risk
  that no planned gate covers, and count it against the plan.

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
| 6. Independent review, and security review at the [routed tier](#security-tier) | [nfct-pr-review](../nfct-pr-review/SKILL.md), [nfct-security-review](../nfct-security-review/SKILL.md) |
| 7. Pre-merge validation green on the integration PR's final head: a merge gate, run by hand ([CI](../../../docs/nfct/ci.md)) and reported rather than waited for | Integrator reports whether it has run; whoever merges confirms it |
| 8. Targeted human visual and hardware checks | Owner, from the QA report's HUMAN CHECK items |
| 9. Merge | Owner |

- Review of a single stream before integration is optional, for risky
  streams. Security review can start as soon as a boundary change is clear
  from the design. Neither replaces review of the integrated result.
- A fix goes to the owner of the branch where the defect lives: a stream's
  implementer, or the integrator for integration defects (see
  [nfct-integration](../nfct-integration/SKILL.md#fix-what-belongs-here)). The
  role that raised the finding verifies the fix within the
  [review budget](../../../AGENTS.md#review-budget).
- Work moves back to an earlier phase only as a fix and its verification.
  FOLLOW-UP findings go to cards, never to another fix round.
- Fix rather than card a finding only with a concrete near-term
  justification: a user-visible failure, a realistic security, privacy or
  data-loss risk, a likely blocker to upcoming work, or a substantial gain in
  safe development velocity. Otherwise card it and continue
  ([prioritization](../../../AGENTS.md#prioritization)).

## Convergence and checkpoints

- Track, for each PR, the review rounds, the agents started and the full-suite
  runs against the plan.
- After each gate's verification pass, apply the
  [review budget](../../../AGENTS.md#review-budget) outcomes; do not start a
  fresh review because a fix landed.
- When a [checkpoint](../../../AGENTS.md#checkpoints) condition is met, start
  nothing new, let running agents finish their current task or stop them, and
  report the checkpoint with each stream's state.
- In [deep audit mode](../../../AGENTS.md#deep-audit-mode), which only the
  user can request, announce it, keep each extra pass inside the requested
  scope, and still start every agent yourself.

## Completion

Every stream returning successfully does not complete the objective, and
neither does a search for every possible improvement. The orchestration's
agent work is complete when:

- the requested functionality is implemented and integrated: the integration
  report says its agent work is complete or, for independent PRs, the
  combined check has passed at the heads that will merge;
- the applicable tests pass, and the final head's CI (7) state is reported;
- phases 4–6 have passed, with QA and the selected reviews finished within
  their budget and no BLOCKER open;
- open SHOULD-FIX and FOLLOW-UP findings are carded, and the remaining human
  checks are listed.

Report merge readiness separately, as
[completion and merge readiness](../../../AGENTS.md#completion-and-merge-readiness) defines it: with CI pending, the
objective is *not yet* merge-ready, and you do not wait for CI. Until the agent
work is complete, report the objective as in progress, naming the current
phase and what blocks it.

Merging into `development` is the owner's decision. The orchestrator merges only when
explicitly delegated, never a PR it implemented or integrated, and only after
confirming Pre-merge validation is green on the head being merged.

## Reshape when contracts change

If an upstream contract changes (a type, path, rule or interface), pause the
downstream streams that depend on it. Reassess their plans, have their owners
rebase them, or stop them, rather than letting them finish against a stale
contract. Once integration of a stream has started, its owner adds fixes as
new commits instead of rebasing (see
[nfct-integration](../nfct-integration/SKILL.md#inventory-the-streams)).

## Report

Give the stream plan (cards, owners, worktrees, dependencies, merge order),
the state of each stream and the current phase, the security tier and reason
for each reviewed PR, the review rounds, agents and full-suite runs used
against the plan, the integration report or a link to it, CI state and merge
readiness, open findings by severity, follow-up cards, the remaining human
checks, and what remains blocked. At a checkpoint, also give why execution
stopped and the recommended next action. Once work is merged, have stale
worktrees cleaned up per
[nfct-worktrees](../nfct-worktrees/SKILL.md#clean-up-a-task-worktree).
