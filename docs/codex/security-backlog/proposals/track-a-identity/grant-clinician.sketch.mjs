// SKETCH (Track A) - proposed scripts/admin/grant-clinician.mjs. Not run, not wired.
// (Linked patients can get() this doc, so keep it free of private fields.)
// Operator-only trusted writer for clinicianAccess/{uid}. Uses Application Default
// Credentials (gcloud auth application-default login) or GOOGLE_APPLICATION_CREDENTIALS.
// Usage:
//   node scripts/admin/grant-clinician.mjs grant  <uid> --name "Dr Jane Doe" [--license CPSO-123 --license-status verified]
//   node scripts/admin/grant-clinician.mjs revoke <uid> [--reason text]
//   node scripts/admin/grant-clinician.mjs show   <uid>
//   (E2E only) --mark-email-verified  : sets Auth emailVerified=true for an allow-listed E2E account.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const [command, uid, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId || !uid || !['grant', 'revoke', 'show', 'suspend'].includes(command)) {
  throw new Error('Set FIREBASE_PROJECT_ID and pass: grant|suspend|revoke|show <uid>');
}
const app = initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const ref = db.doc(`clinicianAccess/${uid}`);
const user = await auth.getUser(uid);

if (command === 'show') {
  console.log({ email: user.email, emailVerified: user.emailVerified, grant: (await ref.get()).data() ?? null });
} else if (command === 'grant') {
  if (rest.includes('--mark-email-verified')) {
    if (!/^neurasticity-e2e-|^e2e-/.test(user.email ?? '')) throw new Error('Only E2E accounts may be force-verified.');
    await auth.updateUser(uid, { emailVerified: true });
  } else if (!user.emailVerified) {
    throw new Error('Refusing to grant: the account email is not verified.');
  }
  const displayName = flag('name');
  if (!displayName?.trim()) throw new Error('--name is required (it is the patient-visible, rules-pinned clinician name).');
  const license = flag('license');
  await ref.set({
    status: 'active',
    displayName: displayName.trim(),
    license: license ? {
      identifier: license,
      status: flag('license-status') ?? 'unverified',   // unverified | pending | verified | expired | revoked
      verifiedAt: flag('license-status') === 'verified' ? FieldValue.serverTimestamp() : null,
    } : null,
    grantedBy: process.env.USER ?? 'operator',
    grantedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    schemaVersion: 1,
  }, { merge: true });
  console.log(`Granted clinician access to ${uid}. The user must press "Check again" or re-sign-in.`);
} else {
  // suspend | revoke: effective on the next request with the stage-2 rules.
  await ref.set({
    status: command === 'revoke' ? 'revoked' : 'suspended',
    reason: flag('reason') ?? null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`${command}d ${uid}.`);
}
