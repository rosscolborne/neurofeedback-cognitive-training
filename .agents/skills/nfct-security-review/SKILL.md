---
name: nfct-security-review
description: Adversarially review NFCT changes for security at a risk-routed tier (LIGHT, STANDARD or DEEP), each with an explicit stopping point. Read-only by default; use for changes to Firebase Auth, Firestore rules, Cloud Functions, account deletion, trusted scoring or progression, EEG persistence or privacy, secrets or configuration, or user ownership, and when asked for a security review, security hardening or an adversarial audit. Implementers never run it on their own change: if your diff adds, changes or removes one of these boundaries and no separate orchestrator exists, you hold the orchestrator role and must have a separate reviewer run it at the routed tier before your task is complete.
---

# NFCT security review

You are an attacker-minded reviewer, not the implementer. Stay read-only: do
not modify the implementation, commit, push, merge, comment on the PR or change
Jira unless you are explicitly asked to switch roles.

General correctness review belongs to [nfct-pr-review](../nfct-pr-review/SKILL.md).
This skill goes deeper on trust boundaries and can run alongside it.

Review at the tier you were given. You start no other agents
([agent topology](../../../AGENTS.md#agent-topology)): if the change needs a
higher tier, say so at the top of your findings with the reason, carry on at
your tier, and let whoever started you decide.

## Review tiers

The orchestrator routes each change to a tier by its actual risk and records
why ([security tier](../nfct-orchestration/SKILL.md#security-tier)). DEEP is
not the default.

| Tier | Use for | Run by |
| --- | --- | --- |
| **LIGHT** | Docs and agent instructions, tests, CI and config that handle no secrets or deploy targets, styling, isolated UI, refactors that move no trust boundary, and feature logic the server does not trust | Normally the independent reviewer, in its [nfct-pr-review](../nfct-pr-review/SKILL.md) pass |
| **STANDARD** | Persistent data and repositories, backend writes, Cloud Functions and trusted scoring or progression within the existing trust model, account state, features that rely on existing permissions, Firebase and Firestore integration, offline storage, user-generated data, ordinary auth-adjacent behavior | A separate security reviewer. The default for security-relevant product work |
| **DEEP** | Material changes to authentication, authorization, Firestore rules, what the server trusts from the client, consent and privacy boundaries, account deletion, exposure of EEG or other health data, secrets and credentials (including `firebaseConfig.ts` failing closed and clinical isolation), admin capabilities, cross-user isolation, or release and signing security | A separate security reviewer |

### LIGHT

A sanity check, not an attack-surface review. Check the diff for:

- secrets, keys, tokens or service-account material, in code, config,
  fixtures, logs or the client bundle;
- configuration that fails open or can reach a real project: a default
  Firebase project, Waveable config, emulator flags reachable in production
  builds, `firebaseConfig.ts` no longer failing closed, or
  `npm run check:isolation` failing;
- dangerous scripts or CI: deploy steps, destructive commands, broader
  workflow permissions, secrets exposed to untrusted pull requests or logs;
- an accidental auth or data-boundary change: new or changed Firestore paths,
  rules, Functions, writes, ownership fields or EEG handling. If you find one,
  the tier is too low; say so.

Stop once those are checked. Do not map trust boundaries or write exploit
probes; at most, run a quick check to confirm a suspected problem.

### STANDARD

A normal adversarial review of the boundaries the change touches.

1. Map each touched boundary: who calls what, with which identity, and which
   fields the server trusts. Read the changed client paths together with the
   rules and Functions they reach; a rule is only as strict as every path that
   reaches it.
2. Apply the [review areas](#review-areas) that bear on those boundaries, as
   realistic failure modes: what a signed-in user, a second user or a retrying
   client can actually do.
3. [Probe](#probing) where a probe would confirm or rule out a finding.

Stop when every touched boundary is mapped and every applicable review area is
checked or ruled out. Go into unchanged code only as far as the change relies
on it.

### DEEP

An exhaustive, adversarial review of the affected boundaries.

1. Everything STANDARD does, across each whole affected boundary: every
   `allow` that matches the affected documents, every write path that reaches
   them (client, Functions, deletion), and the unchanged code the change now
   relies on.
2. Work through realistic abuse cases for each boundary, using every review
   area, and try to break each assumption the design states.
3. Probe each abuse case that reading the code cannot settle.

Stop when every abuse case for the affected boundaries has been probed or
ruled out with reasons. DEEP is exhaustive within the change's boundaries, not
across the product, unless the user asked for a product-wide
[deep audit](../../../AGENTS.md#deep-audit-mode).

## Before reviewing

1. Read the Jira card and the NFCT hard rules in [AGENTS.md](../../../AGENTS.md)
   and, for STANDARD and DEEP, the Stage 1 design's data model and trust
   boundaries.
2. Review the complete diff against its intended base, plus any unchanged code
   the new behavior now relies on. For an
   [integration PR](../nfct-integration/SKILL.md), concentrate on what
   integration adds: merge resolutions, integration commits and the boundaries
   where streams meet, which can open even when each stream passed on its own.
   A stream already security-reviewed at the merged SHA need not be reviewed
   again at that depth.

## Review areas

- Authentication confused with authorization: a signed-in user is not an
  authorized one.
- Cross-user reads and writes, and a path UID that does not match the stored
  `userId` or owner field.
- Forged client fields: timestamps, owner IDs, versions, server-only status.
- Client-derived scores, progression, unlocks or achievements that the server
  trusts without re-deriving or bounding them. EEG must never drive these.
- Mass assignment: unknown or extra fields accepted on create or update.
- Privilege escalation through role, flag or ownership fields.
- Rules that look strict but are bypassed by another matching `allow`, a
  broader wildcard match, or a different write path.
- Retry and idempotency abuse: replayed or duplicated writes that grant
  rewards twice or corrupt counters.
- Malformed, oversized or replayed requests to rules and Functions.
- Incomplete deletion: data left behind in other collections, storage or
  derived records after account deletion.
- Information leakage through errors, list queries, existence checks or logs.
  Treat EEG recordings and derived signals as sensitive personal data.
- Secrets, keys or service-account material committed or exposed to the
  client bundle.
- Unsafe fallbacks: failing open when config, auth or a check is missing.
  `src/services/firebaseConfig.ts` must keep failing closed.
- Emulator and production configuration mistakes: emulator flags reachable in
  production builds, or tests or scripts able to reach a real project.

## Probing

Write realistic exploit and probe tests where they would confirm or rule out a
finding: rules cases with `@firebase/rules-unit-testing` beside
`tests/firestore-rules/`, Functions emulator calls, or browser probes against
the local emulators. Run them only against local emulators and test
environments. Never probe real users, a deployed Firebase project or any
production service, and never run destructive tests outside the emulators.

Never write probes into the implementer's worktree or the primary checkout. Put
them, and any test runs that write output, in a detached
[review worktree](../nfct-worktrees/SKILL.md#review-worktrees) at the PR head,
and remove it when the review ends. Never commit or push probes unless you are
explicitly switched into an implementation role. If one
should become a permanent regression test, recommend it in the findings.

## Findings

Label each finding with the [severities](../../../AGENTS.md#finding-severity)
every reviewer uses:

- **BLOCKER**: a realistic, exploitable problem in this change: cross-user
  exposure, an auth or rules bypass, secret leakage, an unauthorized or
  incomplete destructive action, sensitive-data exposure, or forged data that
  the server trusts.
- **SHOULD-FIX**: a real weakness the change introduces with limited impact or
  narrow preconditions, such as a missing size or field check behind otherwise
  correct ownership rules, small enough to fix in this PR.
- **FOLLOW-UP**: defense in depth, hardening with no realistic attack path in
  the app as built, and weaknesses that predate the change and that it does
  not make worse. Mark a serious pre-existing one urgent, so it is carded with
  priority.

Exploitable means you can name the attacker (anonymous, signed in, another
user, a retrying client), what they control, their steps and the impact in the
app as built. A weakness with no such path is hardening: FOLLOW-UP. The
exception is a plausible path in a protected category (cross-user exposure, an
auth or rules bypass, secret leakage, a destructive action or sensitive-data
exposure) that you could neither confirm nor rule out: it keeps the severity it
would have if real, marked unverified, with the probe that would settle it.
Budget limits never downgrade these categories.

For each finding, give the file and line, the attacker's steps, the impact and
the evidence (probe output or code path). List the areas you checked and ruled
out, and what you could not verify.

Not every possible improvement is a blocker. Once your tier's stopping point
is reached, stop looking: report remaining ideas briefly, grouped, as
FOLLOW-UP hardening.

## Verification pass

When asked to verify fixes, prove each prior finding resolved with the least
evidence that shows it: rerun the probe or test that demonstrated it, or the
regression test that replaced it, and read the fix diff for a new hole,
including fixes for other gates' findings that touch a boundary. Do not
repeat the audit at your tier. Report any BLOCKER you happen to see; label
anything else new FOLLOW-UP. Give each prior finding's status.

## Verdict

State the tier you reviewed at, then end with an explicit verdict: either
**no security blockers; ready to merge** (hosted Pre-merge validation is
the owner's step), or the BLOCKER and
SHOULD-FIX items to fix first. After a verification pass, only an open BLOCKER
keeps the verdict at not ready; list any SHOULD-FIX still open.
