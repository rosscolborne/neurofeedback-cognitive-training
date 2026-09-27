#!/usr/bin/env node
/**
 * READ-ONLY audit of existing Firestore/Auth data when reviewing a development
 * project's data after repository integration or before a reset/migration decision.
 *
 * Run from the current repository checkout (so firebase-admin resolves from its node_modules):
 *
 *   cd /path/to/neurasticity
 *   AUDIT_READ_ONLY=true AUDIT_PROJECT_ID=brainwell-327dc \
 *     AUDIT_CONFIRM_PROJECT=brainwell-327dc \
 *     node scripts/e2e/data-audit/audit-firestore-readonly.mjs \
 *       > /path/to/private/audit-report.json
 *
 * Credentials: Application Default Credentials only (the script never reads a
 * key file itself). Least privilege: roles/datastore.viewer +
 * roles/firebaseauth.viewer. Emulator smoke tests: set FIRESTORE_EMULATOR_HOST
 * (and optionally FIREBASE_AUTH_EMULATOR_HOST) with a demo-* project ID.
 *
 * Guarantees enforced in code (defense in depth; the IAM role is the real one):
 *   1. Refuses to start unless AUDIT_READ_ONLY=true and AUDIT_PROJECT_ID is
 *      the expected production ID or a demo-* ID bound to an emulator.
 *   2. Every Firestore/Auth write entry point is patched on the prototypes to
 *      throw, and a self-test proves this before any network call.
 *   3. The audit code only receives allow-listed read proxies.
 *   4. All reads are paginated and capped; truncation is reported.
 *   5. Output contains paths, rule IDs and counts only. Emails and path
 *      segments that are emails are salted-hashed; field values are never
 *      printed (only types/enum membership).
 */
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- guards ----
const EXPECTED_PROD_PROJECT = 'brainwell-327dc';
const env = process.env;
function refuse(msg) { console.error(`[audit] REFUSING TO RUN: ${msg}`); process.exit(2); }

if (env.AUDIT_READ_ONLY !== 'true') refuse('set AUDIT_READ_ONLY=true to acknowledge this is a read-only audit.');
const PROJECT_ID = env.AUDIT_PROJECT_ID;
if (!PROJECT_ID) refuse('set AUDIT_PROJECT_ID explicitly.');
const usingEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST);
if (usingEmulator) {
  if (!PROJECT_ID.startsWith('demo-')) refuse('emulator runs must use a demo-* project ID.');
  if (env.FIREBASE_AUTH_EMULATOR_HOST === undefined && env.AUDIT_SKIP_AUTH !== 'true') {
    refuse('emulator run without FIREBASE_AUTH_EMULATOR_HOST: set AUDIT_SKIP_AUTH=true so Auth is not contacted in production.');
  }
} else {
  if (PROJECT_ID !== EXPECTED_PROD_PROJECT) refuse(`AUDIT_PROJECT_ID must be ${EXPECTED_PROD_PROJECT} (or demo-* with an emulator).`);
  if (env.AUDIT_CONFIRM_PROJECT !== PROJECT_ID) refuse(`also set AUDIT_CONFIRM_PROJECT=${PROJECT_ID} to confirm the target.`);
  if (env.FIREBASE_AUTH_EMULATOR_HOST) refuse('FIREBASE_AUTH_EMULATOR_HOST is set for a production run; unset it.');
}
if (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID) refuse('GOOGLE_CLOUD_PROJECT disagrees with AUDIT_PROJECT_ID.');

const MAX_DOCS = Number(env.AUDIT_MAX_DOCS_PER_COLLECTION ?? 5000);
const PAGE = Math.min(Number(env.AUDIT_PAGE_SIZE ?? 300), 1000);
const MAX_AUTH = Number(env.AUDIT_MAX_AUTH_USERS ?? 5000);
const HASH_IDS = env.AUDIT_HASH_IDS === 'true';
const SALT = env.AUDIT_HASH_SALT ?? randomBytes(16).toString('hex');
const KNOWN_E2E_UIDS = new Set((env.AUDIT_E2E_UIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));

const require = createRequire(`${process.cwd()}/`);
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const fs = require('firebase-admin/firestore');
const authMod = env.AUDIT_SKIP_AUTH === 'true' ? null : require('firebase-admin/auth');

