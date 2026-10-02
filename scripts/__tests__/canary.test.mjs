import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanedCompletely,
  cleanUpIdentity,
  formatCleanupReport,
  newIdentity,
  readIdentityFile,
  resolveCanaryTarget,
  SMOKE_EMAIL_PATTERN,
  writeIdentityFile,
} from '../canary/canary.mjs';

// The nfct-dev canary's identity and user-level cleanup (scripts/canary/canary.mjs).
// No network: cleanup runs against a recorded fake of the two REST APIs.

const nfctDev = {
  NFCT_CANARY_TARGET: 'nfct-dev',
  VITE_FIREBASE_PROJECT_ID: 'nfct-dev',
  VITE_FIREBASE_AUTH_DOMAIN: 'nfct-dev.firebaseapp.com',
  VITE_FIREBASE_API_KEY: 'public-web-key',
};

describe('resolveCanaryTarget', () => {
  it('targets nfct-dev only, and the emulators only when asked', () => {
    expect(resolveCanaryTarget(nfctDev)).toMatchObject({ name: 'nfct-dev', projectId: 'nfct-dev', authBase: 'https://identitytoolkit.googleapis.com/v1' });
    expect(resolveCanaryTarget({ NFCT_CANARY_TARGET: 'emulators' })).toMatchObject({ projectId: 'demo-neurasticity-protocol-e2e', authBase: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1' });
    expect(() => resolveCanaryTarget({ ...nfctDev, VITE_FIREBASE_PROJECT_ID: 'some-other-project' })).toThrow(/only against nfct-dev/);
    expect(() => resolveCanaryTarget({ ...nfctDev, VITE_FIREBASE_PROJECT_ID: undefined })).toThrow(/only against nfct-dev/);
    expect(() => resolveCanaryTarget({ ...nfctDev, VITE_FIREBASE_AUTH_DOMAIN: 'elsewhere.firebaseapp.com' })).toThrow(/VITE_FIREBASE_AUTH_DOMAIN/);
    expect(() => resolveCanaryTarget({ ...nfctDev, VITE_FIREBASE_API_KEY: '' })).toThrow(/VITE_FIREBASE_API_KEY/);
    expect(() => resolveCanaryTarget({ ...nfctDev, VITE_E2E_EMULATORS: 'true' })).toThrow(/VITE_E2E_EMULATORS/);
    // The target is always explicit: no default sends a local run to nfct-dev.
    expect(() => resolveCanaryTarget({ ...nfctDev, NFCT_CANARY_TARGET: undefined })).toThrow(/Set NFCT_CANARY_TARGET/);
    expect(() => resolveCanaryTarget({ NFCT_CANARY_TARGET: 'production' })).toThrow(/Set NFCT_CANARY_TARGET/);
  });
});

describe('newIdentity', () => {
  it('is unique per run, attempt and call, and always matches the canary pattern', () => {
    const ci = newIdentity({ GITHUB_RUN_ID: '18234567890', GITHUB_RUN_ATTEMPT: '2' });
    expect(ci.email).toMatch(/^nfct-smoke\+18234567890-2-[a-z2-7]{10}@example\.test$/);
    expect(newIdentity({}).email).toMatch(/^nfct-smoke\+local-0-[a-z2-7]{10}@example\.test$/);
    const emails = new Set(Array.from({ length: 200 }, () => newIdentity({ GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1' }).email));
    expect(emails.size).toBe(200);
    for (const email of emails) expect(email).toMatch(SMOKE_EMAIL_PATTERN);
    expect(ci.password.length).toBeGreaterThanOrEqual(32);
    expect(newIdentity({}).password).not.toBe(newIdentity({}).password);
    expect(() => newIdentity({ GITHUB_RUN_ID: '1; rm -rf /' })).toThrow(/run ID/);
  });

  it('never matches an ordinary address', () => {
    for (const email of ['person@example.com', 'nfct-smoke@example.test', 'nfct-smoke+1-1-abcdefghij@example.test.evil.com', 'NFCT-SMOKE+1-1-abcdefghij@example.test']) {
      expect(email).not.toMatch(SMOKE_EMAIL_PATTERN);
    }
  });
});

describe('the identity file', () => {
  let directory;
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('is owner-only, written once, and read back', () => {
    directory = mkdtempSync(join(tmpdir(), 'canary-test-'));
    const path = join(directory, 'private', 'identity.json');
    const identity = newIdentity({});
    writeIdentityFile(path, identity);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, 'private')).mode & 0o777).toBe(0o700);
    expect(readIdentityFile(path)).toEqual(identity);
    // A second run never reuses (or overwrites) an earlier identity.
    expect(() => writeIdentityFile(path, newIdentity({}))).toThrow(/EEXIST/);
    expect(readIdentityFile(path)).toEqual(identity);
  });
});

describe('cleanUpIdentity', () => {
  const target = resolveCanaryTarget(nfctDev);
  const identity = { displayName: 'NFCT Smoke', email: 'nfct-smoke+1-1-abcdefghij@example.test', password: 'the-password-Aa1!' };
  const token = (aud) => `header.${Buffer.from(JSON.stringify({ aud, sub: 'uid-1' })).toString('base64url')}.signature`;
  const idToken = token('nfct-dev');

  /** A fake of the two REST APIs that records each call. */
  function backend(responses) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const key = `${init.method} ${new URL(url).pathname}`;
      calls.push({ key, url, init });
      const [status, body] = responses[key] ?? [500, { error: { message: 'UNEXPECTED' } }];
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { calls, fetchImpl };
  }
  const signIn = 'POST /v1/accounts:signInWithPassword';
  const deleteAccount = 'POST /v1/accounts:delete';
  const deleteClient = 'DELETE /v1/projects/nfct-dev/databases/(default)/documents/clients/uid-1';
  const signedIn = [200, { localId: 'uid-1', idToken }];

  it('deletes clients/{uid} as the user, then the Auth account, and reports the residue', async () => {
    const { calls, fetchImpl } = backend({ [signIn]: signedIn, [deleteClient]: [200, {}], [deleteAccount]: [200, {}] });
    const report = await cleanUpIdentity(target, identity, { fetchImpl });
    expect(calls.map(({ key }) => key)).toEqual([signIn, deleteClient, deleteAccount]);
    expect(calls[0].url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=public-web-key');
    expect(calls[1].init.headers).toEqual({ authorization: `Bearer ${idToken}` });
    expect(JSON.parse(calls[2].init.body)).toEqual({ idToken });
    expect(report).toMatchObject({ uid: 'uid-1', account: 'deleted', deleted: ['clients/uid-1', 'Auth account'], problems: [] });
    expect(report.residue).toEqual([expect.stringMatching(/^users\/uid-1 /)]);
    expect(cleanedCompletely(report)).toBe(true);
  });

  it('never deletes anything when the API key signed in to another project', async () => {
    const { calls, fetchImpl } = backend({ [signIn]: [200, { localId: 'uid-1', idToken: token('another-project') }] });
    const report = await cleanUpIdentity(target, identity, { fetchImpl });
    expect(calls.map(({ key }) => key)).toEqual([signIn]);
    expect(report.problems).toEqual([expect.stringMatching(/project 'another-project', not nfct-dev; nothing was deleted/)]);
    expect(cleanedCompletely(report)).toBe(false);
  });

  it('is idempotent: an account that does not exist is already clean', async () => {
    for (const code of ['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND']) {
      const { calls, fetchImpl } = backend({ [signIn]: [400, { error: { message: code } }] });
      const report = await cleanUpIdentity(target, identity, { fetchImpl });
      expect(calls).toHaveLength(1);
      expect(report).toMatchObject({ account: 'absent', deleted: [], residue: [], problems: [] });
    }
  });

  it('still deletes the Auth account when the rules refuse the Firestore delete', async () => {
    const { fetchImpl } = backend({ [signIn]: signedIn, [deleteClient]: [403, { error: { status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } }], [deleteAccount]: [200, {}] });
    const report = await cleanUpIdentity(target, identity, { fetchImpl });
    expect(report).toMatchObject({ account: 'deleted', deleted: ['Auth account'], problems: [] });
    expect(report.residue[0]).toBe('clients/uid-1 (PERMISSION_DENIED (HTTP 403))');
    // The rehearsal treats this as broken cleanup; against nfct-dev it is residue.
    expect(cleanedCompletely(report)).toBe(false);
  });

  it('reports a failure it cannot finish, without the password or token', async () => {
    const failures = [
      { [signIn]: [400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled' } }] },
      { [signIn]: signedIn, [deleteClient]: [200, {}], [deleteAccount]: [400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }] },
    ];
    for (const responses of failures) {
      const { fetchImpl } = backend(responses);
      const report = await cleanUpIdentity(target, identity, { fetchImpl });
      expect(report.problems).toHaveLength(1);
      const printed = formatCleanupReport(target, report).join('\n');
      expect(printed).toMatch(/PROBLEM: .*(TOO_MANY_ATTEMPTS_TRY_LATER|CREDENTIAL_TOO_OLD_LOGIN_AGAIN)/);
      expect(printed).not.toContain(identity.password);
      expect(printed).not.toContain(idToken);
    }
  });
});
