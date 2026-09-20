import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import type { ClinicBrandConfig, ClinicProfile, PersistedTimestamp, PractitionerCredential, PractitionerProfile } from '../types';
import { auth, db } from './firebase';
import { createBrandPalette, isBrandAccentUsable } from './brandEngine';
import { isClinicianDemoWorkspace } from './clinicianDemoBoundary';

const LEGACY_BRAND_KEYS = ['waveable_brand_config', 'brainswell_brand_config', 'brainwell_brand_config'] as const;
const LEGACY_BRAND_OWNER_KEY = 'waveable_brand_config_owner';
const TENANT_BRAND_PREFIX = 'waveable_brand_config:clinic:';
const MAX_CLINIC_NAME = 120;
const MAX_PRACTITIONER_NAME = 120;
const MAX_LICENSE_IDENTIFIER = 120;
const MAX_TAGLINE = 180;
const MAX_LOGO_URL = 700_000;

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

interface CurrentUserLike { uid: string }
interface AuthLike { currentUser: CurrentUserLike | null }
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
const getBrowserStorage = (): StorageLike | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};
const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

const requireText = (value: string, label: string, maximum: number): string => {
  const normalized = clean(value);
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return normalized;
};

const optionalText = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') return '';
  return clean(value).slice(0, maximum);
};

export const isValidTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

const timestampString = (value: unknown): string | null => {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  if (value && typeof value === 'object') {
    const candidate = value as { seconds?: unknown; toDate?: unknown };
    if (typeof candidate.toDate === 'function') {
      const date = (candidate.toDate as () => Date)();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof candidate.seconds === 'number' && Number.isFinite(candidate.seconds)) {
      return new Date(candidate.seconds * 1000).toISOString();
    }
  }
  return null;
};

const safeLogoUrl = (value: unknown): string => {
  const candidate = optionalText(value, MAX_LOGO_URL);
  if (
    candidate.startsWith('/') ||
    candidate.startsWith('https://') ||
    candidate.startsWith('http://') ||
    candidate.startsWith('data:image/png;') ||
    candidate.startsWith('data:image/webp;') ||
    candidate.startsWith('data:image/svg+xml;')
  ) return candidate;
  return '/app-logo.png';
};

/** Maps persisted/untrusted branding to a complete safe palette or rejects it. */
export const mapClinicBrand = (value: unknown, expectedClinicId: string, rebind = false): ClinicBrandConfig | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!rebind && raw.clinicId !== expectedClinicId) return null;
  const name = optionalText(raw.name, MAX_CLINIC_NAME);
  const accent = typeof raw.primaryAccent === 'string' ? raw.primaryAccent.trim().toUpperCase() : '';
  if (!name || !isBrandAccentUsable(accent)) return null;
  const logoUrl = safeLogoUrl(raw.logoUrl);
  try {
    const mapped = createBrandPalette(accent, name, logoUrl);
    mapped.clinicId = expectedClinicId;
    mapped.tagline = optionalText(raw.tagline, MAX_TAGLINE);
    mapped.typographyStyle = raw.typographyStyle === 'modern-sans' ? 'modern-sans' : 'editorial-serif';
    mapped.createdAt = timestampString(raw.createdAt) ?? '';
    const updatedAt = timestampString(raw.updatedAt);
    if (updatedAt) mapped.updatedAt = updatedAt;
    mapped.schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
    return mapped;
  } catch {
    return null;
  }
};

const readLocalBrandValue = (raw: string | null, clinicId: string, rebind = false): ClinicBrandConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return mapClinicBrand(rebind && parsed && typeof parsed === 'object' ? { ...(parsed as object), clinicId } : parsed, clinicId);
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
  branding: mapClinicBrand(data.branding, id, true) ?? undefined,
});

const mapCredential = (value: unknown): PractitionerCredential | null => {
  if (!value || typeof value !== 'object') return null;
  const credential = value as PractitionerCredential;
  if (typeof credential.id !== 'string' || typeof credential.label !== 'string' || typeof credential.status !== 'string') return null;
  const { identifier, ...rest } = credential;
  return typeof identifier === 'string' ? { ...rest, identifier } : rest;
};

