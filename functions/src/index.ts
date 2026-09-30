import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/options';
import { onDocumentCreated } from 'firebase-functions/firestore';
import { processingContext } from './context';
import { handleSessionCreated } from './pipeline';

// NFCT Cloud Functions (2nd gen, Node 22). Stage 1 has one function: trusted
// session scoring. Nothing here is deployed by this repository's tooling;
// deploys are manual, by the owner, to a named project (AGENTS.md).
//
// Trust boundary: this code is the only writer of `result` and `processing`
// on users/{uid}/gameSessions/{sessionId} and of users/{uid}/progress/{gameId}
// (the rules deny clients both). It trusts only the session document's path,
// its server-clock createdAt, and its own frozen game-version modules; every
// other field is client-written and re-derived or bounded. It never reads
// eegRecordings.

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
 * writes `result` (performanceIndex null) and progress/{gameId} in one
 * transaction, exactly once. Retries are enabled; see handleSessionCreated.
 */
export const onGameSessionCreated = onDocumentCreated(
  { document: 'users/{uid}/gameSessions/{sessionId}', retry: true },
  async (event) => {
    await handleSessionCreated(context, { params: event.params, time: event.time });
  },
);
