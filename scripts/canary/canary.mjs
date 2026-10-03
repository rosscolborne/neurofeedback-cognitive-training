#!/usr/bin/env node
// The nfct-dev canary's disposable account and its cleanup
// (docs/nfct/nfct-dev-canary.md).
//
//   node scripts/canary/canary.mjs build     production build for nfct-dev, then check it
//   node scripts/canary/canary.mjs prepare   new identity -> $NFCT_CANARY_IDENTITY_FILE
//   node scripts/canary/canary.mjs cleanup   user-level cleanup of that identity
//   node scripts/canary/canary.mjs run       prepare, the Playwright canary, cleanup (local runs)
//
// Public client APIs only: Firebase Auth's REST API with the web API key, and
// Firestore's REST API with the canary user's own ID token, so every request
// is one an ordinary user could make and the deployed security rules apply.
// No Admin SDK, no service account and no privileged credential. The password
// and ID token are never printed.
//
// NFCT_CANARY_TARGET (required) is `nfct-dev`, or `emulators` to rehearse the
// same journey and cleanup against the local Auth and Firestore emulators
// (run it under `firebase emulators:exec`). The rehearsal fails if cleanup
// does not remove the account; against nfct-dev a cleanup problem is a warning.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANARY_PROJECT_ID = 'nfct-dev';
export const EMULATOR_PROJECT_ID = 'demo-neurasticity-protocol-e2e';
export const CANARY_CONFIG = 'playwright.canary.config.ts';

// Every canary account matches this, and nothing else should. The owner-run
// residue cleanup (functions/scripts/canaryCleanup.ts) deletes only accounts
// whose email matches the same pattern; a test keeps the two identical.
export const SMOKE_EMAIL_PATTERN = /^nfct-smoke\+[a-z0-9]{1,24}-[0-9]{1,4}-[a-z2-7]{10}@example\.test$/;

const REQUEST_TIMEOUT_MS = 15_000;

