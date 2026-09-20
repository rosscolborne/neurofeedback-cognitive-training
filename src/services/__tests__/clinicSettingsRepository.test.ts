import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicBrandConfig } from '../../types';

const firestore = vi.hoisted(() => {
  const batchSet = vi.fn();
  const batchCommit = vi.fn();
  return {
    getDoc: vi.fn(), setDoc: vi.fn(), serverTimestamp: vi.fn(() => ({ seconds: 1 })),
    batchSet, batchCommit, writeBatch: vi.fn(() => ({ set: batchSet, commit: batchCommit })),
  };
});

vi.mock('../firebase', () => ({ auth: { currentUser: null }, db: { name: 'test' } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  ...firestore,
}));

import { ClinicSettingsRepository, mapClinicBrand } from '../clinicSettingsRepository';
import { activateClinicianDemoWorkspace, deactivateClinicianDemoWorkspace } from '../clinicianDemoBoundary';

const missing = (id: string) => ({ id, exists: () => false, data: () => undefined });
const found = (id: string, data: Record<string, unknown>) => ({ id, exists: () => true, data: () => data });
const brand: ClinicBrandConfig = {
  clinicId: 'clinic-1', name: 'North Clinic', tagline: 'Training', logoUrl: '/app-logo.png',
  primaryAccent: '#A8482F', primaryHover: '#8F3D28', primarySubtle: '#FBF2EE', onPrimary: '#FFFFFF',
  patientBaseSurface: '#F8F7F4', clinicianBaseSurface: '#FAFAFA', typographyStyle: 'editorial-serif',
  createdAt: '2026-01-01T00:00:00Z',
};

const memoryStorage = (seed: Record<string, string> = {}, failWrites = false) => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error('quota exceeded');
      values.set(key, value);
    },
    values,
  };
};

const throwingReadStorage = {
  getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  setItem: () => undefined,
};

const repositoryFor = (uid = 'clinician-1', storage: { getItem(key: string): string | null; setItem(key: string, value: string): void } = memoryStorage()) =>
  new ClinicSettingsRepository({ auth: { currentUser: { uid } }, database: {} as never, storage });

