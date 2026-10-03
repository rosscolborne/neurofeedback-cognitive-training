---
name: nfct-worktrees
description: Create, hand off and clean up isolated NFCT task, review, QA and integration worktrees and branches safely. Use when starting writable work on a card, setting up a reviewer's or exploratory QA's worktree, an integration branch or an integration check, finishing or handing off a PR, or diagnosing and removing stale worktrees.
---

# NFCT worktrees

This skill owns the lifecycle of worktrees: creating them, keeping them tidy for
hand-off, and removing them once their work is done.

Commands below use `$PRIMARY`, the primary checkout. Git always lists it first,
so derive it rather than hardcoding a path. Shell state does not persist
between agent tool calls, so define it in the same command or block that uses
it. This form works from any worktree and keeps spaces in paths:

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
```

## When a worktree is needed

- Independent writable work (a card, a PR, a review-fix stream) gets its own
  branch and worktree whenever other work may run in parallel, which is the
  normal case here.
- Read-only planning, review, Jira work and analysis do not need one. A
  reviewer who wants temporary probe files, or an independent QA pass that
  runs the app, uses a [review or QA worktree](#review-worktrees); an
  integrator uses an [integration worktree](#integration-worktrees).
- The primary checkout is shared. Do not switch its branch or do task work in
  it while other streams are running.
- Never modify another agent's active worktree, branch or uncommitted work.

## Create

Use predictable names from the Jira card: branch `<type>/<CARD>-<slug>`
(`feature/`, `fix/`, `chore/`, `docs/`) and a sibling worktree
`$PRIMARY-<CARD>`. For work with no card, use a short task slug instead of
`<CARD>`. Integration branches have their own names; see
[Integration worktrees](#integration-worktrees).

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$PRIMARY" fetch origin
git -C "$PRIMARY" worktree add --no-track -b feature/NFCT-18-firestore-rules \
  "$PRIMARY-NFCT-18" origin/development
```

Base on current `origin/development` unless the card depends on an unmerged branch;
then base on that branch's `origin/` ref and say so in the PR. Never base on
whatever another feature worktree happens to have checked out. `--no-track`
stops the branch tracking `origin/development`; set its own upstream on first push
with `git push -u origin HEAD`. A new worktree has no `node_modules`; run
`npm ci --legacy-peer-deps` in it before running checks.

Check the base before the first commit:

```bash
git log --oneline origin/development..HEAD   # only this task's commits
git merge-base --is-ancestor origin/development HEAD && echo "based on origin/development"
```

