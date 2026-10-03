# ADR-003: Domain indexes and an aggregate training score

- **Status:** Proposed, 3 October 2026
- **Cards:** NFCT-26 (`performanceIndex` and domain indexes, deferred until real gameplay data exists), NFCT-70 (overall score framework), NFCT-72 (recommendations for areas with less progress), NFCT-14 (domain list)
- **Builds on:** [ADR-001](adr-001-consumer-domain-model.md), decisions 4, 6, 8, 9, 10, 12 and 13
- **Code it cites:** [`shared/domains.ts`](../../shared/domains.ts), [`shared/games/definition.ts`](../../shared/games/definition.ts), [`shared/schemas/gameSession.ts`](../../shared/schemas/gameSession.ts), [`shared/processing/decide.ts`](../../shared/processing/decide.ts), [`shared/schemas/stats.ts`](../../shared/schemas/stats.ts), [`shared/stats/`](../../shared/stats/reducer.ts)
- **Scope of this record:** design only. It changes no code, schema, Firestore rule, UI or formula. Every threshold and estimator in it is **provisional** (decision 8).

## Context

ADR-001 reserved room for per-game performance indexes and domain indexes but built none of it:

- `GameDefinition.domainWeights` files each game under one or more domains. The weights sum to 1 and are product taxonomy, not measurements (ADR-001 decision 10).
- `GameDefinition.performanceIndex` is an optional, versioned `{ version, compute(trials, ctx) }` ([`shared/games/definition.ts`](../../shared/games/definition.ts)). No game defines one.
- A stored `result` carries `performanceIndex` and `performanceIndexVersion`, always `null` today, and `domainContributions`, a copy of the game's weights ([`shared/schemas/gameSession.ts`](../../shared/schemas/gameSession.ts), [`shared/processing/decide.ts`](../../shared/processing/decide.ts)).
- Raw trials are stored on every session, so a formula chosen later can be applied to history. No data collection change is needed now.

The catalogue today ([`shared/domains.ts`](../../shared/domains.ts), `DOMAIN_CATALOG` version 1) is `math`, `reasoning`, `memory`, `verbal`, `spatial`, `processing-speed`. Domains can only be added; ids are never renamed, removed or reused. The only scoring game is Mental Math, filed `{ math: 0.7, processing-speed: 0.2, memory: 0.1 }` ([`shared/games/mental-math/v1/definition.ts`](../../shared/games/mental-math/v1/definition.ts); [v2](../../shared/games/mental-math/v2/definition.ts) reuses the weights). Its 3-up/1-down staircase is in [`v1/staircase.ts`](../../shared/games/mental-math/v1/staircase.ts). v1 (a fixed 90 s run) and v2 (time bank) share levels and questions.

NFCT-26 and NFCT-70 need a design before anyone writes code: what a 0–100 per-game number means, how runs are combined, how much evidence a domain needs before it shows a number, and how to stop one game from inflating an overall score. This record decides that design and says what can ship with one game and what must wait for a second.

## Decisions

### 1. Domains: keep the v1 six

The catalogue stays as it is. A domain such as `attention` is added (additively, per ADR-001 decision 10) only in the change that files a game under it. No domain is added speculatively.

### 2. Per-game index: progress up the game's own ladder

Each game version may define a `performanceIndex`, a 0–100 value per session. It means **how far up that game's own difficulty ladder the player performs reliably.**

- Difficulty, accuracy and speed matter only inside a game's own index. Raw scores and game metrics are never combined across games.
- It is not a population percentile and makes no claim about norms.
- A game with no index counts as activity only (ADR-001 decision 13). It contributes nothing to a rating, a domain index or the aggregate.
- **Mental Math's candidate basis** is the staircase's settled level (a 3-up/1-down staircase settles near 79% correct) plus a small speed term.
- **Not decided:** the formula and its 0–100 mapping. NFCT-26 sets them from real gameplay distributions, as that card already requires. This ADR invents no formula.

### 3. Which runs count

Valid, completed sessions only, the same eligibility as achievements (ADR-001 decision 13: valid and completed). EEG is never an input (AGENTS.md hard rule; ADR-001 decisions 3 and 12).

A flagged session counts once the start-level upgrade makes it valid. The upgrade changes a session's stored result and applies only valid-only effects, so the window update (decision 9) must also run in `applyValidUpgrade` ([`shared/stats/reducer.ts`](../../shared/stats/reducer.ts)), not only when a session is first processed valid. Otherwise the aggregate would depend on the order sessions arrived in.

### 4. Per-game rating: a trimmed mean of recent runs

A game's **rating** `R` is a **20% trimmed mean** of the per-session index over the last `N` valid, completed runs. Provisional parameters are in decision 8.

- **Window.** The last `N` runs ordered by `(endedAt, sessionId)`, at the game's **current `performanceIndexVersion` only**. The window counts runs, not days, so there is no time decay.
- **Estimator.** Sort the indices, drop `floor(0.2·n)` runs from each end, and average the rest (`n` is the number of runs in the window).
- **Minimum evidence.** No rating until at least the minimum number of runs exists.