describe('ClinicSettingsRepository', () => {
  beforeEach(() => {
    deactivateClinicianDemoWorkspace();
    vi.clearAllMocks();
    firestore.setDoc.mockResolvedValue(undefined);
    firestore.batchCommit.mockResolvedValue(undefined);
  });

  it('returns blank onboarding without fabricated identity', async () => {
    firestore.getDoc.mockResolvedValueOnce(missing('clinician-1')).mockResolvedValueOnce(missing('clinician-1'));
    await expect(repositoryFor().load()).resolves.toMatchObject({
      clinic: null, practitioner: null, clinicId: 'clinician-1', brand: null, needsOnboarding: true,
    });
  });

  it('keeps brand-first setup in onboarding and does not manufacture a practitioner', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(missing('clinician-1'))
      .mockResolvedValueOnce(found('clinician-1', { name: 'Brand Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'], branding: { ...brand, clinicId: 'clinician-1' } }));
    const snapshot = await repositoryFor().load();
    expect(snapshot).toMatchObject({ practitioner: null, needsOnboarding: true, brandSource: 'clinic' });
  });

  it('rejects cross-tenant clinic membership', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: '', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Other', timezone: 'UTC', practitionerIds: ['someone-else'] }));
    await expect(repositoryFor().load()).rejects.toThrow('not a member');
  });

  it('commits clinic and practitioner settings atomically', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(missing('clinician-1')).mockResolvedValueOnce(missing('clinician-1'))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinician-1', displayName: 'Dr. Real', credentials: [] }))
      .mockResolvedValueOnce(found('clinician-1', { name: 'Real Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await repositoryFor().saveSettings({ clinicName: ' Real Clinic ', timezone: 'UTC', practitionerName: ' Dr. Real ', licenseIdentifier: '' });
    expect(firestore.batchSet).toHaveBeenCalledTimes(2);
    expect(firestore.batchSet.mock.calls[0][0]).toEqual({ collection: 'clinics', id: 'clinician-1' });
    expect(firestore.batchSet.mock.calls[1][0]).toEqual({ collection: 'practitioners', id: 'clinician-1' });
    expect(firestore.batchCommit).toHaveBeenCalledOnce();
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.batchSet.mock.calls[0][1]).not.toHaveProperty('branding');
  });

  it('does not rewrite mapped branding or its server timestamp during settings saves', async () => {
    const rawCreatedAt = { seconds: 91, nanoseconds: 4 };
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'], branding: { ...brand, createdAt: rawCreatedAt } }))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'], branding: { ...brand, createdAt: rawCreatedAt } }));
    await repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: '' });
    expect(firestore.batchSet.mock.calls[0][1]).not.toHaveProperty('branding');
  });

  it('preserves unrelated credentials and replaces only primary-license', async () => {
    const credentials = [
      { id: 'board-cert', type: 'board-certification', label: 'Board', identifier: 'BOARD-7', status: 'verified' },
      { id: 'primary-license', type: 'other', label: 'Old primary', identifier: 'OLD-1', status: 'unverified' },
    ];
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: 'NEW-2' });
    const payload = firestore.batchSet.mock.calls[1][1] as { credentials: Array<{ id: string; identifier?: string }> };
    expect(payload.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'board-cert', identifier: 'BOARD-7' }),
      expect.objectContaining({ id: 'primary-license', identifier: 'NEW-2' }),
    ]));
    expect(payload.credentials).not.toContainEqual(expect.objectContaining({ identifier: 'OLD-1' }));
  });

  it('preserves a verified primary license byte-for-byte when its identifier is unchanged', async () => {
    const verifiedAt = { seconds: 20 };
    const expiresAt = { seconds: 200 };
    const primary = {
      id: 'primary-license', type: 'medical-license', label: 'Ontario physician license', identifier: 'ON-123',
      status: 'verified', verifiedAt, expiresAt, jurisdiction: 'Ontario',
    };
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [primary] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [primary] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: 'ON-123' });
    const payload = firestore.batchSet.mock.calls[1][1] as { credentials: unknown[] };
    expect(payload.credentials).toEqual([primary]);
  });

  it('clears verification timestamps only when the primary identifier changes', async () => {
    const primary = {
      id: 'primary-license', type: 'medical-license', label: 'Ontario physician license', identifier: 'ON-123',
      status: 'verified', verifiedAt: { seconds: 20 }, expiresAt: { seconds: 200 }, jurisdiction: 'Ontario',
    };
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [primary] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: 'ON-999' });
    const payload = firestore.batchSet.mock.calls[1][1] as { credentials: Array<Record<string, unknown>> };
    expect(payload.credentials[0]).toMatchObject({ type: 'medical-license', label: 'Ontario physician license', identifier: 'ON-999', status: 'unverified', jurisdiction: 'Ontario' });
    expect(payload.credentials[0]).not.toHaveProperty('verifiedAt');
    expect(payload.credentials[0]).not.toHaveProperty('expiresAt');
  });

  it('removes a malformed primary credential when the identifier is cleared', async () => {
    const malformedPrimary = { id: 'primary-license', type: 'other', label: 'Legacy', identifier: 42, status: 'verified', verifiedAt: { seconds: 10 } };
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [malformedPrimary] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: '' });
    const payload = firestore.batchSet.mock.calls[1][1] as { credentials: Array<Record<string, unknown>> };
    expect(payload.credentials).toEqual([]);
  });

  it('replaces an unknown-status primary credential instead of preserving invalid verification claims', async () => {
    const invalidPrimary = { id: 'primary-license', type: 'other', label: 'Legacy', identifier: 'LEGACY-1', status: 'mystery', verifiedAt: { seconds: 10 } };
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [invalidPrimary] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: 'LEGACY-1' });
    const payload = firestore.batchSet.mock.calls[1][1] as { credentials: Array<Record<string, unknown>> };
    expect(payload.credentials[0]).toMatchObject({ id: 'primary-license', identifier: 'LEGACY-1', status: 'unverified' });
    expect(payload.credentials[0]).not.toHaveProperty('verifiedAt');
  });

  it('rejects invalid timezone and overlong text before writing', async () => {
    await expect(repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'Not/AZone', practitionerName: 'Name', licenseIdentifier: '' })).rejects.toThrow('valid IANA');
    await expect(repositoryFor().saveSettings({ clinicName: 'x'.repeat(121), timezone: 'UTC', practitionerName: 'Name', licenseIdentifier: '' })).rejects.toThrow('120');
    expect(firestore.writeBatch).not.toHaveBeenCalled();
  });

  it('does not expose malformed or low-contrast remote branding', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'], branding: { ...brand, primaryAccent: 'not-a-color' } }));
    await expect(repositoryFor().load()).resolves.toMatchObject({ brand: null, brandSource: 'default' });
    expect(mapClinicBrand({ ...brand, primaryAccent: '#D16D4D' }, 'clinic-1')).toBeNull();
    expect(mapClinicBrand({ ...brand, primaryHover: 'bad', onPrimary: 'bad', logoUrl: 'javascript:alert(1)' }, 'clinic-1')).toMatchObject({
      primaryHover: '#8f3d28', onPrimary: '#FFFFFF', logoUrl: '/app-logo.png',
    });
  });

  it('uses only validated tenant-bound migration data', async () => {
    const storage = memoryStorage({ waveable_brand_config: JSON.stringify({ ...brand, clinicId: 'old-slug' }), waveable_brand_config_owner: 'clinic-1' });
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await expect(repositoryFor('clinician-1', storage).load()).resolves.toMatchObject({ brandSource: 'legacy-local', brand: { clinicId: 'clinic-1' } });

    vi.clearAllMocks();
    const malformed = memoryStorage({ waveable_brand_config: '{bad', waveable_brand_config_owner: 'clinic-2' });
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-2', { userId: 'clinician-2', clinicId: 'clinic-2', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-2', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-2'] }));
    await expect(repositoryFor('clinician-2', malformed).load()).resolves.toMatchObject({ brand: null, brandSource: 'default' });
  });

  it('ignores localStorage read SecurityError and still returns remote/no-brand state', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await expect(repositoryFor('clinician-1', throwingReadStorage).load()).resolves.toMatchObject({ brand: null, brandSource: 'default' });
  });

  it('persists branding once, uses server timestamps, and never creates a blank practitioner', async () => {
    const storage = memoryStorage();
    firestore.getDoc.mockResolvedValueOnce(missing('clinician-1')).mockResolvedValueOnce(missing('clinician-1'));
    const saved = await repositoryFor('clinician-1', storage).saveBrand({ ...brand, clinicId: 'untrusted' });
    expect(saved.clinicId).toBe('clinician-1');
    const payload = firestore.setDoc.mock.calls[0][1] as { branding: Record<string, unknown> };
    expect(payload.branding).toMatchObject({ clinicId: 'clinician-1', createdAt: { seconds: 1 }, updatedAt: { seconds: 1 } });
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(firestore.batchSet).not.toHaveBeenCalled();
    expect(storage.values.has('waveable_brand_config')).toBe(false);
    expect(storage.values.has('waveable_brand_config_owner')).toBe(false);
  });

  it('does not turn optional cache failure into an authoritative save failure', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    await expect(repositoryFor('clinician-1', memoryStorage({}, true)).saveBrand(brand)).resolves.toMatchObject({ clinicId: 'clinic-1' });
  });

  it('preserves the authoritative raw brand createdAt on brand updates', async () => {
    const rawCreatedAt = { seconds: 77, nanoseconds: 9 };
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: 'Name', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'], branding: { ...brand, createdAt: rawCreatedAt } }));
    await repositoryFor().saveBrand(brand);
    const payload = firestore.setDoc.mock.calls[0][1] as { branding: Record<string, unknown> };
    expect(payload.branding.createdAt).toBe(rawCreatedAt);
    expect(payload.branding.updatedAt).toEqual({ seconds: 1 });
  });

  it('reports atomic commit failure and performs no post-save reload', async () => {
    firestore.getDoc.mockResolvedValueOnce(missing('clinician-1')).mockResolvedValueOnce(missing('clinician-1'));
    firestore.batchCommit.mockRejectedValueOnce(new Error('write denied'));
    await expect(repositoryFor().saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Practitioner', licenseIdentifier: '' })).rejects.toThrow('write denied');
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
  });

  it('rejects signed-out access', async () => {
    const signedOut = new ClinicSettingsRepository({ auth: { currentUser: null }, database: {} as never, storage: memoryStorage() });
    await expect(signedOut.load()).rejects.toThrow('Sign in with a clinician account');
  });

  it('denies demo-workspace settings before any network access', async () => {
    activateClinicianDemoWorkspace();
    const repository = repositoryFor('real-session-still-present');
    await expect(repository.load()).rejects.toThrow('unavailable in the sample clinician workspace');
    await expect(repository.saveBrand(brand)).rejects.toThrow('unavailable in the sample clinician workspace');
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
    deactivateClinicianDemoWorkspace();
  });
});
