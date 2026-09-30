# ADR-001: Consumer domain model

- **Status:** Accepted, 29 September 2026
- **Card:** NFCT-5 (Stage 1, PR 1)
- **Design baseline:** [NFCT Consumer Firestore & Domain Model — Stage 1 Design](https://claude.ai/code/artifact/bd8c450e-199f-42ea-ba59-60ddcf7758cb).
  This ADR is the durable summary; the design holds the full reasoning, rules sketch, index plan and card sequence.
- **Code:** [`shared/`](../../shared/index.ts), imported as `@nfct/shared`

## Context

NFCT was forked from Waveable, a clinical neurofeedback product ([FORK.md](FORK.md)). Its persistence model is clinical and EEG-first. `clients/{uid}` holds the profile and all progress. `sessions/{id}` is an EEG session. Every score, streak and badge is computed and written by the client, so all of it can be forged. None of that model is a safe base for a consumer cognitive-training app.

The consumer model is built new alongside it. The clinical model stays in place, untouched, until later cards remove it.

## Decisions

### 1. Everything a user owns lives under `users/{uid}`

| Path | Holds | Written by |
| --- | --- | --- |
| `users/{uid}` | Profile: display name, preset avatar, preferences, onboarding, EEG consent. No role, and no email (that stays in Auth). | Client, exact key set |
| `users/{uid}/gameSessions/{sessionId}` | One finished game session with its raw trials | Client, create only |
| `users/{uid}/eegRecordings/{recordingId}` | One optional EEG summary, linked to a session | Client, create or delete |
| `users/{uid}/progress/{gameId}` | Per-game bests, unlocks and totals | Server only |
| `users/{uid}/{stats,dailyStats,achievements}` | Stage 2 aggregates (reserved) | Server only |
| `accountDeletions/{uid}` | Deletion ledger; top level so it outlives the user | Server only |

Ownership is then one rule, and account deletion is one recursive delete. `userId` is still stored on sessions and recordings, so collection-group queries stay possible later. The game catalogue is code in `shared/`, not a Firestore collection.

### 2. The game session is the primary record

Game → mode → start level → game session → performance metrics → domain taxonomy. EEG is not part of this chain. A session stores:

- `gameId`, `gameVersion`, `modeId`, `startLevel`, `peakLevel` and `status` (`completed` or `abandoned`);
- the session `seed` (added by NFCT-17, see below);
- device-clock `startedAt`/`endedAt`, `activeDurationMs`, `localDate` and `timezone`;
- raw per-trial observations (`trials`) and a client-derived display `summary`;
- after processing, a server-written `result`.

Game-specific trials and metrics are validated by each game's own Zod schemas (`gameSessionSchemaFor(definition)`). No game is forced into a universal metric shape.

**The session seed.** Every session stores `seed`, an unsigned 32-bit integer (0 to 4294967295) that the client draws when the game starts, like the session ID, and never changes (`shared/games/seed.ts`).

- **What it is for.** Each game version derives its content from the seed with a frozen algorithm. Trusted scoring can therefore reproduce every recorded question and reject trials the seed cannot produce (Mental Math v1: `question-not-from-seed`). It needs no stored counter: a question discarded on pause is replaced by the next of a fixed number of variants at the same position.
- **What it is not.** The client chooses the seed, so it is forgeable like everything else the client writes, and decision 4 still holds. It is for reproducibility and plausibility, not anti-cheat. Leaderboards would still need server-issued seeds and server-timed trials.
- **Every game.** It is required on every session, so the rules keep one exact key set. A game with no randomness stores it and ignores it.
- **No `schemaVersion` bump.** Adding a required field would normally change the version 1 contract. No session had been written when it was added, and no build or document existed that could be broken.

### 3. EEG is separate, optional recording data

- An EEG recording is its own document. Its **only** link to play is the required `EegRecording.gameSessionId`.
- The session has **no** `eegLinked` or other EEG flag, and its schema rejects unknown keys. A flag would go stale: sessions are immutable, but recordings can be deleted. "Does this session have EEG?" is the query `eegRecordings where gameSessionId == X`.
- EEG is never required to play. It never feeds scores, records, unlocks, progression or domain metrics, and `shared/progress/` does not import the EEG module.

### 4. Trust boundary

The client writes only its profile preferences, a finished session (raw trials plus a display summary) and EEG recordings. Everything that counts is computed from the trials by trusted server code: validity, the score every screen uses, records and unlocks. Assume a motivated user can forge anything the client writes; the design limits that forgery to the forger's own view. Leaderboards would need server-issued seeds and server-timed trials, not more client validation.

### 5. Sessions are write-once

The client generates the session ID when the game starts, so an EEG recording can reference it before anything is written. It writes the document once, when the session ends. Rules (NFCT-18) allow create only, with an exact key set and no `result`. An offline retry either lands once or is refused as an update.

### 6. Trusted server scoring and aggregates

`onGameSessionCreated` (NFCT-19) is the only writer of `result` and `progress/{gameId}`, and writes both in one transaction:

1. validate the session with the game's schemas;
2. rescore it with the game's pure `score()`, which also replays the trusted peak level from the trials;
3. run plausibility checks and set `validity`;
4. write both documents.

It processes a user's sessions in play order.

| Validity | History | Totals | Records and unlocks |
| --- | --- | --- | --- |
| `valid` | Shown | Counted | Set, if the session completed; records go to the record set of the session's own `gameVersion` |
| `flagged` (e.g. RT floor, locked start level) | Shown | Counted | Never |
| `invalid` (schema failure) | Kept for debugging | Not counted | Never |

- **Result variants.** `result` is a union on `validity`. Every variant carries the processing metadata that makes a session processed exactly once: `processedAt`, `scoringVersion`, `validity` and `reasons`, where a flagged or invalid result needs at least one reason.
  - **`valid` and `flagged`** also carry the scored values: `score`, `accuracy`, `responseTime`, the trusted `peakLevel` and `metrics`, the `performanceIndex` pair and `domainContributions`.
  - **`valid`** also fixes the `recordKey` and `recordValues` the session competed with, plus `personalBest` and `unlocked`.
  - **`invalid`** carries nothing else, so trusted scoring can mark a session permanently processed without inventing gameplay values.
- **Trusted peak level.** The session's own `peakLevel` is a client observation only. Trusted scoring compares it with the peak replayed from the trials as a plausibility check. `bestPeakLevel`, unlocks and the `peakLevel` record use only the replayed `result.peakLevel`.
- **Totals.** Abandoned sessions add active time and last-played time, but do not count as completed or set records.
- **`performanceIndex`.** `result.performanceIndex` and `performanceIndexVersion` are `number | null` and always null in Stage 1. `GameDefinition.performanceIndex` stays absent until a formula is validated on real gameplay data (NFCT-26).
- **Where the logic lives.** The per-game reducer `applySession` and `unlockedStartLevel` are pure functions in `shared/`. Trusted scoring, the client's optimistic preview and the rebuild script all call the same code.
- **Stage 1 progress is limited.** It holds only personal bests, best peak level, unlocked start levels, completed-session count, active time and last-played time. Streaks, daily stats, weekly goals, achievements, domain indexes and leaderboards are later stages.

`applySession(progress | null, { definition, sessionId, session, outcome, appliedAt })` works as follows:

- **Trusted input only.** The outcome is either `validOutcome(definition, { modeId, startLevel }, scored)` for a session just scored, or `outcomeFromResult(result)` for a stored one. It holds the validity and, for a valid session, the trusted peak, record key and record values. The reducer never reads the client's `peakLevel`.

- **Deterministic and non-mutating.** It reads no clock and never mutates its inputs.
- **Not idempotent.** Applying the same session twice adds its totals twice (records, best peak level and unlocks are max-based and unaffected). Progress stores no session ledger. Exactly-once application is the caller's responsibility:
  - **Trusted scoring (NFCT-19)** reads the session inside the transaction and skips it when `result.processedAt` is already set. `result` and `progress` are then written in that same transaction.
  - **Rebuilds** start from empty progress and replay each stored session once, in play order.
  - **The client preview (NFCT-20, NFCT-22)** de-duplicates pending sessions in transient client state, never in persisted progress. Progress and a session's `result` land in one commit but may arrive through separate listeners. To avoid a transient double preview, treat a session as pending only until its trusted `result` is observed, and coordinate the two listeners (for example with `onSnapshotsInSync`) before combining cached progress with pending sessions.
- **Missing progress.** An invalid session on missing progress leaves it missing. The first valid or flagged session creates the document.
- **Deterministic ties.** A higher value takes a record. On an equal value the earlier achievement (`endedAt`) keeps it, and then the lower session ID. The result never depends on the order in which triggers or a rebuild apply sessions.
- **Unknown aggregates.** `canApplyToProgress(progress, definition)` is false when progress was maintained by a different `aggregateVersion` or a newer `gameVersion`. Reading such progress still works. Trusted scoring then rebuilds before applying; a client preview declines to preview and shows the trusted server state as it is. `applySession` refuses rather than reinterpret it.

### 7. Deletion: hard delete, server-driven

Account deletion (NFCT-23) runs through a callable that checks the login is recent (`auth_time` under 5 minutes). The sequence is:

1. write the `accountDeletions/{uid}` ledger;
2. disable the Auth user and revoke refresh tokens;
3. `recursiveDelete(users/{uid})`;
4. delete the Storage prefix `users/{uid}/`;
5. delete the Auth user.

Then:

- **Sweeps.** An hourly sweep resumes failed runs, and a final sweep 24 hours later catches late offline writes.
- **Ledger.** The ledger holds only the uid and timestamps, and a TTL removes it after 30 days.
- **What is kept.** No game or EEG data is retained. The user can also delete any EEG recording at any time.
- **Inherited code.** WB-97's tombstoning deletion does not carry over; only its reauthentication UI and error mapping are reused.

### 8. Versioning: four integers, each with one job

| Version | Lives on | Bump when | Effect |
| --- | --- | --- | --- |
| `schemaVersion` | Every document | A field is changed, removed or repurposed, or an existing enum gains a value (the domain catalogue excepted). Adding an optional field is not a bump. | Readers upcast in memory via one mapper per collection (`readUserProfile`, `readGameSession`, `readEegRecording`, `readGameProgress`). Rules accept current and current − 1. |
| `gameVersion` | Catalogue and each session | Scores stop being comparable (new levels, changed ramp) | A new record set starts; the previous one moves to `progress.bestsArchive`. Earned unlocks carry over. |
| `scoringVersion` | Catalogue and `result` | `score()` or the performance index changes | New sessions use it. Stored results stay as written; rescoring them is a deliberate, separate job. |
| `aggregateVersion` | Each aggregate | A reducer changes | That user's aggregates are rebuilt from sessions. Derived data is never migrated. |

**Strict writes, tolerant reads.**

- **Writes are strict.** Each collection has a write schema for the current version (`*WriteSchema`) that rejects unknown fields, and rules enforce the same exact key set.
- **Reads are tolerant.** The `read*` mappers drop fields they do not understand, so an older build can read a document from a newer compatible writer. That is why adding an optional field needs no `schemaVersion` bump, while changing, removing or repurposing a field does.
- **Domain IDs are the one open set.** Readers ignore domain contributions whose ID this build's catalogue does not know (decision 10).
- **Unreadable documents.** A document whose `schemaVersion` a build cannot read throws `DomainReadError`. Repositories (NFCT-20) treat it as unreadable rather than crash.

**Rebuilds across game versions.** `rebuildProgress(definition, sessions, appliedAt)` is the pure rebuild:

- **Stored results, not rescoring.** It replays each processed session once, in play order (`endedAt`, then session ID), from its stored trusted result.
- **Old sessions are never re-checked.** A session is never revalidated against, or rescored with, a later game version's schemas or scoring. `readGameSessionFor(definition)` applies only to the definition's exact `gameVersion`; older sessions are read with `readGameSession`.
- **Old records stay archived.** Records stay in the record set of the session's own `gameVersion`, so earlier sets move into `bestsArchive` rather than disappear. A late session of an earlier version lands in that version's archived set.
- **Unlocks survive by default.** `bestPeakLevel` spans every game version, and `unlockedStartLevel` clamps it to the current mode's levels, so a routine rebuild or version bump never revokes an earned unlock. A future version whose levels change meaning must define an explicit migration instead, for example a new mode ID.
- **Unprocessed sessions are skipped.** Trusted scoring applies them when it processes them.

Two catalogue identifiers are also versioned:

- **Domain catalogue.** It carries its own `version` (decision 10).
- **Record keys.** A `recordKey` change is a catalogue change:
  - if gameplay is unchanged, bump `scoringVersion` and run a deliberate rescoring of stored trials;
  - if gameplay changed, bump `gameVersion`.

### 9. Mental Math records are keyed by mode + start level

Mental Math v1 has one mode, `timed-90`: a fixed 90-second run over 10 levels, driven by a 3-up/1-down staircase. Scores from different start levels are not comparable, even with the staircase:

- base points per answer scale 5.5× from level 1 to level 10;
- a higher start skips the climb, earning high-value points from its first answer;
- the staircase pulls every run toward the player's own level, but how quickly is unknown until there is real data.

So:

- **Records.** Bests are kept per `recordKey`: Mental Math uses `${modeId}:${startLevel}`, so `timed-90` has up to 10 record classes, `timed-90:1` to `timed-90:10`. The record metrics are score, correct answers and peak level, each with its own `sessionId` and date. Ties go to the earlier achievement, then the lower session ID (decision 6). No normalisation merges the classes until one can be validated on real data.
- **Unlocks.** `bestPeakLevel[modeId]` is the highest trusted peak level in any valid completed run at **any** start level.
  - **The mode owns the rule.** Each mode defines a deterministic `unlockPolicy({ bestPeakLevel, maxLevel })`. `unlockedStartLevel(mode, progress | null)` applies it and clamps the result to `[initiallyUnlockedStartLevel, maxLevel]`. Shared code holds no game-specific formula.
  - **Mental Math `timed-90` (NFCT-17), v1 policy:** unlock up to `bestPeakLevel − 1`, but once level 10 has actually been reached, level 10 itself is an allowed start level (`bestPeakLevel >= 10 ? 10 : bestPeakLevel − 1`). The initial level (1) and the mode's bounds always apply.
- **Missing progress.** A missing progress document, or no entry for the mode, yields `initiallyUnlockedStartLevel`.
- **Where it is called.** The start-level picker, the client preview and the server all call this one function. It derives the level from `bestPeakLevel` and never trusts the cached `progress.unlocked`.
- **Totals** (sessions and time) are per game and include flagged sessions.

### 10. The v1 cognitive-domain catalogue

`DOMAIN_CATALOG` (`shared/domains.ts`) is version 1: `math`, `reasoning`, `memory`, `verbal`, `spatial`, `processing-speed`.

- **Product taxonomy only.** It is the v1 taxonomy, not a permanent scientific ontology. No field or label claims to measure intelligence or cognitive improvement, or to have a clinical effect. User-facing domain wording is a separate owner decision.
- **Fractional weights.** A game belongs to one or more domains through `domainWeights`, which are non-negative and sum to 1 (e.g. `{ math: 0.7, 'processing-speed': 0.2, memory: 0.1 }`). Weights say how a game is filed; they are not measurements.
- **Additive growth.** Adding a domain such as `attention` or `cognitive-flexibility` appends it and bumps the catalogue `version`. Aggregates are keyed maps, so weights written under v1 stay valid and no schema migration is needed. Domain IDs are never renamed, removed or reused.
- **Older builds tolerate newer domains.** A build that reads contributions naming a domain its catalogue does not know ignores that domain rather than fail. Writes accept only the writer's own catalogue.

### 11. EEG storage policy and simulated provenance

- **Summary only.** v1 stores one summary document per recording, about 5–15 KB:
  - device model, firmware, transport, channels and sample rate;
  - `brainflow-service` and feature versions;
  - calibration and quality fractions;
  - mindfulness and restfulness distributions over usable windows;
  - mean relative band power;
  - an optional 10-second timeline of at most 360 points.
- **Never stored:**
  - raw samples, AUX, PPG or motion streams;
  - device serials or MACs;
  - per-user baselines;
  - full-resolution per-window features;
  - valence, arousal, emotion or any "state" label;
  - neurofeedback concepts such as `inZone`.

  The write schema rejects unknown keys, so these cannot be added silently, and readers drop any field they do not know. Raw capture, if ever wanted, is a separately consented schema version 2 backed by Cloud Storage.
- **Consent.** Profile consent gates every write (enforced by rules). Recordings live as long as the account and are deletable by the user.
- **Provenance.** Every recording carries `source: 'measured' | 'simulated'`. `device.model` always names the actual headset (`muse-2`, `muse-s`, `muse-s-athena` or `unknown`), never "simulated". Simulated recordings (demo mode, tests) keep that provenance wherever they appear. They are labelled as simulated and excluded from real EEG history and analytics. Whether production demo mode exists is NFCT-16's decision.

## The shared package

`shared/` is the one home for consumer-domain contracts and pure logic. The app imports it through the `@nfct/shared` alias (Vite and `tsconfig.app.json`); Cloud Functions will import the same code. It depends only on `zod`, and is type-checked strictly with no DOM or Node types (`tsconfig.shared.json`). A boundary test keeps it free of Firebase SDKs, `src/` and clinical code, and keeps EEG out of `shared/progress/`.

| Module | Contents |
| --- | --- |
| `domains.ts` | `DOMAIN_CATALOG`, domain IDs, weight schemas |
| `games/definition.ts` | `GameDefinition` contract and `defineGame()` invariant check |
| `games/seed.ts` | The session seed schema and `createSessionSeed` |
| `schemas/*.ts` | Zod schemas and `read*` mappers for the profile, game session, EEG recording and progress |
| `progress/unlocks.ts` | `unlockedStartLevel` |
| `progress/applySession.ts` | The `applySession` reducer, `validOutcome` / `outcomeFromResult`, `canApplyToProgress` and `rebuildProgress` |

`GameDefinition` fields:

- stable `id`, `gameVersion` and `scoringVersion`;
- `modes`, each with levels 1..N, `initiallyUnlockedStartLevel` and a deterministic `unlockPolicy`;
- `domainWeights`;
- `trialSchema` and `metricsSchema`;
- `limits`;
- a pure, deterministic `score()` that also returns the trusted `peakLevel`;
- `recordKey()` and `recordMetrics`, whose names must fit the stored record-name format (letters and digits);
- an optional versioned `performanceIndex`.

Timestamps are typed structurally (`FirestoreTimestamp`), so the same schemas read web SDK and Admin SDK documents.

## Consequences

- Adding a game means a `shared/games/<gameId>/` definition, plus its `gameId` in the rules allowlist and a rules deploy. A `gameId` with no scoring code cannot be processed.
- Clinical types, `storageEngine`, and the `clients`/`sessions` paths are not used by the consumer model and must not be extended to represent games (see AGENTS.md).
- Stage 1 sequence after this ADR:
  - NFCT-17: Mental Math definition;
  - NFCT-18: rules and indexes;
  - NFCT-19: Functions and trusted scoring;
  - NFCT-20: client repositories;
  - NFCT-21: playable Mental Math;
  - NFCT-22: summary and progress UI;
  - NFCT-23: deletion.