// ------------------------------------------------- structural read-only ----
const WRITE_METHODS = {
  Firestore: ['batch', 'bulkWriter', 'runTransaction', 'recursiveDelete', 'bundle', 'terminate'],
  DocumentReference: ['set', 'update', 'delete', 'create'],
  CollectionReference: ['add'],
  WriteBatch: ['set', 'update', 'delete', 'create', 'commit'],
  BulkWriter: ['set', 'update', 'delete', 'create', 'flush', 'close'],
  Transaction: ['set', 'update', 'delete', 'create'],
};
for (const [cls, methods] of Object.entries(WRITE_METHODS)) {
  const proto = fs[cls]?.prototype;
  if (!proto) continue;
  for (const m of methods) {
    if (typeof proto[m] !== 'function') continue;
    Object.defineProperty(proto, m, {
      value() { throw new Error(`[audit] read-only: ${cls}.${m}() is disabled`); },
      writable: false, configurable: false,
    });
  }
}
const AUTH_WRITE = ['createUser', 'updateUser', 'deleteUser', 'deleteUsers', 'importUsers', 'setCustomUserClaims',
  'revokeRefreshTokens', 'createCustomToken', 'createSessionCookie', 'generatePasswordResetLink',
  'generateEmailVerificationLink', 'generateSignInWithEmailLink', 'generateVerifyAndChangeEmailLink',
  'createProviderConfig', 'updateProviderConfig', 'deleteProviderConfig'];
if (authMod) {
  let proto = authMod.Auth.prototype;
  while (proto && proto !== Object.prototype) {
    for (const m of AUTH_WRITE) {
      if (Object.prototype.hasOwnProperty.call(proto, m)) {
        Object.defineProperty(proto, m, { value() { throw new Error(`[audit] read-only: Auth.${m}() is disabled`); }, writable: false, configurable: false });
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
}

const app = initializeApp(usingEmulator ? { projectId: PROJECT_ID } : { credential: applicationDefault(), projectId: PROJECT_ID }, 'readonly-audit');
const rawDb = fs.getFirestore(app);
const rawAuth = authMod ? authMod.getAuth(app) : null;

// Allow-listed proxies: the audit code never sees the raw objects.
const QUERY_OK = new Set(['where', 'orderBy', 'limit', 'startAfter', 'select', 'get', 'count', 'id', 'path', 'parent', 'doc', 'collection', 'listCollections', 'firestore']);
function ro(target) {
  if (target === null || typeof target !== 'object') return target;
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'symbol') return t[prop];
      if (!QUERY_OK.has(prop)) throw new Error(`[audit] read-only proxy: .${String(prop)} is not allowed`);
      const v = t[prop];
      if (typeof v !== 'function') return prop === 'firestore' ? db : v;
      return (...args) => {
        const out = v.apply(t, args);
        if (out instanceof fs.Query || out instanceof fs.DocumentReference || out instanceof fs.CollectionReference) return ro(out);
        return out;
      };
    },
  });
}
const db = {
  collection: (p) => ro(rawDb.collection(p)),
  collectionGroup: (id) => ro(rawDb.collectionGroup(id)),
  doc: (p) => ro(rawDb.doc(p)),
  listCollections: () => rawDb.listCollections(),
  getAll: (...refs) => rawDb.getAll(...refs),
};
const auth = rawAuth ? { listUsers: (max, token) => rawAuth.listUsers(max, token) } : null;

// Self-test: every write path must throw synchronously, before any I/O.
function selfTest() {
  const ref = rawDb.doc('__audit_selftest__/x');
  const attempts = [
    () => ref.set({}), () => ref.update({ a: 1 }), () => ref.delete(), () => ref.create({}),
    () => rawDb.collection('__audit_selftest__').add({}), () => rawDb.batch(), () => rawDb.bulkWriter(),
    () => rawDb.runTransaction(async () => {}), () => rawDb.recursiveDelete(ref),
    () => db.doc('__audit_selftest__/x').set({}), () => db.collection('__audit_selftest__').add({}),
    ...(rawAuth ? [() => rawAuth.deleteUser('x'), () => rawAuth.updateUser('x', {}), () => rawAuth.setCustomUserClaims('x', {})] : []),
  ];
  attempts.forEach((fn, i) => {
    let threw = false;
    try { const r = fn(); if (r && typeof r.then === 'function') r.catch(() => {}); } catch { threw = true; }
    if (!threw) { console.error(`[audit] self-test failed at write attempt #${i}; aborting.`); process.exit(3); }
  });
}
selfTest();