**Considered and rejected: "mean of the top half".**

- The best run is always included, so one lucky run lifts the rating by 1/5 of its excess over the others at `N = 10`.
- It rewards inconsistency over reliable performance, which contradicts decision 2's definition.
- With a short window it averages only two or three runs.

The trimmed mean drops the extremes at both ends, so a single lucky or unlucky run does not move it, while the rest of the window still counts.

### 5. Baseline and improvement

The **baseline** is the same statistic over the first `K` valid, completed runs at the same index version. **Improvement** (the current rating minus the baseline) is shown separately and **never added into a score**, so weak early runs earn nothing and a strong start is not penalised.

### 6. Domain index

For a domain, over the games filed under it:

```
D        = Σ (w · c · R) / Σ (w · c)
coverage = Σ (w · c)
```

- `w` is the game's weight for the domain, from its `domainWeights`.
- `c = min(1, runs / N)` is how full the game's window is.
- `R` is the game's rating (decision 4). Games with no rating contribute nothing.

A domain is in one of four **internal states**:

| State | Condition | Shown |
| --- | --- | --- |
| `no-games` | no catalogue game is filed under the domain | no row |
| `building` | coverage < 0.5 | no number |
| `early` | coverage ≥ 0.5 | a number, labelled "Early" |
| `established` | coverage ≥ 1.0 and at least 2 contributing games | a number |

Players see only the label "Early". The other states are internal.

The rule needs no game-specific logic, and it has a direct consequence: **Mental Math alone can never produce a memory or processing-speed number.** Its maximum coverage is 0.1 in memory and 0.2 in processing-speed, both under the 0.5 early threshold. It can produce an early `math` number (maximum coverage 0.7), and never an established one (fewer than 2 games, and coverage below 1.0).

### 7. Aggregate score

The aggregate is shown only when **at least 3 domains are `early` or better.** It is the **equal-weighted mean** of the qualifying domains' indexes, so grinding one game cannot dominate it.

- **No imputation.** A domain that does not qualify is left out, not filled in.
- **Copy.** The UI says "across X of Y areas" and explains the jump when a domain starts qualifying.
- **Additive catalogue.** Adding a domain to the catalogue never lowers a score: a new domain joins the mean only once it qualifies, and until then the aggregate is computed as before.

### 8. Provisional parameters

Every value below is a **provisional default**. None is validated. Each is set from the evidence in its last column, by NFCT-26 or the stage card named in decision 14.

| Parameter | Controls | Default | Evidence that would set it |
| --- | --- | --- | --- |
| `N` | Runs in a game's rating window; also the divisor in `c` | 10 | Owner-run distribution of per-session index variance within a player; how many runs a rating needs to be stable |
| `K` | Runs in the baseline window | to be set (not chosen here) | How quickly early runs settle; must be small enough to be "early" and large enough to damp a single run |
| Minimum runs | Runs before a game has any rating | 5 | Same variance analysis as `N` |
| Trim fraction | Share dropped from each end of the window | 0.2 | Outlier rate in real per-session indices |
| Early coverage | Coverage at which a domain shows a number | 0.5 | Whether single-game "early" numbers are meaningful (open owner decision, decision 15) |
| Established coverage | Coverage at which a domain is `established` | 1.0 | Same |
| Established game count | Contributing games needed for `established` | 2 | Same |
| Aggregate domain count | Qualifying domains needed for the aggregate | 3 | How many domains the catalogue can support at once |
| Saturation formula | How a game's index maps to 0–100 and saturates near the top of its ladder | not decided | Real gameplay distributions (NFCT-26) |

**Which version bumps, and when:**

- A value used only when computing on read (everything except `N` and `K`) is changed by bumping `BRAIN_SCORE_VERSION`, a new code-level constant that versions the shared read-side formulas. It needs no migration: scores are recomputed from stored data on the next read.
- `N` and `K` size the stored window (decision 9), so changing either bumps `STATS_AGGREGATE_VERSION` ([`shared/schemas/stats.ts`](../../shared/schemas/stats.ts)) and triggers the existing rebuild (ADR-001 decision 13).

### 9. Storage and trust

- **Per session.** Trusted scoring computes `result.performanceIndex` (and `performanceIndexVersion`) in the same transaction that writes the result, from the game's `performanceIndex.compute`. Nothing client-computed is trusted (ADR-001 decision 4).
- **Per user.** `stats/summary` gains an optional `performance` field. For each game it holds, capped, the `N` most recent and the `K` earliest valid, completed entries, each `{ sessionId, endedAt, index, indexVersion }`.
  - "The `N` most recent" and "the `K` earliest" are set functions of the sessions' own values, so they are **order-independent**: the same set results from any processing order and from a rebuild. ADR-001's exactly-once, order-independence and rebuild guarantees (decisions 12 and 13) therefore hold.
  - Adding an optional field is not a `schemaVersion` bump (ADR-001 decision 8). There is **no new collection and no rules change**: `stats/summary` is server-only already.
