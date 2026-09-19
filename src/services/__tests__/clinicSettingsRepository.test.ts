import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClinicBrandConfig } from '../../types';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ seconds: 1 })),
}));

vi.mock('../firebase', () => ({ auth: { currentUser: null }, db: { name: 'test' } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  ...firestore,
}));

import { ClinicSettingsRepository } from '../clinicSettingsRepository';

const missing = (id: string) => ({ id, exists: () => false, data: () => undefined });
const found = (id: string, data: Record<string, unknown>) => ({ id, exists: () => true, data: () => data });

const brand: ClinicBrandConfig = {
  clinicId: 'clinic-1', name: 'North Clinic', tagline: 'Training', logoUrl: '/app-logo.png',
  primaryAccent: '#D16D4D', primaryHover: '#BA5B3D', primarySubtle: '#FBF2EE',
  onPrimary: '#FFFFFF', patientBaseSurface: '#F8F7F4', clinicianBaseSurface: '#FAFAFA',
  typographyStyle: 'editorial-serif', createdAt: '2026-01-01T00:00:00Z',
};

const memoryStorage = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
};

describe('ClinicSettingsRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an honest onboarding state with no fabricated identity', async () => {
    firestore.getDoc.mockResolvedValueOnce(missing('clinician-1')).mockResolvedValueOnce(missing('clinician-1'));
    const repository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-1' } }, database: {} as never, storage: memoryStorage() });

    await expect(repository.load()).resolves.toMatchObject({
      clinic: null, practitioner: null, clinicId: 'clinician-1', brand: null, needsOnboarding: true,
    });
  });

  it('resolves the clinic only through the signed-in practitioner membership', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: '', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'Other clinic', timezone: 'UTC', practitionerIds: ['someone-else'] }));
    const repository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-1' } }, database: {} as never, storage: memoryStorage() });

    await expect(repository.load()).rejects.toThrow('not a member of this clinic');
  });

  it('creates the clinic before its practitioner profile and stores no fake credential', async () => {
    firestore.getDoc
      .mockResolvedValueOnce(missing('clinician-1'))
      .mockResolvedValueOnce(missing('clinician-1'))
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinician-1', displayName: 'Dr. Real', credentials: [] }))
      .mockResolvedValueOnce(found('clinician-1', { name: 'Real Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    const repository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-1' } }, database: {} as never, storage: memoryStorage() });

    await repository.saveSettings({ clinicName: ' Real Clinic ', timezone: 'UTC', practitionerName: ' Dr. Real ', licenseIdentifier: '' });

    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    expect(firestore.setDoc.mock.calls[0][0]).toEqual({ collection: 'clinics', id: 'clinician-1' });
    expect(firestore.setDoc.mock.calls[1][0]).toEqual({ collection: 'practitioners', id: 'clinician-1' });
    expect(firestore.setDoc.mock.calls[1][1]).toMatchObject({ displayName: 'Dr. Real', credentials: [] });
  });

  it('uses only tenant-bound legacy branding and exposes it for explicit migration', async () => {
    const matchingStorage = memoryStorage({ waveable_brand_config: JSON.stringify(brand), waveable_brand_config_owner: 'clinic-1' });
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: '', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'North Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    const repository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-1' } }, database: {} as never, storage: matchingStorage });
    await expect(repository.load()).resolves.toMatchObject({ brandSource: 'legacy-local', brand: { clinicId: 'clinic-1' } });

    vi.clearAllMocks();
    const foreignStorage = memoryStorage({ waveable_brand_config: JSON.stringify(brand), waveable_brand_config_owner: 'clinic-1' });
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-2', { userId: 'clinician-2', clinicId: 'clinic-2', displayName: '', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-2', { name: 'South Clinic', timezone: 'UTC', practitionerIds: ['clinician-2'] }));
    const foreignRepository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-2' } }, database: {} as never, storage: foreignStorage });
    await expect(foreignRepository.load()).resolves.toMatchObject({ brandSource: 'default', brand: null });
  });

  it('persists branding under the resolved tenant and writes a tenant-scoped cache', async () => {
    const storage = memoryStorage();
    firestore.getDoc
      .mockResolvedValueOnce(found('clinician-1', { userId: 'clinician-1', clinicId: 'clinic-1', displayName: '', credentials: [] }))
      .mockResolvedValueOnce(found('clinic-1', { name: 'North Clinic', timezone: 'UTC', practitionerIds: ['clinician-1'] }));
    const repository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-1' } }, database: {} as never, storage });

    const saved = await repository.saveBrand({ ...brand, clinicId: 'untrusted-form-value' });

    expect(saved.clinicId).toBe('clinic-1');
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { collection: 'clinics', id: 'clinic-1' },
      expect.objectContaining({ branding: expect.objectContaining({ clinicId: 'clinic-1' }) }),
      { merge: true },
    );
    expect(JSON.parse(storage.values.get('waveable_brand_config:clinic:clinic-1') || '{}')).toMatchObject({ clinicId: 'clinic-1' });
  });

  it('rejects unauthenticated and demo identities instead of silently saving locally', async () => {
    const signedOut = new ClinicSettingsRepository({ auth: { currentUser: null }, database: {} as never, storage: memoryStorage() });
    await expect(signedOut.load()).rejects.toThrow('Sign in with a clinician account');
    const demo = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'demo-clinician' } }, database: {} as never, storage: memoryStorage() });
    await expect(demo.saveBrand(brand)).rejects.toThrow('Sign in with a clinician account');
  });

  it('propagates persistence failures instead of reporting a successful save', async () => {
    firestore.getDoc.mockResolvedValueOnce(missing('clinician-1')).mockResolvedValueOnce(missing('clinician-1'));
    firestore.setDoc.mockRejectedValueOnce(new Error('write denied'));
    const repository = new ClinicSettingsRepository({ auth: { currentUser: { uid: 'clinician-1' } }, database: {} as never, storage: memoryStorage() });

    await expect(repository.saveSettings({ clinicName: 'Clinic', timezone: 'UTC', practitionerName: 'Practitioner', licenseIdentifier: '' })).rejects.toThrow('write denied');
  });
});
