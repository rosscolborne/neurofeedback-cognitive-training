# ADR-001: Consumer domain model

- **Status:** Accepted, 29 September 2026
- **Card:** NFCT-5 (Stage 1, PR 1)
- **Design baseline:** [NFCT Consumer Firestore & Domain Model — Stage 1 Design](https://claude.ai/code/artifact/bd8c450e-199f-42ea-ba59-60ddcf7758cb).
  This ADR is the durable summary; the design holds the full reasoning, rules sketch, index plan and card sequence.
- **Code:** [`shared/`](../../shared/index.ts), imported as `@nfct/shared`; trusted scoring in [`functions/`](../../functions/src/index.ts)
- **Amended:** NFCT-17 (session seed, validity classification); NFCT-19 (decision 12, trusted session processing, and the notes it adds to decisions 2, 5, 6 and 8). Items marked **owner confirmation** are provisional until the owner confirms them.

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
- after processing, a server-written `result`;
- until then, optionally, server-written `processing` metadata saying why there is no result yet (decision 12).

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

The client generates the session ID when the game starts, so an EEG recording can reference it before anything is written. It writes the document once, when the session ends. Rules (NFCT-18) allow create only, with an exact key set and no `result` or `processing`. An offline retry either lands once or is refused as an update. Only trusted scoring adds `result` or `processing` afterwards (decision 12).

### 6. Trusted server scoring and aggregates

`onGameSessionCreated` (NFCT-19) is the only writer of `result` and `progress/{gameId}`, and writes both in one transaction:

1. validate the session with the game's schemas;
2. rescore it with the game's pure `score()`, which also replays the trusted peak level from the trials;
3. run plausibility checks and set `validity`;
4. write both documents.

It aims to process a user's sessions in play order, and its final progress does not depend on the order it actually processes them in (decision 12, NFCT-19).

| Validity | History | Totals | Records and unlocks |
| --- | --- | --- | --- |
| `valid` | Shown | Counted | Set, if the session completed; records go to the record set of the session's own `gameVersion` |
| `flagged` (e.g. RT floor, locked start level, the game's timing checks) | Shown | Counted | Never |
| `invalid` (schema failure, or a game's deterministic contract violation) | Kept for debugging | Not counted | Never |

- **Who classifies game checks.** Each game version owns and freezes the outcome of its own plausibility checks, so trusted scoring applies them generically. Mental Math v1 does this in `REASON_OUTCOMES` (NFCT-17):
  - `invalid`: contract violations a conforming client cannot produce, such as arithmetic, flags, time limits, level legality, staircase replay and seed reproduction;
  - `flagged`: statistical and timing checks;
  - `diagnostic`: reasons recorded on any result, including a valid one, that never change validity (a disagreeing client `peakLevel`, a summary mismatch).

  Trusted scoring adds its own reasons, such as `schema-invalid` and `start-level-locked`. This split is provisional pending owner confirmation.

- **Result variants.** `result` is a union on `validity`. Every variant carries the processing metadata that makes a session processed exactly once: `processedAt`, `scoringVersion`, `validity` and `reasons`, where a flagged or invalid result needs at least one reason. The one change a stored result can later undergo is the flagged-to-valid start-level upgrade (decision 12), which keeps `processedAt` and every scored value.
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
  - **Trusted scoring (NFCT-19)** reads the session inside the transaction and skips it when `result.processedAt` is already set. `result` and `progress` are then written in that same transaction. The start-level upgrade applies only `applyValidEffects`, which is idempotent and never touches totals (decision 12).
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
| `scoringVersion` | Catalogue and `result` | `score()` or the performance index changes | New sessions use it. Stored results stay as written (except the start-level upgrade, decision 12, which never rescores); rescoring them is a deliberate, separate job. |
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
- **Unprocessed sessions are skipped.** Trusted scoring applies them when it processes them. Sessions with `processing` metadata (failed or unsupported) have no result and are skipped too; re-drive them first (decision 12).
- **Where it runs.** Trusted scoring rebuilds inside its processing transaction when it meets progress from an older `aggregateVersion`; the admin script `functions/scripts/rebuild-progress.ts` runs the same rebuild on demand (decision 12).

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

### 12. Trusted session processing (NFCT-19)

`onGameSessionCreated` is a 2nd-gen Firestore `onDocumentCreated` trigger on `users/{uid}/gameSessions/{sessionId}`, TypeScript on Node 22, in `northamerica-northeast2`, with retries enabled. Its decisions are pure functions in `shared/processing/` (`evaluateSession`, `decideSession`, `upgradeSession`), so the client preview could run the same checks; `functions/src/` only reads documents, runs those functions inside transactions and writes what they return. It never reads `eegRecordings`.

**Pipeline, per session** (card order):

1. **Validate** the client-written fields (any `result` or `processing` is ignored) with the session's own game version's schema, `trustedGameSessionSchemaFor(definition)`: strict, trials checked by the version's trial schema, the mode and the start level checked against the version's catalogue. The display `summary` is checked only for the structure the rules enforce (keys, types, at most 32 metrics; any number the rules accept, NaN and the infinities included). A failure is `invalid` with `schema-invalid`, with one exception: a session whose only fault is fields this build does not know in the envelope, `client` or `summary` is `unsupported` (`unknown-session-field`), not invalid. The rules gate those with exact key sets, so only a rules or client deploy that ran ahead of Functions can produce one; it is re-driven once Functions know the field (owner confirmation). An unknown *trial* field stays `schema-invalid`: the rules do not check trials, and a version's trial shape is frozen. **Deploy order: Functions first, then rules, then clients.**
2. **Rescore** with the version's pure `score()`, which also replays the trusted peak level.
3. **Check** with the version's frozen plausibility checks (Mental Math v1: `checkSession`, including seed reproduction), trusted scoring's path checks (`userId` equals the path uid, a valid session ID) and its clock diagnostics.
4. **Decide the start-level unlock** inside the transaction: `startLevel` above `unlockedStartLevel(mode, progress | null)` adds the flag `start-level-locked`.
5. **Write** `result` (with `performanceIndex: null`) and `progress/{gameId}` in one transaction, removing any stale `processing` in the same write.

**Validity.** The worst outcome among all reasons: a game version's own table (`REASON_OUTCOMES`) for its codes, and trusted scoring's `SERVER_REASON_OUTCOMES` for its own:

| Code | Outcome |
| --- | --- |
| `schema-invalid`, `user-id-mismatch`, `session-id-invalid` | invalid |
| `start-level-locked` | flagged |
| `start-level-unlocked-later`, `device-clock-ahead`, `late-upload`, `wall-clock-short`, `local-date-mismatch`, `unknown-timezone`, `reasons-truncated` | diagnostic |

- **Client summary and client `peakLevel` are diagnostics only.** A summary that disagrees with trusted scoring, or that the game's own summary schema rejects, is the game's `summary-mismatch`; a client peak that disagrees with the replayed one, even below the start level or beyond the mode, is `peak-level-mismatch`. The shared session schema therefore no longer refuses `peakLevel < startLevel` or a peak beyond the mode; it keeps the rules' 1–50 bound, and now refuses a *start* level beyond the mode (scoring and the staircase run from it).
- **Clock diagnostics** (owner confirmation): device clocks drift and offline sessions arrive late, so none of these changes validity. `device-clock-ahead`: `endedAt` more than 60 s after the server's `createdAt` (rules allow 5 min). `late-upload`: `createdAt` more than 7 days after `endedAt`. `wall-clock-short`: `endedAt − startedAt` more than 1 s shorter than `activeDurationMs`. `local-date-mismatch`: `localDate` more than one day from `endedAt`'s date in `timezone` (`unknown-timezone` when the zone is not recognised). What is clearly impossible is already refused by the rules and the schema (`endedAt <= startedAt`, `endedAt` beyond `request.time + 5 min`). Stage 2 may exclude `local-date-mismatch` sessions from streaks. Note (owner review): this check compares `localDate` with the device's `endedAt`, because offline sessions legitimately arrive days later; design section F compares it with the server's `createdAt`, which is what stops streak backfilling, so Stage 2 streak rules must use `createdAt` (a device clock can be set back).
- **Bounded reasons.** `result.reasons` holds at most 20. Trusted scoring merges each code once, most severe first (invalid, flagged, diagnostic; the version's canonical order, then its own), and a longer list keeps 19 and ends with `reasons-truncated`, so a result write can never fail validation and loop on retries. Validity is computed before any cut. Today the most a forged session can raise is exactly 20.

**Processing metadata.** `processing` is server-owned like `result` (rules forbid clients to write it): `{ state, reason, attempts, updatedAt }`. Writes accept only these states; reads accept any kebab-case state, so a build keeps reading sessions annotated by a newer server.

| State | Meaning | Set when | Cleared |
| --- | --- | --- | --- |
| none (pending) | no `result`, no `processing` | the client creates the session | when either is written |
| `unsupported` | no frozen module for its `gameId`/`gameVersion` (or its `schemaVersion`), or envelope fields this build does not know (`unknown-session-field`); never a judgement on the session | processing finds no module, or only unknown envelope fields | by the re-drive, once a deploy adds the module or the field |
| `failed` | processing kept failing past its retry window | the trigger's retry window ends (reason: `progress-newer-than-code`, `progress-unreadable`, `session-unreadable` or `internal-error`) | by a successful re-drive |

- `processing` is only ever written in a transaction that re-checks the session has no `result`, so it never replaces or coexists with one. A success deletes it in the same write that adds `result`. `attempts` counts each recorded state.
- **Retries** (owner confirmation). Any processing error is rethrown while the trigger event is younger than 30 minutes, so the platform redelivers it with backoff; after that the reason is recorded as `failed` and the delivery ends. The re-drive script (`functions/scripts/redrive-sessions.ts`) finds pending sessions with the collection-group `createdAt` index and failed or unsupported ones with the (`processing.state`, `createdAt`) index, and runs them through the same pipeline in play order per user. A scheduled sweep can call the same function later; none is deployed in Stage 1.

**Exactly once.** The processing transaction reads the session and exits if `result` exists; otherwise it evaluates exactly the document it read, reads progress, and writes `result` and progress together. Duplicate or concurrent deliveries serialise on the session and skip, so totals are applied exactly once.

**Out-of-order delivery** (owner confirmation; replaces the card's "throw a retryable error"). When a session would be flagged `start-level-locked` under the progress stored now, trusted scoring first processes the user's *truly pending* earlier sessions of the same game (no `result` and no `processing`, earlier in play order), oldest first, each through the same pipeline in its own transaction, then decides with fresh progress. So a session an earlier, still-unprocessed session unlocked is not flagged, which is the card's intent, without depending on redelivery (the Functions emulator never retries, and platform backoff can take minutes) and without ever waiting on a session that is stuck, failed or unsupported, so it cannot deadlock. The scan reads at most 200 recent sessions (newest `createdAt` first, within 24 hours, projected without trials) and processes at most 10. What it cannot see, such as another device's session that arrives later or anything past the budget, is repaired by the upgrade below.

**The start-level upgrade** (owner confirmation; deliberately amends "processed exactly once" in decision 6 and "stored results stay as written" in decision 8). A session flagged *only* because its start level was locked when it was processed becomes valid once progress unlocks that level, whichever session unlocked it and in whatever order they were processed.

- **Upgradable:** its stored result is flagged with `start-level-locked`; every other reason is a diagnostic of its own game version or of trusted scoring (`reasons-truncated` does not count); its own version's module is registered and wrote the result with the module's current `scoringVersion` (after a `scoringVersion` bump older flagged sessions stay flagged until a deliberate rescoring job); its start level is now at or below `unlockedStartLevel(mode, progress)`.
- **What changes:** `validity` becomes `valid`; `start-level-locked` leaves the reasons and the diagnostic `start-level-unlocked-later` joins them; `recordKey` and `recordValues` are computed by the session's own version's module from the stored trusted values (never by rescoring), and `personalBest` and `unlocked` as of the upgrade; progress gains only the session's valid-only effects through `applyValidEffects` (records in the session's own game version's record set, best peak level, cached unlocks).
- **What never changes:** `processedAt`, `scoringVersion`, the stored scored values (score, accuracy, response times, trusted peak, metrics, performance index, domain contributions), and the totals, which were counted once when the session was processed as flagged. Nothing ever downgrades a session.
- **When:** after any processing transaction that raised the unlocked start level (the only event that can make a stored session upgradable), after a rebuild, on redelivery of an already-valid session, and from the admin scripts.
- **How:** it queries the merged index (`gameId`, `modeId`, `result.validity == 'flagged'`, `startLevel == level`) for each start level up to the unlocked level, through a projection without trials, paging with cursors to the end of each level, so sessions flagged for other reasons cannot hide an upgradable one (`result.reasons` is index-exempt, so they cannot be filtered out in the query). It re-checks each candidate in its transaction (at most 20 per transaction) and repeats for the newly unlocked levels while its own upgrades raise the unlocked level, to a fixpoint. Each flagged session is read at most once per call.
- **Budgets, and what is guaranteed:** a trigger's reconcile reads at most 1,000 flagged documents and makes at most 100 upgrades per call. When it runs out it stops, reports `budget` and logs a warning; nothing is lost, but the rest is only finished by another reconcile, and a trigger reconciles again only when an unlock rises or a valid session is redelivered. The admin scripts (`rebuild-progress`, and `redrive-sessions`, for every user they touch or the one given with `--uid`) reconcile with **no budget**, examining every flagged session at every unlocked level, so they always complete it. Reaching the budget needs more than 1,000 sessions flagged for other reasons at or below the user's unlocked level.
- **Why this is order-independent:** totals are counted once per counted session whatever the order, and a session is marked valid only when progress already justifies it. When every reconcile has run to its fixpoint (no call stopped at its budget), every start-level-locked session the final progress unlocks has been upgraded, so the valid set, and with it every max-based record, best peak and unlock, is the same fixpoint for every order. If a trigger's reconcile stopped at its budget, that holds once the admin reconcile has run. A property test checks both over random session sets and orders (with and without a tight scan budget), and a rebuild from the stored results reproduces live progress. Session results stay point-in-time facts: `personalBest`, `unlocked` and the `start-level-unlocked-later` note depend on when a session was processed.

**`applyValidEffects(progress, input)`** (shared) is the valid-only half of `applySession`: pure, idempotent (applying it twice equals once, including `updatedAt` for the same `appliedAt`), and it never touches totals. `applySession` is now the session's totals followed, for a valid session, by `applyValidEffects`; its behaviour is unchanged.

**Game-version module registry.** `GAME_MODULE_REGISTRY` maps (`gameId`, `gameVersion`) to the frozen module that validates, rescores and checks sessions of exactly that version (Mental Math v1: an adapter over `mentalMathV1`). A session is only ever judged by its own version's module; progress is maintained with the game's newest registered version. A test keeps the rules' `supportedGameVersions()` window inside the registry.

**Aggregate compatibility.** Before applying a session, trusted scoring classifies the stored progress by its versions before reading its shape:

- same `aggregateVersion`, `gameVersion` no newer than the newest registered module: apply;
- older `aggregateVersion`: rebuild it inside the processing transaction from the stored trusted results (`rebuildProgress`, a projection without trials, never rescoring), then apply;
- newer `schemaVersion`, `aggregateVersion` or `gameVersion` than this build knows (a rollback or a mixed deploy): never written. The delivery is retried, and the session marked `failed` with `progress-newer-than-code` after the window, for newer code to re-drive;
- unreadable but not newer: `failed` with `progress-unreadable`. The admin rebuild replaces it (a repair).

The rebuild reads every processed session of the game in one transaction (about 1 KB each, no trials). That only happens after an `aggregateVersion` bump or an admin rebuild; a very long history would need a paged rebuild (follow-up).

**Admin scripts** (`functions/scripts/`, run with `npm run functions:rebuild-progress` and `npm run functions:redrive-sessions`) run on an operator's machine with the Admin SDK and are not deployed. There is no default project: `--project` is required, the emulator accepts only a `demo-*` project, and a real project needs `--live` and the operator's Application Default Credentials. Both scripts run the start-level upgrade with no budget.

**Bounded work per invocation.** Excluding the rare in-transaction rebuild, one trigger invocation reads at most about 1,450 documents, almost all projected without trials: about 35 for the session, its progress and up to 10 inline predecessors; 200 for the predecessor scan; and per reconciled game mode 1,000 flagged sessions, up to 10 progress reads and at most 200 in the upgrade transactions. It writes at most about 220: 11 sessions with their progress, and 100 upgrades, each batch also rewriting progress. The predecessor scan runs only when a session would be start-level-locked, and the reconcile only after an unlock rises, which happens at most once per level per mode, so a user who writes many sessions does not multiply this work.

## The shared package

`shared/` is the one home for consumer-domain contracts and pure logic. The app imports it through the `@nfct/shared` alias (Vite and `tsconfig.app.json`); Cloud Functions import the same code through the same alias, and `functions/build.mjs` bundles it (with zod) into the deployable `functions/lib/index.js`, because a deploy uploads `functions/` alone. It depends only on `zod`, and is type-checked strictly with no DOM or Node types (`tsconfig.shared.json`). A boundary test keeps it free of Firebase SDKs, `src/` and clinical code, and keeps EEG out of `shared/progress/`.

| Module | Contents |
| --- | --- |
| `domains.ts` | `DOMAIN_CATALOG`, domain IDs, weight schemas |
| `games/definition.ts` | `GameDefinition` contract and `defineGame()` invariant check |
| `games/seed.ts` | The session seed schema and `createSessionSeed` |
| `games/mental-math/` | Mental Math: one frozen module per `gameVersion` (`v1/`), and the simulation script |
| `schemas/*.ts` | Zod schemas and `read*` mappers for the profile, game session, EEG recording and progress |
| `progress/unlocks.ts` | `unlockedStartLevel` |
| `progress/applySession.ts` | The `applySession` reducer (totals, then `applyValidEffects`), `validOutcome` / `outcomeFromResult`, `canApplyToProgress` and `rebuildProgress` |
| `processing/` | Trusted scoring's pure decisions (NFCT-19): the game-version module registry, `evaluateSession`, `decideSession`, `upgradeSession`, reason merging and clock diagnostics |

`GameDefinition` fields:

- stable `id`, `gameVersion` and `scoringVersion`;
- `modes`, each with levels 1..N, `initiallyUnlockedStartLevel`, a deterministic `unlockPolicy` and an optional `runDurationMs` (design section C; Mental Math `timed-90`: 90 s);
- `domainWeights`;
- `trialSchema` and `metricsSchema`;
- `limits`;
- a pure, deterministic `score()` that also returns the trusted `peakLevel`;
- `recordKey()` and `recordMetrics`, whose names must fit the stored record-name format (letters and digits);
- an optional versioned `performanceIndex`.

Timestamps are typed structurally (`FirestoreTimestamp`), so the same schemas read web SDK and Admin SDK documents.

## Consequences

- Adding a game means a `shared/games/<gameId>/` definition, plus its `gameId` in the rules allowlist and a rules deploy. A `gameId` with no scoring code cannot be processed.
- Adding or retiring a game version means registering its frozen module in `shared/processing/modules.ts` before widening the rules' `supportedGameVersions()` window, and keeping it registered while any of its sessions may still need processing (decision 12). A session whose version has no module waits in `processing.state = 'unsupported'` until a deploy adds one.
- Trusted scoring is a Cloud Functions codebase (`functions/`), built by bundling `shared/` into `functions/lib/`. Deploying it needs the Blaze plan and is a manual owner step; Stage 1 deploys nothing.
- Clinical types, `storageEngine`, and the `clients`/`sessions` paths are not used by the consumer model and must not be extended to represent games (see AGENTS.md).
- Stage 1 sequence after this ADR:
  - NFCT-17: Mental Math definition;
  - NFCT-18: rules and indexes;
  - NFCT-19: Functions and trusted scoring;
  - NFCT-20: client repositories;
  - NFCT-21: playable Mental Math;
  - NFCT-22: summary and progress UI;
  - NFCT-23: deletion.
