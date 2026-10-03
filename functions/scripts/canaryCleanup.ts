import { parseArgs } from 'node:util';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { resolveTarget, type CliEnvironment, type Output, type Target } from './cli';

// Owner-run cleanup of what the nfct-dev canary leaves behind
// (docs/nfct/nfct-dev-canary.md#cleanup). The canary deletes its own profile
// document and Auth account as an ordinary user, as account deletion in the
// app does; only server-side deletion (NFCT-23) removes the profile's
// subcollections, such as game sessions. Two kinds of leftover:
// - an account whose canary run never cleaned up: found by its Auth
//   account's canary email;
// - the data under users/{uid} of an account the canary did delete: nothing
//   there names the canary (consumer profiles hold no email), so the owner
//   names it with --uid, the UID the canary's cleanup printed before deleting
//   the account.
//
// Safety, beyond cli.ts's (no default project; --live for a real one):
// - a dry run unless --delete is given;
// - only nfct-dev, or a demo-* project on the emulators;
// - an Auth account is touched only if its email matches the canary pattern
//   exactly; any other account is refused, even when named, and never printed;
// - data with no Auth account is touched only when named with --uid;
// - only what was created more than --older-than-minutes ago (default 120, at
//   least 30): the server's creation time (the Auth account's, or else the
//   earliest document left under users/{uid}), compared with this machine's clock;
// - at most --max accounts (default 25); a larger plan aborts before deleting.
// Credentials are the operator's Application Default Credentials, never a key
// in the repository, and never a CI job's.

/** Every canary account's email; keep identical to scripts/canary/canary.mjs (a test checks). */
export const SMOKE_EMAIL_PATTERN = /^nfct-smoke\+[a-z0-9]{1,24}-[0-9]{1,4}-[a-z2-7]{10}@example\.test$/;

/** A Firebase Auth UID as a single path segment: no '/', and nothing Firestore treats specially. */
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The only real project the canary uses, and so the only one this cleans up. */
const CANARY_PROJECT_ID = 'nfct-dev';

const isCanaryEmail = (email: unknown): email is string => typeof email === 'string' && SMOKE_EMAIL_PATTERN.test(email);

/** The parts of Admin Auth the cleanup uses, so tests can supply their own. */
export interface CanaryAuth {
  listUsers(maxResults: number, pageToken?: string): Promise<{
    users: ReadonlyArray<{ uid: string; email?: string; metadata: { creationTime: string } }>;
    pageToken?: string;
  }>;
  getUser(uid: string): Promise<{ uid: string; email?: string; metadata: { creationTime: string } }>;
  deleteUser(uid: string): Promise<void>;
}

export type CanaryCandidate = {
  readonly uid: string;
  /** The Auth account's email; null when the account has none; undefined when there is no account. */
  readonly authEmail: string | null | undefined;
  /** Named by the owner with --uid, from a canary cleanup report. */
  readonly named: boolean;
  /** Server time: the Auth account's creation, or else the earliest document left under users/{uid}. */
  readonly createdAtMs: number;
};

export type CleanupPlan = {
  readonly remove: readonly CanaryCandidate[];
  readonly tooRecent: readonly CanaryCandidate[];
  readonly refused: ReadonlyArray<{ readonly uid: string; readonly reason: string }>;
};

/** Decides what may be deleted. Pure, so the rules are tested on their own. */
export function planCanaryCleanup(candidates: readonly CanaryCandidate[], { nowMs, olderThanMs }: { nowMs: number; olderThanMs: number }): CleanupPlan {
  const remove: CanaryCandidate[] = [];
  const tooRecent: CanaryCandidate[] = [];
  const refused: Array<{ uid: string; reason: string }> = [];
  for (const candidate of candidates) {
    if (candidate.authEmail !== undefined && !isCanaryEmail(candidate.authEmail)) {
      refused.push({ uid: candidate.uid, reason: 'its Auth account is not a canary account' });
    } else if (candidate.authEmail === undefined && !candidate.named) {
      refused.push({ uid: candidate.uid, reason: 'it has no Auth account and was not named with --uid' });
    } else if (candidate.authEmail === undefined && !Number.isFinite(candidate.createdAtMs)) {
      refused.push({ uid: candidate.uid, reason: 'it has no Auth account and nothing is left under users/{uid}' });
    } else if (!Number.isFinite(candidate.createdAtMs)) {
      refused.push({ uid: candidate.uid, reason: 'its creation time is unknown' });
    } else if (nowMs - candidate.createdAtMs < olderThanMs) {
      tooRecent.push(candidate);
    } else {
      remove.push(candidate);
    }
  }
  return { remove, tooRecent, refused };
}

const isNotFound = (error: unknown) => (error as { code?: unknown } | null)?.code === 'auth/user-not-found';

async function authAccount(auth: CanaryAuth, uid: string) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/** The earliest server create time of anything left under users/{uid}, or NaN when nothing is left. */
async function earliestLeftover(db: Firestore, uid: string): Promise<number> {
  const profile = db.doc(`users/${uid}`);
  const times: number[] = [];
  const snapshot = await profile.get();
  if (snapshot.exists && snapshot.createTime) times.push(snapshot.createTime.toMillis());
  for (const collection of await profile.listCollections()) {
    const documents = await collection.limit(50).get();
    for (const document of documents.docs) times.push(document.createTime.toMillis());
  }
  return times.length > 0 ? Math.min(...times) : Number.NaN;
}

