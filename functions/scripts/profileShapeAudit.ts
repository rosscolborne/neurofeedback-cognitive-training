import { parseArgs } from 'node:util';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { DomainReadError, readUserProfile } from '@nfct/shared';
import { resolveTarget, type CliEnvironment, type Output } from './cli';

// Read-only audit of the player profile documents (users/*) in a project:
// how many have each schemaVersion and set of top-level keys, and whether
// this build's reader (readUserProfile, which the app uses at sign-in) can
// read them. Run it before merging or deploying a change to shared schemas,
// profile reads, AuthContext or the Firestore rules, to see which real
// accounts the change meets (docs/nfct/nfct-dev-canary.md#existing-profile-shapes).
// Every new-account test writes the current shape, so this is how the shapes
// real accounts actually hold are found; shared/__tests__/profileShapes.ts
// holds the ones the tests cover.
//
// Safety:
// - It only reads: the audit sees users/* only through ProfileDocuments,
//   which pages through the collection with queries.
// - It prints counts, key names, schemaVersion values and reader issue codes,
//   never field values. Document IDs (UIDs) only with --examples.
// - cli.ts's target rules: --project is required; a real project needs --live
//   and the operator's Application Default Credentials. A read-only identity
//   (Cloud Datastore Viewer) is enough.

/** One profile document: its ID and raw data. */
export type ProfileDocument = { readonly id: string; readonly data: Readonly<Record<string, unknown>> };

/** The audit's only access to the project: pages of users/* in document-ID order. */
export interface ProfileDocuments {
  page(afterId: string | undefined, limit: number): Promise<readonly ProfileDocument[]>;
}

