import { describe, expect, it } from 'vitest';
import type { ClientProfile } from '../../types';
import { readClientProfile, removeUndefined } from '../dataMappers';

const clientFixture = (): ClientProfile => ({
  id: 'patient-1',
  name: 'Patient One',
  email: 'patient@example.test',
  avatarUrl: '',
  status: 'active',
  brainMaps: [],
});

describe('client profile reader', () => {
  it('fills the document ID, brain maps and schema version for a legacy document', () => {
    const migrated = readClientProfile({ name: 'Legacy', email: 'legacy@example.test', status: 'active' }, 'legacy-1');

    expect(migrated.id).toBe('legacy-1');
    expect(migrated.brainMaps).toEqual([]);
    expect(migrated.schemaVersion).toBe(1);
  });

  it('preserves legacy clinician relationship fields as stored', () => {
    const legacy = { ...clientFixture(), clinicianId: undefined, linkedClinicianCode: 'legacy-clinician' };
    const migrated = readClientProfile(legacy);

    // The fields are frozen by the rules and cleared only by account deletion, so a
    // profile save must write back exactly what was read.
    expect(migrated.linkedClinicianCode).toBe('legacy-clinician');
    expect(migrated.clinicianId).toBeUndefined();
  });

  it('does not mutate the stored document', () => {
    const stored = { ...clientFixture(), id: '' };
    const snapshot = structuredClone(stored);
    readClientProfile(stored, 'patient-1');

    expect(stored).toEqual(snapshot);
  });
});

describe('removeUndefined', () => {
  it('removes nested undefined values without damaging Dates or timestamp sentinels', () => {
    const date = new Date('2026-09-15T12:00:00.000Z');
    const sentinel = Object.create({ firestoreSentinel: true }) as { value?: string };
    const cleaned = removeUndefined({ a: undefined, nested: { keep: 1, drop: undefined }, date, sentinel });

    expect(cleaned).toEqual({ nested: { keep: 1 }, date, sentinel });
    expect(cleaned.date).toBe(date);
    expect(cleaned.sentinel).toBe(sentinel);
  });
});