Only the branch's owner rebases it, and not once integration of it has
started: then fixes go on as new commits (see
[nfct-integration](../nfct-integration/SKILL.md#inventory-the-streams)). If a
rebase rewrites published history, push with `git push --force-with-lease`,
never plain `--force`.

## Review worktrees

Reviewers ([nfct-pr-review](../nfct-pr-review/SKILL.md),
[nfct-security-review](../nfct-security-review/SKILL.md)) never write probes
into the implementer's worktree or the primary checkout. When probe files or
tests are useful, create a detached worktree at the PR head:

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$PRIMARY" fetch origin pull/<n>/head
git -C "$PRIMARY" worktree add --detach "$PRIMARY-review-pr<n>" FETCH_HEAD
```

An independent [exploratory QA](../nfct-exploratory-qa/SKILL.md) pass runs
the app from the same kind of worktree, named `$PRIMARY-qa-pr<n>` so it does
not collide with a reviewer's. For an integration check, which has no PR, use
the check's local SHA instead of `FETCH_HEAD` and name it
`$PRIMARY-qa-<slug>`.

It has no `node_modules`; run `npm ci --legacy-peer-deps` in it before running
tests. It has no branch and no PR lifecycle. Never commit or push from it
unless you are explicitly switched into an implementation role. When the
review or QA pass ends, delete your own probe files (note any worth keeping as
permanent tests in the findings), then
[remove it](#clean-up-review-qa-and-integration-check-worktrees).

## Integration worktrees

An integrator ([nfct-integration](../nfct-integration/SKILL.md)) works in its
own worktree from `origin/development`, never in a stream's worktree or the primary
checkout. Either kind has no `node_modules`; install dependencies before
running the suite.

**Integration branch** (the default). The integrator's task branch,
`integration/<slug>`, where the slug names the objective or epic, in
`$PRIMARY-integration-<slug>`. Merge each stream into it in dependency order:

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$PRIMARY" fetch origin
git -C "$PRIMARY" worktree add --no-track -b integration/NFCT-1-mental-math \
  "$PRIMARY-integration-NFCT-1-mental-math" origin/development
git -C "$PRIMARY-integration-NFCT-1-mental-math" merge --no-ff --no-edit \
  origin/feature/NFCT-17-mental-math-definition
```

The integrator commits integration fixes on it, pushes it and opens one PR.
It follows the task [lifecycle](#lifecycle) and
[cleanup](#clean-up-a-task-worktree).

**Integration check** (only when the user wants independent PRs). A detached
worktree that merges the streams only to test that they work together:

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$PRIMARY" fetch origin
git -C "$PRIMARY" worktree add --detach "$PRIMARY-integration-check-<slug>" origin/development
git -C "$PRIMARY-integration-check-<slug>" merge --no-ff --no-edit origin/feature/NFCT-18-firestore-rules
```

Its merge and cherry-pick commits are disposable test state: never push them
and never create a branch from them. Conflicts and regressions go back to each
stream's owner as findings.

## Hand-off hygiene

Before opening, updating or handing off a PR:

- remove temporary probes, scratch files, debug output and agent-generated
  reports; keep scratch work outside the repository;
- keep permanent tests and documentation that the card needs;
- confirm the diff contains only intended files (`git diff --stat
  origin/development...HEAD`, `git status --short`);
- leave the working tree clean, with everything committed and pushed.

## Lifecycle

- **An open PR is not a disposable worktree.** Keep a task worktree while its
  PR is open, so review fixes are made in place. It becomes eligible for
  cleanup only when the PR is merged or the work is explicitly abandoned by the
  owner, **and** the worktree is clean and fully pushed.
- **Review, QA and integration-check worktrees are disposable.** A review or
  QA worktree never has commits; an integration check's local test merges are
  never pushed. Each is eligible for cleanup as soon as its pass ends and its
  findings are handed back, once `git status` is clean. An integration branch
  is a task branch and follows the rule above.
- **Stale worktrees are every agent's housekeeping.** When you start or finish
  a task, run [Diagnose](#diagnose). Remove any worktree another task left
  behind that now passes the cleanup checks below: typically one whose PR merged
  (or was closed as superseded) with its commits on `origin/development`, or a
  review or QA worktree from a finished pass. Remove only what the checks prove
  safe. Leave anything that fails a check, may have an active agent, or that you
  are otherwise unsure about, and list it in your report with the reason
  instead of guessing.

## Diagnose

List every worktree with its state:

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$PRIMARY" fetch --prune origin
git -C "$PRIMARY" worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do
  b=$(git -C "$wt" branch --show-current)
  dirty=$(git -C "$wt" status --porcelain | wc -l | tr -d ' ')
  unpushed=$(git -C "$wt" rev-list --count HEAD --not --remotes)
  if [ -z "$b" ]; then
    printf '%s  (detached at %s)  dirty=%s  unpushed=%s  pr=n/a\n' \
      "$wt" "$(git -C "$wt" rev-parse --short HEAD)" "$dirty" "$unpushed"
    continue
  fi
  pr=$(gh pr list --head "$b" --state all --json number,state -q '.[] | "#\(.number) \(.state)"' | head -1)
  printf '%s  %s  dirty=%s  unpushed=%s  pr=%s\n' "$wt" "$b" "$dirty" "$unpushed" "${pr:-none}"
done
```

- The first line is the primary checkout. Never remove it.
- `dirty` counts modified and untracked files; ignored files such as
  `node_modules/` are not counted and do not block removal.
- `unpushed` counts commits on no remote branch. For an integration check
  these are its disposable test merges.
- A detached worktree is a review, QA or integration-check worktree
  (`-review-pr<n>`, `-qa-pr<n>` or `-qa-<slug>`, `-integration-check-<slug>`).
  A worktree on an `integration/<slug>` branch is a task worktree. `pr=none`
  with a dirty tree usually means work in progress. Leave both to their owner
  unless the lifecycle rules say otherwise.
- Active-agent check, **Linux only**: look for processes running in the
  worktree, then for recent edits:

  ```bash
  for p in /proc/[0-9]*; do
    c=$(readlink "$p/cwd" 2>/dev/null) || continue
    case "$c" in "$wt"|"$wt"/*) echo "pid ${p#/proc/}: $c" ;; esac
  done
  find "$wt" -mmin -60 -not -path '*/node_modules/*' -not -path '*/.git/*' | head
  ```

  Without `/proc` there is no process check here; do not treat that as "no
  agent". In every case, if you cannot rule out an active agent, ask the owner
  or orchestrator.

## Clean up a task worktree

Clean up only a worktree that meets the lifecycle rules and has no active
agent. The block runs in a subshell and stops at the first failed check, so it
is safe to paste as a whole. Set `b` and `wt` first.

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
b=feature/NFCT-18-firestore-rules
wt="$PRIMARY-NFCT-18"
(
  set -eu
  stop() { echo "STOP: $*" >&2; exit 1; }
  git -C "$PRIMARY" fetch --prune origin
  [ "$(git -C "$wt" branch --show-current)" = "$b" ] || stop "$wt is not on $b"
  [ -z "$(git -C "$wt" status --porcelain)" ] || stop "$wt has uncommitted changes"
  [ "$(gh pr list --head "$b" --state open --json number -q length)" = 0 ] || stop "$b has an open PR (or gh failed)"
  sha=$(git -C "$PRIMARY" rev-parse "$b")
  if ! git -C "$PRIMARY" merge-base --is-ancestor "$sha" origin/development; then
    # Squash merge: accept only if a merged PR's head is exactly this commit.
    [ "$(gh pr list --head "$b" --state merged --json headRefOid -q '.[0].headRefOid // ""')" = "$sha" ] \
      || stop "$b is not merged into origin/development"
  fi
  git -C "$PRIMARY" worktree remove "$wt"
  git -C "$PRIMARY" branch -D "$b"   # merged state verified above
  if git -C "$PRIMARY" ls-remote --exit-code --heads origin "$b" >/dev/null; then
    stacked=$(gh pr list --base "$b" --state open --json number -q length)
    if [ "$stacked" = 0 ]; then
      git -C "$PRIMARY" push origin --delete "$b"
    else
      echo "KEEP: remote $b is the base of $stacked open PR(s)" >&2
    fi
  fi
  git -C "$PRIMARY" worktree prune
)
```

- Each check fails closed: if `gh` or `git` errors, `set -e` stops the block
  before anything is removed.
- `branch -D` is used only after the merged check passes, because `branch -d`
  compares against the branch's upstream or whatever `HEAD` is checked out,
  and refuses once GitHub has deleted the upstream.
- `git worktree remove` still refuses a dirty worktree. Never add `--force`.
- Abandoned work fails the merged check by design. Remove it only with the
  owner's explicit say-so, after confirming it is pushed, and never with
  `--force`.
- Report what you removed and what you left, with the reason.

## Clean up review, QA and integration-check worktrees

```bash
PRIMARY=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
wt="$PRIMARY-review-pr<n>"   # or -qa-pr<n>, -qa-<slug>, -integration-check-<slug>
(
  set -eu
  stop() { echo "STOP: $*" >&2; exit 1; }
  [ -z "$(git -C "$wt" branch --show-current)" ] || stop "$wt is on a branch; use the task cleanup"
  [ -z "$(git -C "$wt" status --porcelain)" ] || stop "$wt has uncommitted files"
  git -C "$PRIMARY" worktree remove "$wt"
  git -C "$PRIMARY" worktree prune
)
```