export function firestoreProfileDocuments(db: Firestore, collection = 'users'): ProfileDocuments {
  return {
    async page(afterId, limit) {
      let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(limit);
      if (afterId !== undefined) query = query.startAfter(afterId);
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
  };
}

export type ProfileClassification = {
  /** `absent`, a number, or the JSON of any other value, shortened. */
  readonly schemaVersion: string;
  readonly keys: readonly string[];
  readonly readable: boolean;
  /** Why this build cannot read it; empty when it can. Issue paths and codes only, never values. */
  readonly reason: string;
};

function describeVersion(data: Readonly<Record<string, unknown>>): string {
  if (!Object.hasOwn(data, 'schemaVersion')) return 'absent';
  const version = data.schemaVersion;
  if (typeof version === 'number') return String(version);
  return (JSON.stringify(version) ?? String(version)).slice(0, 24);
}

/** What this build makes of one profile document. Pure. */
export function classifyProfile(data: Readonly<Record<string, unknown>>): ProfileClassification {
  const shape = { schemaVersion: describeVersion(data), keys: Object.keys(data).sort() };
  try {
    readUserProfile(data);
    return { ...shape, readable: true, reason: '' };
  } catch (error) {
    if (!(error instanceof DomainReadError)) throw error;
    const reason = error.issues.length === 0
      ? 'unsupported schemaVersion'
      : [...new Set(error.issues.map((issue) => `${issue.path.map(String).join('.') || '(document)'}: ${issue.code}`))].sort().join('; ');
    return { ...shape, readable: false, reason };
  }
}

export type ShapeGroup = ProfileClassification & { readonly count: number; readonly examples: readonly string[] };

export type ProfileShapeReport = {
  readonly projectId: string;
  readonly scanned: number;
  readonly readable: number;
  readonly unreadable: number;
  /** Stopped at --max-docs before the end of the collection. */
  readonly truncated: boolean;
  /** Largest first. */
  readonly groups: readonly ShapeGroup[];
};

/** Pages through every profile document, up to maxDocs, and groups them by shape and verdict. */
export async function auditProfileShapes(
  documents: ProfileDocuments,
  { projectId, pageSize, maxDocs, examples }: { projectId: string; pageSize: number; maxDocs: number; examples: number },
): Promise<ProfileShapeReport> {
  const groups = new Map<string, { classification: ProfileClassification; count: number; examples: string[] }>();
  let scanned = 0;
  let afterId: string | undefined;
  let truncated = false;
  for (;;) {
    if (scanned >= maxDocs) {
      truncated = (await documents.page(afterId, 1)).length > 0;
      break;
    }
    const limit = Math.min(pageSize, maxDocs - scanned);
    const page = await documents.page(afterId, limit);
    for (const { id, data } of page) {
      const classification = classifyProfile(data);
      const key = JSON.stringify([classification.schemaVersion, classification.keys, classification.readable, classification.reason]);
      const group = groups.get(key) ?? { classification, count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < examples) group.examples.push(id);
      groups.set(key, group);
    }
    scanned += page.length;
    if (page.length < limit) break;
    afterId = page[page.length - 1]!.id;
  }
  const sorted = [...groups.values()]
    .map(({ classification, count, examples: ids }) => ({ ...classification, count, examples: ids }))
    .sort((a, b) => b.count - a.count || Number(a.readable) - Number(b.readable));
  const readable = sorted.filter((group) => group.readable).reduce((sum, group) => sum + group.count, 0);
  return { projectId, scanned, readable, unreadable: scanned - readable, truncated, groups: sorted };
}

export function formatProfileShapeReport(report: ProfileShapeReport): string[] {
  const lines = [`${report.projectId} users/*: ${report.scanned} profile document(s) scanned${report.truncated ? ' (TRUNCATED at --max-docs: raise it to see every document)' : ''}`];
  for (const group of report.groups) {
    lines.push(`- ${group.count} ${group.readable ? 'readable' : 'UNREADABLE'}: schemaVersion ${group.schemaVersion}; keys ${group.keys.join(', ') || '(none)'}${group.reason ? `; ${group.reason}` : ''}`);
    if (group.examples.length > 0) lines.push(`  e.g. ${group.examples.join(', ')}`);
  }
  lines.push(`This build can read ${report.readable} of ${report.scanned}.`);
  if (report.unreadable > 0) {
    lines.push(`${report.unreadable} account(s) would see "This version of the app can’t open your account." Cover each unreadable shape in shared/__tests__/profileShapes.ts, or plan a migration or wipe with the owner.`);
  }
  return lines;
}

export type ProfileShapeAuditOptions = { readonly documents?: ProfileDocuments };

/**
 * `audit-profile-shapes --project <id> [--live] [--page-size 300] [--max-docs 10000]
 *  [--examples 0] [--fail-on-unreadable]`: reports the shapes of users/*.
 * With --fail-on-unreadable it fails when a document is unreadable or the scan
 * was truncated, for use as a gate.
 */
export async function runProfileShapeAudit(argv: readonly string[], env: CliEnvironment, out: Output, options: ProfileShapeAuditOptions = {}): Promise<ProfileShapeReport> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      project: { type: 'string' },
      'page-size': { type: 'string', default: '300' },
      'max-docs': { type: 'string', default: '10000' },
      examples: { type: 'string', default: '0' },
      'fail-on-unreadable': { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const target = resolveTarget(values.project, values.live, env);
  const number = (name: string, value: string, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
    return parsed;
  };
  const settings = {
    projectId: target.projectId,
    pageSize: number('page-size', values['page-size'], 1, 1000),
    maxDocs: number('max-docs', values['max-docs'], 1, 1_000_000),
    examples: number('examples', values.examples, 0, 5),
  };
  const app = options.documents ? null : initializeApp({ projectId: target.projectId }, `nfct-profile-shape-audit-${Date.now()}`);
  try {
    const report = await auditProfileShapes(options.documents ?? firestoreProfileDocuments(getFirestore(app!)), settings);
    formatProfileShapeReport(report).forEach((line) => out(line));
    if (values['fail-on-unreadable'] && (report.unreadable > 0 || report.truncated)) {
      throw new Error(report.truncated ? 'The scan was truncated, so unreadable profiles may be missed' : `${report.unreadable} profile document(s) cannot be read by this build`);
    }
    return report;
  } finally {
    if (app) await deleteApp(app);
  }
}
