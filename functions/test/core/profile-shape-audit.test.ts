import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { PROFILE_SHAPE_NAMES, PROFILE_SHAPES } from '../../../shared/__tests__/profileShapes';
import { classifyProfile, firestoreProfileDocuments, runProfileShapeAudit } from '../../scripts/profileShapeAudit';
import { CORE_PROJECT, emulatorFirestore } from '../helpers/emulator';

// The read-only profile shape audit (functions/scripts/profileShapeAudit.ts),
// against the Firestore emulator. Each run reads its own collection, so other
// suites' users/* documents do not change the counts.

const { db, close } = emulatorFirestore(CORE_PROJECT);
afterAll(close);

const env = { FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST };
const shapeInput = (n: number) => ({ displayName: `Player ${n}`, email: `player-${n}@example.test`, now: Timestamp.fromMillis(1_790_000_000_000) });

/** A collection holding `counts[shape]` profiles of each historical shape. */
async function seedShapes(counts: Partial<Record<(typeof PROFILE_SHAPE_NAMES)[number], number>>): Promise<string> {
  const collection = `profile-audit-${randomUUID()}`;
  let n = 0;
  for (const [shape, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      await db.doc(`${collection}/uid-${String(n).padStart(3, '0')}`).set(PROFILE_SHAPES[shape as keyof typeof PROFILE_SHAPES].build(shapeInput(n)));
    }
  }
  return collection;
}

describe('classifyProfile', () => {
  it.each(PROFILE_SHAPE_NAMES)('agrees with the app about the %s shape', (shape) => {
    expect(classifyProfile(PROFILE_SHAPES[shape].build(shapeInput(1))).readable).toBe(PROFILE_SHAPES[shape].appReads === 'readable');
  });

  it('names the version, keys and issues, never field values', () => {
    const legacy = classifyProfile(PROFILE_SHAPES['legacy-signup'].build(shapeInput(1)));
    expect(legacy).toEqual({ schemaVersion: 'absent', keys: ['createdAt', 'displayName', 'email', 'role', 'updatedAt'], readable: false, reason: 'unsupported schemaVersion' });

    const broken = classifyProfile({ ...PROFILE_SHAPES.current.build(shapeInput(1)), displayName: 42 });
    expect(broken).toMatchObject({ schemaVersion: '1', readable: false, reason: 'displayName: invalid_type' });
    expect(JSON.stringify(broken)).not.toContain('42');
    expect(classifyProfile({ schemaVersion: '1' }).schemaVersion).toBe('"1"');
  });
});

describe('audit-profile-shapes', () => {
  const lines: string[] = [];
  const out = (line: string) => void lines.push(line);

  it('counts every document by shape across pages, reads only, and prints no values', async () => {
    const collection = await seedShapes({ current: 2, 'legacy-signup': 4, 'future-version': 1 });
    const before = (await db.collection(collection).get()).docs.map((doc) => [doc.id, doc.updateTime.toMillis()]);
    lines.length = 0;

    const report = await runProfileShapeAudit(['--project', CORE_PROJECT, '--page-size', '2'], env, out, { documents: firestoreProfileDocuments(db, collection) });

    expect(report).toMatchObject({ projectId: CORE_PROJECT, scanned: 7, readable: 2, unreadable: 5, truncated: false });
    expect(report.groups.map(({ count, readable, schemaVersion }) => [count, readable, schemaVersion])).toEqual([
      [4, false, 'absent'],
      [2, true, '1'],
      [1, false, '2'],
    ]);
    expect(report.groups.every((group) => group.examples.length === 0)).toBe(true);
    expect(lines.join('\n')).not.toMatch(/@example\.test|Player \d|uid-/);
    expect(lines.at(-1)).toContain('5 account(s) would see');
    // Nothing was written.
    expect((await db.collection(collection).get()).docs.map((doc) => [doc.id, doc.updateTime.toMillis()])).toEqual(before);
  });

  it('names example documents only when asked, and fails as a gate on unreadable or truncated scans', async () => {
    const collection = await seedShapes({ current: 2, 'legacy-signup': 1 });
    const documents = firestoreProfileDocuments(db, collection);
    lines.length = 0;

    const report = await runProfileShapeAudit(['--project', CORE_PROJECT, '--examples', '1'], env, out, { documents });
    expect(report.groups.find((group) => !group.readable)?.examples).toEqual(['uid-003']);
    expect(lines).toContain('  e.g. uid-003');

    await expect(runProfileShapeAudit(['--project', CORE_PROJECT, '--fail-on-unreadable'], env, out, { documents }))
      .rejects.toThrow('1 profile document(s) cannot be read by this build');

    const readableOnly = firestoreProfileDocuments(db, await seedShapes({ current: 3 }));
    await expect(runProfileShapeAudit(['--project', CORE_PROJECT, '--fail-on-unreadable'], env, out, { documents: readableOnly }))
      .resolves.toMatchObject({ scanned: 3, unreadable: 0, truncated: false });
    const truncated = await runProfileShapeAudit(['--project', CORE_PROJECT, '--max-docs', '2'], env, out, { documents: readableOnly });
    expect(truncated).toMatchObject({ scanned: 2, truncated: true });
    await expect(runProfileShapeAudit(['--project', CORE_PROJECT, '--max-docs', '2', '--fail-on-unreadable'], env, out, { documents: readableOnly }))
      .rejects.toThrow('truncated');
    await expect(runProfileShapeAudit(['--project', CORE_PROJECT, '--max-docs', '3'], env, out, { documents: readableOnly }))
      .resolves.toMatchObject({ scanned: 3, truncated: false });
  });

  it('keeps cli.ts\'s target rules', async () => {
    await expect(runProfileShapeAudit(['--project', 'nfct-dev'], {}, out)).rejects.toThrow('--live');
    await expect(runProfileShapeAudit(['--project', 'nfct-dev', '--live'], env, out)).rejects.toThrow('demo-*');
    await expect(runProfileShapeAudit(['--project', CORE_PROJECT, '--examples', '9'], env, out)).rejects.toThrow('--examples');
  });
});
