# ADR-001: Consumer domain model

- **Status:** Accepted, 29 September 2026
- **Card:** NFCT-5 (Stage 1, PR 1)
- **Design baseline:** [NFCT Consumer Firestore & Domain Model — Stage 1 Design](https://claude.ai/code/artifact/bd8c450e-199f-42ea-ba59-60ddcf7758cb).
  This ADR is the durable summary; the design holds the full reasoning, rules sketch, index plan and card sequence.
- **Code:** [`shared/`](../../shared/index.ts), imported as `@nfct/shared`; trusted scoring in [`functions/`](../../functions/src/index.ts)
- **Amended:** NFCT-17 (session seed, validity classification); NFCT-19 (decision 12, trusted session processing, and the notes it adds to decisions 2, 5, 6, 7 and 8); NFCT-13 part 1 (decision 13, streaks, daily stats and achievements). Items marked **owner confirmation** are provisional until the owner confirms them.

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
| `users/{uid}/stats/summary`, `dailyStats/{localDate}`, `achievements/{id}` | Cross-game totals, the streak, daily activity and earned achievements (decision 13) | Server only |
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

**Writing a session and its recording (NFCT-20).** They are two writes, never one batch:

1. The session is written on its own when the game ends (decision 5). Nothing about EEG can delay or refuse it.
2. The recording is a separate create, written after the session is queued, and only once the server has confirmed consent (decision 11).

- **Why not one batch.** A batch is all or nothing, so any EEG-side refusal would also discard the completed session: consent withdrawn on another device, a stale consent read, or invalid EEG data. After an app restart that loss would be silent. EEG is optional and must never cost play.
- **Why it is safe.**
  - The rules evaluate each recording create on its own when it reaches the server: the linked session must exist (`existsAfter`) and the profile must record consent (`getAfter`).
  - The SDK sends one user's queued writes in order, including across tabs and after a restart (the queue is persistent). A recording queued after its session therefore arrives after it.
  - If the session is refused, its recording is refused too, so no recording can exist without its session.
  - Sessions stay create-only and recordings create-or-delete. A resend after a lost acknowledgement is refused as an update and never duplicates either document.
- **One recording per session.** A recording's document ID is its session's ID, so the create-only rules refuse a second recording for a session from any tab, device or retry. A refused second write is reported as refused (`already-recorded`) unless the stored recording is exactly what it wrote (a lost acknowledgement). Once the user deletes a recording, the rules would accept a new one for that session, but the client never offers one again: the recording exists only in memory, in the run that captured it.
- **Nothing relied on the atomicity.** Scoring and progression never read EEG, and "has EEG?" is still the `gameSessionId` query. On other devices a recording may briefly lag its session.
- **Separate outcomes.** The client reports the session (queued, then acknowledged or refused) and the recording separately. A recording is queued, then acknowledged or refused with a reason; or it is skipped with a reason. The UI can therefore say "game saved, EEG not saved" and why.

### 4. Trust boundary

The client writes only its profile preferences, a finished session (raw trials plus a display summary) and EEG recordings. Everything that counts is computed from the trials by trusted server code: validity, the score every screen uses, records and unlocks. Assume a motivated user can forge anything the client writes; the design limits that forgery to the forger's own view. Leaderboards would need server-issued seeds and server-timed trials, not more client validation.

### 5. Sessions are write-once

The client generates the session ID when the game starts, so an EEG recording can reference it before anything is written. It writes the document once, when the session ends, on its own (decision 3). Rules (NFCT-18) allow create only, with an exact key set and no `result` or `processing`. An offline retry either lands once or is refused as an update. Only trusted scoring adds `result` or `processing` afterwards (decision 12).

### 6. Trusted server scoring and aggregates

`onGameSessionCreated` (NFCT-19) is the only writer of `result` and `progress/{gameId}`, and writes both in one transaction:

1. validate the session with the game's schemas;
2. rescore it with the game's pure `score()`, which also replays the trusted peak level from the trials;
3. run plausibility checks and set `validity`;
4. write both documents.

It processes each session independently, in whatever order sessions arrive, and its final progress does not depend on that order: no device clock decides what is processed first (decision 12, NFCT-19).

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
- **Stage 1 progress is limited.** It holds only personal bests, best peak level, unlocked start levels, completed-session count, active time and last-played time. Streaks, daily stats and achievements are separate cross-game aggregates (decision 13); weekly goals are computed on read; domain indexes and leaderboards are later stages.

`applySession(progress | null, { definition, sessionId, session, outcome, appliedAt })` works as follows:

- **Trusted input only.** The outcome is either `validOutcome(definition, { modeId, startLevel }, scored)` for a session just scored, or `outcomeFromResult(result)` for a stored one. It holds the validity and, for a valid session, the trusted peak, record key and record values. The reducer never reads the client's `peakLevel`.

- **Deterministic and non-mutating.** It reads no clock and never mutates its inputs.
- **Not idempotent.** Applying the same session twice adds its totals twice (records, best peak level and unlocks are max-based and unaffected). Progress stores no session ledger. Exactly-once application is the caller's responsibility:
  - **Trusted scoring (NFCT-19)** reads the session inside the transaction and skips it when `result.processedAt` is already set. `result` and `progress` are then written in that same transaction. The start-level upgrade applies only `applyValidEffects`, which is idempotent and never touches totals (decision 12).
  - **Rebuilds** start from empty progress and replay each stored session once, in session ID order: a deterministic order, never a device clock, that the result does not depend on.
  - **The client preview (NFCT-20, NFCT-22)** de-duplicates pending sessions in transient client state, never in persisted progress. Progress and a session's `result` land in one commit but may arrive through separate listeners. To avoid a transient double preview, treat a session as pending only until its trusted `result` is observed, and coordinate the two listeners (for example with `onSnapshotsInSync`) before combining cached progress with pending sessions.
- **Missing progress.** An invalid session on missing progress leaves it missing. The first valid or flagged session creates the document.
- **Deterministic ties.** A higher value takes a record. On an equal value the earlier achievement (`endedAt`) keeps it, and then the lower session ID. The result never depends on the order in which triggers or a rebuild apply sessions. This tie-break, and `lastPlayedAt`, are the only uses of `endedAt` in progress; it never decides the order sessions are processed, re-driven or replayed in.
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
- **Trusted scoring stops at the ledger** (NFCT-19). Every transaction that writes a session's `result` or `processing`, or progress, reads `accountDeletions/{uid}` and writes nothing once it exists (decision 12). Because that read is part of the transaction, a processing commit either precedes the ledger write or sees the ledger, so the ledger must be written before the recursive delete (step 1 before step 3, as listed) and no processing commit can recreate data after the delete has listed it.

### 8. Versioning: four integers, each with one job

| Version | Lives on | Bump when | Effect |
| --- | --- | --- | --- |
| `schemaVersion` | Every document | A field is changed, removed or repurposed, or an existing enum gains a value (the domain catalogue excepted). Adding an optional field is not a bump. | Readers upcast in memory via one mapper per collection (`readUserProfile`, `readGameSession`, `readEegRecording`, `readGameProgress`). Rules accept current and current − 1. |
| `gameVersion` | Catalogue and each session | Scores stop being comparable (new levels, changed ramp) | A new record set starts; the previous one moves to `progress.bestsArchive`. Earned unlocks carry over. |
| `scoringVersion` | Catalogue and `result` | `score()`, the performance index, or any plausibility check or threshold that can change a session's validity changes (a game version's checks, or trusted scoring's own validity-changing checks) | New sessions use it. Stored results stay as written (except the start-level upgrade, decision 12, which never rescores and refuses a result written under another `scoringVersion`); rescoring them is a deliberate, separate job. |
| `aggregateVersion` | Each aggregate | A reducer changes | That user's aggregates are rebuilt from sessions. Derived data is never migrated. |

**Strict writes, tolerant reads.**

- **Writes are strict.** Each collection has a write schema for the current version (`*WriteSchema`) that rejects unknown fields, and rules enforce the same exact key set.
- **Reads are tolerant.** The `read*` mappers drop fields they do not understand, so an older build can read a document from a newer compatible writer. That is why adding an optional field needs no `schemaVersion` bump, while changing, removing or repurposing a field does.
- **Domain IDs are the one open set.** Readers ignore domain contributions whose ID this build's catalogue does not know (decision 10).
- **Unreadable documents.** A document whose `schemaVersion` a build cannot read throws `DomainReadError`. Repositories (NFCT-20) treat it as unreadable rather than crash.

**Rebuilds across game versions.** `rebuildProgress(definition, sessions, appliedAt)` is the pure rebuild:

- **Stored results, not rescoring.** It replays each processed session once from its stored trusted result, in session ID order. The order only makes the replay deterministic and is never a device clock. Totals are sums, and records, best peak level and unlocks are maxima with deterministic ties, so any order gives the same progress. Property tests check it against live processing in random orders, and against folding the same stored results in shuffled orders.
- **Old sessions are never re-checked.** A session is never revalidated against, or rescored with, a later game version's schemas or scoring. `readGameSessionFor(definition)` applies only to the definition's exact `gameVersion`; older sessions are read with `readGameSession`.
- **Old records stay archived.** Records stay in the record set of the session's own `gameVersion`, so earlier sets move into `bestsArchive` rather than disappear. A late session of an earlier version lands in that version's archived set.
- **Unlocks survive by default.** `bestPeakLevel` spans every game version, and `unlockedStartLevel` clamps it to the current mode's levels, so a routine rebuild or version bump never revokes an earned unlock. A future version whose levels change meaning must define an explicit migration instead, for example a new mode ID.
- **Unprocessed sessions are skipped.** Trusted scoring applies them when it processes them. Sessions with `processing` metadata (failed or unsupported) have no result and are skipped too; re-drive them first (decision 12).
- **Where it runs.** Trusted scoring rebuilds inside its processing transaction when it meets progress from an older `aggregateVersion`; the admin script `functions/scripts/rebuild-progress.ts` runs the same rebuild on demand, in one transaction, so a session processed concurrently is either in the rebuild or applied after it (decision 12).

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
- **Consent.** Profile consent gates every write, and the rules check it again when a recording reaches the server.
  - **When the client writes a recording.** Only when consent is positively established: the server's copy of the profile, read when the game ends within a short bound (1.5 s), records consent, and this device has no unacknowledged consent change.
  - **Never the cached profile.** A cached copy can still show consent withdrawn on another device. Offline, on a stalled connection, or without a timely server answer, the recording is not saved (`consent-unavailable`). The session is saved regardless.
  - **The remaining window** runs from that read until the write reaches the server, normally milliseconds. If consent is withdrawn in it, the rules refuse the recording (`consent-withdrawn`). If the device goes offline in it, the recording waits in the device's queue, and the rules decide when it arrives.
  - **A later relaxation is the owner's call.** Accepting a cached grant would keep EEG from offline play, and the rules would still refuse it if consent were gone. It was not chosen: a recording captured while consent was withdrawn elsewhere could be accepted under a later re-grant, and EEG would wait in the device's queue after a withdrawal.
  - Recordings live as long as the account and are deletable by the user.
- **Provenance.** Every recording carries `source: 'measured' | 'simulated'`. `device.model` always names the actual headset (`muse-2`, `muse-s`, `muse-s-athena` or `unknown`), never "simulated". Simulated recordings (demo mode, tests) keep that provenance wherever they appear. They are labelled as simulated and excluded from real EEG history and analytics. Whether production demo mode exists is NFCT-16's decision.

### 12. Trusted session processing (NFCT-19)

`onGameSessionCreated` is a 2nd-gen Firestore `onDocumentCreated` trigger on `users/{uid}/gameSessions/{sessionId}`, TypeScript on Node 22, in `northamerica-northeast2`, with retries enabled. A scheduled sweep, `sweepUnprocessedSessions`, finishes what a trigger could not. The decisions are pure functions in `shared/processing/` (`evaluateSession`, `decideSession`, `upgradeSession`, `classifyProgress`), so the client preview could run the same checks; `functions/src/` only reads documents, runs those functions inside transactions and writes what they return. It never reads `eegRecordings`, and EEG is never an input to any of it.

**Invariants.**

- Processing is order-independent. Each session is processed on its own, whenever it arrives; no device clock (`endedAt`) ever decides what is processed first, and the final progress and validities are the same for every order and under concurrency.
- Totals enter progress exactly once per counted session. Reapplying the valid-only effects cannot add them again.
- No automatic transition lowers validity. The one later change a result can undergo is the start-level upgrade, flagged to valid.
- Rebuilds use stored trusted results and never rescore; each game version is only ever judged by its own frozen module.
- A build never writes progress written by newer code, and never judges a session of a version it cannot process.
- Client summary and client peak mismatches are diagnostics only.
- `personalBest` and `unlocked` on a result describe the session's effect when it was processed or upgraded (below).

**Pipeline, per session.** Before the transaction, with no locks held and never repeated when the transaction retries on contention:

1. **Resolve** the session's frozen game-version module (`GAME_MODULE_REGISTRY`); none means `unsupported`.
2. **Validate** the client-written fields (any `result` or `processing` is ignored) with that version's `trustedGameSessionSchemaFor(definition)`: the envelope and trials strictly, the mode and start level against the version's catalogue, and the display `summary` only for the structure the rules enforce (keys, types, at most 32 metrics; any number the rules accept, NaN and the infinities included). A failure is `invalid` with `schema-invalid`, with one exception: a session whose only fault is fields this build does not know in the envelope, `client` or `summary` is `unsupported` (`unknown-session-field`), not invalid. The rules gate those with exact key sets, so only a rules or client deploy that ran ahead of Functions can produce one; it is re-driven once Functions know the field (owner confirmation). An unknown *trial* field stays `schema-invalid`: the rules do not check trials, and a version's trial shape is frozen. **Deploy order: Functions first, then rules, then clients.**
3. **Rescore** with the version's pure `score()`, which also replays the trusted peak level.
4. **Check** with the version's frozen plausibility checks (Mental Math v1: `checkSession`, including seed reproduction), trusted scoring's path checks (`userId` equals the path uid, a valid session ID) and its clock diagnostics.

Then one transaction:

5. Re-read the session and stop if it already has a `result`.
6. Stop, writing nothing, if `accountDeletions/{uid}` exists (decision 7).
7. Use the evaluation only if the document is exactly the version evaluated (same `updateTime`); otherwise evaluate what the transaction read.
8. `unsupported`: record `processing.state = 'unsupported'` and stop. `invalid`: write the result alone; it counts nowhere, so progress is not even read.
9. Classify progress (below): apply it, rebuild an older aggregate inside the transaction, or refuse progress from newer code.
10. **Decide the start-level unlock:** `startLevel` above `unlockedStartLevel(mode, progress | null)` adds the flag `start-level-locked`.
11. If the decision raised the unlocked start level (or progress was rebuilt), **upgrade**, in this same transaction, the start-level-locked sessions the new progress unlocks (below). A session flagged `start-level-locked` against progress its own transaction rebuilt joins that cascade as well. So if the cascade unlocks its level, it is upgraded in the same commit, exactly as if it had been processed after the cascade; its totals are still counted once.
12. **Write** the `result` (with `performanceIndex: null`), progress and every upgraded result in one commit, removing any stale `processing` in the same write.

**Validity.** The worst outcome among all reasons: a game version's own table (`REASON_OUTCOMES`) for its codes, and trusted scoring's `SERVER_REASON_OUTCOMES` for its own:

| Code | Outcome |
| --- | --- |
| `schema-invalid`, `user-id-mismatch`, `session-id-invalid` | invalid |
| `start-level-locked` | flagged |
| `start-level-unlocked-later`, `device-clock-ahead`, `late-upload`, `wall-clock-short`, `local-date-mismatch`, `local-date-inconsistent`, `unknown-timezone`, `reasons-truncated` | diagnostic |

- **Client summary and client `peakLevel` are diagnostics only.** A summary that disagrees with trusted scoring, or that the game's own summary schema rejects, is the game's `summary-mismatch`; a client peak that disagrees with the replayed one, even below the start level or beyond the mode, is `peak-level-mismatch`. The shared session schema therefore no longer refuses `peakLevel < startLevel` or a peak beyond the mode; it keeps the rules' 1–50 bound, and now refuses a *start* level beyond the mode (scoring and the staircase run from it).
- **Clock diagnostics** (owner confirmation). Device clocks drift and offline sessions arrive late, so none of these changes validity:
  - `device-clock-ahead`: `endedAt` more than 60 s after the server's `createdAt` (the rules allow 5 min);
  - `late-upload`: `createdAt` more than 7 days after `endedAt`;
  - `wall-clock-short`: `endedAt − startedAt` more than 1 s shorter than `activeDurationMs`;
  - `local-date-mismatch` (design section F): `localDate` more than one day from the date of the server's `createdAt` in `timezone`. The server clock cannot be set back, so this is the anti-backfill signal Stage 2 streak rules should use. An honest session played offline and uploaded more than a day later raises it too, because from the server's point of view its date really is in the past;
  - `local-date-inconsistent`: `localDate` more than one day from the date of the device's own `endedAt` in `timezone`. The client's fields disagree with each other (a date or time-zone bug, or an edited `localDate`), whatever the server clock says. It catches a device clock set back with today's `localDate`, which `local-date-mismatch` cannot;
  - `unknown-timezone` replaces both date checks when the zone is not recognised.

  What is clearly impossible is already refused by the rules and the schema (`endedAt <= startedAt`, `endedAt` beyond `request.time + 5 min`).
- **Bounded reasons.** `result.reasons` holds at most 20. Trusted scoring merges each code once, most severe first (invalid, flagged, diagnostic; the version's canonical order, then its own), and a longer list keeps 19 and ends with `reasons-truncated`, so a result write can never fail validation and loop on retries. Validity is computed before any cut, and severity order means only diagnostics are ever cut. Today the most a forged session can raise is 21 codes, which makes it invalid and cuts its stored list; a valid or flagged session raises at most 11.
- **Thresholds are versioned.** A change to any check or threshold that can change validity, in a game version's module or in trusted scoring, bumps `scoringVersion` (decision 8), so sessions judged under the old rule are never upgraded under the new one. Reason codes are append-only: a stored result keeps its codes, and the upgrade looks each one up.

**Processing metadata.** `processing` is server-owned like `result` (rules forbid clients to write it): `{ state, reason, attempts, updatedAt }`. Writes accept only these states; reads accept any kebab-case state, so a build keeps reading sessions annotated by a newer server. It is never terminal: it says why there is no result yet, and the next successful processing deletes it in the same write that adds the result.

| State | Meaning | Set when | Cleared |
| --- | --- | --- | --- |
| none (pending) | no `result`, no `processing` | the client creates the session | when either is written |
| `unsupported` | no frozen module for its `gameId`/`gameVersion` (or its `schemaVersion`), or envelope fields this build does not know (`unknown-session-field`); never a judgement on the session | processing finds no module, or only unknown envelope fields | by the sweep or the re-drive, once a deploy adds the module or the field |
| `failed` | processing kept failing past its retry window | the trigger's retry window ends, or a sweep or re-drive fails (reason: `progress-newer-than-code`, `progress-unreadable`, `session-unreadable` or `internal-error`) | by a successful sweep or re-drive |

- `processing` is only ever written in a transaction that re-checks the session has no `result` and the account is not being deleted, so it never replaces or coexists with a result. `attempts` counts each recorded state.
- **Retries** (owner confirmation). Any processing error is rethrown while the trigger event is younger than 30 minutes, and nothing is written, so the platform redelivers it with backoff: a transient fault, contention past the SDK's own retries, or progress written by newer code. After that the reason is recorded as `failed` and the delivery ends.

**State machine.** For `users/{uid}/gameSessions/{id}`; `processedAt` is the trusted server clock when the result was first written.

| From | To | When | `processedAt` |
| --- | --- | --- | --- |
| pending, `failed`, `unsupported` | `result` valid, flagged or invalid; `processing` deleted in the same write | processing succeeds | set, once |
| pending, `unsupported` | `processing.state = 'unsupported'` | no module, or only unknown envelope fields | none (no result) |
| pending, `failed` | `processing.state = 'failed'` | an error still failing after the retry window, or a failed sweep or re-drive | none |
| pending (any state) | unchanged | a transient error or progress from newer code inside the retry window; or the account is being deleted | none |
| flagged, only `start-level-locked` plus diagnostics | valid | progress now unlocks its start level (the upgrade, below) | unchanged |
| invalid | never changes | no automatic or admin path reprocesses it; only the deliberate rescoring job of decision 8 could | unchanged |

**Exactly once.** The processing transaction reads the session and exits if `result` exists; otherwise it decides on exactly the document version it read, reads progress, and writes `result` and progress together. Duplicate or concurrent deliveries serialise on the session and skip, so totals are applied exactly once.

**Order independence** (owner decision; supersedes the card's "throw a retryable error so sessions are processed in play order" and "replay in `endedAt` order"). Sessions are processed independently, in whatever order they arrive. A session whose start level is still locked when it is processed is flagged `start-level-locked`; when a later commit unlocks that level, the upgrade makes it valid. The card's "two queued sessions processed out of order are not wrongly flagged" holds as an end state: once both are processed, the later session is valid, whichever was processed first.

- **Why not wait for earlier sessions.** Ordering by `endedAt` trusts a device clock, cannot see another device's offline queue, and waiting on an earlier session that is failed or unsupported would block later ones. A build that processed "earlier" pending sessions inline was considered and removed: correctness never depended on it (the upgrade already reaches the same end state), it ordered by `endedAt`, and it cost up to 200 reads and 10 extra transactions per locked session. What it improved, the transient flag and the point-in-time fields, is not part of the end state.
- **Why the end state is unique.** A session becomes valid only when the progress its transaction reads already justifies it (directly at processing, or through the upgrade). So the valid set is the least fixpoint: the sessions valid on their own merits at the initially unlocked level, plus, repeatedly, every start-level-locked session the valid set's best peak unlocks. Sessions that could only unlock each other never bootstrap each other and stay flagged. Every upgrade applies only max-based effects, and totals were counted at processing, so progress is the same fixpoint for every order.

**The start-level upgrade** (owner confirmation; deliberately amends "processed exactly once" in decision 6 and "stored results stay as written" in decision 8).

- **Upgradable:**
  - its stored result is flagged with `start-level-locked`;
  - every other reason is a diagnostic of its own game version or of trusted scoring;
  - its own version's module is registered and wrote the result with the module's current `scoringVersion` (after a `scoringVersion` bump, older flagged sessions stay flagged until a deliberate rescoring job);
  - its start level is now at or below `unlockedStartLevel(mode, progress)`.

  `reasons-truncated`, any other flag, and any code the module does not know block it. The plan said "exactly `['start-level-locked']`". This deliberately accepts diagnostics as well, because diagnostics never change validity. A session with, say, `summary-mismatch` processed after the session that unlocked it is valid; under the narrower rule the same session processed before it would stay flagged forever, so a diagnostic would decide validity and the end state would depend on order. `reasons-truncated` still blocks because a cut list might have hidden a flag (unreachable today: only invalid sessions can raise more than 20 codes).
- **What changes:**
  - `validity` becomes `valid`;
  - `start-level-locked` leaves the reasons and the diagnostic `start-level-unlocked-later` joins them;
  - `recordKey` and `recordValues` are computed by the session's own version's module from the stored trusted values (never by rescoring);
  - `personalBest` and `unlocked` are as of the upgrade;
  - progress gains only the session's valid-only effects through `applyValidEffects` (records in the session's own game version's record set, best peak level, cached unlocks).
- **What never changes:** `processedAt`, `scoringVersion`, the stored scored values (score, accuracy, response times, trusted peak, metrics, performance index, domain contributions), and the totals, which were counted once when the session was processed as flagged. Nothing ever downgrades a session. The upgrade time is not stored on the result; `start-level-unlocked-later` records that it happened.
- **Where it runs, in order of preference:**
  1. **Inside the processing transaction whose decision raised the unlocked start level, or rebuilt progress.** That is the only event that can make a stored session upgradable. The transaction reads the candidates and writes them in its own commit, so there is no window in which progress unlocks a level while a session it unlocked is still flagged, and no crash can separate the two.
  2. Only when that transaction's bounded budget runs out, a **post-commit reconcile** in separate transactions.
  3. On **redelivery** of an already-valid session (covering a delivery that died between its commit and that reconcile), after an admin rebuild, and from the admin scripts with no budget.
- **How:**
  - It queries the merged index (`gameId`, `modeId`, `result.validity == 'flagged'`, `startLevel == level`) for each level from the lowest lockable one (above `initiallyUnlockedStartLevel`) up to the unlocked level, through a projection without trials. It pages with cursors to the end of each level, so sessions flagged for other reasons cannot hide an upgradable one (`result.reasons` is index-exempt, so they cannot be filtered out in the query).
  - It repeats for newly unlocked levels while its own upgrades raise the unlocked level, to a fixpoint.
  - Candidates are upgraded in scan order (start level, then session ID), never by a device clock. Final progress does not depend on that order; only the point-in-time `personalBest` and `unlocked` of each upgraded result do.
  - The post-commit reconcile re-checks each candidate in its own transaction, at most 20 per transaction.
- **Budgets, and what is guaranteed:**
  - The processing transaction reads at most 100 flagged documents and makes at most 20 upgrades.
  - A post-commit reconcile reads at most 1,000 and makes at most 100. When it runs out it stops, reports `budget` and logs a warning. Nothing is lost, but the rest is finished only by another reconcile: a later unlock, a redelivery, or the admin scripts (`rebuild-progress`, and `redrive-sessions` for every user it touches or the one given with `--uid`), which reconcile with **no budget**.
  - Reaching the transaction's budget needs more than 100 flagged sessions at or below the user's unlocked level; reaching the reconcile's needs more than 1,000. The sweep does not track budget-stopped reconciles (that would need a new marker or index). Such accounts are confined to the forger's own data and logged.
  - A property test checks convergence over random session sets and orders, with random tight transaction and reconcile budgets and the admin path, and checks that a rebuild from the stored results reproduces live progress.
- **What results mean.** Progress is order-independent; individual results are point-in-time facts. A result's `personalBest` says whether the session held a record in its own record set right after its commit (processing or upgrade), and `unlocked` lists the start levels that commit newly unlocked. Neither is updated when a later session takes the record, and an upgraded session's values reflect the progress at its upgrade.

**`applyValidEffects(progress, input)`** (shared) is the valid-only half of `applySession`: pure, idempotent (applying it twice equals once, including `updatedAt` for the same `appliedAt`), and it never touches totals. `applySession` is now the session's totals followed, for a valid session, by `applyValidEffects`; its behaviour is unchanged.

**Concurrency and locking.**

- All of one user's processing transactions for a game read and then write that game's progress document, so they serialise on it. Firestore transactions are serializable: with the server SDK's locks, a conflict aborts one transaction, and the SDK retries it with backoff. So contention delays a delivery but never loses an update. A transaction that still gives up after its SDK retries is rethrown and redelivered by the platform within the retry window.
- The in-transaction upgrade adds reads of at most 100 flagged documents and their query ranges. Every transaction that could write one of them (another processing transaction or an upgrade) also writes that progress document. So it adds no new conflict between transactions, only a longer lock hold, and it cannot create a deadlock cycle that the progress document did not already create.
- Emulator tests show it:
  - 2 sessions of one user, where one unlocks the other, delivered at once (5 rounds);
  - 7 sessions created at the same moment: a chain of 5 unlocks plus a pair that only unlock each other (3 rounds);
  - random sets processed concurrently.

  Each reaches exactly the sequential end state, with totals counted once. Two admin rebuilds racing three live deliveries lose no update, and several sessions racing to rebuild older progress rebuild it once.

**Deletion.** Every transaction that writes a session's `result` or `processing`, an upgrade, or progress (processing, `recordProcessingState`, the reconcile's upgrade batches, the admin rebuild) first reads `accountDeletions/{uid}` and, if it exists, writes nothing and records no state. A session of a deleted account is left as it is for the recursive delete. See decision 7 for why this also closes the race with the recursive delete.

**Game-version module registry.** `GAME_MODULE_REGISTRY` maps (`gameId`, `gameVersion`) to the frozen module that validates, rescores and checks sessions of exactly that version (Mental Math v1: an adapter over `mentalMathV1`). A session is only ever judged by its own version's module, including a late session of an earlier version, whose records go to that version's archived record set. Progress is maintained with the game's newest registered version. A session of a version this build has no module for is `unsupported`, never invalid, and is processed once a build registers it. A test keeps the rules' `supportedGameVersions()` window inside the registry.

**Aggregate compatibility** (`classifyProgress`, shared). Before applying a session, trusted scoring classifies the stored progress by its versions before reading its shape:

- same `aggregateVersion`, `gameVersion` no newer than the newest registered module: apply;
- older `aggregateVersion`: rebuild it inside the processing transaction from the stored trusted results (`rebuildProgress`, a projection without trials, never rescoring), then apply;
- newer `schemaVersion`, `aggregateVersion` or `gameVersion` than this build knows (a rollback or a mixed deploy): never written. The delivery is retried, and after the window the session is marked `failed` with `progress-newer-than-code` for newer code to re-drive. An older build therefore never overwrites progress, or an aggregate version, that a newer build wrote;
- unreadable but not newer: `failed` with `progress-unreadable`. The admin rebuild replaces it (a repair).

An invalid session needs none of this: it is written whatever state progress is in. The rebuild reads every processed session of the game in one transaction (about 1 KB each, no trials). That only happens after an `aggregateVersion` bump or an admin rebuild; a very long history would need a paged rebuild (follow-up).

**The sweep.** `sweepUnprocessedSessions` (scheduled hourly; exported but not deployed by this repository) calls the same re-drive core as the admin script, bounded per run:

- pending sessions created more than 60 minutes ago, which missed their trigger (a delivery stops retrying after 30 minutes and records `failed`, so only a delivery that never ran leaves a session pending);
- failed sessions with fewer than 5 recorded attempts;
- unsupported sessions this build now has a module for, under the same cap;
- at most 100 sessions per run, scanning at most 2,000 projected documents per state, within the last 7 days.

Sessions at the attempt cap are left for the admin re-drive (which has no cap) and logged as an error, which is what alerting should watch. Within a user, sessions are re-driven in server arrival order (`createdAt`, then session ID); the order changes nothing in the result.

**Admin scripts** (`functions/scripts/`, run with `npm run functions:rebuild-progress` and `npm run functions:redrive-sessions`) run on an operator's machine with the Admin SDK and are not deployed. There is no default project: `--project` is required, the emulator accepts only a `demo-*` project, and a real project needs `--live` and the operator's Application Default Credentials. Both scripts run the start-level upgrade with no budget. Neither reprocesses a session that has a result.

**Bounded work per invocation.**

- **Processing transaction** (excluding the rare in-transaction rebuild):
  - reads: the session (twice), the ledger, progress, and at most 100 flagged sessions (projected, plus one minimum-charge read per empty level query);
  - writes: at most 22 (the session, progress and 20 upgrades).
- **Post-commit reconcile**, only past that budget or on redelivery of a valid session:
  - reads: at most 1,000 flagged sessions, 10 progress reads and about 110 reads in its upgrade transactions;
  - writes: at most 105 (100 upgrades and 5 progress writes).

So one trigger invocation reads at most about 1,230 documents, almost all projected without trials, and writes at most about 130. The in-transaction upgrade runs only when the unlocked level rises, at most once per level per mode, or after a rebuild, and the reconcile only past the transaction's budget. A user who writes many sessions therefore pays about one small transaction per session. A sweep run reads at most 2,000 projected documents per state and processes at most 100 sessions.

### 13. Streaks, daily stats and achievements (NFCT-13)

Three more server-only aggregates, maintained by `onGameSessionCreated` in the **same transaction** as a session's `result` and `progress/{gameId}` (and by every transaction that upgrades a session), with the same exactly-once, order-independence, compatibility and deletion guarantees as progress (decision 12). The pure reducers are in `shared/stats/`; `functions/src/stats.ts` only reads and writes documents. EEG is never an input.

| Document | Holds |
| --- | --- |
| `stats/summary` | Activity: counted sessions, completed sessions, active time, last played. Progression: valid runs, best trusted peak level per game, the streak (training days as maximal runs of consecutive local dates, with `current`, `longest`, `lastActiveDate`) and the IDs of the achievements created |
| `dailyStats/{localDate}` | One per local date with a counted session: sessions, completed sessions, active time, and the same per game. Bucketed by the session's own `localDate` |
| `achievements/{id}` | One per achievement earned: `earnedAt` (server clock), the valid session that earned it, its game and local date. Created only if absent |

**Eligibility** (owner confirmation):

| Session | Activity (summary totals, `dailyStats`, weekly goal) | Valid runs, peak level, streak, achievements |
| --- | --- | --- |
| valid, completed | Counted | Counted; a training day only with a verified date |
| valid, abandoned | Counted | Never |
| flagged | Counted | Never, until the start-level upgrade makes it valid |
| invalid | Never | Never |

- **Training day.** A local date with at least one **valid, completed** session whose date the server verified: its result carries neither `local-date-mismatch` (the anti-backfill check against the server clock, decision 12) nor `unknown-timezone`, nor `reasons-truncated`. An honest session uploaded more than a day after it was played counts toward time played on its day, but does not make that day a training day.
- **Why valid only.** Flagged sessions count toward time played but never earn achievements; streak and run achievements read the streak and the valid-run count, so those count valid sessions only. Everything a session contributes is therefore fixed when it is processed, except its valid-only part, which the start-level upgrade adds at most once.
- **Streak liveness is read-time.** The summary stores the latest run whether or not it is still alive. `streakStatus(streak, today)` decides, with `today = localDateIn(profile timezone, now)`: alive while the latest training day is today or yesterday, otherwise `current` is 0.
- **Weekly goal, week and month views** are computed on read from at most 31 `dailyStats` documents and the profile's `weeklyGoal` (`shared/stats/views.ts`); nothing is stored for them. `sessions` counts completed sessions, `minutes` all active play, `activeDays` days with a completed session.
- **Achievement catalogue v1** (`ACHIEVEMENT_CATALOGUE`, provisional, owner to change freely): first run; 10, 50 and 100 runs; 3-, 7- and 30-day streaks; Mental Math level 5 and level 10. Gameplay-only criteria and plain copy, no cognitive, clinical or EEG claim. Titles and descriptions live in code, not in Firestore. A change to a criterion or to the set bumps `STATS_AGGREGATE_VERSION`, so trusted scoring rebuilds each player's stats and awards the new set from stored results; IDs are never reused.

**Exactly once and order independence.** Activity is sums applied when a session is first processed (the transaction skips a session that has a result). The valid-only part is applied once per session: when it is processed valid, or when it is upgraded (a session is upgraded at most once), in the processing transaction's cascade or in a post-commit upgrade batch. It is a count, a maximum and a set union of training days, so the final summary is the same for every processing order and equals a rebuild from the stored results. Achievement criteria are monotone in it and checked after every change, so the set earned does not depend on order; which session is credited, and `earnedAt`, are point-in-time facts like a result's `personalBest`.

**Compatibility.** One `aggregateVersion` covers the summary, every day and the achievement set:

- current: apply;
- older (or no summary although earlier sessions already count, because they were processed before NFCT-13): rebuild every stats document inside the processing transaction from the stored results, in `endedAt` order, then apply. "Older" is decided from the `schemaVersion` and `aggregateVersion` alone, before the shape is read, so a bump that also changes the shape rebuilds rather than failing sessions;
- newer, from newer code: never written; the session is retried and then marked `failed` with `stats-newer-than-code`;
- unreadable: the session is marked `failed` with `stats-unreadable` until the admin rebuild repairs it;
- a post-commit upgrade batch that meets newer or unreadable stats upgrades nothing and stops with `stats-not-current`; one that meets missing or older stats upgrades the session and progress and leaves the stats to the next rebuild, which then includes the upgrade.

**Rebuild.** `rebuildUserStats` (run by `npm run functions:rebuild-progress` after the progress rebuild and before the no-budget reconcile) replays every stored result in `endedAt` order in one transaction, overwrites the summary and every day, deletes days and catalogue achievements no session justifies, and creates missing achievements. An existing achievement keeps its original attribution. Like the progress rebuild, its read grows with the user's history (NFCT-35 tracks a paged rebuild).

**Cost.** A counted session's transaction adds two reads and two writes (summary and day), plus one read and one write per achievement earned, and one read the first time a player's summary is created.

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
| `schemas/stats.ts`, `stats/` | The stats, daily stats and achievement schemas and readers; the stats reducers, `rebuildStats` and compatibility classification; streak runs and `streakStatus`; the achievement catalogue; local-date arithmetic and the read-time week, month and weekly-goal views (decision 13) |
| `processing/` | Trusted scoring's pure decisions (NFCT-19): the game-version module registry, `evaluateSession`, `decideSession`, `upgradeSession`, `upgradeScanLevels`, `classifyProgress` (aggregate compatibility), reason merging and clock diagnostics |

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
