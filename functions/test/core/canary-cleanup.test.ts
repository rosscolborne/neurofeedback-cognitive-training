import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { planCanaryCleanup, runCanaryCleanup, SMOKE_EMAIL_PATTERN, type CanaryAuth, type CanaryCandidate } from '../../scripts/canaryCleanup';
import { CORE_PROJECT, emulatorFirestore } from '../helpers/emulator';

// The owner-run canary cleanup (functions/scripts/canaryCleanup.ts), against
// the Firestore emulator with an in-memory Auth in place of Admin Auth.

const { db, close } = emulatorFirestore(CORE_PROJECT);
afterAll(close);

const HOUR = 3_600_000;
const env = { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };
const smokeEmail = () => `nfct-smoke+1234-1-${randomUUID().replace(/[^a-z]/g, '').padEnd(10, 'a').slice(0, 10)}@example.test`;

class MemoryAuth implements CanaryAuth {
  readonly users = new Map<string, { uid: string; email?: string; metadata: { creationTime: string } }>();
  add(uid: string, email: string | undefined, createdAtMs: number) {
    this.users.set(uid, { uid, email, metadata: { creationTime: new Date(createdAtMs).toUTCString() } });
  }
  async listUsers(maxResults: number, pageToken?: string) {
    const all = [...this.users.values()];
    const start = pageToken ? Number(pageToken) : 0;
    const next = start + maxResults;
    return { users: all.slice(start, next), pageToken: next < all.length ? String(next) : undefined };
  }
  async getUser(uid: string) {
    const user = this.users.get(uid);
    if (!user) throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
    return user;
  }
  async deleteUser(uid: string) {
    this.users.delete(uid);
  }
}

const candidate = (overrides: Partial<CanaryCandidate>): CanaryCandidate => ({
  uid: `u-${randomUUID()}`, authEmail: smokeEmail(), named: false, createdAtMs: 0, ...overrides,
});

describe('planCanaryCleanup', () => {
  const nowMs = 10 * HOUR;
  const olderThanMs = 2 * HOUR;

  it('removes old canary accounts and the named leftovers of deleted ones, and keeps recent ones', () => {
    const old = candidate({ createdAtMs: nowMs - 3 * HOUR });
    const deleted = candidate({ authEmail: undefined, named: true, createdAtMs: nowMs - 5 * HOUR });
    const recent = candidate({ createdAtMs: nowMs - HOUR });
    const recentNamed = candidate({ authEmail: undefined, named: true, createdAtMs: nowMs - HOUR });
    expect(planCanaryCleanup([old, deleted, recent, recentNamed], { nowMs, olderThanMs }))
      .toEqual({ remove: [old, deleted], tooRecent: [recent, recentNamed], refused: [] });
  });

  it('refuses anything that is not unambiguously canary data', () => {
    const plan = planCanaryCleanup([
      candidate({ uid: 'real-user', authEmail: 'person@example.com' }),
      candidate({ uid: 'named-real-user', authEmail: 'person@example.com', named: true }),
      candidate({ uid: 'no-email', authEmail: null }),
      candidate({ uid: 'lookalike', authEmail: 'nfct-smoke+1-1-abcdefghij@example.test.evil.com' }),
      candidate({ uid: 'unnamed', authEmail: undefined }),
      candidate({ uid: 'nothing-left', authEmail: undefined, named: true, createdAtMs: Number.NaN }),
      candidate({ uid: 'no-time', createdAtMs: Number.NaN }),
    ], { nowMs, olderThanMs });
    expect(plan.remove).toEqual([]);
    expect(plan.refused.map(({ uid }) => uid)).toEqual(['real-user', 'named-real-user', 'no-email', 'lookalike', 'unnamed', 'nothing-left', 'no-time']);
  });
});

