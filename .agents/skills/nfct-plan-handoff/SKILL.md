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
implementation prompt begins with `/nfct-orchestration` instead of designing
the topology here. One stream is the default. Several files, bullets or
acceptance criteria are not a reason to orchestrate.

## Decide the execution strategy

Settle these now, from AGENTS.md and the review, security and testing skills,
so the implementation agent does not re-decide them. Apply existing policy;
do not weaken a required gate, and do not add a reviewer, tester or suite the
routing does not justify.

- **Orchestration:** yes only for genuinely independent streams
  ([nfct-orchestration](../nfct-orchestration/SKILL.md)); otherwise no.
- **Primary model and effort,** for the agent that receives the prompt: the
  lightest that reliably executes this plan, judged on remaining judgment,
  architectural uncertainty, risk boundaries and how mechanical execution
  now is, not on task size. For an orchestrator, which owns decomposition,
  routing and integration, strongly prefer Opus at High effort unless a
  concrete task-specific reason makes a lighter setting sufficient.
- **Review:** whether an independent correctness review is required, the
  security tier ([which PRs get review](../../../AGENTS.md#which-prs-get-review),
  [security tier](../nfct-orchestration/SKILL.md#security-tier)), the scope
  (full PR review, targeted review of a named change or range, verification
  pass only, or none under policy, with the policy reason), and what the
  reviewer should focus on. Keep it proportional: a tiny docs or display
  change gets no broad review; auth, rules, persistence, migration or trusted
  scoring gets a stronger one.
- **Validation:** the local checks and test layers required, those that are
  unnecessary, whether deterministic browser tests or exploratory QA apply,
  whether a separate tester agent is warranted (exploratory QA may be the
  implementer's own recorded pass), and the hosted-CI expectation, which is
  skipped under the local-first policy unless the owner has authorized it.
- **Child-agent settings:** a spawned agent's model can be set explicitly
  (the Agent tool's `model` option). Its effort cannot be set per spawn: it
  comes from the agent type's definition, or is inherited from the parent.
  This repo defines no custom agent types. So give a model for each reviewer
  or tester, and give effort only as guidance the parent honors by choosing
  an agent type that sets it; if none does, say it inherits.

## Output

Reply with exactly these four sections and nothing else.

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

### `## Implementation prompt`

Exactly one complete prompt for a fresh implementation agent, in a single
fenced block. It is the only fenced block in the response, and the section
contains nothing outside that block, so the owner can copy it alone. Use a
longer fence if the prompt contains backticks.

The prompt is self-contained: the implementation agent has no access to this
conversation or to the sections above. It carries the decisions, constraints,
acceptance criteria and execution instructions, not the analysis.

If orchestration is warranted, the prompt's first line is exactly
`/nfct-orchestration`, followed by the task. Otherwise it does not invoke
orchestration. The prompt is for a fresh Claude Code chat:

- the goal, the Jira card if any, and the expected behavior;
- the architectural decisions from the plan, stated as decisions, and the
  relevant files and systems;
- the scope boundaries, including which follow-ups to card rather than fix;
- acceptance criteria the implementer can check;
- the validation expected before the PR is ready;
- an execution section carrying only the decisions from
  [Decide the execution strategy](#decide-the-execution-strategy), as
  applicable: orchestration yes or no; the primary model and effort; each
  required review gate with its tier, scope, focus, and reviewer model and
  effort guidance; the required and unnecessary validation; a separate tester
  or exploratory-QA agent and its model and effort guidance, if warranted;
  and the hosted-CI expectation;
- the safety limits that apply (do not repeat policy the execution section
  already carries): AGENTS.md hard rules, a task worktree per
  [nfct-worktrees](../nfct-worktrees/SKILL.md), no deploys, no hosted CI
  dispatch, PR to `development`, no self-merge;
- when the root cause is not established, an instruction to confirm it before
  changing code;
- an instruction to follow the plan unless new evidence contradicts it, and
  then to stop and report rather than redesign silently.

### `## Execution recommendation`

Exactly three lines, after the implementation prompt, not fenced (the
implementation prompt stays the response's only fenced block):

- `Model:` the Claude model.
- `Effort:` the Claude Code effort level.
- `Reason:` one concise sentence.

This is the fresh-chat configuration for the agent that receives the
prompt: the orchestrator if the prompt starts with `/nfct-orchestration`.
Choose it as in the execution strategy above. Reviewer and tester routing
belongs in the implementation prompt, not here.