// ------------------------------------------------------------- helpers ----
const h = (v) => createHash('sha256').update(`${SALT}:${String(v).trim().toLowerCase()}`).digest('hex').slice(0, 12);
const looksLikeEmail = (s) => typeof s === 'string' && s.includes('@');
const anonSeg = (s) => (looksLikeEmail(s) ? `email#${h(s)}` : HASH_IDS ? `id#${h(s)}` : s);
const anonPath = (p) => p.split('/').map((seg, i) => (i % 2 === 1 ? anonSeg(seg) : seg)).join('/');
const typeOf = (v) => (v === null ? 'null' : v === undefined ? 'missing' : Array.isArray(v) ? 'array' : v instanceof fs.Timestamp ? 'timestamp' : typeof v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const findings = [];
const counts = {};
const truncated = [];
function add(severity, collection, path, rule, detail = '') {
  findings.push({ severity, collection, path: anonPath(path), rule, ...(detail ? { detail } : {}) });
}
function bump(key, n = 1) { counts[key] = (counts[key] ?? 0) + n; }

async function readAll(query, label) {
  const out = [];
  let last = null;
  for (;;) {
    let q = query.orderBy(fs.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const d of snap.docs) out.push(d);
    if (snap.size < PAGE) break;
    last = snap.docs[snap.docs.length - 1];
    if (out.length >= MAX_DOCS) { truncated.push(label); break; }
  }
  return out;
}

// ------------------------------------------------------------- loading ----
const KNOWN_ROOT = new Set(['users', 'clients', 'sessions', 'deviceAssignments', 'messages', 'messageThreads', 'appointments',
  'patientInvitations', 'patientInvitationClaims', 'brands', 'clinics', 'practitioners', 'protocolCatalog']);
const HARNESS_ROOT = new Set(['e2eHarnessLocks', 'e2eHarnessDisposableAccounts', 'e2eHarnessBaselines', 'e2eHarnessSentinels']);

async function main() {
  const startedAt = new Date().toISOString();
  const rootCollections = (await db.listCollections()).map((c) => c.id);
  for (const id of rootCollections) {
    if (!KNOWN_ROOT.has(id) && !HARNESS_ROOT.has(id)) add('REVIEW', id, id, 'unknown-root-collection', 'not covered by rules -> client access denied; decide keep/delete');
  }

  // ---- Auth
  const authUsers = new Map();
  const authSummary = { skipped: !auth };
  if (auth) {
    let token; let n = 0;
    const s = { total: 0, emailVerified: 0, disabled: 0, anonymousOrNoProvider: 0, withCustomClaims: 0, providers: {}, emailHeuristics: { testLike: 0, other: 0, none: 0 }, signedInLast30d: 0, neverSignedIn: 0 };
    do {
      const page = await auth.listUsers(1000, token);
      for (const u of page.users) {
        n += 1; s.total += 1;
        if (u.emailVerified) s.emailVerified += 1;
        if (u.disabled) s.disabled += 1;
        if (!u.providerData?.length) s.anonymousOrNoProvider += 1;
        if (u.customClaims && Object.keys(u.customClaims).length) s.withCustomClaims += 1;
        for (const p of u.providerData ?? []) s.providers[p.providerId] = (s.providers[p.providerId] ?? 0) + 1;
        const e = u.email?.toLowerCase();
        if (!e) s.emailHeuristics.none += 1;
        else if (/(e2e|test|example\.(com|org|net)|\+|mailinator|\.test$|\.invalid$)/.test(e)) s.emailHeuristics.testLike += 1;
        else s.emailHeuristics.other += 1;
        const last = Date.parse(u.metadata?.lastSignInTime ?? '');
        if (!Number.isFinite(last)) s.neverSignedIn += 1;
        else if (Date.now() - last < 30 * 864e5) s.signedInLast30d += 1;
        authUsers.set(u.uid, { emailHash: e ? h(e) : null, email: e ?? null, emailVerified: u.emailVerified });
      }
      token = page.pageToken;
      if (n >= MAX_AUTH) { truncated.push('auth.users'); break; }
    } while (token);
    Object.assign(authSummary, s);
  }
  const isAuthUser = (uid) => (auth ? authUsers.has(uid) : null);

  // ---- users
  const users = new Map();
  for (const d of await readAll(db.collection('users'), 'users')) {
    const v = d.data(); users.set(d.id, v); bump('users');
    const role = v.role;
    if (role === 'clinician') bump('users.role=clinician');
    else if (role === 'patient') bump('users.role=patient');
    else if (role == null) bump('users.role=null');
    else add('DANGEROUS', 'users', d.ref.path, 'unexpected-role-value', `type=${typeOf(role)}`);
    if (auth && !isAuthUser(d.id)) add('CLEANUP', 'users', d.ref.path, 'orphan-no-auth-user');
    if (role === 'clinician' && KNOWN_E2E_UIDS.size && !KNOWN_E2E_UIDS.has(d.id)) add('REVIEW', 'users', d.ref.path, 'clinician-role-not-in-e2e-allowlist', 'role is self-assigned under both rule sets');
  }
  const isClinicianUid = (uid) => users.get(uid)?.role === 'clinician';

  // ---- clinics / practitioners
  const clinics = new Map();
  for (const d of await readAll(db.collection('clinics'), 'clinics')) {
    const v = d.data(); clinics.set(d.id, v); bump('clinics');
    const p = v.practitionerIds;
    if (!Array.isArray(p) || !p.every(isStr)) { add('BREAKS', 'clinics', d.ref.path, 'practitionerIds-not-string-array'); continue; }
    const idIsUser = users.has(d.id) || (auth && isAuthUser(d.id));
    if (!idIsUser) add('DANGEROUS', 'clinics', d.ref.path, 'clinic-id-not-a-user-id', 'new rules only create clinics/{uid}; legacy ID created without ownership proof');
    if (idIsUser && !(p.length === 1 && p[0] === d.id)) add('DANGEROUS', 'clinics', d.ref.path, 'uid-clinic-membership-not-exactly-owner', `practitionerIds.length=${p.length}, ownerIncluded=${p.includes(d.id)} (squatted or extra members get isClinicMember)`);
    for (const uid of p) {
      if (auth && !isAuthUser(uid)) add('DANGEROUS', 'clinics', d.ref.path, 'practitionerId-not-auth-user');
      else if (!isClinicianUid(uid)) add('DANGEROUS', 'clinics', d.ref.path, 'practitionerId-not-clinician-role');
    }
    if (has(v, 'id') && v.id !== d.id) add('BREAKS', 'clinics', d.ref.path, 'data.id-differs-from-doc-id');
  }
  const practitioners = new Map();
  for (const d of await readAll(db.collection('practitioners'), 'practitioners')) {
    const v = d.data(); practitioners.set(d.id, v); bump('practitioners');
    if (v.userId !== d.id) add('BREAKS', 'practitioners', d.ref.path, 'userId-differs-from-doc-id', 'new client throws "does not belong to the signed-in account"');
    const c = clinics.get(v.clinicId);
    if (!isStr(v.clinicId)) add('BREAKS', 'practitioners', d.ref.path, 'clinicId-missing');
    else if (!c) add('BREAKS', 'practitioners', d.ref.path, 'clinic-does-not-exist');
    else if (!Array.isArray(c.practitionerIds) || !c.practitionerIds.includes(d.id)) add('BREAKS', 'practitioners', d.ref.path, 'not-member-of-own-clinic');
    else if (v.clinicId !== d.id) add('REVIEW', 'practitioners', d.ref.path, 'belongs-to-shared-or-legacy-clinic');
    if (!isClinicianUid(d.id)) add('REVIEW', 'practitioners', d.ref.path, 'practitioner-without-clinician-role');
  }

  // ---- invitations (+claims)
  const invitations = new Map();
  const STATUSES = new Set(['pending', 'accepted', 'cancelled']);
  for (const d of await readAll(db.collection('patientInvitations'), 'patientInvitations')) {
    const v = d.data(); invitations.set(d.id, v); bump('patientInvitations'); bump(`patientInvitations.status=${STATUSES.has(v.status) ? v.status : 'other'}`);
    if (v.id !== d.id) add('BREAKS', 'patientInvitations', d.ref.path, 'data.id-differs-from-doc-id');
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(d.id)) add('REVIEW', 'patientInvitations', d.ref.path, 'id-not-invitation-code-format');
    if (!STATUSES.has(v.status)) add('BREAKS', 'patientInvitations', d.ref.path, 'unknown-status');
    if (!isClinicianUid(v.clinicianId)) add('DANGEROUS', 'patientInvitations', d.ref.path, 'inviter-not-clinician-role');
    if (!isStr(v.patientEmail) || v.patientEmail !== v.patientEmail.toLowerCase().trim()) add('BREAKS', 'patientInvitations', d.ref.path, 'patientEmail-not-normalized', 'never matches token.email.lower()');
    if (v.status === 'pending') {
      if (!has(v, 'expiresAt')) add('DANGEROUS', 'patientInvitations', d.ref.path, 'pending-without-expiresAt', 'new accept rule defaults missing expiresAt to "not expired": never expires');
      else if (!(v.expiresAt instanceof fs.Timestamp)) add('BREAKS', 'patientInvitations', d.ref.path, 'expiresAt-not-timestamp');
      if (!isStr(v.clinicId)) add('DANGEROUS', 'patientInvitations', d.ref.path, 'pending-without-clinicId', 'acceptance links patient with no clinic binding');
      else if (!clinics.get(v.clinicId)?.practitionerIds?.includes?.(v.clinicianId)) add('DANGEROUS', 'patientInvitations', d.ref.path, 'pending-clinicId-not-inviters-clinic');
      if (!isStr(v.uniquenessClaimId)) add('LEGACY', 'patientInvitations', d.ref.path, 'pending-without-uniqueness-claim');
      if (auth && isStr(v.patientEmail) && authUsers.get(v.clinicianId)?.email === v.patientEmail.toLowerCase()) add('DANGEROUS', 'patientInvitations', d.ref.path, 'self-invitation');
    }
    if (v.status === 'accepted' && !isStr(v.patientId)) add('BREAKS', 'patientInvitations', d.ref.path, 'accepted-without-patientId');
  }
  for (const d of await readAll(db.collectionGroup('emails'), 'patientInvitationClaims/*/emails')) {
    const parts = d.ref.path.split('/');
    if (parts[0] !== 'patientInvitationClaims') continue;
    bump('patientInvitationClaims');
    const v = d.data();
    const inv = invitations.get(v.invitationId);
    if (!inv) add('CLEANUP', 'patientInvitationClaims', d.ref.path, 'claim-for-missing-invitation');
    else if (inv.status !== 'pending') add('CLEANUP', 'patientInvitationClaims', d.ref.path, 'claim-not-released', `invitationStatus=${STATUSES.has(inv.status) ? inv.status : 'other'}`);
    if (v.clinicianId !== parts[1]) add('BREAKS', 'patientInvitationClaims', d.ref.path, 'clinicianId-differs-from-path');
  }

  // ---- clients
  const clients = new Map();
  const canonicalClinician = (v) => (v.clinicianId != null ? v.clinicianId : v.linkedClinicianCode ?? null);
  for (const d of await readAll(db.collection('clients'), 'clients')) {
    const v = d.data(); clients.set(d.id, v); bump('clients');
    const P = d.ref.path; const C = 'clients';
    if (d.id.startsWith('demo-') || v.isDemo === true) add('CLEANUP', C, P, 'demo-record-in-firestore');
    if (v.id !== d.id) add('DANGEROUS', C, P, 'data.id-differs-from-doc-id', 'main create rule allowed writing any path when data.id==caller; possible pre-seeded victim profile');
    if (auth && !isAuthUser(d.id)) add('CLEANUP', C, P, 'no-auth-user-for-doc-id');
    if (users.get(d.id)?.role === 'clinician') add('REVIEW', C, P, 'profile-owner-has-clinician-role');
    if (auth && isStr(v.email) && authUsers.get(d.id)?.email && authUsers.get(d.id).email !== v.email.toLowerCase().trim()) add('REVIEW', C, P, 'email-differs-from-auth-email');
    const cid = v.clinicianId; const lcc = v.linkedClinicianCode;
    if (!has(v, 'clinicianId')) bump('clients.clinicianId=missing');
    if (cid === '') add('BREAKS', C, P, 'clinicianId-empty-string', 'client falls back to linkedClinicianCode, rules do not (split-brain)');
    if (cid != null && typeof cid !== 'string') add('BREAKS', C, P, 'clinicianId-wrong-type', `type=${typeOf(cid)}`);
    if (isStr(cid) && isStr(lcc) && cid !== lcc) add('LEGACY', C, P, 'split-brain-clinicianId-vs-linkedClinicianCode', 'canonical wins; null the legacy field');
    if (cid == null && isStr(lcc)) add('DANGEROUS', C, P, 'legacy-linkedClinicianCode-grants-access', 'patient-settable under main; no invitation proof unless acceptedInvitationId checks out');
    if (cid == null && isStr(lcc) && !has(v, 'clinicianId')) add('LEGACY', C, P, 'legacy-link-not-enumerable', 'roster query needs clinicianId==null explicitly');
    const owner = canonicalClinician(v);
    if (isStr(owner)) {
      bump('clients.linked');
      if (owner === d.id) add('DANGEROUS', C, P, 'patient-is-own-clinician');
      if (auth && !isAuthUser(owner)) add('DANGEROUS', C, P, 'clinician-not-auth-user');
      else if (!isClinicianUid(owner)) add('DANGEROUS', C, P, 'clinician-not-clinician-role');
      const inv = isStr(v.acceptedInvitationId) ? invitations.get(v.acceptedInvitationId) : null;
      if (!inv) add('DANGEROUS', C, P, 'link-without-accepted-invitation', 'relationship unproven: patient could self-assign clinician under main rules');
      else if (inv.status !== 'accepted' || inv.patientId !== d.id || inv.clinicianId !== owner) add('DANGEROUS', C, P, 'link-invitation-mismatch');
      else if ((inv.clinicId ?? null) !== (v.clinicId ?? null)) add('REVIEW', C, P, 'clinicId-differs-from-invitation-clinicId');
    } else if (isStr(v.acceptedInvitationId)) add('CLEANUP', C, P, 'acceptedInvitationId-without-link');
    if (v.clinicId != null) {
      if (!isStr(v.clinicId)) add('BREAKS', C, P, 'clinicId-wrong-type');
      else {
        const clinic = clinics.get(v.clinicId);
        if (!clinic) add('REVIEW', C, P, 'clinicId-points-to-missing-clinic', 'a later clinic created at this id gains access');
        else if (!isStr(owner)) add('DANGEROUS', C, P, 'clinicId-without-clinician-link', 'patient-set clinicId: grants clinic members access and patient reads clinic/protocolCatalog');
        else if (!clinic.practitionerIds?.includes?.(owner)) add('DANGEROUS', C, P, 'clinicId-not-owning-clinicians-clinic');
      }
    }
    if (Array.isArray(v.brainMaps) && v.brainMaps.length) { bump('clients.embeddedBrainMaps'); add('LEGACY', C, P, 'embedded-brainMaps-array', `count=${v.brainMaps.length}`); }
    if (v.assignedDevice) add('LEGACY', C, P, 'embedded-assignedDevice');
  }

  // ---- brainMaps
  for (const d of await readAll(db.collectionGroup('brainMaps'), 'clients/*/brainMaps')) {
    const parts = d.ref.path.split('/'); if (parts[0] !== 'clients' || parts.length !== 4) { add('REVIEW', 'brainMaps', d.ref.path, 'brainMaps-at-unexpected-path'); continue; }
    bump('brainMaps'); const v = d.data();
    if (v.schemaVersion !== 1 || v.id !== d.id) add('BREAKS', 'brainMaps', d.ref.path, 'non-canonical-brainMap');
    const owner = clients.get(parts[1]) ? canonicalClinician(clients.get(parts[1])) : null;
    if (v.createdBy !== owner) add('REVIEW', 'brainMaps', d.ref.path, 'createdBy-not-current-clinician');
  }

  // ---- sessions
  for (const d of await readAll(db.collection('sessions'), 'sessions')) {
    const v = d.data(); bump('sessions'); const P = d.ref.path;
    if (v.isDemo === true || String(v.patientId ?? '').startsWith('demo-')) add('CLEANUP', 'sessions', P, 'demo-session');
    if (!isStr(v.patientId)) { add('BREAKS', 'sessions', P, 'patientId-missing'); continue; }
    const pat = clients.get(v.patientId);
    if (!pat) { add('CLEANUP', 'sessions', P, 'patient-profile-missing'); continue; }
    if (v.clinicId != null && v.clinicId !== pat.clinicId) add('REVIEW', 'sessions', P, 'clinicId-differs-from-patient-clinicId', 'not a grant under new rules (needs match), but forged/stale attribution');
    if (isStr(v.clinicId) && !clinics.has(v.clinicId)) add('REVIEW', 'sessions', P, 'clinicId-points-to-missing-clinic', 'a clinic later created at this id + patient clinicId match would gain access');
    if (v.clinicianId != null && v.clinicianId !== canonicalClinician(pat)) add('REVIEW', 'sessions', P, 'clinicianId-differs-from-current-clinician', 'forged or stale; immutable under new update rule');
  }

  // ---- deviceAssignments
  for (const d of await readAll(db.collection('deviceAssignments'), 'deviceAssignments')) {
    const v = d.data(); bump('deviceAssignments'); const P = d.ref.path;
    if (v.patientId !== d.id) add('BREAKS', 'deviceAssignments', P, 'patientId-differs-from-doc-id', 'update rule denies; delete+recreate needed');
    const pat = clients.get(d.id);
    if (!pat) add('CLEANUP', 'deviceAssignments', P, 'patient-profile-missing');
    else if (v.assignedByUserId !== d.id && v.assignedByUserId !== canonicalClinician(pat)) add('REVIEW', 'deviceAssignments', P, 'assigned-by-non-participant');
  }

  // ---- legacy messages/{patientId}
  for (const d of await readAll(db.collection('messages'), 'messages')) {
    const v = d.data(); bump('messages(legacy)'); const P = d.ref.path;
    const pid = typeof v.patientId === 'string' ? v.patientId : v.clientId;
    if (d.id.startsWith('demo-') || v.isDemo === true) add('CLEANUP', 'messages', P, 'demo-thread');
    if (pid !== d.id) add('LEGACY', 'messages', P, 'thread-patient-differs-from-doc-id', 'hidden by new mapper; only doc-id owner can read');
    if (isStr(v.clientId) && isStr(v.patientId) && v.clientId !== v.patientId) add('DANGEROUS', 'messages', P, 'clientId-differs-from-patientId', 'extra participant could have authored under main rules');
    const pat = clients.get(d.id);
    if (!pat) add('CLEANUP', 'messages', P, 'patient-profile-missing');
    else if (v.clinicianId !== canonicalClinician(pat)) add('LEGACY', 'messages', P, 'clinician-not-current', 'readable by patient only; not shown in current relationship');
    else if (pid === d.id) add('REVIEW', 'messages', P, 'displayed-legacy-history', 'shown to patient and current clinician as authored by each other; authorship unprovable');
    if (!Array.isArray(v.messages)) add('BREAKS', 'messages', P, 'messages-not-array', 'mapper throws "Legacy message history is malformed"');
  }

  // ---- canonical messageThreads
  for (const d of await readAll(db.collectionGroup('relationships'), 'messageThreads/*/relationships')) {
    const parts = d.ref.path.split('/'); if (parts[0] !== 'messageThreads') continue;
    bump('messageThreads.relationships'); const v = d.data();
    if (v.patientId !== parts[1] || v.clinicianId !== parts[3] || v.schemaVersion !== 1) add('BREAKS', 'messageThreads', d.ref.path, 'summary-identity-mismatch');
    const pat = clients.get(parts[1]);
    if (!pat || canonicalClinician(pat) !== parts[3]) add('REVIEW', 'messageThreads', d.ref.path, 'relationship-not-current');
  }
  for (const d of await readAll(db.collectionGroup('messages'), 'messageThreads/*/relationships/*/messages')) {
    const parts = d.ref.path.split('/'); if (parts[0] !== 'messageThreads' || parts.length !== 6) continue;
    bump('messageThreads.messages'); const v = d.data();
    const roleOk = (v.senderRole === 'patient' && v.senderId === parts[1]) || (v.senderRole === 'clinician' && v.senderId === parts[3]);
    if (v.id !== d.id || v.patientId !== parts[1] || v.clinicianId !== parts[3] || !roleOk || v.schemaVersion !== 1) add('DANGEROUS', 'messageThreads', d.ref.path, 'message-identity-mismatch');
  }

  // ---- appointments
  const APPT_TYPES = new Set(['remote-training', 'in-clinic-evaluation', 'qeeg-mapping', 'protocol-review', 'consultation']);
  const APPT_STATUS = new Set(['scheduled', 'in-progress', 'completed', 'cancelled', 'missed']);
  for (const d of await readAll(db.collection('appointments'), 'appointments')) {
    const v = d.data(); bump('appointments'); const P = d.ref.path; const A = 'appointments';
    if (d.id.startsWith('demo-') || v.isDemo === true) add('CLEANUP', A, P, 'demo-appointment');
    if (typeof v.patientId === 'string') {
      bump('appointments.canonical');
      const ok = isStr(v.clinicianId) && v.patientId.length > 0 && v.startsAt instanceof fs.Timestamp && Number.isInteger(v.durationMinutes) &&
        v.durationMinutes >= 15 && v.durationMinutes <= 240 && APPT_TYPES.has(v.type) && APPT_STATUS.has(v.status) && isStr(v.createdBy) &&
        isStr(v.patientDisplayName) && isStr(v.timezone) && (v.status !== 'cancelled' || (v.cancelledAt && isStr(v.cancelledBy)));
      if (!ok) add('BREAKS', A, P, 'canonical-shape-invalid', 'list() throws for every query that returns it (patient calendar breaks)');
      if (v.schemaVersion !== 1 || !/^[A-Za-z0-9_-]{20,100}$/.test(d.id)) add('REVIEW', A, P, 'not-created-by-new-client');
      const pat = clients.get(v.patientId);
      if (!pat) add('CLEANUP', A, P, 'patient-profile-missing');
      else if (v.clinicianId !== canonicalClinician(pat)) add('DANGEROUS', A, P, 'canonical-clinician-not-current', 'still readable by patientId; main let any user create rows naming any patient');
      if (v.createdBy !== v.clinicianId) add('DANGEROUS', A, P, 'createdBy-differs-from-clinicianId');
    } else if (has(v, 'patientId') && v.patientId === null) {
      bump('appointments.legacy-backfilled');
      const pat = clients.get(v.clientId);
      if (!isStr(v.clientId)) add('BREAKS', A, P, 'legacy-null-patientId-without-clientId');
      else if (!pat || v.clinicianId !== canonicalClinician(pat)) add('DANGEROUS', A, P, 'legacy-readable-by-clientId-with-unproven-clinician');
      if (v.startsAt !== undefined || typeof v.date !== 'string' || typeof v.time !== 'string' || !APPT_STATUS.has(v.status) || !isStr(v.clientName)) add('BREAKS', A, P, 'legacy-shape-invalid', 'list() throws');
    } else if (has(v, 'patientId')) {
      add('BREAKS', A, P, 'patientId-wrong-type', `type=${typeOf(v.patientId)}`);
    } else {
      bump('appointments.legacy-unbackfilled');
      add('LEGACY', A, P, 'legacy-invisible-until-backfill', 'no patientId field: new queries never return it');
    }
  }

  // ---- brands / protocolCatalog
  for (const d of await readAll(db.collection('brands'), 'brands')) {
    bump('brands'); add('CLEANUP', 'brands', d.ref.path, 'legacy-public-brand', 'world-readable under new rules; app no longer uses brands/*');
  }
  for (const d of await readAll(db.collection('protocolCatalog'), 'protocolCatalog')) {
    bump('protocolCatalog'); const v = d.data();
    const clinic = clinics.get(v.clinicId);
    if (!isStr(v.clinicId)) add('BREAKS', 'protocolCatalog', d.ref.path, 'clinicId-missing', 'unreadable under new rules');
    else if (!clinic) add('REVIEW', 'protocolCatalog', d.ref.path, 'clinic-missing', 'future clinic at this id would inherit it');
  }

  // ---- harness collections: counts only
  for (const id of rootCollections.filter((c) => HARNESS_ROOT.has(c))) {
    const docs = await readAll(db.collection(id), id);
    counts[`harness.${id}`] = docs.length;
  }

  const bySeverity = {}; const byRule = {};
  for (const f of findings) { bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1; const k = `${f.severity} ${f.collection}:${f.rule}`; byRule[k] = (byRule[k] ?? 0) + 1; }
  const report = {
    meta: { projectId: PROJECT_ID, emulator: usingEmulator, startedAt, finishedAt: new Date().toISOString(), maxDocsPerCollection: MAX_DOCS, hashedIds: HASH_IDS, e2eAllowlistSize: KNOWN_E2E_UIDS.size, note: 'Hashes use a per-run salt unless AUDIT_HASH_SALT is set.' },
    rootCollections, truncated, auth: authSummary, counts, bySeverity, byRule, findings,
  };
  const text = JSON.stringify(report, null, 2);
  if (env.AUDIT_OUT_FILE) writeFileSync(env.AUDIT_OUT_FILE, text); else process.stdout.write(`${text}\n`);
  console.error(`[audit] done: ${findings.length} findings ${JSON.stringify(bySeverity)}; truncated=${JSON.stringify(truncated)}`);
}

main().catch((e) => { console.error(`[audit] failed: ${e?.code ?? ''} ${e?.message ?? e}`); process.exit(1); });