describe('cleanup-canary-accounts', () => {
  const lines: string[] = [];
  const out = (line: string) => void lines.push(line);

  async function seed(auth: MemoryAuth, nowMs: number) {
    const id = randomUUID();
    const canary = { uid: `canary-${id}`, email: smokeEmail() };
    // A canary account its own cleanup deleted: only its game sessions remain, with nothing naming the canary.
    const deleted = { uid: `deleted-${id}` };
    const recent = { uid: `recent-${id}`, email: smokeEmail() };
    const person = { uid: `person-${id}`, email: `person-${id}@example.com` };
    // A deleted real account's leftovers that nobody named.
    const unnamed = { uid: `unnamed-${id}` };
    auth.add(canary.uid, canary.email, nowMs - 3 * HOUR);
    auth.add(recent.uid, recent.email, nowMs - 10 * 60_000);
    auth.add(person.uid, person.email, nowMs - 30 * 24 * HOUR);
    await Promise.all([
      db.doc(`users/${canary.uid}`).set({ schemaVersion: 1, displayName: 'Canary' }),
      db.doc(`users/${canary.uid}/gameSessions/s1`).set({ gameId: 'mental-math' }),
      db.doc(`users/${deleted.uid}/gameSessions/s1`).set({ gameId: 'mental-math' }),
      db.doc(`users/${deleted.uid}/progress/mental-math`).set({ gameId: 'mental-math' }),
      db.doc(`users/${recent.uid}`).set({ schemaVersion: 1, displayName: 'Recent' }),
      db.doc(`users/${person.uid}`).set({ schemaVersion: 1, displayName: 'Person' }),
      db.doc(`users/${unnamed.uid}/gameSessions/s1`).set({ gameId: 'mental-math' }),
    ]);
    return { canary, deleted, recent, person, unnamed };
  }

  const exists = async (path: string) => (await db.doc(path).get()).exists;

  it('is a dry run by default and never reaches a real project without --live', async () => {
    const auth = new MemoryAuth();
    const nowMs = Date.now() + 3 * HOUR; // the leftovers are created now, by the emulator's clock
    const { canary, deleted } = await seed(auth, nowMs);
    const report = await runCanaryCleanup(['--project', CORE_PROJECT, '--uid', deleted.uid], env, out, { db, auth, nowMs });
    expect(report.dryRun).toBe(true);
    expect(report.deleted).toEqual([]);
    expect(report.remove.map(({ uid }) => uid)).toEqual(expect.arrayContaining([canary.uid, deleted.uid]));
    expect(await exists(`users/${canary.uid}`)).toBe(true);
    expect(await exists(`users/${deleted.uid}/gameSessions/s1`)).toBe(true);
    expect(auth.users.has(canary.uid)).toBe(true);

    await expect(runCanaryCleanup(['--project', 'nfct-dev'], {}, out)).rejects.toThrow(/without --live/);
    await expect(runCanaryCleanup(['--project', 'some-other-project', '--live'], {}, out)).rejects.toThrow(/only against nfct-dev/);
    await expect(runCanaryCleanup(['--project', 'nfct-dev', '--live'], { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, out)).rejects.toThrow(/Unset FIREBASE_AUTH_EMULATOR_HOST/);
    await expect(runCanaryCleanup(['--project', CORE_PROJECT], { FIRESTORE_EMULATOR_HOST: env.FIRESTORE_EMULATOR_HOST }, out)).rejects.toThrow(/FIREBASE_AUTH_EMULATOR_HOST too/);
    await expect(runCanaryCleanup(['--project', CORE_PROJECT, '--older-than-minutes', '5'], env, out, { db, auth })).rejects.toThrow(/older-than-minutes/);
  });

  it('refuses a --uid that is not a single UID path segment', async () => {
    for (const uid of ['../clients/x', 'a/b', '', '.']) {
      await expect(runCanaryCleanup(['--project', CORE_PROJECT, '--uid', uid], env, out, { db, auth: new MemoryAuth() })).rejects.toThrow(/--uid must be a Firebase Auth UID/);
    }
  });

  it('with --delete removes old canary accounts and the named leftovers, and nothing else', async () => {
    const auth = new MemoryAuth();
    const nowMs = Date.now() + 3 * HOUR;
    const { canary, deleted, recent, person, unnamed } = await seed(auth, nowMs);
    const report = await runCanaryCleanup(
      ['--project', CORE_PROJECT, '--delete', '--max', '500', '--uid', deleted.uid, '--uid', person.uid],
      env, out, { db, auth, nowMs },
    );

    expect(report.deleted).toEqual(expect.arrayContaining([canary.uid, deleted.uid]));
    expect(report.deleted).not.toEqual(expect.arrayContaining([recent.uid]));
    // Naming a real account does not make it a canary account.
    expect(report.refused).toEqual(expect.arrayContaining([{ uid: person.uid, reason: 'its Auth account is not a canary account' }]));
    for (const path of [`users/${canary.uid}`, `users/${canary.uid}/gameSessions/s1`, `users/${deleted.uid}/gameSessions/s1`, `users/${deleted.uid}/progress/mental-math`]) {
      expect(await exists(path), path).toBe(false);
    }
    expect(auth.users.has(canary.uid)).toBe(false);
    for (const uid of [recent.uid, person.uid]) expect(await exists(`users/${uid}`), uid).toBe(true);
    expect(await exists(`users/${unnamed.uid}/gameSessions/s1`)).toBe(true);
    expect([recent.uid, person.uid].every((uid) => auth.users.has(uid))).toBe(true);
    // Accounts that are not canary accounts are never printed.
    expect(lines.join('\n')).not.toContain(person.email);
  });

  it('aborts before deleting anything when the plan is larger than --max', async () => {
    const auth = new MemoryAuth();
    const nowMs = Date.now() + 3 * HOUR;
    const { canary, deleted } = await seed(auth, nowMs);
    await expect(runCanaryCleanup(['--project', CORE_PROJECT, '--delete', '--max', '1', '--uid', deleted.uid], env, out, { db, auth, nowMs })).rejects.toThrow(/more than --max 1/);
    expect(await exists(`users/${canary.uid}`)).toBe(true);
    expect(await exists(`users/${deleted.uid}/gameSessions/s1`)).toBe(true);
    expect(auth.users.has(canary.uid)).toBe(true);
  });

  it('matches exactly the identities the canary creates', () => {
    const canaryScript = readFileSync(new URL('../../../scripts/canary/canary.mjs', import.meta.url), 'utf8');
    expect(canaryScript).toContain(`export const SMOKE_EMAIL_PATTERN = ${SMOKE_EMAIL_PATTERN.toString()};`);
  });
});
