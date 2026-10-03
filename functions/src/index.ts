import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/options';
import { onDocumentCreated } from 'firebase-functions/firestore';
import { onSchedule } from 'firebase-functions/scheduler';
import { processingContext } from './context';
import { handleSessionCreated } from './pipeline';
import { sweepSessions } from './sweep';

// NFCT Cloud Functions (2nd gen, Node 22). Stage 1 has trusted session scoring:
// the onGameSessionCreated trigger and the scheduled sweep that finishes what
// a trigger could not. Nothing here is deployed by this repository's tooling;
// deploys are manual, by the owner, to a named project (AGENTS.md).
//
// Trust boundary: this code is the only writer of `result` and `processing`
// on users/{uid}/gameSessions/{sessionId}, of users/{uid}/progress/{gameId},
// and of users/{uid}/stats/summary, dailyStats/{localDate} and
// achievements/{id} (NFCT-13; the rules deny clients all of them). It trusts only the session document's path,
// its server-clock createdAt, and its own frozen game-version modules; every
// other field is client-written and re-derived or bounded. It never reads
// eegRecordings. It reads accountDeletions/{uid} and writes nothing for a user
// whose account is being deleted.

/** Design section F: the same region as the Firestore database. */
const REGION = 'northamerica-northeast2';

// maxInstances bounds cost and write contention on one user's progress.
setGlobalOptions({ region: REGION, maxInstances: 10 });

const context = processingContext(getFirestore(initializeApp()), {
  log: {
    info: (message, fields) => logger.info(message, fields ?? {}),
    warn: (message, fields) => logger.warn(message, fields ?? {}),
    error: (message, fields) => logger.error(message, fields ?? {}),
  },
});

/**
 * Scores a newly created game session: validates it with its game version's
 * schemas, rescores it from its trials, runs the plausibility checks, and
 * writes `result` (performanceIndex null), progress/{gameId}, stats/summary,
 * dailyStats/{localDate} and any achievements it earns in one transaction,
 * exactly once. Retries are enabled; see handleSessionCreated.
 */
export const onGameSessionCreated = onDocumentCreated(
  { document: 'users/{uid}/gameSessions/{sessionId}', retry: true },
  async (event) => {
    await handleSessionCreated(context, { params: event.params, time: event.time });
  },
);

/**
 * Re-drives sessions without a result: pending ones whose trigger never ran,
 * failed ones, and unsupported ones this build can now process (sweep.ts).
 * Bounded per run; what a run leaves, the next run finds. Not deployed by this
 * repository (a scheduled function also needs Cloud Scheduler on the Blaze
 * plan); the admin re-drive script runs the same code on demand.
 */
export const sweepUnprocessedSessions = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'UTC', retryCount: 0 },
  async () => {
    await sweepSessions(context);
  },
);
