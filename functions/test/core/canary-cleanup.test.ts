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
  uid: `u-${randomUUID()}`, authEmail: smokeEmail(), profileEmail: undefined, createdAtMs: 0, ...overrides,
});

describe('planCanaryCleanup', () => {
  const nowMs = 10 * HOUR;
  const olderThanMs = 2 * HOUR;

  it('removes old canary accounts and orphaned canary profiles, and keeps recent ones', () => {
    const old = candidate({ createdAtMs: nowMs - 3 * HOUR });
    const orphan = candidate({ authEmail: undefined, profileEmail: smokeEmail(), createdAtMs: nowMs - 5 * HOUR });
    const recent = candidate({ createdAtMs: nowMs - HOUR });
    expect(planCanaryCleanup([old, orphan, recent], { nowMs, olderThanMs })).toEqual({ remove: [old, orphan], tooRecent: [recent], refused: [] });
  });

  it('refuses anything that is not unambiguously a canary account', () => {
    const plan = planCanaryCleanup([
      candidate({ uid: 'real-user', authEmail: 'person@example.com', profileEmail: smokeEmail() }),
      candidate({ uid: 'no-email', authEmail: null }),
      candidate({ uid: 'forged-profile', authEmail: undefined, profileEmail: 'nfct-smoke+evil@example.test' }),
      candidate({ uid: 'lookalike', authEmail: 'nfct-smoke+1-1-abcdefghij@example.test.evil.com' }),
      candidate({ uid: 'nothing', authEmail: undefined, profileEmail: undefined }),
      candidate({ uid: 'no-time', createdAtMs: Number.NaN }),
    ], { nowMs, olderThanMs });
    expect(plan.remove).toEqual([]);
    expect(plan.refused.map(({ uid }) => uid)).toEqual(['real-user', 'no-email', 'forged-profile', 'lookalike', 'nothing', 'no-time']);
  });
});

describe('cleanup-canary-accounts', () => {
  const lines: string[] = [];
  const out = (line: string) => void lines.push(line);

  async function seed(auth: MemoryAuth, nowMs: number) {
    const id = randomUUID();
    const canary = { uid: `canary-${id}`, email: smokeEmail() };
    const orphan = { uid: `orphan-${id}`, email: smokeEmail() };
    const recent = { uid: `recent-${id}`, email: smokeEmail() };
    const person = { uid: `person-${id}`, email: `person-${id}@example.com` };
    const forged = { uid: `forged-${id}`, email: `real-${id}@example.com` };
    auth.add(canary.uid, canary.email, nowMs - 3 * HOUR);
    auth.add(recent.uid, recent.email, nowMs - 10 * 60_000);
    auth.add(person.uid, person.email, nowMs - 30 * 24 * HOUR);
    auth.add(forged.uid, forged.email, nowMs - 30 * 24 * HOUR);
    await Promise.all([
      db.doc(`users/${canary.uid}`).set({ email: canary.email, role: 'patient' }),
      db.doc(`users/${canary.uid}/gameSessions/s1`).set({ gameId: 'mental-math' }),
      db.doc(`clients/${canary.uid}`).set({ id: canary.uid }),
      db.doc(`users/${orphan.uid}`).set({ email: orphan.email, role: null }),
      db.doc(`users/${recent.uid}`).set({ email: recent.email, role: 'patient' }),
      db.doc(`users/${person.uid}`).set({ email: person.email, role: 'patient' }),
      // A real user who wrote a canary-looking email into their own profile.
      db.doc(`users/${forged.uid}`).set({ email: smokeEmail(), role: 'patient' }),
    ]);
    return { canary, orphan, recent, person, forged };
  }

  const exists = async (path: string) => (await db.doc(path).get()).exists;

  it('is a dry run by default and never reaches a real project without --live', async () => {
    const auth = new MemoryAuth();
    const nowMs = Date.now() + 3 * HOUR; // the orphan's profile is created now, by the emulator's clock
    const { canary } = await seed(auth, nowMs);
    const report = await runCanaryCleanup(['--project', CORE_PROJECT], env, out, { db, auth, nowMs });
    expect(report.dryRun).toBe(true);
    expect(report.deleted).toEqual([]);
    expect(await exists(`users/${canary.uid}`)).toBe(true);
    expect(auth.users.has(canary.uid)).toBe(true);

    await expect(runCanaryCleanup(['--project', 'nfct-dev'], {}, out)).rejects.toThrow(/without --live/);
    await expect(runCanaryCleanup(['--project', 'nfct-dev', '--live'], { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, out)).rejects.toThrow(/Unset FIREBASE_AUTH_EMULATOR_HOST/);
    await expect(runCanaryCleanup(['--project', CORE_PROJECT], { FIRESTORE_EMULATOR_HOST: env.FIRESTORE_EMULATOR_HOST }, out)).rejects.toThrow(/FIREBASE_AUTH_EMULATOR_HOST too/);
    await expect(runCanaryCleanup(['--project', CORE_PROJECT, '--older-than-minutes', '5'], env, out, { db, auth })).rejects.toThrow(/older-than-minutes/);
  });

  it('with --delete removes only old canary accounts and their data', async () => {
    const auth = new MemoryAuth();
    const nowMs = Date.now() + 3 * HOUR;
    const { canary, orphan, recent, person, forged } = await seed(auth, nowMs);
    const report = await runCanaryCleanup(['--project', CORE_PROJECT, '--delete', '--max', '500'], env, out, { db, auth, nowMs });

    expect(report.deleted).toEqual(expect.arrayContaining([canary.uid, orphan.uid]));
    expect(report.deleted).not.toEqual(expect.arrayContaining([recent.uid]));
    expect(report.refused).toEqual(expect.arrayContaining([{ uid: forged.uid, reason: 'its Auth account is not a canary account' }]));
    for (const path of [`users/${canary.uid}`, `users/${canary.uid}/gameSessions/s1`, `clients/${canary.uid}`, `users/${orphan.uid}`]) {
      expect(await exists(path), path).toBe(false);
    }
    expect(auth.users.has(canary.uid)).toBe(false);
    for (const uid of [recent.uid, person.uid, forged.uid]) expect(await exists(`users/${uid}`), uid).toBe(true);
    expect([recent.uid, person.uid, forged.uid].every((uid) => auth.users.has(uid))).toBe(true);
    // Accounts that are not canary accounts are never printed.
    expect(lines.join('\n')).not.toContain(person.email);
    expect(lines.join('\n')).not.toContain(forged.email);
  });

  it('aborts before deleting anything when the plan is larger than --max', async () => {
    const auth = new MemoryAuth();
    const nowMs = Date.now() + 3 * HOUR;
    const { canary } = await seed(auth, nowMs);
    await expect(runCanaryCleanup(['--project', CORE_PROJECT, '--delete', '--max', '1'], env, out, { db, auth, nowMs })).rejects.toThrow(/more than --max 1/);
    expect(await exists(`users/${canary.uid}`)).toBe(true);
    expect(auth.users.has(canary.uid)).toBe(true);
  });

  it('matches exactly the identities the canary creates', () => {
    const canaryScript = readFileSync(new URL('../../../scripts/canary/canary.mjs', import.meta.url), 'utf8');
    expect(canaryScript).toContain(`export const SMOKE_EMAIL_PATTERN = ${SMOKE_EMAIL_PATTERN.toString()};`);
  });
});
