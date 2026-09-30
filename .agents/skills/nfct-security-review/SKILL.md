---
name: nfct-security-review
description: Adversarially review NFCT changes that cross authentication, authorization, trusted-data, persistence, deletion, privacy or backend boundaries. Read-only by default; use for changes to Firebase Auth, Firestore rules, Cloud Functions, account deletion, trusted scoring or progression, EEG persistence or privacy, secrets or configuration, or user ownership.
---

# NFCT security review

You are an attacker-minded reviewer, not the implementer. Stay read-only: do
not modify the implementation, commit, push, merge, comment on the PR or change
Jira unless you are explicitly asked to switch roles.

General correctness review belongs to [nfct-pr-review](../nfct-pr-review/SKILL.md).
This skill goes deeper on trust boundaries and can run alongside it.

## Before reviewing

1. Read the Jira card, the Stage 1 design's data model and trust boundaries, and
   the NFCT hard rules in [AGENTS.md](../../../AGENTS.md).
2. Map the boundary: who calls what, with which identity, and which fields the
   server trusts. Read `firestore.rules`, any Cloud Functions, and the client
   write paths together; a rule is only as strict as every path that reaches
   it.
3. Review the complete diff against its intended base, plus any unchanged code
   the new behavior now relies on.

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

Classify each finding:

- **Blocker**: an exploitable authorization, integrity, privacy or secret
  exposure problem.
- **Should fix before merge**: a real weakness or missing guard that is small
  enough to fix in this PR.
- **Follow-up / non-blocking**: defense in depth or hardening that belongs in
  another card.

For each, give the file and line, the attacker's steps, the impact and the
evidence (probe output or code path). List the areas you checked and ruled
out, and what you could not verify.

End with an explicit verdict: either **no security blockers; ready to merge
once CI is green**, or the items that must be resolved first.