/** Which backend the canary talks to, and how; throws on anything unexpected. */
export function resolveCanaryTarget(env) {
  const name = env.NFCT_CANARY_TARGET;
  if (name === 'emulators') {
    return {
      name,
      projectId: EMULATOR_PROJECT_ID,
      apiKey: 'local-test-key',
      authBase: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1',
      firestoreBase: 'http://127.0.0.1:8080/v1',
    };
  }
  if (name !== 'nfct-dev') throw new Error(`Set NFCT_CANARY_TARGET to nfct-dev or emulators (got '${name ?? ''}')`);
  if (env.VITE_E2E_EMULATORS) throw new Error('VITE_E2E_EMULATORS must not be set for the nfct-dev canary');
  const projectId = (env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
  if (projectId !== CANARY_PROJECT_ID) {
    throw new Error(`The canary runs only against ${CANARY_PROJECT_ID}; VITE_FIREBASE_PROJECT_ID is '${projectId || '(unset)'}'`);
  }
  const authDomain = (env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim();
  if (authDomain !== `${CANARY_PROJECT_ID}.firebaseapp.com`) {
    throw new Error(`VITE_FIREBASE_AUTH_DOMAIN must be ${CANARY_PROJECT_ID}.firebaseapp.com (got '${authDomain || '(unset)'}')`);
  }
  const apiKey = (env.VITE_FIREBASE_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is not set');
  return {
    name,
    projectId,
    apiKey,
    authBase: 'https://identitytoolkit.googleapis.com/v1',
    firestoreBase: 'https://firestore.googleapis.com/v1',
  };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A unique, recognisable disposable account; nothing about it is reused. */
export function newIdentity(env, random = randomBytes) {
  const run = String(env.GITHUB_RUN_ID || 'local').toLowerCase();
  const attempt = String(env.GITHUB_RUN_ATTEMPT || '0');
  if (!/^[a-z0-9]{1,24}$/.test(run)) throw new Error('GITHUB_RUN_ID is not a run ID');
  if (!/^[0-9]{1,4}$/.test(attempt)) throw new Error('GITHUB_RUN_ATTEMPT is not a run attempt');
  const suffix = Array.from(random(10), (byte) => BASE32[byte % 32]).join('');
  const email = `nfct-smoke+${run}-${attempt}-${suffix}@example.test`;
  if (!SMOKE_EMAIL_PATTERN.test(email)) throw new Error('Generated an identity outside the canary pattern');
  // Random, and long enough for any password policy the project may enable.
  const password = `${random(24).toString('base64url')}Aa1!`;
  return { displayName: 'NFCT Smoke', email, password };
}

/** Written before the account exists, owner-only, so cleanup can find a partial run. */
export function writeIdentityFile(path, identity) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(path, `${JSON.stringify(identity)}\n`, { mode: 0o600, flag: 'wx' });
}

export function readIdentityFile(path) {
  const identity = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof identity?.email !== 'string' || !SMOKE_EMAIL_PATTERN.test(identity.email) || typeof identity.password !== 'string') {
    throw new Error(`${path} does not hold a canary identity`);
  }
  return identity;
}

export class CanaryRequestError extends Error {
  constructor(code, status) {
    super(`${code} (HTTP ${status})`);
    this.name = 'CanaryRequestError';
    this.code = code;
    this.status = status;
  }
}

/** Only the service's error code: never the request, which carries the password or token. */
async function failure(response) {
  const body = await response.json().catch(() => null);
  // Auth puts its code first in the message ("INVALID_LOGIN_CREDENTIALS");
  // Firestore sends prose there and the code in `status`.
  const message = typeof body?.error?.message === 'string' ? body.error.message : '';
  const status = typeof body?.error?.status === 'string' ? body.error.status : '';
  const code = /^[A-Z][A-Z_]+(?=$|[\s:])/.exec(message)?.[0] ?? (/^[A-Z][A-Z_]+$/.test(status) ? status : `HTTP_${response.status}`);
  return new CanaryRequestError(code, response.status);
}

async function identityToolkit(target, method, body, fetchImpl) {
  const response = await fetchImpl(`${target.authBase}/accounts:${method}?key=${encodeURIComponent(target.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response);
  return response.json();
}

async function deleteOwnDocument(target, idToken, path, fetchImpl) {
  const response = await fetchImpl(`${target.firestoreBase}/projects/${target.projectId}/databases/(default)/documents/${path}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${idToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await failure(response);
}

// Sign-in answers for an account that does not exist (never created, or
// already deleted). With email enumeration protection on, a missing account
// and a wrong password look the same; the canary holds the right password.
const ABSENT = new Set(['EMAIL_NOT_FOUND', 'INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD']);

/**
 * Removes what the canary user may remove as itself, as account deletion in
 * the app does: its profile document (users/{uid}) and then its Auth account.
 * The rules keep the profile's subcollections, such as game sessions (only
 * server-side deletion removes them, NFCT-23); they stay as residue. A profile
 * deletion the deployed rules refuse is residue too, not a failure.
 * Idempotent: an account that is already gone is a success.
 */
export async function cleanUpIdentity(target, identity, { fetchImpl = fetch } = {}) {
  const report = { email: identity.email, uid: null, account: 'absent', deleted: [], residue: [], problems: [] };
  let session;
  try {
    session = await identityToolkit(target, 'signInWithPassword', { email: identity.email, password: identity.password, returnSecureToken: true }, fetchImpl);
  } catch (error) {
    if (error instanceof CanaryRequestError && ABSENT.has(error.code)) return report;
    report.account = 'unknown';
    report.problems.push(`sign-in for cleanup failed: ${error.message}`);
    return report;
  }
  report.uid = session.localId;
  report.account = 'present';
  // The API key decides which project Auth answered for. Never act on an
  // account in a project other than the canary's.
  const audience = tokenAudience(session.idToken);
  if (audience !== target.projectId) {
    report.account = 'unknown';
    report.problems.push(`the API key signed in to project '${audience}', not ${target.projectId}; nothing was deleted`);
    return report;
  }
  try {
    await deleteOwnDocument(target, session.idToken, `users/${session.localId}`, fetchImpl);
    report.deleted.push(`users/${session.localId}`);
  } catch (error) {
    report.residue.push(`users/${session.localId} (${error.message})`);
  }
  report.residue.push(`users/${session.localId}'s subcollections, if created (only server-side deletion removes them)`);
  try {
    await identityToolkit(target, 'delete', { idToken: session.idToken }, fetchImpl);
    report.account = 'deleted';
    report.deleted.push('Auth account');
  } catch (error) {
    report.problems.push(`Auth account deletion failed: ${error.message}`);
  }
  return report;
}

/** The `aud` claim (the Firebase project) of an ID token; it is not verified, only read. */
function tokenAudience(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).aud ?? null;
  } catch {
    return null;
  }
}

/**
 * The rehearsal's bar: the account and its profile (users/{uid}) are both
 * gone. The emulators run the branch's rules, which let a player delete their
 * own profile; nfct-dev's deployed rules may not yet, so there it is residue.
 */
export function cleanedCompletely(report) {
  return report.problems.length === 0 && report.account === 'deleted' && report.deleted.includes(`users/${report.uid}`);
}

/** The owner-run cleanup (functions/scripts/canaryCleanup.ts) for one canary account's residue. */
export function ownerCleanupCommand(target, uid) {
  const project = target.name === 'nfct-dev' ? `${target.projectId} --live` : target.projectId;
  return `npx tsx --tsconfig functions/tsconfig.json functions/scripts/cleanup-canary-accounts.ts --project ${project} --uid ${uid}`;
}

export function formatCleanupReport(target, report) {
  const lines = [`nfct-dev canary cleanup (${target.name}, project ${target.projectId})`, `- identity: ${report.email}`];
  if (report.uid) lines.push(`- uid: ${report.uid}`);
  lines.push(`- Auth account: ${report.account === 'absent' ? 'not found (never created or already deleted)' : report.account}`);
  for (const item of report.deleted) lines.push(`- deleted: ${item}`);
  for (const item of report.residue) lines.push(`- left for the owner-run cleanup: ${item}`);
  // Nothing left under users/{uid} names the canary once its Auth account is
  // gone, so the owner-run cleanup finds that residue only by this UID.
  if (report.uid && report.residue.length > 0) {
    lines.push(`- owner-run cleanup (dry run; add --delete): ${ownerCleanupCommand(target, report.uid)}`);
  }
  for (const item of report.problems) lines.push(`- PROBLEM: ${item}`);
  return lines;
}

function identityPath(env) {
  const path = env.NFCT_CANARY_IDENTITY_FILE;
  if (!path) throw new Error('Set NFCT_CANARY_IDENTITY_FILE to the canary identity file');
  return resolve(path);
}

function prepare(env, out) {
  resolveCanaryTarget(env);
  const path = identityPath(env);
  const identity = newIdentity(env);
  // GitHub Actions then masks the password in every later log line.
  if (env.GITHUB_ACTIONS === 'true') out(`::add-mask::${identity.password}`);
  writeIdentityFile(path, identity);
  out(`Canary identity: ${identity.email} (written to ${path}, mode 600; the password is not printed)`);
  return identity;
}

/** Cleans up the identity file's account, if there is one; returns the report, or null. */
async function cleanup(env, out) {
  const path = identityPath(env);
  if (!existsSync(path)) {
    out('No canary identity file: no account was created, so there is nothing to clean up.');
    return null;
  }
  const target = resolveCanaryTarget(env);
  const report = await cleanUpIdentity(target, readIdentityFile(path));
  const lines = formatCleanupReport(target, report);
  lines.forEach((line) => out(line));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n### ${lines[0]}\n\n${lines.slice(1).join('\n')}\n`);
  for (const problem of report.problems) out(`::warning title=nfct-dev canary cleanup::${problem}`);
  return report;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The production bundle the canary serves, built with the nfct-dev web config, then checked. */
function build(env, out) {
  if (env.NFCT_CANARY_TARGET !== 'nfct-dev') throw new Error('build is for NFCT_CANARY_TARGET=nfct-dev; the emulator rehearsal uses the dev server');
  const missing = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'].filter((name) => !(env[name] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')}: nfct-dev's web config. In CI, set the repository variables ${missing.map((name) => name.replace('VITE_FIREBASE_', 'NFCT_DEV_FIREBASE_')).join(', ')} (docs/nfct/nfct-dev-canary.md#owner-setup)`);
  }
  resolveCanaryTarget(env);
  const result = spawnSync('npx', ['vite', 'build', '--mode', 'production'], { cwd: repositoryRoot, stdio: 'inherit', env });
  if (result.status !== 0) throw new Error('vite build failed');
  const dist = join(repositoryRoot, 'dist');
  if (!readFileSync(join(dist, 'index.html'), 'utf8').includes('<meta name="nfct-build" content="production">')) {
    throw new Error('dist/index.html is not a production build');
  }
  const assets = readdirSync(join(dist, 'assets')).filter((file) => file.endsWith('.js'));
  const compiled = assets.some((file) => {
    const text = readFileSync(join(dist, 'assets', file), 'utf8');
    return /VITE_FIREBASE_PROJECT_ID:\s*["'`]nfct-dev["'`]/.test(text) && text.includes(env.VITE_FIREBASE_API_KEY.trim());
  });
  if (!compiled) throw new Error(`The bundle does not contain the ${CANARY_PROJECT_ID} web config`);
  out(`Built the production bundle for ${CANARY_PROJECT_ID}.`);
}

/**
 * A private identity file, the canary, then cleanup whatever happened. Against
 * nfct-dev it builds the bundle first, so it never serves a stale dist/.
 */
async function run(env, out) {
  const target = resolveCanaryTarget(env);
  if (target.name === 'nfct-dev') build(env, out);
  const directory = mkdtempSync(join(tmpdir(), 'nfct-canary-'));
  const runEnv = { ...env, NFCT_CANARY_IDENTITY_FILE: join(directory, 'identity.json') };
  let status = 1;
  try {
    prepare(runEnv, out);
    const child = spawn('npx', ['playwright', 'test', '--config', CANARY_CONFIG], { cwd: repositoryRoot, stdio: 'inherit', env: runEnv });
    // Ctrl-C reaches Playwright too; wait for it, then clean up.
    const ignore = () => {};
    process.on('SIGINT', ignore);
    process.on('SIGTERM', ignore);
    status = await new Promise((resolveStatus) => child.on('close', (code) => resolveStatus(code ?? 1)));
    process.off('SIGINT', ignore);
    process.off('SIGTERM', ignore);
  } finally {
    const report = await cleanup(runEnv, out);
    rmSync(directory, { recursive: true, force: true });
    if (report && !cleanedCompletely(report)) {
      if (target.name === 'emulators' && status === 0) {
        out('The rehearsal passed, but cleanup did not remove the account and its profile: cleanup is broken.');
        status = 1;
      } else if (report.problems.length > 0) {
        out('Cleanup did not finish; see above.');
      }
    }
  }
  return status;
}

async function main(argv, env) {
  const out = (line) => console.log(line);
  switch (argv[0]) {
    case 'build': build(env, out); return 0;
    case 'prepare': prepare(env, out); return 0;
    case 'cleanup': return ((await cleanup(env, out))?.problems.length ?? 0) === 0 ? 0 : 1;
    case 'run': return run(env, out);
    default:
      throw new Error('Usage: node scripts/canary/canary.mjs build|prepare|cleanup|run');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
