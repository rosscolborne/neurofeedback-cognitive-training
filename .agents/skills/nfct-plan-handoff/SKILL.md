---
name: nfct-plan-handoff
description: Plan one NFCT task against the repository and produce a copyable prompt for a separate implementation agent. Manual only; run it when the user invokes it by name, never on your own initiative.
argument-hint: "<task, Jira card key or description>"
disable-model-invocation: true
---

# NFCT plan and handoff

Plan the task the user named when invoking this skill, then hand it off. You
are the planner, not the implementer. If no task was given, ask for one and
stop.

## Stay read-only

- Do not edit files, create branches or worktrees, commit, push, open PRs,
  deploy, dispatch hosted workflows or change Jira.
- Start no other agents. Plan in this session.
- Do not run test suites or the app. Where the plan rests on something you
  could not confirm by reading, say so; the implementer verifies it.

## Inspect only what the task needs

1. If a Jira card is named, read it: its acceptance criteria are the contract.
2. Read the parts of [AGENTS.md](../../../AGENTS.md) that bear on the task:
   [hard rules](../../../AGENTS.md#hard-rules),
   [working on a card](../../../AGENTS.md#working-on-a-card),
   [which PRs get review](../../../AGENTS.md#which-prs-get-review),
   [proportional validation](../../../AGENTS.md#proportional-validation) and
   [hosted CI](../../../AGENTS.md#hosted-ci). Read an ADR or `docs/nfct/` page
   only when the task touches what it governs.
3. Find the code the task touches with targeted searches, and read those
   files and their direct callers and tests. Do not survey the repo.
4. For a bug, look for the root cause. If you cannot establish it by reading,
   record the leading hypothesis and how the implementer should confirm it.

If the task conflicts with a hard rule, an ADR or the card's contract, say so
in the plan instead of planning around it.

## Keep the plan proportional

Plan the smallest change that meets the task. Do not add process, abstraction
or hardening it does not need. Recommend parallel streams only when the work
has independent parts large enough to justify an integration step; then the
handoff names [nfct-orchestration](../nfct-orchestration/SKILL.md) instead of
designing the topology here. One stream is the default.

## Output

Reply with exactly these three sections and nothing else.

### `## Plan`

Concise, but enough to implement from:

- the relevant current architecture, with file paths;
- the recommended approach, and why over the obvious alternative if one
  exists;
- the files and systems likely affected;
- sequencing and dependencies;
- the risks and edge cases that matter;
- validation: which test layers
  ([neurasticity-development-testing](../neurasticity-development-testing/SKILL.md)),
  whether exploratory QA applies, the likely review routing and security tier,
  and any owner action such as a native `ios.yml` scenario or a deploy;
- whether parallel workstreams are worth it, in one line.

### `## Scope boundaries`

- In scope.
- Out of scope.
- Follow-ups to card rather than fold in
  ([out-of-scope work](../../../AGENTS.md#out-of-scope-work)), each with a
  one-line summary. List them; do not file them.

### `## Implementation handoff`

One prompt in a single fenced block, written for a fresh agent with no access
to this conversation. Use a longer fence if the prompt contains backticks.
It carries the decisions, not the analysis:

- the goal, the Jira card if any, and the expected behavior;
- the architectural decisions from the plan, stated as decisions, and the
  relevant files and systems;
- the scope boundaries, including which follow-ups to card rather than fix;
- acceptance criteria the implementer can check;
- the validation expected before the PR is ready;
- the safety limits that apply: AGENTS.md hard rules, a task worktree per
  [nfct-worktrees](../nfct-worktrees/SKILL.md), no deploys, no hosted CI
  dispatch, PR to `development`, no self-merge;
- when the root cause is not established, an instruction to confirm it before
  changing code;
- an instruction to follow the plan unless new evidence contradicts it, and
  then to stop and report rather than redesign silently.