/** Canary Auth accounts, up to the scan budget, and the UIDs the owner named. */
export async function findCanaryCandidates(db: Firestore, auth: CanaryAuth, scanBudget: number, namedUids: readonly string[] = []): Promise<CanaryCandidate[]> {
  const byUid = new Map<string, CanaryCandidate>();
  let scanned = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    scanned += page.users.length;
    for (const user of page.users) {
      if (!isCanaryEmail(user.email)) continue;
      byUid.set(user.uid, { uid: user.uid, authEmail: user.email, named: false, createdAtMs: Date.parse(user.metadata.creationTime) });
    }
    pageToken = page.pageToken;
    if (pageToken && scanned >= scanBudget) throw new Error(`Scanned ${scanned} Auth accounts without finishing; raise --scan-budget`);
  } while (pageToken);

  for (const uid of namedUids) {
    const known = byUid.get(uid);
    if (known) {
      byUid.set(uid, { ...known, named: true });
      continue;
    }
    const account = await authAccount(auth, uid);
    byUid.set(uid, {
      uid,
      authEmail: account ? account.email ?? null : undefined,
      named: true,
      createdAtMs: account ? Date.parse(account.metadata.creationTime) : await earliestLeftover(db, uid),
    });
  }
  return [...byUid.values()].sort((a, b) => a.createdAtMs - b.createdAtMs);
}

export type CanaryCleanupOptions = {
  readonly auth?: CanaryAuth;
  readonly db?: Firestore;
  readonly nowMs?: number;
};

export type CanaryCleanupReport = CleanupPlan & { readonly deleted: readonly string[]; readonly dryRun: boolean };

/**
 * `cleanup-canary-accounts --project <id> [--uid <uid> ...] [--older-than-minutes 120]
 *  [--max 25] [--scan-budget 10000] [--delete] [--live]`: lists, or with
 * --delete removes, the canary's leftover accounts and data.
 */
export async function runCanaryCleanup(argv: readonly string[], env: CliEnvironment, out: Output, options: CanaryCleanupOptions = {}): Promise<CanaryCleanupReport> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      project: { type: 'string' },
      'older-than-minutes': { type: 'string', default: '120' },
      max: { type: 'string', default: '25' },
      'scan-budget': { type: 'string', default: '10000' },
      uid: { type: 'string', multiple: true, default: [] },
      delete: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const target = resolveTarget(values.project, values.live, env);
  assertAuthTarget(target, env);
  if (!target.emulator && target.projectId !== CANARY_PROJECT_ID) throw new Error(`The canary runs only against ${CANARY_PROJECT_ID}; refusing ${target.projectId}`);
  const number = (name: string, value: string, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
    return parsed;
  };
  const olderThanMs = number('older-than-minutes', values['older-than-minutes'], 30, 525_600) * 60_000;
  const max = number('max', values.max, 1, 500);
  const scanBudget = number('scan-budget', values['scan-budget'], 1, 100_000);
  const namedUids = [...new Set(values.uid)];
  const invalid = namedUids.filter((uid) => !UID_PATTERN.test(uid));
  if (invalid.length > 0) throw new Error(`--uid must be a Firebase Auth UID; refusing ${invalid.map((uid) => JSON.stringify(uid)).join(', ')}`);

  const app = options.db && options.auth ? null : initializeApp({ projectId: target.projectId }, `nfct-canary-cleanup-${Date.now()}`);
  const db = options.db ?? getFirestore(app!);
  const auth: CanaryAuth = options.auth ?? (getAuth(app!) as unknown as CanaryAuth);
  try {
    const plan = planCanaryCleanup(await findCanaryCandidates(db, auth, scanBudget, namedUids), { nowMs: options.nowMs ?? Date.now(), olderThanMs });
    const dryRun = !values.delete;
    out(`${target.projectId}: ${plan.remove.length} canary account(s) to remove, ${plan.tooRecent.length} too recent, ${plan.refused.length} refused`);
    for (const { uid, reason } of plan.refused) out(`refused ${uid}: ${reason}`);
    for (const candidate of plan.remove) out(`${dryRun ? 'would remove' : 'remove'} ${describe(candidate)}`);
    if (plan.remove.length > max) {
      throw new Error(`Refusing to remove ${plan.remove.length} accounts, more than --max ${max}; check the list, then rerun with a higher --max`);
    }
    const deleted: string[] = [];
    if (!dryRun) {
      for (const candidate of plan.remove) {
        // Check again right before deleting: an account must still be a canary account.
        const account = await authAccount(auth, candidate.uid);
        if (account ? !isCanaryEmail(account.email) : !candidate.named) {
          out(`skipped ${candidate.uid}: its Auth account changed`);
          continue;
        }
        await db.recursiveDelete(db.doc(`users/${candidate.uid}`));
        if (account) await auth.deleteUser(candidate.uid);
        deleted.push(candidate.uid);
        out(`removed ${candidate.uid}`);
      }
    } else if (plan.remove.length > 0) {
      out('Dry run: nothing was deleted. Add --delete to remove these.');
    }
    return { ...plan, deleted, dryRun };
  } finally {
    if (app) await deleteApp(app);
  }
}

function describe(candidate: CanaryCandidate): string {
  const parts = [candidate.authEmail === undefined ? 'no Auth account, named with --uid' : `Auth ${candidate.authEmail}`];
  parts.push(`users/${candidate.uid} and its subcollections`);
  parts.push(`created ${new Date(candidate.createdAtMs).toISOString()}`);
  return `${candidate.uid} (${parts.join(', ')})`;
}

/** Auth must be the same place as Firestore: both emulated, or both the real project. */
function assertAuthTarget(target: Target, env: CliEnvironment): void {
  if (target.emulator && !env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('With the Firestore emulator, set FIREBASE_AUTH_EMULATOR_HOST too');
  if (!target.emulator && env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Unset FIREBASE_AUTH_EMULATOR_HOST to clean up a real project');
}