- **On read.** Ratings, domain indexes and the aggregate are pure functions in `shared/`, computed when read, like the views in [`shared/stats/views.ts`](../../shared/stats/views.ts). Nothing derived is stored.
- **No client preview.** The client shows the trusted server state only.
- **Trust limit.** `endedAt` is a device clock and only selects the recent window. Forging it affects only the forger's own view (ADR-001 decision 4). **These scores must never feed leaderboards**, which would need server-issued seeds and server-timed trials.

### 10. Versioning

`performanceIndexVersion` is per game version. A rating uses only the current version's entries (decision 4). Trends are recomputed from per-session indices, never from stored snapshots, so a changed formula cannot leave an inconsistent history behind.

### 11. Proposed amendment to ADR-001: backfill (not applied)

**Conflict.** Filling `performanceIndex` onto sessions already processed contradicts ADR-001 decision 12, "What never changes" (the stored scored values, including the performance index), and decision 8, "rebuilds never rescore".

**Proposal.** Add one narrow exception: a **deliberate backfill** may fill a `null` or older-version `performanceIndex` (and its version) from stored trials. It never changes validity, score, any other scored value or any total.

**Status.** Recorded here as a proposal only. **ADR-001 is not amended by this record.** The amendment is accepted together with NFCT-26 (stage 1, decision 14), when the owner has seen the formula it would apply.

### 12. Terminology

A domain index means **"progress in the games filed under this area, weighted by how they are filed."** It measures no cognitive ability. That keeps ADR-001 decision 10 ("weights are not measurements") true.

- Code and docs use **"domain index"** and **"aggregate score"**.
- **User-facing names are an owner decision.** Recommended defaults: "training areas", "[area] progress", "Training Score", "Training profile".
- **"Brain Score"** (the name NFCT-70 and NFCT-72 use) is an option the owner may choose only with a short permanent explainer: it reflects progress through the games' levels and is not a measure of intelligence, memory capacity or brain health.
- **Copy never uses** percentile, IQ, comparisons with other people, "improved your [area]", "weak", "deficit" or "below average". 0–100 is never presented as a percentage.

### 13. UI

- **Profile card.** At the top of Progress ([`src/consumer/overview/ProgressOverview.tsx`](../../src/consumer/overview/ProgressOverview.tsx) today): the aggregate header, or what unlocks it. Below it, one row per domain that some game is filed under, showing the state, a 0–100 bar when a number is shown, "based on N runs of X games", and the change since the first runs (decision 5).
- **Domain detail view.** Lists the contributing games, their weights (reuse the catalogue percentages in [`src/consumer/catalogue/`](../../src/consumer/catalogue/percentages.ts)) and each game's rating.
- **Game progress card.** Each game's rating goes on its own progress card.
- **Home.** A tile appears only once the aggregate exists.
- **No radar chart.**

### 14. Staging

What can ship with Mental Math alone is stages 0–2. What must wait for a second game is stages 3–4.

| Stage | Content | Needs |
| --- | --- | --- |
| 0 | This ADR | nothing |
| 1 | Mental Math index v1; an owner-run, read-only distribution analysis; the decision 11 amendment; the backfill (NFCT-26) | real gameplay data |
| 2 | The summary `performance` window and the per-game rating | stage 1 |
| 3 | Domain indexes and the profile card | stage 2, and a second scoring game with a different main domain |
| 4 | The aggregate score and the Home tile | stage 3, and at least 3 domains able to qualify |

NFCT-72 (recommendations for areas with less progress) follows stage 3.

### 15. Open owner decisions

1. User-facing names and copy, including whether to use "Brain Score" (decision 12).
2. The provisional parameter defaults (decision 8).
3. Whether a one-game `early` domain index ever shows on its own (decisions 6 and 8).

## Consequences

- Nothing ships from this record. Stage 1 starts only when real Mental Math distributions exist, as NFCT-26 already requires.
- NFCT-26's text ("domain indexes in `stats/summary`", backfill "using the rebuild script") is superseded: domain indexes are computed on read, and the backfill needs the decision 11 amendment first. NFCT-26 is rescoped to stage 1, and NFCT-70 is rescoped so this ADR meets its design criteria and its code criteria move to stages 2–4.
- Because a domain index is defined as progress in the games filed under it, adding games or domains changes what a number summarises, never what a stored session says. Old sessions are never rescored.
- A domain filled by one game can reach `early` but never `established` (decision 6), and the aggregate needs 3 qualifying domains (decision 7), so it cannot be reached with Mental Math alone.
- NFCT-72 uses `early` or better as its sparse-data guard and adopts the copy rules in decision 12 (its current title says "weak").