const mapPractitioner = (id: string, data: Partial<PractitionerProfile>): PractitionerProfile => ({
  ...data,
  id,
  userId: typeof data.userId === 'string' ? data.userId : '',
  clinicId: typeof data.clinicId === 'string' ? data.clinicId : '',
  displayName: typeof data.displayName === 'string' ? data.displayName : '',
  credentials: Array.isArray(data.credentials)
    ? data.credentials.map(mapCredential).filter((entry): entry is PractitionerCredential => entry !== null)
    : [],
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
    if (isClinicianDemoWorkspace()) {
      throw new Error('Clinic settings are unavailable in the sample clinician workspace.');
    }
    const user = this.authState.currentUser;
    if (!user) throw new Error('Sign in with a clinician account to manage clinic settings.');
    return user;
  }

  private async readPractitioner(userId: string): Promise<PractitionerProfile | null> {
    const snapshot = await getDoc(doc(this.database, 'practitioners', userId));
    if (!snapshot.exists()) return null;
    const practitioner = mapPractitioner(snapshot.id, snapshot.data() as Partial<PractitionerProfile>);
    if (practitioner.userId !== userId) throw new Error('The practitioner profile does not belong to the signed-in account.');
    return practitioner;
  }

  private async readClinicRecord(clinicId: string, userId: string): Promise<{ clinic: ClinicProfile; rawBrandCreatedAt?: unknown } | null> {
    const snapshot = await getDoc(doc(this.database, 'clinics', clinicId));
    if (!snapshot.exists()) return null;
    const raw = snapshot.data() as Partial<ClinicProfile>;
    const clinic = mapClinic(snapshot.id, raw);
    if (!clinic.practitionerIds.includes(userId)) throw new Error('The signed-in practitioner is not a member of this clinic.');
    const rawBrand = raw.branding && typeof raw.branding === 'object' ? raw.branding as unknown as Record<string, unknown> : null;
    return { clinic, rawBrandCreatedAt: rawBrand?.createdAt };
  }

  private async readClinic(clinicId: string, userId: string): Promise<ClinicProfile | null> {
    return (await this.readClinicRecord(clinicId, userId))?.clinic ?? null;
  }

  private readLocalBrand(clinicId: string): { brand: ClinicBrandConfig; source: BrandSource } | null {
    if (!this.storage) return null;
    try {
      const tenantBrand = readLocalBrandValue(this.storage.getItem(`${TENANT_BRAND_PREFIX}${clinicId}`), clinicId, true);
      if (tenantBrand) return { brand: tenantBrand, source: 'tenant-local' };
      const recordedOwner = this.storage.getItem(LEGACY_BRAND_OWNER_KEY);
      for (const key of LEGACY_BRAND_KEYS) {
        const legacy = readLocalBrandValue(this.storage.getItem(key), clinicId, recordedOwner === clinicId);
        if (legacy) return { brand: legacy, source: 'legacy-local' };
      }
    } catch {
      // Local storage is an optional migration/cache layer. Remote settings remain authoritative.
    }
    return null;
  }

  async load(): Promise<ClinicSettingsSnapshot> {
    const user = this.requireUser();
    const practitioner = await this.readPractitioner(user.uid);
    const clinicId = practitioner?.clinicId || user.uid;
    const clinic = await this.readClinic(clinicId, user.uid);
    const local = clinic?.branding ? null : this.readLocalBrand(clinicId);
    const identityComplete = Boolean(clinic?.name.trim() && clinic?.timezone.trim() && practitioner?.displayName.trim());
    return {
      clinic,
      practitioner,
      clinicId,
      brand: clinic?.branding ?? local?.brand ?? null,
      brandSource: clinic?.branding ? 'clinic' : local?.source ?? 'default',
      needsOnboarding: !identityComplete,
    };
  }

  async saveSettings(input: ClinicSettingsInput): Promise<ClinicSettingsSnapshot> {
    const user = this.requireUser();
    const clinicName = requireText(input.clinicName, 'Clinic name', MAX_CLINIC_NAME);
    const practitionerName = requireText(input.practitionerName, 'Practitioner name', MAX_PRACTITIONER_NAME);
    const timezone = requireText(input.timezone, 'Clinic timezone', 80);
    if (!isValidTimeZone(timezone)) throw new Error('Enter a valid IANA clinic timezone, such as America/Toronto.');
    const licenseIdentifier = clean(input.licenseIdentifier);
    if (licenseIdentifier.length > MAX_LICENSE_IDENTIFIER) throw new Error(`License identifier must be ${MAX_LICENSE_IDENTIFIER} characters or fewer.`);

    const existingPractitioner = await this.readPractitioner(user.uid);
    const clinicId = existingPractitioner?.clinicId || user.uid;
    const existingClinic = await this.readClinic(clinicId, user.uid);
    const timestamp = serverTimestamp() as unknown as PersistedTimestamp;
    const existingCredentials = existingPractitioner?.credentials ?? [];
    const existingPrimary = existingCredentials.find((credential) => credential.id === 'primary-license');
    const otherCredentials = existingCredentials.filter((credential) => credential.id !== 'primary-license');
    const existingIdentifier = typeof existingPrimary?.identifier === 'string' ? clean(existingPrimary.identifier) : '';
    const existingPrimaryIsValid = Boolean(
      existingIdentifier
      && existingPrimary
      && ['unverified', 'pending', 'verified', 'expired', 'revoked'].includes(existingPrimary.status),
    );
    let primaryCredential: PractitionerCredential | null = null;
    if (existingPrimary && existingPrimaryIsValid && existingIdentifier === licenseIdentifier) {
      primaryCredential = existingPrimary;
    } else if (licenseIdentifier) {
      if (existingPrimary) {
        const { verifiedAt: _verifiedAt, expiresAt: _expiresAt, ...preserved } = existingPrimary;
        primaryCredential = { ...preserved, identifier: licenseIdentifier, status: 'unverified' };
      } else {
        primaryCredential = { id: 'primary-license', type: 'other', label: 'Professional license or certification', identifier: licenseIdentifier, status: 'unverified' };
      }
    }
    const credentials: PractitionerCredential[] = primaryCredential ? [...otherCredentials, primaryCredential] : otherCredentials;
    const clinic: ClinicProfile = {
      id: clinicId,
      name: clinicName,
      timezone,
      practitionerIds: existingClinic?.practitionerIds ?? [user.uid],
      createdAt: existingClinic?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
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
    const batch = writeBatch(this.database);
    batch.set(doc(this.database, 'clinics', clinicId), withoutUndefined({ ...clinic }), { merge: true });
    batch.set(doc(this.database, 'practitioners', user.uid), withoutUndefined({ ...practitioner }), { merge: true });
    await batch.commit();
    return this.load();
  }

  async saveBrand(brand: ClinicBrandConfig): Promise<ClinicBrandConfig> {
    const user = this.requireUser();
    const existingPractitioner = await this.readPractitioner(user.uid);
    const clinicId = existingPractitioner?.clinicId || user.uid;
    const existingClinicRecord = await this.readClinicRecord(clinicId, user.uid);
    const existingClinic = existingClinicRecord?.clinic ?? null;
    if (!clean(brand.name) || clean(brand.name).length > MAX_CLINIC_NAME) throw new Error(`Clinic display name must be between 1 and ${MAX_CLINIC_NAME} characters.`);
    if (typeof brand.tagline !== 'string' || brand.tagline.trim().length > MAX_TAGLINE) throw new Error(`Clinic tagline must be ${MAX_TAGLINE} characters or fewer.`);
    if (typeof brand.logoUrl !== 'string' || brand.logoUrl.length > MAX_LOGO_URL) throw new Error('Clinic logo data is too large.');
    const safeBrand = mapClinicBrand({ ...brand, clinicId }, clinicId);
    if (!safeBrand) throw new Error('Clinic branding is invalid or does not meet contrast requirements.');
    const timestamp = serverTimestamp() as unknown as PersistedTimestamp;
    const authoritativeCreatedAt = existingClinicRecord?.rawBrandCreatedAt;
    const isNewBrand = authoritativeCreatedAt === undefined || authoritativeCreatedAt === null;
    const returnedBrand: ClinicBrandConfig = {
      ...safeBrand,
      createdAt: existingClinic?.branding?.createdAt ?? new Date().toISOString(),
      updatedAt: timestamp,
      schemaVersion: 1,
    };
    const persistedBrand = {
      ...returnedBrand,
      createdAt: isNewBrand ? timestamp : authoritativeCreatedAt,
      updatedAt: timestamp,
    };
    const clinic: ClinicProfile = {
      id: clinicId,
      name: existingClinic?.name || safeBrand.name,
      timezone: existingClinic?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      practitionerIds: existingClinic?.practitionerIds ?? [user.uid],
      branding: persistedBrand as ClinicBrandConfig,
      createdAt: existingClinic?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await setDoc(doc(this.database, 'clinics', clinicId), withoutUndefined({ ...clinic }), { merge: true });
    this.cacheBrandBestEffort(returnedBrand);
    return returnedBrand;
  }

  private cacheBrandBestEffort(brand: ClinicBrandConfig): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(`${TENANT_BRAND_PREFIX}${brand.clinicId}`, JSON.stringify(brand));
    } catch {
      // Firestore is authoritative. Quota/security failures in the optional cache must not turn a successful save into an error.
    }
  }
}

export const clinicSettingsRepository = new ClinicSettingsRepository();
