import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { ClinicBrandConfig, ClinicProfile, PersistedTimestamp, PractitionerProfile } from '../types';
import { auth, db } from './firebase';

const LEGACY_BRAND_KEYS = [
  'waveable_brand_config',
  'brainswell_brand_config',
  'brainwell_brand_config',
] as const;
const LEGACY_BRAND_OWNER_KEY = 'waveable_brand_config_owner';
const TENANT_BRAND_PREFIX = 'waveable_brand_config:clinic:';

type BrandSource = 'clinic' | 'tenant-local' | 'legacy-local' | 'default';

export interface ClinicSettingsSnapshot {
  clinic: ClinicProfile | null;
  practitioner: PractitionerProfile | null;
  brand: ClinicBrandConfig | null;
  brandSource: BrandSource;
  clinicId: string;
  needsOnboarding: boolean;
}

export interface ClinicSettingsInput {
  clinicName: string;
  timezone: string;
  practitionerName: string;
  licenseIdentifier: string;
}

interface CurrentUserLike {
  uid: string;
}

interface AuthLike {
  currentUser: CurrentUserLike | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface RepositoryDependencies {
  auth: AuthLike;
  database: typeof db;
  storage?: StorageLike;
}

const clean = (value: string) => value.trim();

const getBrowserStorage = (): StorageLike | undefined =>
  typeof window === 'undefined' ? undefined : window.localStorage;

const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const readBrand = (raw: string | null): ClinicBrandConfig | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ClinicBrandConfig>;
    if (
      typeof value.clinicId !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.primaryAccent !== 'string' ||
      typeof value.primaryHover !== 'string' ||
      typeof value.primarySubtle !== 'string' ||
      typeof value.onPrimary !== 'string'
    ) return null;
    return value as ClinicBrandConfig;
  } catch {
    return null;
  }
};

const mapClinic = (id: string, data: Partial<ClinicProfile>): ClinicProfile => ({
  ...data,
  id,
  name: typeof data.name === 'string' ? data.name : '',
  timezone: typeof data.timezone === 'string' ? data.timezone : '',
  practitionerIds: Array.isArray(data.practitionerIds)
    ? data.practitionerIds.filter((entry): entry is string => typeof entry === 'string')
    : [],
});

const mapPractitioner = (id: string, data: Partial<PractitionerProfile>): PractitionerProfile => ({
  ...data,
  id,
  userId: typeof data.userId === 'string' ? data.userId : '',
  clinicId: typeof data.clinicId === 'string' ? data.clinicId : '',
  displayName: typeof data.displayName === 'string' ? data.displayName : '',
  credentials: Array.isArray(data.credentials) ? data.credentials : [],
});

export class ClinicSettingsRepository {
  private readonly authState: AuthLike;
  private readonly database: typeof db;
  private readonly storage?: StorageLike;

  constructor(dependencies: RepositoryDependencies = { auth, database: db, storage: getBrowserStorage() }) {
    this.authState = dependencies.auth;
    this.database = dependencies.database;
    this.storage = dependencies.storage;
  }

  private requireUser(): CurrentUserLike {
    const user = this.authState.currentUser;
    if (!user || user.uid === 'demo-clinician') {
      throw new Error('Sign in with a clinician account to manage clinic settings.');
    }
    return user;
  }

  private async readPractitioner(userId: string): Promise<PractitionerProfile | null> {
    const snapshot = await getDoc(doc(this.database, 'practitioners', userId));
    if (!snapshot.exists()) return null;
    const practitioner = mapPractitioner(snapshot.id, snapshot.data() as Partial<PractitionerProfile>);
    if (practitioner.userId !== userId) {
      throw new Error('The practitioner profile does not belong to the signed-in account.');
    }
    return practitioner;
  }

  private async readClinic(clinicId: string, userId: string): Promise<ClinicProfile | null> {
    const snapshot = await getDoc(doc(this.database, 'clinics', clinicId));
    if (!snapshot.exists()) return null;
    const clinic = mapClinic(snapshot.id, snapshot.data() as Partial<ClinicProfile>);
    if (!clinic.practitionerIds.includes(userId)) {
      throw new Error('The signed-in practitioner is not a member of this clinic.');
    }
    return clinic;
  }

  private readLocalBrand(clinicId: string): { brand: ClinicBrandConfig; source: BrandSource } | null {
    if (!this.storage) return null;
    const tenantBrand = readBrand(this.storage.getItem(`${TENANT_BRAND_PREFIX}${clinicId}`));
    if (tenantBrand?.clinicId === clinicId) return { brand: tenantBrand, source: 'tenant-local' };

    const recordedOwner = this.storage.getItem(LEGACY_BRAND_OWNER_KEY);
    for (const key of LEGACY_BRAND_KEYS) {
      const legacy = readBrand(this.storage.getItem(key));
      if (legacy && (recordedOwner === clinicId || legacy.clinicId === clinicId)) {
        return { brand: { ...legacy, clinicId }, source: 'legacy-local' };
      }
    }
    return null;
  }

