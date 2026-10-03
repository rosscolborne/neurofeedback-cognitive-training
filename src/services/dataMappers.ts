import type { ClientProfile } from '../types';

/** Read both current and legacy client documents without mutating Firestore data. */
export function readClientProfile(data: unknown, documentId?: string): ClientProfile {
  const raw = { ...(data as Record<string, unknown>) } as unknown as ClientProfile;
  return {
    ...raw,
    id: raw.id || documentId || '',
    brainMaps: Array.isArray(raw.brainMaps) ? raw.brainMaps : [],
    schemaVersion: raw.schemaVersion ?? 1,
  };
}

/** Firestore rejects undefined values, including nested ones. */
export function removeUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefined(item)) as T;
  }
  if (value instanceof Date || value === null || typeof value !== 'object') {
    return value;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, removeUndefined(entry)])
  ) as T;
}
