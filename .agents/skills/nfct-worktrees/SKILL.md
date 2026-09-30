---
name: nfct-worktrees
description: Create, hand off and clean up isolated NFCT task worktrees and branches safely. Use when starting writable work on a card, finishing or handing off a PR, or diagnosing and removing stale worktrees.
---

# NFCT worktrees

This skill owns the lifecycle of writable task environments: creating them,
keeping them tidy for hand-off, and removing them once their work is done.

## When a worktree is needed

- Independent writable work (a card, a PR, a review-fix stream) gets its own
  branch and worktree whenever other work may run in parallel, which is the
  normal case here.
- Read-only planning, review, Jira work and analysis do not need one unless
  isolation is specifically useful, such as a reviewer running probes.
- The primary checkout (`~/eeg_projects/neurofeedback-cognitive-training`) is
  shared. Do not switch its branch or do task work in it while other streams
  are running.
- Never modify another agent's active worktree, branch or uncommitted work.

## Create

Use predictable names from the Jira card: branch `<type>/<CARD>-<slug>`
(`feature/`, `fix/`, `chore/`, `docs/`) and a sibling worktree
`~/eeg_projects/neurofeedback-cognitive-training-<CARD>`. For work with no
card, use a short task slug instead of `<CARD>`.

```bash
cd ~/eeg_projects/neurofeedback-cognitive-training
git fetch origin
git worktree add --no-track -b feature/NFCT-18-firestore-rules \
  ../neurofeedback-cognitive-training-NFCT-18 origin/main
```

Base on current `origin/main` unless the card depends on an unmerged branch;
then base on that branch's `origin/` ref and say so in the PR. Never base on
whatever another feature worktree happens to have checked out. `--no-track`
stops the branch tracking `origin/main`; set its own upstream on first push
with `git push -u origin HEAD`.

Check the base before the first commit:

```bash
git log --oneline origin/main..HEAD   # only this task's commits
git merge-base --is-ancestor origin/main HEAD && echo "based on origin/main"
```

## Hand-off hygiene

Before opening, updating or handing off a PR:

- remove temporary probes, scratch files, debug output and agent-generated
  reports; keep scratch work outside the repository;
- keep permanent tests and documentation that the card needs;
- confirm the diff contains only intended files (`git diff --stat
  origin/main...HEAD`, `git status --short`);
- leave the working tree clean, with everything committed and pushed.

## Lifecycle

**An open PR is not a disposable worktree.** Keep the worktree while its PR is
open, so review fixes are made in place. It becomes eligible for cleanup only
when the PR is merged or the work is explicitly abandoned by the owner, **and**
the worktree is clean and fully pushed.

## Diagnose

List every worktree with its state:

```bash
cd ~/eeg_projects/neurofeedback-cognitive-training
git fetch --prune origin
git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
  b=$(git -C "$wt" branch --show-current)
  dirty=$(git -C "$wt" status --porcelain | wc -l)
  unpushed=$(git -C "$wt" rev-list --count HEAD --not --remotes)
  pr=$(gh pr list --head "$b" --state all --json number,state -q '.[] | "#\(.number) \(.state)"' | head -1)
  printf '%s  %s  dirty=%s  unpushed=%s  pr=%s\n' "$wt" "$b" "$dirty" "$unpushed" "${pr:-none}"
done
```

- `dirty` counts modified and untracked files; ignored files such as
  `node_modules/` are not counted and do not block removal.
- `unpushed` counts commits on no remote branch. After a squash merge whose
  remote branch was deleted, confirm with
  `gh pr view <n> --json state,headRefOid` that the merged head equals local
  `HEAD`.
- `pr=none` with a dirty tree usually means work in progress. Leave it.
- To look for an active agent, check for processes running in the worktree
  (`ls -l /proc/*/cwd 2>/dev/null | grep "<worktree>"`) and recent edits
  (`find <worktree> -mmin -60 -not -path '*/node_modules/*' -not -path '*/.git/*' | head`).
  If you cannot rule one out, ask the owner.

## Clean up

Clean up only a worktree that meets the lifecycle rule and has no active agent.
Never remove the primary checkout.

```bash
git worktree remove ../neurofeedback-cognitive-training-NFCT-18
git branch -d feature/NFCT-18-firestore-rules
git ls-remote --exit-code --heads origin feature/NFCT-18-firestore-rules \
  && git push origin --delete feature/NFCT-18-firestore-rules
git worktree prune
```

- `git worktree remove` and `git branch -d` refuse when work would be lost.
  Treat a refusal as a stop signal. Never use `--force` or `branch -D` to get
  past uncommitted or unpushed work.
- `branch -D` is acceptable only after a squash merge, once the merged head
  equals the local branch's `HEAD`.
- Delete the remote branch only if GitHub has not already done so. For merged
  PRs this is routine; for abandoned work, only with the owner's say-so.
- Report what you removed and what you left, with the reason.