  async load(): Promise<ClinicSettingsSnapshot> {
    const user = this.requireUser();
    const practitioner = await this.readPractitioner(user.uid);
    const clinicId = practitioner?.clinicId || user.uid;
    const clinic = await this.readClinic(clinicId, user.uid);
    const local = clinic?.branding ? null : this.readLocalBrand(clinicId);
    return {
      clinic,
      practitioner,
      clinicId,
      brand: clinic?.branding ?? local?.brand ?? null,
      brandSource: clinic?.branding ? 'clinic' : local?.source ?? 'default',
      needsOnboarding: !clinic || !practitioner,
    };
  }

  async saveSettings(input: ClinicSettingsInput): Promise<ClinicSettingsSnapshot> {
    const user = this.requireUser();
    const clinicName = clean(input.clinicName);
    const practitionerName = clean(input.practitionerName);
    const timezone = clean(input.timezone);
    if (!clinicName) throw new Error('Clinic name is required.');
    if (!practitionerName) throw new Error('Practitioner name is required.');
    if (!timezone) throw new Error('Clinic timezone is required.');

    const existingPractitioner = await this.readPractitioner(user.uid);
    const clinicId = existingPractitioner?.clinicId || user.uid;
    const existingClinic = await this.readClinic(clinicId, user.uid);
    const timestamp = serverTimestamp() as unknown as PersistedTimestamp;
    const clinic: ClinicProfile = {
      id: clinicId,
      name: clinicName,
      timezone,
      practitionerIds: existingClinic?.practitionerIds ?? [user.uid],
      branding: existingClinic?.branding,
      createdAt: existingClinic?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await setDoc(doc(this.database, 'clinics', clinicId), withoutUndefined({ ...clinic }), { merge: true });

    const licenseIdentifier = clean(input.licenseIdentifier);
    const otherCredentials = (existingPractitioner?.credentials ?? []).filter((credential) => credential.id !== 'primary-license');
    const credentials = licenseIdentifier
      ? [...otherCredentials, {
          id: 'primary-license',
          type: 'other' as const,
          label: 'Professional license or certification',
          identifier: licenseIdentifier,
          status: 'unverified' as const,
        }]
      : otherCredentials;
    const practitioner: PractitionerProfile = {
      id: user.uid,
      userId: user.uid,
      clinicId,
      displayName: practitionerName,
      professionalSuffixes: existingPractitioner?.professionalSuffixes,
      credentials,
      createdAt: existingPractitioner?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await setDoc(doc(this.database, 'practitioners', user.uid), withoutUndefined({ ...practitioner }), { merge: true });
    return this.load();
  }

  async saveBrand(brand: ClinicBrandConfig): Promise<ClinicBrandConfig> {
    const user = this.requireUser();
    const existingPractitioner = await this.readPractitioner(user.uid);
    const clinicId = existingPractitioner?.clinicId || user.uid;
    const existingClinic = await this.readClinic(clinicId, user.uid);
    const name = clean(brand.name);
    if (!name) throw new Error('Clinic display name is required.');
    const timestamp = serverTimestamp() as unknown as PersistedTimestamp;
    const persistedBrand: ClinicBrandConfig = {
      ...brand,
      clinicId,
      name,
      createdAt: existingClinic?.branding?.createdAt || brand.createdAt,
      updatedAt: timestamp,
      schemaVersion: 1,
    };
    const clinic: ClinicProfile = {
      id: clinicId,
      name: existingClinic?.name || name,
      timezone: existingClinic?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      practitionerIds: existingClinic?.practitionerIds ?? [user.uid],
      branding: persistedBrand,
      createdAt: existingClinic?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await setDoc(doc(this.database, 'clinics', clinicId), withoutUndefined({ ...clinic }), { merge: true });

    if (!existingPractitioner) {
      const practitioner: PractitionerProfile = {
        id: user.uid,
        userId: user.uid,
        clinicId,
        displayName: '',
        credentials: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await setDoc(doc(this.database, 'practitioners', user.uid), practitioner, { merge: true });
    }
    this.cacheBrand(persistedBrand);
    return persistedBrand;
  }

  private cacheBrand(brand: ClinicBrandConfig): void {
    if (!this.storage) return;
    const serialized = JSON.stringify(brand);
    this.storage.setItem(`${TENANT_BRAND_PREFIX}${brand.clinicId}`, serialized);
    this.storage.setItem(LEGACY_BRAND_KEYS[0], serialized);
    this.storage.setItem(LEGACY_BRAND_OWNER_KEY, brand.clinicId);
  }
}

export const clinicSettingsRepository = new ClinicSettingsRepository();
